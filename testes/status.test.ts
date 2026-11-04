import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { semear } from "../src/banco/dados-ficticios";
import { buscarCobertura, criarContrato } from "../src/regras/contratos";
import { gerarCpfFicticio } from "../src/regras/cpf";
import { incluirDependente, removerDependente } from "../src/regras/dependentes";
import {
  carregarPainelStatus,
  criarFaturaTeste,
  diasEntre,
  executarAcaoManual,
  faltasParaAtivar,
  lerPrazos,
  pagarFatura,
  podeMudar,
  registrarAssinatura,
  registrarPagamentoAdesao,
  rodarRotinaDiaria,
  salvarPrazoInadimplencia,
  TRANSICOES,
  type Status,
} from "../src/regras/status";

let cliente: PGlite;
let db: Banco;
let total: string;
let sequencia = 300;

const dia = (data: string) => new Date(`${data}T15:00:00Z`);

async function umId(consulta: string, parametros: unknown[] = []) {
  const { rows } = await cliente.query<{ id: string }>(consulta, parametros);
  return rows[0].id;
}

function novoCpf() {
  sequencia += 1;
  return gerarCpfFicticio(`900001${sequencia}`);
}

async function novoContrato() {
  const titularId = await umId(
    "INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Titular de Teste', $1, '1990-01-01') RETURNING id",
    [novoCpf()],
  );
  const resultado = await criarContrato(
    db,
    {
      titularId,
      planoId: total,
      composicao: "familiar",
      funeral: false,
      cupom: "",
      formaPagamento: "carne",
      diaVencimento: "10",
      origemTipo: "balcao",
      origemDetalhe: "",
    },
    "2026-11-04",
  );
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return { id: resultado.id, titularId };
}

async function contratoAtivo() {
  const { id } = await novoContrato();
  await registrarPagamentoAdesao(db, id, dia("2026-11-04"));
  await registrarAssinatura(db, id, dia("2026-11-04"));
  return id;
}

async function statusDe(id: string) {
  const { rows } = await cliente.query<{ status: string }>("SELECT status FROM contrato WHERE id = $1", [id]);
  return rows[0].status;
}

async function ultimoHistorico(id: string) {
  const { rows } = await cliente.query<Record<string, unknown>>(
    `SELECT status_anterior, status_novo, autor, motivo, modo, data FROM historico_status
     WHERE contrato_id = $1 ORDER BY data DESC, id DESC LIMIT 1`,
    [id],
  );
  return rows[0];
}

async function contarHistorico(id: string) {
  const { rows } = await cliente.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM historico_status WHERE contrato_id = $1",
    [id],
  );
  return rows[0].n;
}

async function faturaDe(id: string, competencia: string) {
  const { rows } = await cliente.query<{ id: string; status: string; vencimento: string; motivo: string | null }>(
    `SELECT id, status, vencimento::text AS vencimento, motivo_cancelamento AS motivo
     FROM fatura WHERE contrato_id = $1 AND competencia = $2 ORDER BY criado_em DESC LIMIT 1`,
    [id, competencia],
  );
  return rows[0];
}

/** Contrato Inadimplente desde 2026-11-15, com fatura de novembro vencida em 10/11. */
async function contratoInadimplente() {
  const id = await contratoAtivo();
  await criarFaturaTeste(db, id, "2026-11");
  await rodarRotinaDiaria(db, dia("2026-11-15"));
  expect(await statusDe(id)).toBe("inadimplente");
  return id;
}

beforeAll(async () => {
  const banco = abrirBanco();
  cliente = banco.cliente;
  db = banco.db;
  await aplicarMigracoes(db);
  await semear(db);
  total = await umId("SELECT id FROM plano WHERE nome = 'Realize Total'");
});

afterAll(async () => {
  await cliente.close();
});

beforeEach(async () => {
  // Isola cada teste: a rotina olha todos os contratos do banco.
  await cliente.query("UPDATE contrato SET status = 'cancelado' WHERE status <> 'cancelado'");
  await salvarPrazoInadimplencia(db, "5");
});

