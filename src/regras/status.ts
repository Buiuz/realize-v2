// Máquina de status do contrato (PRD 2.6). Toda mudança passa por mudarStatus, que confere se a
// transição é permitida e grava o histórico: status anterior, novo, data, autor, motivo e modo.
import { and, asc, desc, eq, inArray, isNull, gte, lte, ne } from "drizzle-orm";
import type { Banco } from "../banco/conexao";
import {
  condicaoEspecial,
  configuracao,
  contrato,
  fatura,
  historicoStatus,
  versaoContrato,
} from "../banco/esquema";
import { AUTOR_PADRAO, ehIdValido } from "./contratos";
import { atualizarValorContrato, carregarPainel } from "./dependentes";
import { NOME_STATUS } from "./nomes";
import type { Permissao } from "./permissoes";
import { hojeEmSaoPaulo, limparTexto } from "./titular";

export type Status =
  | "pendente"
  | "ativo"
  | "inadimplente"
  | "bloqueado"
  | "cancelamento_solicitado"
  | "cancelado";

type Modo = "manual" | "automatico";
type Transacao = Parameters<Parameters<Banco["transaction"]>[0]>[0];
type LeituraBanco = Pick<Banco, "select">;

export type ResultadoStatus = { ok: true } | { ok: false; erro: string };

/** Únicas mudanças possíveis. Cancelado é definitivo: reativar cria um contrato novo. */
export const TRANSICOES: Record<Status, Status[]> = {
  pendente: ["ativo", "cancelado"],
  ativo: ["inadimplente", "bloqueado", "cancelamento_solicitado"],
  inadimplente: ["ativo", "bloqueado"],
  bloqueado: ["ativo"],
  cancelamento_solicitado: ["ativo", "cancelado"],
  cancelado: [],
};

export function podeMudar(de: Status, para: Status) {
  return TRANSICOES[de].includes(para);
}

export const PRAZO_X = "dias_para_inadimplente";
export const PRAZO_Y = "dias_para_bloqueado";
const PRAZO_ASSINATURA = "dias_limite_assinatura";
const PRAZO_CANCELAMENTO = "dias_limite_cancelamento";

/** Dias corridos de uma data até outra, no formato AAAA-MM-DD. */
export function diasEntre(de: string, ate: string) {
  const diferenca = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(diferenca / 86_400_000);
}

/** Único lugar que altera o status: confere a transição e grava o histórico junto. */
async function mudarStatus(
  tx: Transacao,
  contratoId: string,
  para: Status,
  motivo: string,
  modo: Modo,
  agora: Date,
  autor = "Sistema (automático)",
): Promise<ResultadoStatus> {
  const [atual] = await tx
    .select({ status: contrato.status })
    .from(contrato)
    .where(eq(contrato.id, contratoId))
    .for("update");
  if (!atual) return { ok: false, erro: "Contrato não encontrado" };
  if (!podeMudar(atual.status, para)) {
    return {
      ok: false,
      erro: `Não é possível mudar de ${NOME_STATUS[atual.status]} para ${NOME_STATUS[para]}`,
    };
  }

  await tx.update(contrato).set({ status: para }).where(eq(contrato.id, contratoId));
  await tx.insert(historicoStatus).values({
    contratoId,
    statusAnterior: atual.status,
    statusNovo: para,
    data: agora,
    autor,
    motivo,
    modo,
  });

  // Contrato bloqueado: a fatura do mês que ainda não venceu é cancelada (PRD 2.6).
  if (para === "bloqueado") {
    const hoje = hojeEmSaoPaulo(agora);
    await tx
      .update(fatura)
      .set({
        status: "cancelada",
        canceladaEm: agora,
        canceladaPor: "Sistema (automático)",
        motivoCancelamento: "Contrato bloqueado",
      })
      .where(
        and(
          eq(fatura.contratoId, contratoId),
          eq(fatura.status, "a_vencer"),
          eq(fatura.competencia, hoje.slice(0, 7)),
          gte(fatura.vencimento, hoje),
        ),
      );
  }
  return { ok: true };
}

function validarId(id: string): ResultadoStatus | null {
  return ehIdValido(id) ? null : { ok: false, erro: "Contrato não encontrado" };
}

