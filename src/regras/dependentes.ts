// Inclusão, remoção e exceção de dependentes (PRD 2.3).
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Banco } from "../banco/conexao";
import {
  adicional,
  configuracao,
  contrato,
  excecaoVaga,
  pessoa,
  precoAdicional,
  versaoAdicional,
  versaoContrato,
  vida,
} from "../banco/esquema";
import { AUTOR_PADRAO, buscarCobertura, ehIdValido } from "./contratos";
import { cpfValido, limparCpf } from "./cpf";
import { NOME_STATUS } from "./nomes";
import {
  aplicarCupom,
  calcularIdade,
  faixaDaIdade,
  podeContratarNovaFaixa,
  type FaixaPreco,
} from "./precos";
import { dataExiste, hojeEmSaoPaulo, limparTexto } from "./titular";
import { adicionarDias, calcularVagas, type SituacaoVagas } from "./vagas";

type Transacao = Parameters<Parameters<Banco["transaction"]>[0]>[0];
type LeituraBanco = Pick<Banco, "select">;

export const TIPOS_EXCECAO = ["nascimento", "obito", "divorcio"] as const;
export type TipoExcecao = (typeof TIPOS_EXCECAO)[number];

const INCLUIDOS_PADRAO = 3;
const DIAS_BLOQUEIO_PADRAO = 90;
const IDADE_CPF_PADRAO = 18;

export type EntradaDependente = {
  nome: string;
  cpf: string;
  dataNascimento: string;
  parentesco: string;
  /** Devolvida pela tela para confirmar exatamente o que foi mostrado. */
  confirmacao: string;
};

export type CampoDependente = "nome" | "cpf" | "dataNascimento" | "parentesco" | "geral";
export type ErrosDependente = Partial<Record<CampoDependente, string>>;

export type PreviaInclusao = {
  assinatura: string;
  pessoaExistente: string | null;
  serExtra: boolean;
  valorExtraCentavos: number;
  valorFuneralCentavos: number;
  /** Contrato com funeral, mas esta vida não pode contratá-lo por causa da idade. */
  semFuneralPorIdade: boolean;
  valorAtualCentavos: number;
  valorNovoCentavos: number;
};

export type ResultadoInclusao =
  | { status: "ok"; novaVersao: boolean }
  | { status: "erro"; erros: ErrosDependente }
  | { status: "bloqueada"; liberaEm: string; excecaoPendente: boolean }
  | { status: "confirmar"; previa: PreviaInclusao };

export type ResultadoSimples = { ok: true } | { ok: false; erro: string };

async function config(db: LeituraBanco, chave: string, padrao: number) {
  const [linha] = await db
    .select({ valor: configuracao.valor })
    .from(configuracao)
    .where(eq(configuracao.chave, chave))
    .limit(1);
  return typeof linha?.valor === "number" ? linha.valor : padrao;
}

async function faixasDe(db: LeituraBanco, tipo: "funeral" | "dependente_extra", hoje: string) {
  const linhas = (await db
    .select({
      idadeMinima: precoAdicional.idadeMinima,
      idadeMaxima: precoAdicional.idadeMaxima,
      valorCentavos: precoAdicional.valorCentavos,
      idadeMaximaNovaContratacao: precoAdicional.idadeMaximaNovaContratacao,
      vigenciaInicio: precoAdicional.vigenciaInicio,
      vigenciaFim: precoAdicional.vigenciaFim,
    })
    .from(precoAdicional)
    .innerJoin(adicional, eq(adicional.id, precoAdicional.adicionalId))
    .where(eq(adicional.tipo, tipo))
    .orderBy(asc(precoAdicional.idadeMinima)));
  return linhas.filter(
    (f) => f.vigenciaInicio <= hoje && (f.vigenciaFim === null || f.vigenciaFim >= hoje),
  ) as FaixaPreco[];
}