describe("transições permitidas", () => {
  const TODOS = Object.keys(TRANSICOES) as Status[];
  const PERMITIDAS = new Set([
    "pendente>ativo",
    "pendente>cancelado",
    "ativo>inadimplente",
    "ativo>bloqueado",
    "ativo>cancelamento_solicitado",
    "inadimplente>ativo",
    "inadimplente>bloqueado",
    "bloqueado>ativo",
    "cancelamento_solicitado>ativo",
    "cancelamento_solicitado>cancelado",
  ]);

  it("aceita só as previstas, conferindo todas as combinações", () => {
    for (const de of TODOS) {
      for (const para of TODOS) {
        expect(podeMudar(de, para), `${de} para ${para}`).toBe(PERMITIDAS.has(`${de}>${para}`));
      }
    }
  });

  it("Cancelado é definitivo", () => {
    expect(TRANSICOES.cancelado).toEqual([]);
  });
});

describe("ativação", () => {
  it("nasce Pendente e lista o que falta", async () => {
    const { id } = await novoContrato();
    expect(await statusDe(id)).toBe("pendente");
    expect(await faltasParaAtivar(db, id)).toEqual(["Pagamento da adesão confirmado", "Contrato assinado"]);
  });

  it("não ativa só com o pagamento, nem só com a assinatura", async () => {
    const a = await novoContrato();
    await registrarPagamentoAdesao(db, a.id);
    expect(await statusDe(a.id)).toBe("pendente");
    expect(await faltasParaAtivar(db, a.id)).toEqual(["Contrato assinado"]);

    const b = await novoContrato();
    await registrarAssinatura(db, b.id);
    expect(await statusDe(b.id)).toBe("pendente");
  });

  it("ativa sozinho com os dois, em qualquer ordem, registrando no histórico", async () => {
    const a = await novoContrato();
    await registrarPagamentoAdesao(db, a.id);
    await registrarAssinatura(db, a.id);
    expect(await statusDe(a.id)).toBe("ativo");
    expect(await ultimoHistorico(a.id)).toMatchObject({
      status_anterior: "pendente",
      status_novo: "ativo",
      modo: "automatico",
      motivo: "Pagamento confirmado e contrato assinado",
    });

    const b = await novoContrato();
    await registrarAssinatura(db, b.id);
    await registrarPagamentoAdesao(db, b.id);
    expect(await statusDe(b.id)).toBe("ativo");
  });

  it("não registra duas vezes nem depois de ativo", async () => {
    const { id } = await novoContrato();
    await registrarPagamentoAdesao(db, id);
    expect((await registrarPagamentoAdesao(db, id)).ok).toBe(false);
    await registrarAssinatura(db, id);
    expect((await registrarAssinatura(db, id)).ok).toBe(false);
  });

  it("pagou e ficou 7 dias sem assinar: cancela com estorno", async () => {
    const { id } = await novoContrato();
    await registrarPagamentoAdesao(db, id, dia("2026-11-04"));
    await rodarRotinaDiaria(db, dia("2026-11-10"));
    expect(await statusDe(id)).toBe("pendente");
    await rodarRotinaDiaria(db, dia("2026-11-11"));
    expect(await statusDe(id)).toBe("cancelado");
    expect(await ultimoHistorico(id)).toMatchObject({
      status_anterior: "pendente",
      modo: "automatico",
      motivo: "7 dias sem assinar: cancelado com estorno",
    });
  });

  it("sem pagamento, o prazo de assinatura não corre", async () => {
    const { id } = await novoContrato();
    await rodarRotinaDiaria(db, dia("2027-06-01"));
    expect(await statusDe(id)).toBe("pendente");
  });
});