/** O que falta para o contrato poder ser ativado (prevenção de "cliente ativo sem fatura"). */
export async function faltasParaAtivar(db: LeituraBanco, contratoId: string) {
  const [dados] = await db
    .select({ paga: contrato.adesaoPagaEm, assinado: contrato.assinadoEm })
    .from(contrato)
    .where(eq(contrato.id, contratoId))
    .limit(1);
  const [versao] = await db
    .select({
      id: versaoContrato.id,
    })
    .from(versaoContrato)
    .where(and(eq(versaoContrato.contratoId, contratoId), isNull(versaoContrato.vigenciaFim)))
    .limit(1);

  const faltas: string[] = [];
  if (!versao) faltas.push("Plano", "Valor", "Dia de vencimento", "Forma de pagamento");
  if (!dados?.paga) faltas.push("Pagamento da adesão confirmado");
  if (!dados?.assinado) faltas.push("Contrato assinado");
  return faltas;
}

/** Só ativa com pagamento confirmado e contrato assinado (PRD 2.2). */
async function ativarSePuder(tx: Transacao, contratoId: string, agora: Date) {
  const [dados] = await tx
    .select({ status: contrato.status })
    .from(contrato)
    .where(eq(contrato.id, contratoId))
    .limit(1);
  if (dados?.status !== "pendente") return;
  if ((await faltasParaAtivar(tx, contratoId)).length > 0) return;
  await mudarStatus(tx, contratoId, "ativo", "Pagamento confirmado e contrato assinado", "automatico", agora);
}

async function registrarEtapaAdesao(
  db: Banco,
  contratoId: string,
  etapa: "adesaoPagaEm" | "assinadoEm",
  agora: Date,
): Promise<ResultadoStatus> {
  const invalido = validarId(contratoId);
  if (invalido) return invalido;
  return db.transaction(async (tx): Promise<ResultadoStatus> => {
    const [dados] = await tx
      .select({ status: contrato.status, paga: contrato.adesaoPagaEm, assinado: contrato.assinadoEm })
      .from(contrato)
      .where(eq(contrato.id, contratoId))
      .for("update");
    if (!dados) return { ok: false, erro: "Contrato não encontrado" };
    if (dados.status !== "pendente") return { ok: false, erro: "Só vale para contrato Pendente" };
    if ((etapa === "adesaoPagaEm" ? dados.paga : dados.assinado) !== null) {
      return { ok: false, erro: "Esta etapa já foi registrada" };
    }
    await tx.update(contrato).set({ [etapa]: agora }).where(eq(contrato.id, contratoId));
    await ativarSePuder(tx, contratoId, agora);
    return { ok: true };
  });
}

export function registrarPagamentoAdesao(db: Banco, contratoId: string, agora = new Date()) {
  return registrarEtapaAdesao(db, contratoId, "adesaoPagaEm", agora);
}

export function registrarAssinatura(db: Banco, contratoId: string, agora = new Date()) {
  return registrarEtapaAdesao(db, contratoId, "assinadoEm", agora);
}

export const PERMISSAO_DA_ACAO: Record<AcaoManual, Permissao> = {
  bloquear: "bloquear_contrato",
  negociar: "negociar_bloqueio",
  solicitar_cancelamento: "cancelar_contrato",
  reter: "cancelar_contrato",
  confirmar_cancelamento: "cancelar_contrato",
};

export type AcaoManual =
  | "bloquear"
  | "negociar"
  | "solicitar_cancelamento"
  | "reter"
  | "confirmar_cancelamento";

const ACOES_MANUAIS: Record<AcaoManual, { de: Status[]; para: Status }> = {
  // O PRD permite bloqueio manual sem dizer de onde: vale para quem ainda tem acesso ou está em atraso.
  bloquear: { de: ["ativo", "inadimplente"], para: "bloqueado" },
  negociar: { de: ["bloqueado"], para: "ativo" },
  solicitar_cancelamento: { de: ["ativo"], para: "cancelamento_solicitado" },
  reter: { de: ["cancelamento_solicitado"], para: "ativo" },
  confirmar_cancelamento: { de: ["cancelamento_solicitado"], para: "cancelado" },
};