async function carregarContexto(db: LeituraBanco, contratoId: string, hoje: string) {
  const [dadosContrato] = await db
    .select({ id: contrato.id, status: contrato.status, numero: contrato.numero })
    .from(contrato)
    .where(eq(contrato.id, contratoId))
    .limit(1);
  if (!dadosContrato) return null;

  const [versao] = await db
    .select()
    .from(versaoContrato)
    .where(and(eq(versaoContrato.contratoId, contratoId), isNull(versaoContrato.vigenciaFim)))
    .limit(1);
  if (!versao) return null;

  const adicionais = await db
    .select({ adicionalId: versaoAdicional.adicionalId, tipo: adicional.tipo })
    .from(versaoAdicional)
    .innerJoin(adicional, eq(adicional.id, versaoAdicional.adicionalId))
    .where(eq(versaoAdicional.versaoId, versao.id));

  const vidas = await db
    .select({
      id: vida.id,
      pessoaId: vida.pessoaId,
      nome: pessoa.nome,
      dataNascimento: pessoa.dataNascimento,
      papel: vida.papel,
      dataEntrada: vida.dataEntrada,
      dataSaida: vida.dataSaida,
      carencia: vida.carenciaFuneralInicio,
      valorFuneral: vida.valorFuneralCentavos,
      valorExtra: vida.valorExtraCentavos,
      vagaBloqueadaAte: vida.vagaBloqueadaAte,
    })
    .from(vida)
    .innerJoin(pessoa, eq(pessoa.id, vida.pessoaId))
    .where(eq(vida.contratoId, contratoId))
    .orderBy(asc(vida.dataEntrada), asc(vida.criadoEm), asc(vida.id));

  const excecoes = await db.select().from(excecaoVaga).where(eq(excecaoVaga.contratoId, contratoId));

  const ativas = vidas.filter((v) => v.dataSaida === null);
  const dependentes = ativas.filter((v) => v.papel === "dependente");
  const liberadas = new Set(
    excecoes.filter((e) => e.status === "aprovada").map((e) => e.vidaRemovidaId),
  );
  const bloqueadoras = vidas
    .filter((v) => v.vagaBloqueadaAte !== null && hoje < v.vagaBloqueadaAte && !liberadas.has(v.id))
    .sort((a, b) => (a.vagaBloqueadaAte as string).localeCompare(b.vagaBloqueadaAte as string));

  const incluidos = await config(db, "dependentes_incluidos", INCLUIDOS_PADRAO);
  const vagas = calcularVagas(
    dependentes.map((d) => d.id),
    bloqueadoras.map((b) => b.vagaBloqueadaAte as string),
    incluidos,
    hoje,
  );

  return {
    contrato: dadosContrato,
    versao,
    adicionais,
    temFuneral: adicionais.some((a) => a.tipo === "funeral"),
    vidas,
    ativas,
    dependentes,
    bloqueadoras,
    excecoes,
    incluidos,
    vagas,
  };
}

type Contexto = NonNullable<Awaited<ReturnType<typeof carregarContexto>>>;
type VersaoContrato = Contexto["versao"];

/** O que a versão deveria guardar, considerando as vidas ativas e quem paga como extra. */
function valoresEsperados(
  versao: VersaoContrato,
  ativas: { id: string; valorFuneral: number; valorExtra: number }[],
  extras: string[],
) {
  const valorFuneralCentavos = ativas.reduce((total, v) => total + v.valorFuneral, 0);
  const valorDependenteExtraCentavos = ativas
    .filter((v) => extras.includes(v.id))
    .reduce((total, v) => total + v.valorExtra, 0);
  const cupom =
    versao.cupomPercentual !== null && versao.cupomRecorrente !== null
      ? { percentual: versao.cupomPercentual, recorrente: versao.cupomRecorrente }
      : null;
  return {
    valorFuneralCentavos,
    valorDependenteExtraCentavos,
    ...aplicarCupom(
      versao.valorPlanoCentavos + valorFuneralCentavos + valorDependenteExtraCentavos,
      cupom,
    ),
  };
}