describe("rotina: fatura e inadimplência", () => {
  it("fatura que venceu ontem vira vencida; a de hoje, não", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11");
    await rodarRotinaDiaria(db, dia("2026-11-10"));
    expect((await faturaDe(id, "2026-11")).status).toBe("a_vencer");
    const relatorio = await rodarRotinaDiaria(db, dia("2026-11-11"));
    expect((await faturaDe(id, "2026-11")).status).toBe("vencida");
    expect(relatorio.faturasVencidas).toBe(1);
  });

  it("vira Inadimplente exatamente em X dias, como automático", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11"); // vence em 10/11
    await rodarRotinaDiaria(db, dia("2026-11-14"));
    expect(await statusDe(id)).toBe("ativo");
    const relatorio = await rodarRotinaDiaria(db, dia("2026-11-15"));
    expect(await statusDe(id)).toBe("inadimplente");
    expect(await ultimoHistorico(id)).toMatchObject({
      status_anterior: "ativo",
      status_novo: "inadimplente",
      modo: "automatico",
    });
    expect(relatorio.mudancas).toHaveLength(1);
  });

  it("usa o prazo configurado", async () => {
    await salvarPrazoInadimplencia(db, "20");
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11");
    await rodarRotinaDiaria(db, dia("2026-11-29"));
    expect(await statusDe(id)).toBe("ativo");
    await rodarRotinaDiaria(db, dia("2026-11-30"));
    expect(await statusDe(id)).toBe("inadimplente");
  });

  it("por padrão, vira Inadimplente no dia seguinte ao vencimento", async () => {
    await salvarPrazoInadimplencia(db, "");
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11"); // vence em 10/11
    await rodarRotinaDiaria(db, dia("2026-11-10"));
    expect(await statusDe(id)).toBe("ativo");
    await rodarRotinaDiaria(db, dia("2026-11-11"));
    expect(await statusDe(id)).toBe("inadimplente");
    expect((await faturaDe(id, "2026-11")).status).toBe("vencida");
    expect(await ultimoHistorico(id)).toMatchObject({
      status_novo: "inadimplente",
      motivo: "Fatura venceu e não foi paga",
    });
  });

  it("não vira Inadimplente se a fatura foi paga no vencimento", async () => {
    await salvarPrazoInadimplencia(db, "");
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11");
    await pagarFatura(db, (await faturaDe(id, "2026-11")).id, dia("2026-11-10"));
    await rodarRotinaDiaria(db, dia("2026-12-01"));
    expect(await statusDe(id)).toBe("ativo");
  });

  it("cliente sem fatura não muda de status", async () => {
    const id = await contratoAtivo();
    await rodarRotinaDiaria(db, dia("2027-06-01"));
    expect(await statusDe(id)).toBe("ativo");
  });

  it("cortesia vigente não vira Inadimplente; depois da data de fim, vira", async () => {
    const id = await contratoAtivo();
    await cliente.query(
      `INSERT INTO condicao_especial (contrato_id, tipo, motivo, autor, aprovador, data_fim)
       VALUES ($1, 'cortesia', 'Teste', 'Teste', 'Teste', '2026-12-31')`,
      [id],
    );
    await criarFaturaTeste(db, id, "2026-11");
    await rodarRotinaDiaria(db, dia("2026-12-31"));
    expect(await statusDe(id)).toBe("ativo");
    await rodarRotinaDiaria(db, dia("2027-01-01"));
    expect(await statusDe(id)).toBe("inadimplente");
  });

  it("rodar duas vezes no mesmo dia não duplica o histórico", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-11");
    await rodarRotinaDiaria(db, dia("2026-11-15"));
    const depois = await contarHistorico(id);
    await rodarRotinaDiaria(db, dia("2026-11-15"));
    expect(await contarHistorico(id)).toBe(depois);
  });
});