export async function executarAcaoManual(
  db: Banco,
  contratoId: string,
  acao: string,
  motivo: string,
  agora = new Date(),
  autor = AUTOR_PADRAO,
): Promise<ResultadoStatus> {
  const invalido = validarId(contratoId);
  if (invalido) return invalido;
  const regra = ACOES_MANUAIS[acao as AcaoManual];
  if (!regra) return { ok: false, erro: "Ação inválida" };
  const motivoLimpo = limparTexto(motivo);
  if (!motivoLimpo) return { ok: false, erro: "Informe o motivo" };

  return db.transaction(async (tx): Promise<ResultadoStatus> => {
    const [dados] = await tx
      .select({ status: contrato.status })
      .from(contrato)
      .where(eq(contrato.id, contratoId))
      .for("update");
    if (!dados) return { ok: false, erro: "Contrato não encontrado" };
    if (!regra.de.includes(dados.status)) {
      return { ok: false, erro: `Esta ação não vale para contrato ${NOME_STATUS[dados.status]}` };
    }
    return mudarStatus(tx, contratoId, regra.para, motivoLimpo, "manual", agora, autor);
  });
}

// ---------- Faturas de teste (o módulo de cobrança está fora do protótipo) ----------

export async function criarFaturaTeste(
  db: Banco,
  contratoId: string,
  competencia: string,
): Promise<ResultadoStatus> {
  const invalido = validarId(contratoId);
  if (invalido) return invalido;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) return { ok: false, erro: "Escolha o mês da fatura" };

  return db.transaction(async (tx): Promise<ResultadoStatus> => {
    const [dados] = await tx
      .select({ status: contrato.status })
      .from(contrato)
      .where(eq(contrato.id, contratoId))
      .for("update");
    if (!dados) return { ok: false, erro: "Contrato não encontrado" };
    if (dados.status === "pendente" || dados.status === "cancelado" || dados.status === "bloqueado") {
      return { ok: false, erro: `Contrato ${NOME_STATUS[dados.status]} não gera faturas novas` };
    }
    const [versao] = await tx
      .select({ dia: versaoContrato.diaVencimento, valor: versaoContrato.valorMensalCentavos })
      .from(versaoContrato)
      .where(and(eq(versaoContrato.contratoId, contratoId), isNull(versaoContrato.vigenciaFim)))
      .limit(1);
    if (!versao) return { ok: false, erro: "Contrato sem versão vigente" };

    const [existente] = await tx
      .select({ id: fatura.id })
      .from(fatura)
      .where(
        and(
          eq(fatura.contratoId, contratoId),
          eq(fatura.competencia, competencia),
          ne(fatura.status, "cancelada"),
        ),
      )
      .limit(1);
    if (existente) return { ok: false, erro: "Já existe fatura deste mês" };

    await tx.insert(fatura).values({
      contratoId,
      competencia,
      valorCentavos: versao.valor,
      vencimento: `${competencia}-${String(versao.dia).padStart(2, "0")}`,
    });
    return { ok: true };
  });
}

/** Quitar a última fatura vencida devolve o contrato para Ativo (PRD 2.6). */
export async function pagarFatura(
  db: Banco,
  faturaId: string,
  agora = new Date(),
): Promise<ResultadoStatus> {
  if (!ehIdValido(faturaId)) return { ok: false, erro: "Fatura não encontrada" };
  return db.transaction(async (tx): Promise<ResultadoStatus> => {
    const [alvo] = await tx.select().from(fatura).where(eq(fatura.id, faturaId)).for("update");
    if (!alvo) return { ok: false, erro: "Fatura não encontrada" };
    if (alvo.status === "paga") return { ok: false, erro: "Esta fatura já está paga" };
    if (alvo.status === "cancelada") return { ok: false, erro: "Fatura cancelada não pode ser paga" };

    await tx.update(fatura).set({ status: "paga", pagaEm: agora }).where(eq(fatura.id, faturaId));

    const [dados] = await tx
      .select({ status: contrato.status })
      .from(contrato)
      .where(eq(contrato.id, alvo.contratoId))
      .for("update");
    const emAtraso = dados?.status === "inadimplente" || dados?.status === "bloqueado";
    if (emAtraso && alvo.status === "vencida") {
      const [outraVencida] = await tx
        .select({ id: fatura.id })
        .from(fatura)
        .where(and(eq(fatura.contratoId, alvo.contratoId), eq(fatura.status, "vencida")))
        .limit(1);
      if (!outraVencida) {
        await mudarStatus(tx, alvo.contratoId, "ativo", "Todas as faturas vencidas foram pagas", "automatico", agora);
      }
    }
    return { ok: true };
  });
}

// ---------- Prazos configuráveis ----------

