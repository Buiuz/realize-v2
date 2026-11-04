// Regras do contrato pessoa física (PRD 2.2). O valor é sempre calculado aqui, nunca recebido da tela.
import { and, asc, desc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import type { Banco } from "../banco/conexao";
import {
  adicional,
  configuracao,
  contrato,
  cupom,
  historicoStatus,
  origem,
  pessoa,
  plano,
  planoFormaPagamento,
  precoAdicional,
  precoPlano,
  usuario,
  versaoAdicional,
  versaoContrato,
  vida,
} from "../banco/esquema";
import {
  calcularIdade,
  calcularMensalidade,
  podeContratarNovaFaixa,
  type FaixaPreco,
  type ResultadoCalculo,
} from "./precos";
import { hojeEmSaoPaulo } from "./titular";

// Autor usado só quando a regra é chamada sem usuário logado, como nos testes.
export const AUTOR_PADRAO = "Não identificado";

// Migração tem fluxo próprio e está fora do protótipo.
export const ORIGENS_DISPONIVEIS = [
  "vendedor",
  "link",
  "cupom",
  "influenciador",
  "site",
  "balcao",
  "reativacao",
] as const;

const COMPOSICOES = ["familiar", "individual"] as const;
const FORMATO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TipoOrigem = (typeof ORIGENS_DISPONIVEIS)[number];
type Composicao = (typeof COMPOSICOES)[number];
type FormaPagamento = "cartao_recorrente" | "pix_automatico" | "carne";
type LeituraBanco = Pick<Banco, "select">;

export type EntradaPreco = {
  titularId: string;
  planoId: string;
  composicao: string;
  funeral: boolean;
  cupom: string;
};

export type EntradaContrato = EntradaPreco & {
  formaPagamento: string;
  diaVencimento: string;
  origemTipo: string;
  origemDetalhe: string;
  vendedorId?: string;
};

export type ErrosContrato = Partial<
  Record<keyof EntradaContrato | "titular", string>
>;

export type CupomAplicado = {
  id: string;
  codigo: string;
  percentual: number;
  recorrente: boolean;
};

export type AvaliacaoPreco = {
  erros: ErrosContrato;
  calculo: ResultadoCalculo | null;
  cupom: CupomAplicado | null;
};

export type Cobertura = {
  contratoId: string;
  numero: number;
  status: string;
  papel: string;
};

export type ResultadoCriacao =
  | { ok: true; id: string }
  | { ok: false; erros: ErrosContrato; cobertura?: Cobertura };

export function ehIdValido(id: string) {
  return FORMATO_ID.test(id);
}

const vigente = <T extends typeof precoPlano | typeof precoAdicional>(tabela: T, hoje: string) =>
  and(
    lte(tabela.vigenciaInicio, hoje),
    or(isNull(tabela.vigenciaFim), gte(tabela.vigenciaFim, hoje)),
  );

/** O contrato em que a pessoa está coberta hoje. Só Cancelado deixa de contar (decisão provisória 8). */
export async function buscarCobertura(
  db: LeituraBanco,
  pessoaId: string,
): Promise<Cobertura | undefined> {
  const [cobertura] = await db
    .select({
      contratoId: contrato.id,
      numero: contrato.numero,
      status: contrato.status,
      papel: vida.papel,
    })
    .from(vida)
    .innerJoin(contrato, eq(contrato.id, vida.contratoId))
    .where(and(eq(vida.pessoaId, pessoaId), isNull(vida.dataSaida), ne(contrato.status, "cancelado")))
    .limit(1);
  return cobertura;
}

async function faixasDe(db: LeituraBanco, tipo: "funeral" | "dependente_extra", hoje: string) {
  return db
    .select({
      idadeMinima: precoAdicional.idadeMinima,
      idadeMaxima: precoAdicional.idadeMaxima,
      valorCentavos: precoAdicional.valorCentavos,
      idadeMaximaNovaContratacao: precoAdicional.idadeMaximaNovaContratacao,
    })
    .from(precoAdicional)
    .innerJoin(adicional, eq(adicional.id, precoAdicional.adicionalId))
    .where(and(eq(adicional.tipo, tipo), vigente(precoAdicional, hoje)))
    .orderBy(asc(precoAdicional.idadeMinima)) as Promise<FaixaPreco[]>;
}

async function diasPermitidos(db: LeituraBanco): Promise<number[]> {
  const [linha] = await db
    .select({ valor: configuracao.valor })
    .from(configuracao)
    .where(eq(configuracao.chave, "dias_vencimento_permitidos"))
    .limit(1);
  return Array.isArray(linha?.valor) ? (linha.valor as number[]) : [];
}

async function formasDoPlano(db: LeituraBanco, planoId: string) {
  const linhas = await db
    .select({ forma: planoFormaPagamento.forma })
    .from(planoFormaPagamento)
    .where(eq(planoFormaPagamento.planoId, planoId));
  return linhas.map((l) => l.forma);
}

export type OpcoesContrato = {
  planos: {
    id: string;
    nome: string;
    aceitaFuneral: boolean;
    formas: FormaPagamento[];
    precos: { composicao: Composicao; valorCentavos: number }[];
  }[];
  dias: number[];
  funeralPermitidoPelaIdade: boolean;
  idadeTitular: number;
};

/** O que a tela de novo contrato pode oferecer para este titular. */
export async function carregarOpcoes(
  db: Banco,
  nascimentoTitular: string,
  hoje = hojeEmSaoPaulo(),
): Promise<OpcoesContrato> {
  const planos = await db.select().from(plano).orderBy(asc(plano.nome));
  const precos = await db.select().from(precoPlano).where(vigente(precoPlano, hoje));
  const formas = await db.select().from(planoFormaPagamento);
  const idadeTitular = calcularIdade(nascimentoTitular, hoje);

  return {
    planos: planos.map((p) => ({
      id: p.id,
      nome: p.nome,
      aceitaFuneral: p.aceitaFuneral,
      formas: formas.filter((f) => f.planoId === p.id).map((f) => f.forma),
      precos: precos
        .filter((preco) => preco.planoId === p.id)
        .map((preco) => ({ composicao: preco.composicao, valorCentavos: preco.valorCentavos })),
    })),
    dias: await diasPermitidos(db),
    funeralPermitidoPelaIdade: podeContratarNovaFaixa(await faixasDe(db, "funeral", hoje), idadeTitular),
    idadeTitular,
  };
}

async function avaliarCupom(db: LeituraBanco, texto: string, hoje: string) {
  const codigo = texto.trim().toUpperCase();
  if (!codigo) return { cupom: null };
  const [encontrado] = await db.select().from(cupom).where(eq(cupom.codigo, codigo)).limit(1);
  if (!encontrado) return { cupom: null, erro: "Cupom não encontrado" };
  if (hoje > encontrado.vigenciaFim) return { cupom: null, erro: "Cupom expirado" };
  if (hoje < encontrado.vigenciaInicio) return { cupom: null, erro: "Este cupom ainda não está valendo" };
  return {
    cupom: {
      id: encontrado.id,
      codigo: encontrado.codigo,
      percentual: encontrado.percentual,
      recorrente: encontrado.recorrente,
    },
  };
}

/** Valida plano, composição, funeral e cupom e calcula o valor. Usada no resumo e ao salvar. */
export async function avaliarPreco(
  db: LeituraBanco,
  entrada: EntradaPreco,
  hoje = hojeEmSaoPaulo(),
): Promise<AvaliacaoPreco> {
  const erros: ErrosContrato = {};

  const [titular] = ehIdValido(entrada.titularId)
    ? await db
        .select({ dataNascimento: pessoa.dataNascimento })
        .from(pessoa)
        .where(eq(pessoa.id, entrada.titularId))
        .limit(1)
    : [];
  if (!titular) erros.titular = "Titular não encontrado";

  const [planoEscolhido] = ehIdValido(entrada.planoId)
    ? await db.select().from(plano).where(eq(plano.id, entrada.planoId)).limit(1)
    : [];
  if (!planoEscolhido) erros.planoId = "Escolha um plano";

  const composicao = COMPOSICOES.find((c) => c === entrada.composicao);
  if (!composicao) erros.composicao = "Escolha a composição";

  const [preco] =
    planoEscolhido && composicao
      ? await db
          .select({ valorCentavos: precoPlano.valorCentavos })
          .from(precoPlano)
          .where(
            and(
              eq(precoPlano.planoId, planoEscolhido.id),
              eq(precoPlano.composicao, composicao),
              vigente(precoPlano, hoje),
            ),
          )
          .orderBy(desc(precoPlano.vigenciaInicio))
          .limit(1)
      : [];
  if (planoEscolhido && composicao && !preco) {
    erros.composicao = "Este plano não tem preço vigente para esta composição";
  }

  const faixasFuneral = await faixasDe(db, "funeral", hoje);
  const idade = titular ? calcularIdade(titular.dataNascimento, hoje) : 0;
  if (entrada.funeral && planoEscolhido && !planoEscolhido.aceitaFuneral) {
    erros.funeral = "Este plano não aceita o adicional de funeral";
  } else if (entrada.funeral && titular && !podeContratarNovaFaixa(faixasFuneral, idade)) {
    erros.funeral = "O funeral não é aceito em nova contratação para vidas acima de 80 anos";
  }

  const avaliacaoCupom = await avaliarCupom(db, entrada.cupom, hoje);
  if (avaliacaoCupom.erro) erros.cupom = avaliacaoCupom.erro;

  // Um problema só no cupom ou no funeral não impede de mostrar o valor do restante.
  const calculo =
    titular && preco
      ? calcularMensalidade({
          valorPlanoCentavos: preco.valorCentavos,
          idadesComFuneral: entrada.funeral && !erros.funeral ? [idade] : [],
          idadesDependentesExtras: [],
          faixasFuneral,
          faixasDependenteExtra: await faixasDe(db, "dependente_extra", hoje),
          cupom: avaliacaoCupom.cupom,
        })
      : null;

  return { erros, calculo, cupom: avaliacaoCupom.cupom };
}

export async function criarContrato(
  db: Banco,
  entrada: EntradaContrato,
  hoje = hojeEmSaoPaulo(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoCriacao> {
  const { erros, calculo, cupom: cupomAplicado } = await avaliarPreco(db, entrada, hoje);

  const formas = ehIdValido(entrada.planoId) ? await formasDoPlano(db, entrada.planoId) : [];
  const forma = formas.find((f) => f === entrada.formaPagamento);
  if (!entrada.formaPagamento) {
    erros.formaPagamento = "Escolha a forma de pagamento";
  } else if (!forma && !erros.planoId) {
    erros.formaPagamento = "Este plano não aceita esta forma de pagamento";
  } else if (!forma) {
    erros.formaPagamento = "Escolha a forma de pagamento";
  }

  const dia = Number(entrada.diaVencimento);
  if (!(await diasPermitidos(db)).includes(dia)) erros.diaVencimento = "Escolha o dia de vencimento";

  const tipoOrigem = ORIGENS_DISPONIVEIS.find((o) => o === entrada.origemTipo) as
    | TipoOrigem
    | undefined;
  if (!tipoOrigem) erros.origemTipo = "Informe a origem do contrato";
  if (tipoOrigem === "cupom" && !entrada.cupom.trim()) {
    erros.cupom = "Informe o cupom, já que a origem é Cupom";
  }

  // Venda de vendedor precisa dizer de quem é: define a carteira e, no futuro, a comissão.
  let vendedorId: string | null = null;
  if (tipoOrigem === "vendedor") {
    const [vendedor] = ehIdValido(entrada.vendedorId ?? "")
      ? await db
          .select({ id: usuario.id })
          .from(usuario)
          .where(
            and(
              eq(usuario.id, entrada.vendedorId as string),
              eq(usuario.perfil, "vendedor"),
              eq(usuario.ativo, true),
            ),
          )
          .limit(1)
      : [];
    if (vendedor) vendedorId = vendedor.id;
    else erros.vendedorId = "Escolha o vendedor";
  }

  if (Object.keys(erros).length > 0 || !calculo || !forma || !tipoOrigem) {
    return { ok: false, erros };
  }

  const resultado = await db.transaction(async (tx): Promise<ResultadoCriacao> => {
    // Trava a pessoa para que dois salvamentos ao mesmo tempo não criem dois contratos.
    const [titular] = await tx
      .select({ cpf: pessoa.cpf })
      .from(pessoa)
      .where(eq(pessoa.id, entrada.titularId))
      .for("update");
    if (!titular?.cpf) {
      return { ok: false, erros: { titular: "O titular precisa ter CPF" } };
    }
    const cobertura = await buscarCobertura(tx, entrada.titularId);
    if (cobertura) {
      return {
        ok: false,
        erros: { titular: `Esta pessoa já está no contrato nº ${cobertura.numero}` },
        cobertura,
      };
    }

    const [novaOrigem] = await tx
      .insert(origem)
      .values({ tipo: tipoOrigem, detalhe: entrada.origemDetalhe.trim() || null, vendedorId })
      .returning({ id: origem.id });
    const [novoContrato] = await tx
      .insert(contrato)
      .values({ titularId: entrada.titularId, origemId: novaOrigem.id, dataAdesao: hoje })
      .returning({ id: contrato.id });
    const [versao] = await tx
      .insert(versaoContrato)
      .values({
        contratoId: novoContrato.id,
        numero: 1,
        planoId: entrada.planoId,
        composicao: entrada.composicao as Composicao,
        formaPagamento: forma,
        diaVencimento: dia,
        valorPlanoCentavos: calculo.valorPlanoCentavos,
        valorFuneralCentavos: calculo.valorFuneralCentavos,
        valorDependenteExtraCentavos: calculo.valorDependenteExtraCentavos,
        cupomId: cupomAplicado?.id ?? null,
        cupomPercentual: cupomAplicado?.percentual ?? null,
        cupomRecorrente: cupomAplicado?.recorrente ?? null,
        valorPrimeiraMensalidadeCentavos: calculo.valorPrimeiraMensalidadeCentavos,
        valorMensalCentavos: calculo.valorMensalCentavos,
        vigenciaInicio: hoje,
        motivo: "Adesão",
        autor,
      })
      .returning({ id: versaoContrato.id });

    if (entrada.funeral) {
      const [funeral] = await tx
        .select({ id: adicional.id })
        .from(adicional)
        .where(eq(adicional.tipo, "funeral"))
        .limit(1);
      await tx.insert(versaoAdicional).values({ versaoId: versao.id, adicionalId: funeral.id });
    }

    await tx.insert(vida).values({
      contratoId: novoContrato.id,
      pessoaId: entrada.titularId,
      papel: "titular",
      dataEntrada: hoje,
      carenciaFuneralInicio: entrada.funeral ? hoje : null,
      valorFuneralCentavos: calculo.valorFuneralCentavos,
    });
    await tx.insert(historicoStatus).values({
      contratoId: novoContrato.id,
      statusNovo: "pendente",
      autor,
      motivo: "Contrato criado",
      modo: "manual",
    });

    return { ok: true, id: novoContrato.id };
  });

  return resultado;
}
