import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { semear } from "../src/banco/dados-ficticios";
import {
  avaliarPreco,
  buscarCobertura,
  carregarOpcoes,
  criarContrato,
  type EntradaContrato,
} from "../src/regras/contratos";
import { gerarCpfFicticio } from "../src/regras/cpf";

const HOJE = "2026-11-04";

let cliente: PGlite;
let db: Banco;
let total: string;
let digital: string;
let sequencia = 500;

async function umId(consulta: string, parametros: unknown[] = []) {
  const { rows } = await cliente.query<{ id: string }>(consulta, parametros);
  return rows[0].id;
}

async function novoTitular(nascimento = "1990-01-01", comCpf = true) {
  sequencia += 1;
  const cpf = comCpf ? gerarCpfFicticio(`900000${sequencia}`) : null;
  return umId(
    "INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Titular de Teste', $1, $2) RETURNING id",
    [cpf, nascimento],
  );
}

async function entrada(campos: Partial<EntradaContrato> = {}): Promise<EntradaContrato> {
  return {
    titularId: campos.titularId ?? (await novoTitular()),
    planoId: total,
    composicao: "familiar",
    funeral: false,
    cupom: "",
    formaPagamento: "cartao_recorrente",
    diaVencimento: "10",
    origemTipo: "balcao",
    origemDetalhe: "",
    ...campos,
  };
}

beforeAll(async () => {
  const banco = abrirBanco();
  cliente = banco.cliente;
  db = banco.db;
  await aplicarMigracoes(db);
  await semear(db);
  total = await umId("SELECT id FROM plano WHERE nome = 'Realize Total'");
  digital = await umId("SELECT id FROM plano WHERE nome = 'Realize Digital'");
});

afterAll(async () => {
  await cliente.close();
});