async function lerPrazo(db: LeituraBanco, chave: string): Promise<number | null> {
  const [linha] = await db
    .select({ valor: configuracao.valor })
    .from(configuracao)
    .where(eq(configuracao.chave, chave))
    .limit(1);
  return typeof linha?.valor === "number" ? linha.valor : null;
}

export async function lerPrazos(db: LeituraBanco) {
  return {
    x: await lerPrazo(db, PRAZO_X),
    y: await lerPrazo(db, PRAZO_Y),
    assinatura: (await lerPrazo(db, PRAZO_ASSINATURA)) ?? 7,
    cancelamento: (await lerPrazo(db, PRAZO_CANCELAMENTO)) ?? 30,
  };
}

const DESCRICOES: Record<string, string> = {
  [PRAZO_X]: "Prazo X: dias com fatura vencida até o contrato ficar Inadimplente",
  [PRAZO_Y]: "Prazo Y: dias como Inadimplente até o contrato ficar Bloqueado",
};

/** Vazio significa "ainda não definido": a rotina não aplica aquela mudança. */
export async function salvarPrazo(db: Banco, chave: string, texto: string): Promise<ResultadoStatus> {
  if (chave !== PRAZO_X && chave !== PRAZO_Y) return { ok: false, erro: "Prazo inválido" };
  const limpo = texto.trim();
  if (!limpo) {
    await db.delete(configuracao).where(eq(configuracao.chave, chave));
    return { ok: true };
  }
  if (!/^\d+$/.test(limpo) || Number(limpo) < 1 || Number(limpo) > 365) {
    return { ok: false, erro: "Informe um número de dias entre 1 e 365" };
  }
  const valor = Number(limpo);
  await db
    .insert(configuracao)
    .values({ chave, valor, descricao: DESCRICOES[chave] })
    .onConflictDoUpdate({ target: configuracao.chave, set: { valor } });
  return { ok: true };
}

// ---------- Rotina diária ----------

export type RelatorioRotina = {
  data: string;
  faturasVencidas: number;
  mudancas: { numero: number; de: string; para: string; motivo: string }[];
  valoresAtualizados: number[];
  avisos: string[];
};

async function dataUltimaEntrada(db: LeituraBanco, contratoId: string, status: Status) {
  const [linha] = await db
    .select({ data: historicoStatus.data })
    .from(historicoStatus)
    .where(and(eq(historicoStatus.contratoId, contratoId), eq(historicoStatus.statusNovo, status)))
    .orderBy(desc(historicoStatus.data))
    .limit(1);
  return linha ? hojeEmSaoPaulo(linha.data) : null;
}

async function temCondicaoEspecial(db: LeituraBanco, contratoId: string, hoje: string) {
  const [condicao] = await db
    .select({ id: condicaoEspecial.id })
    .from(condicaoEspecial)
    .where(
      and(
        eq(condicaoEspecial.contratoId, contratoId),
        inArray(condicaoEspecial.tipo, ["cortesia", "isencao"]),
        isNull(condicaoEspecial.canceladaEm),
        gte(condicaoEspecial.dataFim, hoje),
      ),
    )
    .limit(1);
  return Boolean(condicao);
}