function versaoMudou(versao: VersaoContrato, esperados: ReturnType<typeof valoresEsperados>) {
  return (
    versao.valorFuneralCentavos !== esperados.valorFuneralCentavos ||
    versao.valorDependenteExtraCentavos !== esperados.valorDependenteExtraCentavos ||
    versao.valorMensalCentavos !== esperados.valorMensalCentavos
  );
}

/** Mudou o valor: encerra a versão vigente e cria outra, sem aditivo (decisão provisória 7). */
async function gravarNovaVersao(
  tx: Transacao,
  contexto: Contexto,
  esperados: ReturnType<typeof valoresEsperados>,
  motivo: string,
  hoje: string,
  autor: string,
) {
  const { versao } = contexto;
  await tx
    .update(versaoContrato)
    .set({ vigenciaFim: hoje })
    .where(eq(versaoContrato.id, versao.id));
  const [nova] = await tx
    .insert(versaoContrato)
    .values({
      contratoId: versao.contratoId,
      numero: versao.numero + 1,
      planoId: versao.planoId,
      composicao: versao.composicao,
      formaPagamento: versao.formaPagamento,
      diaVencimento: versao.diaVencimento,
      valorPlanoCentavos: versao.valorPlanoCentavos,
      cupomId: versao.cupomId,
      cupomPercentual: versao.cupomPercentual,
      cupomRecorrente: versao.cupomRecorrente,
      ...esperados,
      vigenciaInicio: hoje,
      motivo,
      autor,
    })
    .returning({ id: versaoContrato.id });
  if (contexto.adicionais.length > 0) {
    await tx.insert(versaoAdicional).values(
      contexto.adicionais.map((a) => ({ versaoId: nova.id, adicionalId: a.adicionalId })),
    );
  }
}

function validarEntrada(entrada: EntradaDependente, hoje: string) {
  const dados = {
    nome: limparTexto(entrada.nome),
    cpf: limparCpf(entrada.cpf),
    dataNascimento: entrada.dataNascimento.trim(),
    parentesco: limparTexto(entrada.parentesco),
  };
  const erros: ErrosDependente = {};
  if (dados.cpf && !cpfValido(dados.cpf)) erros.cpf = "CPF inválido";
  if (!dados.parentesco) erros.parentesco = "Informe o parentesco";
  return { dados, erros, hoje };
}

function erroDeStatus(status: string) {
  return status === "cancelado" ? "Contrato cancelado não pode ter dependentes alterados" : null;
}

function descreverCobertura(cobertura: { numero: number; status: string; papel: string }) {
  const papel = cobertura.papel === "titular" ? "titular" : "dependente";
  return `Este CPF já está no contrato nº ${cobertura.numero} como ${papel} (status ${NOME_STATUS[cobertura.status]})`;
}