describe("criação do contrato", () => {
  it("nasce Pendente, com versão, vida do titular e histórico", async () => {
    const titularId = await novoTitular();
    const resultado = await criarContrato(db, await entrada({ titularId }), HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const { rows: contratos } = await cliente.query<Record<string, unknown>>(
      "SELECT status, titular_id, data_adesao::text FROM contrato WHERE id = $1",
      [resultado.id],
    );
    expect(contratos[0]).toMatchObject({ status: "pendente", titular_id: titularId, data_adesao: HOJE });

    const { rows: versoes } = await cliente.query<Record<string, unknown>>(
      "SELECT numero, valor_plano_centavos, valor_mensal_centavos, dia_vencimento FROM versao_contrato WHERE contrato_id = $1",
      [resultado.id],
    );
    expect(versoes).toEqual([
      { numero: 1, valor_plano_centavos: 14990, valor_mensal_centavos: 14990, dia_vencimento: 10 },
    ]);

    const { rows: vidas } = await cliente.query<Record<string, unknown>>(
      "SELECT pessoa_id, papel, carencia_funeral_inicio FROM vida WHERE contrato_id = $1",
      [resultado.id],
    );
    expect(vidas).toEqual([{ pessoa_id: titularId, papel: "titular", carencia_funeral_inicio: null }]);

    const { rows: historico } = await cliente.query<Record<string, unknown>>(
      "SELECT status_anterior, status_novo, motivo, modo FROM historico_status WHERE contrato_id = $1",
      [resultado.id],
    );
    expect(historico).toEqual([
      { status_anterior: null, status_novo: "pendente", motivo: "Contrato criado", modo: "manual" },
    ]);
  });

  it("guarda a origem informada", async () => {
    const vendedorId = await umId(
      `INSERT INTO usuario (nome, cpf, email, login, perfil, senha_hash)
       VALUES ('Vendedor Fictício', $1, 'vendedor.teste@example.com', 'vendedor.teste', 'vendedor', 'x') RETURNING id`,
      [gerarCpfFicticio("900000999")],
    );
    const resultado = await criarContrato(
      db,
      await entrada({ origemTipo: "vendedor", origemDetalhe: " Vendedor Fictício ", vendedorId }),
      HOJE,
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { rows } = await cliente.query<Record<string, unknown>>(
      "SELECT o.tipo, o.detalhe, o.vendedor_id FROM contrato c JOIN origem o ON o.id = c.origem_id WHERE c.id = $1",
      [resultado.id],
    );
    expect(rows[0]).toEqual({ tipo: "vendedor", detalhe: "Vendedor Fictício", vendedor_id: vendedorId });
  });

  it("ignora qualquer valor vindo da tela: quem calcula é o servidor", async () => {
    const dados = { ...(await entrada()), valorMensalCentavos: 1 } as EntradaContrato;
    const resultado = await criarContrato(db, dados, HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { rows } = await cliente.query<{ valor_mensal_centavos: number }>(
      "SELECT valor_mensal_centavos FROM versao_contrato WHERE contrato_id = $1",
      [resultado.id],
    );
    expect(rows[0].valor_mensal_centavos).toBe(14990);
  });

  it("mantém o preço do contrato quando a tabela muda depois", async () => {
    const resultado = await criarContrato(db, await entrada({ planoId: digital }), HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    await cliente.query(
      `INSERT INTO preco_plano (plano_id, composicao, valor_centavos, vigencia_inicio)
       VALUES ($1, 'familiar', 9990, '2026-12-01')`,
      [digital],
    );
    await cliente.query(
      `UPDATE preco_plano SET vigencia_fim = '2026-11-30'
       WHERE plano_id = $1 AND composicao = 'familiar' AND vigencia_inicio = '2026-11-01'`,
      [digital],
    );
    const { rows } = await cliente.query<{ valor_mensal_centavos: number }>(
      "SELECT valor_mensal_centavos FROM versao_contrato WHERE contrato_id = $1",
      [resultado.id],
    );
    expect(rows[0].valor_mensal_centavos).toBe(8990);

    const antes = await avaliarPreco(db, await entrada({ planoId: digital }), HOJE);
    const depois = await avaliarPreco(db, await entrada({ planoId: digital }), "2026-12-01");
    expect(antes.calculo?.valorMensalCentavos).toBe(8990);
    expect(depois.calculo?.valorMensalCentavos).toBe(9990);
  });
});

describe("campos obrigatórios", () => {
  async function erroAo(campos: Partial<EntradaContrato>) {
    const resultado = await criarContrato(db, await entrada(campos), HOJE);
    return resultado.ok ? {} : resultado.erros;
  }

  it("exige plano", async () => {
    expect((await erroAo({ planoId: "" })).planoId).toBe("Escolha um plano");
    expect((await erroAo({ planoId: "nao-e-um-id" })).planoId).toBe("Escolha um plano");
  });

  it("exige composição válida", async () => {
    expect((await erroAo({ composicao: "casal" })).composicao).toBe("Escolha a composição");
  });

  it("exige origem", async () => {
    expect((await erroAo({ origemTipo: "" })).origemTipo).toBe("Informe a origem do contrato");
    expect((await erroAo({ origemTipo: "inventada" })).origemTipo).toBe("Informe a origem do contrato");
  });

  it("não aceita migração como origem nesta tela", async () => {
    expect((await erroAo({ origemTipo: "migracao" })).origemTipo).toBeDefined();
  });

  it("origem Cupom exige um cupom", async () => {
    expect((await erroAo({ origemTipo: "cupom" })).cupom).toBeDefined();
  });

  it("exige forma de pagamento", async () => {
    expect((await erroAo({ formaPagamento: "" })).formaPagamento).toBe("Escolha a forma de pagamento");
  });

  it("aceita só os dias de vencimento configurados", async () => {
    expect((await erroAo({ diaVencimento: "" })).diaVencimento).toBeDefined();
    expect((await erroAo({ diaVencimento: "7" })).diaVencimento).toBeDefined();
    for (const dia of ["5", "10", "15", "20"]) {
      expect((await erroAo({ diaVencimento: dia })).diaVencimento).toBeUndefined();
    }
  });

  it("não grava nada quando há erro", async () => {
    const titularId = await novoTitular();
    await criarContrato(db, await entrada({ titularId, origemTipo: "" }), HOJE);
    expect(await buscarCobertura(db, titularId)).toBeUndefined();
  });
});

describe("forma de pagamento por plano", () => {
  it("recusa forma que o plano não aceita", async () => {
    const plano = await umId(
      "INSERT INTO plano (nome) VALUES ('Plano Só Cartão') RETURNING id",
    );
    await cliente.query(
      `INSERT INTO preco_plano (plano_id, composicao, valor_centavos, vigencia_inicio)
       VALUES ($1, 'familiar', 5000, '2026-01-01')`,
      [plano],
    );
    await cliente.query(
      "INSERT INTO plano_forma_pagamento (plano_id, forma) VALUES ($1, 'cartao_recorrente')",
      [plano],
    );
    const recusado = await criarContrato(
      db,
      await entrada({ planoId: plano, formaPagamento: "carne" }),
      HOJE,
    );
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) {
      expect(recusado.erros.formaPagamento).toBe("Este plano não aceita esta forma de pagamento");
    }
    const aceito = await criarContrato(db, await entrada({ planoId: plano }), HOJE);
    expect(aceito.ok).toBe(true);
  });
});

describe("funeral", () => {
  it("só em planos que aceitam", async () => {
    const resultado = await criarContrato(db, await entrada({ planoId: digital, funeral: true }), HOJE);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros.funeral).toBe("Este plano não aceita o adicional de funeral");
  });

  it("soma pela idade e inicia a carência na adesão", async () => {
    const titularId = await novoTitular("1960-03-15"); // 66 anos
    const resultado = await criarContrato(db, await entrada({ titularId, funeral: true }), HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { rows } = await cliente.query<Record<string, unknown>>(
      `SELECT v.valor_funeral_centavos, v.valor_mensal_centavos, vi.carencia_funeral_inicio::text AS carencia,
         (SELECT count(*)::int FROM versao_adicional va WHERE va.versao_id = v.id) AS adicionais
       FROM versao_contrato v JOIN vida vi ON vi.contrato_id = v.contrato_id
       WHERE v.contrato_id = $1`,
      [resultado.id],
    );
    expect(rows[0]).toEqual({
      valor_funeral_centavos: 1990,
      valor_mensal_centavos: 16980,
      carencia: HOJE,
      adicionais: 1,
    });
  });

  it("recusa acima de 80 anos, mas aceita o plano sem funeral", async () => {
    const titularId = await novoTitular("1945-01-01"); // 81 anos
    const comFuneral = await criarContrato(db, await entrada({ titularId, funeral: true }), HOJE);
    expect(comFuneral.ok).toBe(false);
    if (!comFuneral.ok) expect(comFuneral.erros.funeral).toContain("acima de 80 anos");
    const semFuneral = await criarContrato(db, await entrada({ titularId }), HOJE);
    expect(semFuneral.ok).toBe(true);
  });

  it("informa à tela quando a idade não permite", async () => {
    const opcoes81 = await carregarOpcoes(db, "1945-01-01", HOJE);
    expect(opcoes81.funeralPermitidoPelaIdade).toBe(false);
    const opcoes80 = await carregarOpcoes(db, "1946-01-01", HOJE);
    expect(opcoes80.funeralPermitidoPelaIdade).toBe(true);
  });
});

describe("cupom", () => {
  async function avaliar(codigo: string, hoje = HOJE) {
    return avaliarPreco(db, await entrada({ cupom: codigo }), hoje);
  }

  it("aplica o desconto, sem diferenciar maiúscula de minúscula", async () => {
    const r = await avaliar(" teste50 ");
    expect(r.erros.cupom).toBeUndefined();
    expect(r.calculo?.valorMensalCentavos).toBe(7495);
  });

  it("recusa cupom encerrado", async () => {
    const r = await avaliar("OUT26");
    expect(r.erros.cupom).toBe("Cupom expirado");
    expect(r.calculo?.valorMensalCentavos).toBe(14990);
  });

  it("recusa cupom inexistente", async () => {
    expect((await avaliar("NAOEXISTE")).erros.cupom).toBe("Cupom não encontrado");
  });

  it("vale até o último dia e não antes do primeiro", async () => {
    expect((await avaliar("OUT26", "2026-10-01")).erros.cupom).toBeUndefined();
    expect((await avaliar("OUT26", "2026-10-31")).erros.cupom).toBeUndefined();
    expect((await avaliar("OUT26", "2026-09-30")).erros.cupom).toBe("Este cupom ainda não está valendo");
  });

  it("não cria contrato com cupom recusado", async () => {
    const resultado = await criarContrato(db, await entrada({ cupom: "OUT26" }), HOJE);
    expect(resultado.ok).toBe(false);
  });

  it("guarda o desconto na versão: quem já tem continua com ele", async () => {
    const resultado = await criarContrato(db, await entrada({ cupom: "TESTE50" }), HOJE);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { rows } = await cliente.query<Record<string, unknown>>(
      `SELECT cupom_percentual, cupom_recorrente, valor_primeira_mensalidade_centavos, valor_mensal_centavos
       FROM versao_contrato WHERE contrato_id = $1`,
      [resultado.id],
    );
    expect(rows[0]).toEqual({
      cupom_percentual: 50,
      cupom_recorrente: true,
      valor_primeira_mensalidade_centavos: 7495,
      valor_mensal_centavos: 7495,
    });
  });

  it("cupom só da primeira mensalidade fica registrado nos dois valores", async () => {
    await cliente.query(
      `INSERT INTO cupom (codigo, percentual, recorrente, vigencia_inicio, vigencia_fim)
       VALUES ('SOPRIMEIRA', 10, false, '2026-01-01', '2030-12-31')`,
    );
    const r = await avaliar("SOPRIMEIRA");
    expect(r.calculo?.valorPrimeiraMensalidadeCentavos).toBe(13491);
    expect(r.calculo?.valorMensalCentavos).toBe(14990);
  });
});

describe("quem pode ser titular", () => {
  it("recusa pessoa sem CPF", async () => {
    const titularId = await novoTitular("2016-07-05", false);
    const resultado = await criarContrato(db, await entrada({ titularId }), HOJE);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros.titular).toBe("O titular precisa ter CPF");
  });

  it("recusa titular inexistente", async () => {
    const resultado = await criarContrato(
      db,
      await entrada({ titularId: "00000000-0000-4000-8000-000000000000" }),
      HOJE,
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erros.titular).toBe("Titular não encontrado");
  });

  describe("pessoa já coberta", () => {
    let titularId: string;
    let primeiro: string;

    beforeEach(async () => {
      titularId = await novoTitular();
      const resultado = await criarContrato(db, await entrada({ titularId }), HOJE);
      if (!resultado.ok) throw new Error("falha ao preparar o teste");
      primeiro = resultado.id;
    });

    it("não cria um segundo contrato e aponta o existente", async () => {
      const segundo = await criarContrato(db, await entrada({ titularId }), HOJE);
      expect(segundo.ok).toBe(false);
      if (!segundo.ok) expect(segundo.cobertura?.contratoId).toBe(primeiro);
    });

    it("permite novo contrato depois do cancelamento", async () => {
      await cliente.query("UPDATE contrato SET status = 'cancelado' WHERE id = $1", [primeiro]);
      const novo = await criarContrato(db, await entrada({ titularId }), HOJE);
      expect(novo.ok).toBe(true);
    });

    it("conta os demais status como cobertura", async () => {
      for (const status of ["ativo", "inadimplente", "bloqueado", "cancelamento_solicitado"]) {
        await cliente.query("UPDATE contrato SET status = $1 WHERE id = $2", [status, primeiro]);
        const novo = await criarContrato(db, await entrada({ titularId }), HOJE);
        expect(novo.ok).toBe(false);
      }
    });
  });

  it("salva só um quando dois chegam ao mesmo tempo", async () => {
    const titularId = await novoTitular();
    const dados = await entrada({ titularId });
    const resultados = await Promise.all([
      criarContrato(db, dados, HOJE),
      criarContrato(db, dados, HOJE),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });
});