export async function rodarRotinaDiaria(db: Banco, agora = new Date()): Promise<RelatorioRotina> {
  const hoje = hojeEmSaoPaulo(agora);
  const prazos = await lerPrazos(db);
  const relatorio: RelatorioRotina = {
    data: hoje,
    faturasVencidas: 0,
    mudancas: [],
    valoresAtualizados: [],
    avisos: [],
  };
  if (prazos.x === null) relatorio.avisos.push("Prazo X não definido: ninguém passa para Inadimplente.");
  if (prazos.y === null) relatorio.avisos.push("Prazo Y não definido: ninguém passa para Bloqueado.");

  // 1. Fatura que passou do vencimento vira "vencida".
  const vencidas = await db
    .update(fatura)
    .set({ status: "vencida" })
    .where(and(eq(fatura.status, "a_vencer"), lte(fatura.vencimento, diaAnterior(hoje))))
    .returning({ id: fatura.id });
  relatorio.faturasVencidas = vencidas.length;

  const contratos = await db
    .select({
      id: contrato.id,
      numero: contrato.numero,
      status: contrato.status,
      paga: contrato.adesaoPagaEm,
      assinado: contrato.assinadoEm,
    })
    .from(contrato)
    .where(ne(contrato.status, "cancelado"))
    .orderBy(asc(contrato.numero));

  const aplicar = async (c: (typeof contratos)[number], para: Status, motivo: string) => {
    const resultado = await db.transaction((tx) => mudarStatus(tx, c.id, para, motivo, "automatico", agora));
    if (resultado.ok) {
      relatorio.mudancas.push({ numero: c.numero, de: c.status, para, motivo });
    }
  };

  for (const c of contratos) {
    if (c.status === "pendente") {
      // 2. Pagou e não assinou no prazo.
      if (c.paga && !c.assinado && diasEntre(hojeEmSaoPaulo(c.paga), hoje) >= prazos.assinatura) {
        await aplicar(c, "cancelado", `${prazos.assinatura} dias sem assinar: cancelado com estorno`);
      }
    } else if (c.status === "ativo") {
      // 3. Cliente sem fatura vencida, ou em cortesia, não muda de status.
      if (prazos.x === null || (await temCondicaoEspecial(db, c.id, hoje))) continue;
      const [maisAntiga] = await db
        .select({ vencimento: fatura.vencimento })
        .from(fatura)
        .where(and(eq(fatura.contratoId, c.id), eq(fatura.status, "vencida")))
        .orderBy(asc(fatura.vencimento))
        .limit(1);
      if (maisAntiga && diasEntre(maisAntiga.vencimento, hoje) >= prazos.x) {
        await aplicar(c, "inadimplente", `Fatura vencida há ${prazos.x} dias ou mais`);
      }
    } else if (c.status === "inadimplente") {
      // 4. Tempo demais como Inadimplente.
      if (prazos.y === null || (await temCondicaoEspecial(db, c.id, hoje))) continue;
      const desde = await dataUltimaEntrada(db, c.id, "inadimplente");
      if (desde && diasEntre(desde, hoje) >= prazos.y) {
        await aplicar(c, "bloqueado", `Inadimplente há ${prazos.y} dias ou mais`);
      }
    } else if (c.status === "cancelamento_solicitado") {
      // 5. Pedido de cancelamento sem decisão no prazo.
      const desde = await dataUltimaEntrada(db, c.id, "cancelamento_solicitado");
      if (desde && diasEntre(desde, hoje) >= prazos.cancelamento) {
        await aplicar(c, "cancelado", `${prazos.cancelamento} dias desde o pedido de cancelamento`);
      }
    }
  }

  // 6. Vaga que liberou: o dependente extra deixa de pagar.
  const ativos = await db
    .select({ id: contrato.id, numero: contrato.numero })
    .from(contrato)
    .where(ne(contrato.status, "cancelado"))
    .orderBy(asc(contrato.numero));
  for (const c of ativos) {
    const painel = await carregarPainel(db, c.id, hoje);
    if (painel && painel.valorEsperadoCentavos !== painel.valorAtualCentavos) {
      await atualizarValorContrato(db, c.id, hoje);
      relatorio.valoresAtualizados.push(c.numero);
    }
  }

  return relatorio;
}

function diaAnterior(data: string) {
  const momento = new Date(`${data}T00:00:00Z`);
  momento.setUTCDate(momento.getUTCDate() - 1);
  return momento.toISOString().slice(0, 10);
}

// ---------- Dados para a ficha do contrato ----------

export async function carregarPainelStatus(db: LeituraBanco, contratoId: string) {
  const [dados] = await db
    .select({ status: contrato.status, paga: contrato.adesaoPagaEm, assinado: contrato.assinadoEm })
    .from(contrato)
    .where(eq(contrato.id, contratoId))
    .limit(1);
  if (!dados) return null;

  const acoes = (Object.keys(ACOES_MANUAIS) as AcaoManual[]).filter((a) =>
    ACOES_MANUAIS[a].de.includes(dados.status),
  );
  const faturas = await db
    .select()
    .from(fatura)
    .where(eq(fatura.contratoId, contratoId))
    .orderBy(asc(fatura.competencia), asc(fatura.criadoEm));

  return {
    status: dados.status as Status,
    pagaEm: dados.paga,
    assinadoEm: dados.assinado,
    faltas: dados.status === "pendente" ? await faltasParaAtivar(db, contratoId) : [],
    acoes,
    faturas,
    podeGerarFatura: !["pendente", "cancelado", "bloqueado"].includes(dados.status),
  };
}