export async function incluirDependente(
  db: Banco,
  contratoId: string,
  entrada: EntradaDependente,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoInclusao> {
  if (!ehIdValido(contratoId)) return { status: "erro", erros: { geral: "Contrato não encontrado" } };
  const { dados, erros } = validarEntrada(entrada, hoje);

  try {
    return await db.transaction(async (tx): Promise<ResultadoInclusao> => {
      // Trava o contrato: duas inclusões ao mesmo tempo não podem usar a mesma vaga.
      await tx.select({ id: contrato.id }).from(contrato).where(eq(contrato.id, contratoId)).for("update");
      const contexto = await carregarContexto(tx, contratoId, hoje);
      if (!contexto) return { status: "erro", erros: { geral: "Contrato não encontrado" } };

      const erroStatus = erroDeStatus(contexto.contrato.status);
      if (erroStatus) return { status: "erro", erros: { geral: erroStatus } };
      if (contexto.versao.composicao === "individual") {
        return { status: "erro", erros: { geral: "Contrato individual não aceita dependentes" } };
      }

      // CPF já cadastrado: usa a pessoa existente, em vez de duplicar.
      const [existente] =
        dados.cpf && !erros.cpf
          ? await tx
              .select({ id: pessoa.id, nome: pessoa.nome, dataNascimento: pessoa.dataNascimento })
              .from(pessoa)
              .where(eq(pessoa.cpf, dados.cpf))
              .for("update")
          : [];

      if (!existente) {
        if (dados.nome.split(" ").length < 2) erros.nome = "Informe o nome completo";
        if (!dados.dataNascimento) {
          erros.dataNascimento = "Informe a data de nascimento";
        } else if (!dataExiste(dados.dataNascimento) || dados.dataNascimento < "1900-01-01") {
          erros.dataNascimento = "Data de nascimento inválida";
        } else if (dados.dataNascimento > hoje) {
          erros.dataNascimento = "A data de nascimento não pode ser no futuro";
        }
      }

      const nascimento = existente?.dataNascimento ?? dados.dataNascimento;
      const idade = erros.dataNascimento ? null : calcularIdade(nascimento, hoje);
      const idadeCpf = await config(tx, "idade_cpf_dependente_obrigatorio", IDADE_CPF_PADRAO);
      if (!dados.cpf && idade !== null && idade >= idadeCpf) {
        erros.cpf = `CPF obrigatório a partir de ${idadeCpf} anos`;
      }
      if (Object.keys(erros).length > 0 || idade === null) return { status: "erro", erros };

      if (existente) {
        const cobertura = await buscarCobertura(tx, existente.id);
        if (cobertura) return { status: "erro", erros: { cpf: descreverCobertura(cobertura) } };
      }

      // Vaga bloqueada não aceita ninguém, nem pagando como extra (decisão provisória 5).
      const [bloqueadora] = contexto.bloqueadoras;
      if (bloqueadora) {
        return {
          status: "bloqueada",
          liberaEm: bloqueadora.vagaBloqueadaAte as string,
          excecaoPendente: contexto.excecoes.some((e) => e.status === "pendente"),
        };
      }

      const faixasFuneral = await faixasDe(tx, "funeral", hoje);
      const comFuneral = contexto.temFuneral && podeContratarNovaFaixa(faixasFuneral, idade);
      const valorFuneral = comFuneral ? faixaDaIdade(faixasFuneral, idade).valorCentavos : 0;
      const valorExtra = faixaDaIdade(await faixasDe(tx, "dependente_extra", hoje), idade).valorCentavos;

      const idNovo = "nova-vida";
      const vagasDepois = calcularVagas(
        [...contexto.dependentes.map((d) => d.id), idNovo],
        contexto.vagas.bloqueiosVigentes,
        contexto.incluidos,
        hoje,
      );
      const esperados = valoresEsperados(
        contexto.versao,
        [...contexto.ativas, { id: idNovo, valorFuneral, valorExtra }],
        vagasDepois.extras,
      );
      const mudou = versaoMudou(contexto.versao, esperados);

      // Mudança de valor ou uso de cadastro existente: mostra e pede confirmação antes de gravar.
      if (mudou || existente) {
        const assinatura = `${esperados.valorMensalCentavos}:${existente?.id ?? ""}`;
        if (entrada.confirmacao !== assinatura) {
          return {
            status: "confirmar",
            previa: {
              assinatura,
              pessoaExistente: existente?.nome ?? null,
              serExtra: vagasDepois.extras.includes(idNovo),
              valorExtraCentavos: valorExtra,
              valorFuneralCentavos: valorFuneral,
              semFuneralPorIdade: contexto.temFuneral && !comFuneral,
              valorAtualCentavos: contexto.versao.valorMensalCentavos,
              valorNovoCentavos: esperados.valorMensalCentavos,
            },
          };
        }
      }

      const pessoaId =
        existente?.id ??
        (
          await tx
            .insert(pessoa)
            .values({ nome: dados.nome, cpf: dados.cpf || null, dataNascimento: dados.dataNascimento })
            .returning({ id: pessoa.id })
        )[0].id;

      await tx.insert(vida).values({
        contratoId,
        pessoaId,
        papel: "dependente",
        parentesco: dados.parentesco,
        dataEntrada: hoje,
        carenciaFuneralInicio: comFuneral ? hoje : null,
        valorFuneralCentavos: valorFuneral,
        valorExtraCentavos: valorExtra,
      });

      if (mudou) {
        await gravarNovaVersao(tx, contexto, esperados, "Inclusão de dependente", hoje, autor);
      }
      return { status: "ok", novaVersao: mudou };
    });
  } catch (erro) {
    const texto = `${(erro as Error)?.message ?? ""} ${(erro as { cause?: Error })?.cause?.message ?? ""}`;
    if (texto.includes("pessoa_cpf_unique")) {
      return { status: "erro", erros: { cpf: "Este CPF acabou de ser cadastrado. Tente de novo." } };
    }
    throw erro;
  }
}

export async function removerDependente(
  db: Banco,
  vidaId: string,
  motivo: string,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoSimples> {
  if (!ehIdValido(vidaId)) return { ok: false, erro: "Dependente não encontrado" };
  const motivoLimpo = limparTexto(motivo);
  if (!motivoLimpo) return { ok: false, erro: "Informe o motivo da remoção" };

  return db.transaction(async (tx): Promise<ResultadoSimples> => {
    const [alvo] = await tx.select().from(vida).where(eq(vida.id, vidaId)).limit(1);
    if (!alvo) return { ok: false, erro: "Dependente não encontrado" };
    await tx.select({ id: contrato.id }).from(contrato).where(eq(contrato.id, alvo.contratoId)).for("update");

    const contexto = await carregarContexto(tx, alvo.contratoId, hoje);
    if (!contexto) return { ok: false, erro: "Contrato não encontrado" };
    if (alvo.papel !== "dependente") return { ok: false, erro: "O titular não pode ser removido" };
    if (alvo.dataSaida) return { ok: false, erro: "Este dependente já foi removido" };
    const erroStatus = erroDeStatus(contexto.contrato.status);
    if (erroStatus) return { ok: false, erro: erroStatus };

    // Quem paga como extra não ocupa vaga incluída, então não bloqueia (decisão provisória 6).
    const eraExtra = contexto.vagas.extras.includes(vidaId);
    const dias = await config(tx, "dias_bloqueio_vaga", DIAS_BLOQUEIO_PADRAO);
    const vagaBloqueadaAte = eraExtra ? null : adicionarDias(hoje, dias);
    await tx
      .update(vida)
      .set({ dataSaida: hoje, motivoSaida: motivoLimpo, autorSaida: autor, vagaBloqueadaAte })
      .where(eq(vida.id, vidaId));

    const restantes = contexto.dependentes.filter((d) => d.id !== vidaId).map((d) => d.id);
    const bloqueios = vagaBloqueadaAte
      ? [...contexto.vagas.bloqueiosVigentes, vagaBloqueadaAte]
      : contexto.vagas.bloqueiosVigentes;
    const vagas = calcularVagas(restantes, bloqueios, contexto.incluidos, hoje);
    const esperados = valoresEsperados(
      contexto.versao,
      contexto.ativas.filter((v) => v.id !== vidaId),
      vagas.extras,
    );
    if (versaoMudou(contexto.versao, esperados)) {
      await gravarNovaVersao(tx, contexto, esperados, "Remoção de dependente", hoje, autor);
    }
    return { ok: true };
  });
}

export async function pedirExcecao(
  db: Banco,
  contratoId: string,
  tipo: string,
  descricao: string,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoSimples> {
  if (!ehIdValido(contratoId)) return { ok: false, erro: "Contrato não encontrado" };
  const tipoValido = TIPOS_EXCECAO.find((t) => t === tipo);
  if (!tipoValido) return { ok: false, erro: "Escolha o motivo da exceção" };

  return db.transaction(async (tx): Promise<ResultadoSimples> => {
    await tx.select({ id: contrato.id }).from(contrato).where(eq(contrato.id, contratoId)).for("update");
    const contexto = await carregarContexto(tx, contratoId, hoje);
    if (!contexto) return { ok: false, erro: "Contrato não encontrado" };

    // A exceção vale para a vaga que libera primeiro entre as que ainda não têm pedido aberto.
    const abertos = new Set(contexto.excecoes.filter((e) => e.status === "pendente").map((e) => e.vidaRemovidaId));
    const bloqueadora = contexto.bloqueadoras.find((b) => !abertos.has(b.id));
    if (!bloqueadora) {
      return {
        ok: false,
        erro: abertos.size > 0 ? "Já existe um pedido de exceção aguardando decisão" : "Não há vaga bloqueada neste contrato",
      };
    }
    await tx.insert(excecaoVaga).values({
      contratoId,
      vidaRemovidaId: bloqueadora.id,
      tipo: tipoValido,
      descricao: limparTexto(descricao) || null,
      solicitadaPor: autor,
    });
    return { ok: true };
  });
}

export async function decidirExcecao(
  db: Banco,
  excecaoId: string,
  aprovar: boolean,
  motivo: string,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoSimples> {
  if (!ehIdValido(excecaoId)) return { ok: false, erro: "Pedido não encontrado" };
  const motivoLimpo = limparTexto(motivo);
  if (!motivoLimpo) return { ok: false, erro: "Informe o motivo da decisão" };

  return db.transaction(async (tx): Promise<ResultadoSimples> => {
    const [pedido] = await tx.select().from(excecaoVaga).where(eq(excecaoVaga.id, excecaoId)).for("update");
    if (!pedido) return { ok: false, erro: "Pedido não encontrado" };
    if (pedido.status !== "pendente") return { ok: false, erro: "Este pedido já foi decidido" };
    await tx
      .update(excecaoVaga)
      .set({
        status: aprovar ? "aprovada" : "recusada",
        decididaPor: autor,
        decididaEm: new Date(),
        motivoDecisao: motivoLimpo,
      })
      .where(eq(excecaoVaga.id, excecaoId));

    if (aprovar) await sincronizar(tx, pedido.contratoId, "Exceção aprovada: vaga liberada", hoje, autor);
    return { ok: true };
  });
}

async function sincronizar(tx: Transacao, contratoId: string, motivo: string, hoje: string, autor: string) {
  const contexto = await carregarContexto(tx, contratoId, hoje);
  if (!contexto) return false;
  const esperados = valoresEsperados(contexto.versao, contexto.ativas, contexto.vagas.extras);
  if (!versaoMudou(contexto.versao, esperados)) return false;
  await gravarNovaVersao(tx, contexto, esperados, motivo, hoje, autor);
  return true;
}

export type AlertaIdade = {
  vidaId: string;
  nome: string;
  idade: number;
  tipo: "funeral" | "dependente_extra";
  valorAtualCentavos: number;
  valorNovoCentavos: number;
};

export type PainelDependentes = {
  vagas: SituacaoVagas;
  incluidos: number;
  extras: string[];
  bloqueios: { vidaId: string; nome: string; liberaEm: string }[];
  excecoes: {
    id: string;
    tipo: string;
    descricao: string | null;
    status: string;
    nomeRemovido: string;
    decididaPor: string | null;
    motivoDecisao: string | null;
  }[];
  aceitaDependentes: boolean;
  podeAlterar: boolean;
  valorAtualCentavos: number;
  valorEsperadoCentavos: number;
  alertasIdade: AlertaIdade[];
};

/** Tudo o que a ficha do contrato precisa saber sobre vagas, exceções e alertas. */
export async function carregarPainel(
  db: LeituraBanco,
  contratoId: string,
  hoje = hojeEmSaoPaulo(),
): Promise<PainelDependentes | null> {
  const contexto = await carregarContexto(db, contratoId, hoje);
  if (!contexto) return null;

  const faixasFuneral = await faixasDe(db, "funeral", hoje);
  const faixasExtra = await faixasDe(db, "dependente_extra", hoje);
  const alertasIdade: AlertaIdade[] = [];
  for (const v of contexto.ativas) {
    const idade = calcularIdade(v.dataNascimento, hoje);
    if (v.carencia) {
      const novo = faixaDaIdade(faixasFuneral, idade).valorCentavos;
      if (novo !== v.valorFuneral) {
        alertasIdade.push({
          vidaId: v.id,
          nome: v.nome,
          idade,
          tipo: "funeral",
          valorAtualCentavos: v.valorFuneral,
          valorNovoCentavos: novo,
        });
      }
    }
    if (contexto.vagas.extras.includes(v.id)) {
      const novo = faixaDaIdade(faixasExtra, idade).valorCentavos;
      if (novo !== v.valorExtra) {
        alertasIdade.push({
          vidaId: v.id,
          nome: v.nome,
          idade,
          tipo: "dependente_extra",
          valorAtualCentavos: v.valorExtra,
          valorNovoCentavos: novo,
        });
      }
    }
  }

  const nomes = new Map(contexto.vidas.map((v) => [v.id, v.nome]));
  return {
    vagas: contexto.vagas,
    incluidos: contexto.incluidos,
    extras: contexto.vagas.extras,
    bloqueios: contexto.bloqueadoras.map((b) => ({
      vidaId: b.id,
      nome: b.nome,
      liberaEm: b.vagaBloqueadaAte as string,
    })),
    excecoes: contexto.excecoes.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      descricao: e.descricao,
      status: e.status,
      nomeRemovido: nomes.get(e.vidaRemovidaId) ?? "—",
      decididaPor: e.decididaPor,
      motivoDecisao: e.motivoDecisao,
    })),
    aceitaDependentes: contexto.versao.composicao === "familiar",
    podeAlterar: contexto.contrato.status !== "cancelado",
    valorAtualCentavos: contexto.versao.valorMensalCentavos,
    valorEsperadoCentavos: valoresEsperados(contexto.versao, contexto.ativas, contexto.vagas.extras)
      .valorMensalCentavos,
    alertasIdade,
  };
}

/** Atualiza o valor quando uma vaga liberou e um extra deixou de pagar (decisão provisória 4). */
export async function atualizarValorContrato(
  db: Banco,
  contratoId: string,
  hoje = hojeEmSaoPaulo(),
  autor = "Sistema (automático)",
): Promise<ResultadoSimples> {
  if (!ehIdValido(contratoId)) return { ok: false, erro: "Contrato não encontrado" };
  return db.transaction(async (tx): Promise<ResultadoSimples> => {
    await tx.select({ id: contrato.id }).from(contrato).where(eq(contrato.id, contratoId)).for("update");
    await sincronizar(tx, contratoId, "Vaga liberada: dependente extra deixou de pagar", hoje, autor);
    return { ok: true };
  });
}

/** Aplica a nova faixa de idade de uma vida, depois do contato com o cliente (decisão provisória 9). */
export async function ajustarFaixaVida(
  db: Banco,
  vidaId: string,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoSimples> {
  if (!ehIdValido(vidaId)) return { ok: false, erro: "Vida não encontrada" };
  return db.transaction(async (tx): Promise<ResultadoSimples> => {
    const [alvo] = await tx
      .select({
        contratoId: vida.contratoId,
        dataSaida: vida.dataSaida,
        carencia: vida.carenciaFuneralInicio,
        dataNascimento: pessoa.dataNascimento,
      })
      .from(vida)
      .innerJoin(pessoa, eq(pessoa.id, vida.pessoaId))
      .where(eq(vida.id, vidaId))
      .limit(1);
    if (!alvo || alvo.dataSaida) return { ok: false, erro: "Vida não encontrada" };
    await tx.select({ id: contrato.id }).from(contrato).where(eq(contrato.id, alvo.contratoId)).for("update");

    const idade = calcularIdade(alvo.dataNascimento, hoje);
    await tx
      .update(vida)
      .set({
        valorFuneralCentavos: alvo.carencia
          ? faixaDaIdade(await faixasDe(tx, "funeral", hoje), idade).valorCentavos
          : 0,
        valorExtraCentavos: faixaDaIdade(await faixasDe(tx, "dependente_extra", hoje), idade).valorCentavos,
      })
      .where(eq(vida.id, vidaId));
    await sincronizar(tx, alvo.contratoId, "Ajuste por mudança de faixa de idade", hoje, autor);
    return { ok: true };
  });
}