describe("regularização", () => {
  it("volta para Ativo só quando todas as vencidas são pagas", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-10");
    await criarFaturaTeste(db, id, "2026-11");
    await rodarRotinaDiaria(db, dia("2026-11-15"));
    expect(await statusDe(id)).toBe("inadimplente");

    await pagarFatura(db, (await faturaDe(id, "2026-10")).id, dia("2026-11-16"));
    expect(await statusDe(id)).toBe("inadimplente");
    await pagarFatura(db, (await faturaDe(id, "2026-11")).id, dia("2026-11-16"));
    expect(await statusDe(id)).toBe("ativo");
    expect(await ultimoHistorico(id)).toMatchObject({
      status_anterior: "inadimplente",
      status_novo: "ativo",
      modo: "automatico",
      motivo: "Todas as faturas vencidas foram pagas",
    });
  });

  it("pagar fatura a vencer não tira o contrato de Inadimplente", async () => {
    const id = await contratoInadimplente();
    await criarFaturaTeste(db, id, "2026-12");
    await pagarFatura(db, (await faturaDe(id, "2026-12")).id, dia("2026-11-16"));
    expect(await statusDe(id)).toBe("inadimplente");
  });

  it("não paga fatura duas vezes nem fatura cancelada", async () => {
    const id = await contratoInadimplente();
    const { id: faturaId } = await faturaDe(id, "2026-11");
    await pagarFatura(db, faturaId);
    expect(await pagarFatura(db, faturaId)).toEqual({ ok: false, erro: "Esta fatura já está paga" });

    const outro = await contratoAtivo();
    await criarFaturaTeste(db, outro, "2026-11");
    await executarAcaoManual(db, outro, "bloquear", "Teste", dia("2026-11-05"));
    expect(await pagarFatura(db, (await faturaDe(outro, "2026-11")).id)).toEqual({
      ok: false,
      erro: "Fatura cancelada não pode ser paga",
    });
  });
});

describe("bloqueio", () => {
  it("a rotina nunca bloqueia: o bloqueio é só manual", async () => {
    const id = await contratoInadimplente();
    await rodarRotinaDiaria(db, dia("2030-01-01"));
    expect(await statusDe(id)).toBe("inadimplente");
    expect((await executarAcaoManual(db, id, "bloquear", "Decisão da gestão", dia("2030-01-02"))).ok).toBe(true);
    expect(await ultimoHistorico(id)).toMatchObject({
      status_anterior: "inadimplente",
      status_novo: "bloqueado",
      modo: "manual",
    });
  });

  it("manual exige motivo e registra autor e modo", async () => {
    const id = await contratoAtivo();
    expect(await executarAcaoManual(db, id, "bloquear", "  ")).toEqual({ ok: false, erro: "Informe o motivo" });
    expect(await statusDe(id)).toBe("ativo");

    expect((await executarAcaoManual(db, id, "bloquear", "Pedido da diretoria")).ok).toBe(true);
    const historico = await ultimoHistorico(id);
    expect(historico).toMatchObject({
      status_anterior: "ativo",
      status_novo: "bloqueado",
      motivo: "Pedido da diretoria",
      modo: "manual",
    });
    expect(historico.autor).toBeTruthy();
    expect(historico.data).toBeInstanceOf(Date);
  });

  it("não gera fatura nova", async () => {
    const id = await contratoAtivo();
    await executarAcaoManual(db, id, "bloquear", "Teste");
    expect(await criarFaturaTeste(db, id, "2026-12")).toEqual({
      ok: false,
      erro: "Contrato Bloqueado não gera faturas novas",
    });
  });

  it("cancela a fatura do mês que não venceu, com autor e motivo; a vencida fica aberta", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-10");
    await criarFaturaTeste(db, id, "2026-11"); // vence em 10/11
    await rodarRotinaDiaria(db, dia("2026-11-01"));
    expect((await faturaDe(id, "2026-10")).status).toBe("vencida");

    await executarAcaoManual(db, id, "bloquear", "Teste", dia("2026-11-05"));
    expect(await faturaDe(id, "2026-11")).toMatchObject({ status: "cancelada", motivo: "Contrato bloqueado" });
    expect((await faturaDe(id, "2026-10")).status).toBe("vencida");
  });

  it("não cancela fatura de outro mês", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-12");
    await executarAcaoManual(db, id, "bloquear", "Teste", dia("2026-11-05"));
    expect((await faturaDe(id, "2026-12")).status).toBe("a_vencer");
  });

  it("quitando tudo, volta para Ativo", async () => {
    const id = await contratoInadimplente();
    await executarAcaoManual(db, id, "bloquear", "Teste", dia("2026-11-25"));
    await pagarFatura(db, (await faturaDe(id, "2026-11")).id, dia("2026-11-26"));
    expect(await statusDe(id)).toBe("ativo");
    expect(await ultimoHistorico(id)).toMatchObject({ status_anterior: "bloqueado", status_novo: "ativo" });
  });

  it("negociação volta para Ativo, com motivo", async () => {
    const id = await contratoAtivo();
    await executarAcaoManual(db, id, "bloquear", "Teste");
    expect((await executarAcaoManual(db, id, "negociar", "Acordo de parcelamento")).ok).toBe(true);
    expect(await ultimoHistorico(id)).toMatchObject({
      status_anterior: "bloqueado",
      status_novo: "ativo",
      motivo: "Acordo de parcelamento",
      modo: "manual",
    });
  });
});

describe("cancelamento", () => {
  it("pedido mantém o acesso até efetivar e pode ser retido", async () => {
    const id = await contratoAtivo();
    await executarAcaoManual(db, id, "solicitar_cancelamento", "Cliente pediu");
    expect(await statusDe(id)).toBe("cancelamento_solicitado");
    expect((await executarAcaoManual(db, id, "reter", "Aceitou ficar")).ok).toBe(true);
    expect(await statusDe(id)).toBe("ativo");
  });

  it("efetiva na confirmação", async () => {
    const id = await contratoAtivo();
    await executarAcaoManual(db, id, "solicitar_cancelamento", "Cliente pediu");
    await executarAcaoManual(db, id, "confirmar_cancelamento", "Confirmado por telefone");
    expect(await statusDe(id)).toBe("cancelado");
  });

  it("efetiva sozinho em 30 dias", async () => {
    const id = await contratoAtivo();
    await executarAcaoManual(db, id, "solicitar_cancelamento", "Cliente pediu", dia("2026-11-04"));
    await rodarRotinaDiaria(db, dia("2026-12-03"));
    expect(await statusDe(id)).toBe("cancelamento_solicitado");
    await rodarRotinaDiaria(db, dia("2026-12-04"));
    expect(await statusDe(id)).toBe("cancelado");
    expect(await ultimoHistorico(id)).toMatchObject({ modo: "automatico" });
  });

  it("cancelado é definitivo; reativar é um contrato novo", async () => {
    const { id, titularId } = await novoContrato();
    await registrarPagamentoAdesao(db, id);
    await registrarAssinatura(db, id);
    await executarAcaoManual(db, id, "solicitar_cancelamento", "Cliente pediu");
    await executarAcaoManual(db, id, "confirmar_cancelamento", "Confirmado");

    for (const acao of ["bloquear", "negociar", "solicitar_cancelamento", "reter", "confirmar_cancelamento"]) {
      expect((await executarAcaoManual(db, id, acao, "Teste")).ok).toBe(false);
    }
    expect(await buscarCobertura(db, titularId)).toBeUndefined();
    expect((await criarFaturaTeste(db, id, "2026-12")).ok).toBe(false);
  });
});

describe("ações manuais fora do status certo", () => {
  it("recusa e não grava histórico", async () => {
    const { id } = await novoContrato();
    const antes = await contarHistorico(id);
    for (const acao of ["bloquear", "negociar", "solicitar_cancelamento", "reter", "confirmar_cancelamento"]) {
      expect((await executarAcaoManual(db, id, acao, "Teste")).ok).toBe(false);
    }
    expect(await statusDe(id)).toBe("pendente");
    expect(await contarHistorico(id)).toBe(antes);
  });

  it("recusa ação inexistente", async () => {
    const id = await contratoAtivo();
    expect(await executarAcaoManual(db, id, "apagar", "Teste")).toEqual({ ok: false, erro: "Ação inválida" });
  });

  it("oferece à tela só as ações do status atual", async () => {
    const { id } = await novoContrato();
    expect((await carregarPainelStatus(db, id))?.acoes).toEqual([]);
    await registrarPagamentoAdesao(db, id);
    await registrarAssinatura(db, id);
    expect((await carregarPainelStatus(db, id))?.acoes).toEqual(["bloquear", "solicitar_cancelamento"]);
    await executarAcaoManual(db, id, "bloquear", "Teste");
    expect((await carregarPainelStatus(db, id))?.acoes).toEqual(["negociar"]);
  });
});

describe("fatura de teste", () => {
  it("usa o valor e o vencimento do contrato", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-12");
    const { rows } = await cliente.query<Record<string, unknown>>(
      "SELECT valor_centavos, vencimento::text AS vencimento, status FROM fatura WHERE contrato_id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ valor_centavos: 14990, vencimento: "2026-12-10", status: "a_vencer" });
  });

  it("recusa mês repetido, mês inválido e contrato Pendente", async () => {
    const id = await contratoAtivo();
    await criarFaturaTeste(db, id, "2026-12");
    expect(await criarFaturaTeste(db, id, "2026-12")).toEqual({ ok: false, erro: "Já existe fatura deste mês" });
    expect((await criarFaturaTeste(db, id, "2026-13")).ok).toBe(false);
    const { id: pendente } = await novoContrato();
    expect((await criarFaturaTeste(db, pendente, "2026-12")).ok).toBe(false);
  });
});

describe("prazos configuráveis", () => {
  it("salva, limpa e valida", async () => {
    expect(await salvarPrazoInadimplencia(db, "15")).toEqual({ ok: true });
    expect((await lerPrazos(db)).x).toBe(15);
    expect(await salvarPrazoInadimplencia(db, "")).toEqual({ ok: true });
    expect((await lerPrazos(db)).x).toBe(1);
    for (const invalido of ["0", "-3", "abc", "1.5", "366"]) {
      expect((await salvarPrazoInadimplencia(db, invalido)).ok).toBe(false);
    }
  });
});

describe("rotina: vaga liberada", () => {
  it("o extra deixa de pagar quando o bloqueio de 90 dias termina", async () => {
    const id = await contratoAtivo();
    const incluir = async () => {
      const dados = {
        nome: "Dependente de Teste",
        cpf: novoCpf(),
        dataNascimento: "2000-01-01",
        parentesco: "Filho",
        confirmacao: "",
      };
      const r = await incluirDependente(db, id, dados, "2026-11-04");
      if (r.status === "confirmar") {
        await incluirDependente(db, id, { ...dados, confirmacao: r.previa.assinatura }, "2026-11-04");
      }
    };
    for (let i = 0; i < 4; i += 1) await incluir();
    const primeiro = await umId(
      "SELECT id FROM vida WHERE contrato_id = $1 AND papel = 'dependente' ORDER BY criado_em, id LIMIT 1",
      [id],
    );
    await removerDependente(db, primeiro, "Teste", "2026-11-04"); // libera em 02/02/2027

    await rodarRotinaDiaria(db, dia("2027-02-01"));
    const valor = async () => {
      const { rows } = await cliente.query<{ v: number }>(
        "SELECT valor_mensal_centavos AS v FROM versao_contrato WHERE contrato_id = $1 AND vigencia_fim IS NULL",
        [id],
      );
      return rows[0].v;
    };
    expect(await valor()).toBe(16480);
    const relatorio = await rodarRotinaDiaria(db, dia("2027-02-02"));
    expect(await valor()).toBe(14990);
    expect(relatorio.valoresAtualizados).toHaveLength(1);
  });
});

describe("contagem de dias", () => {
  it("atravessa meses e o horário de verão sem errar", () => {
    expect(diasEntre("2026-11-10", "2026-11-15")).toBe(5);
    expect(diasEntre("2026-12-31", "2027-01-01")).toBe(1);
    expect(diasEntre("2026-11-15", "2026-11-10")).toBe(-5);
  });
});
