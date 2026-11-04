// Confere a estrutura em um banco temporário, na memória, que some ao final dos testes.
import type { PGlite } from "@electric-sql/pglite";
import { asc, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { semear } from "../src/banco/dados-ficticios";
import { pessoa, vida } from "../src/banco/esquema";
import { cpfValido, gerarCpfFicticio } from "../src/regras/cpf";

let cliente: PGlite;
let db: Banco;

async function umId(consulta: string): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(consulta);
  return rows[0].id;
}

const idContrato = () => umId("SELECT id FROM contrato LIMIT 1");
const idOrigem = () => umId("SELECT id FROM origem LIMIT 1");

beforeAll(async () => {
  const banco = abrirBanco();
  cliente = banco.cliente;
  db = banco.db;
  await aplicarMigracoes(db);
  await semear(db);
});

afterAll(async () => {
  await cliente.close();
});

describe("dados fictícios", () => {
  it("guarda os preços do PRD em centavos", async () => {
    const { rows } = await cliente.query<{ nome: string; composicao: string; valor_centavos: number }>(
      `SELECT p.nome, pp.composicao, pp.valor_centavos
       FROM preco_plano pp JOIN plano p ON p.id = pp.plano_id
       ORDER BY p.nome, pp.composicao`,
    );
    expect(rows.map((l) => [l.nome, l.composicao, l.valor_centavos])).toEqual([
      ["Realize Clínicas", "familiar", 8990],
      ["Realize Clínicas", "individual", 5490],
      ["Realize Digital", "familiar", 8990],
      ["Realize Digital", "individual", 5490],
      ["Realize Total", "familiar", 14990],
      ["Realize Total", "individual", 8990],
    ]);
  });

  it("guarda os valores de dependente extra por idade", async () => {
    const { rows } = await cliente.query<{ idade_minima: number; valor_centavos: number }>(
      `SELECT pa.idade_minima, pa.valor_centavos
       FROM preco_adicional pa JOIN adicional a ON a.id = pa.adicional_id
       WHERE a.tipo = 'dependente_extra' ORDER BY pa.idade_minima`,
    );
    expect(rows).toEqual([
      { idade_minima: 0, valor_centavos: 1490 },
      { idade_minima: 65, valor_centavos: 3990 },
    ]);
  });

  it("usa apenas CPFs com formato válido", async () => {
    const { rows } = await cliente.query<{ cpf: string }>(
      "SELECT cpf FROM pessoa WHERE cpf IS NOT NULL",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((l) => cpfValido(l.cpf))).toBe(true);
  });

  it("liga contrato, versão, vidas e histórico", async () => {
    const { rows } = await cliente.query<{ status: string; valor: number; vidas: number; historico: number }>(
      `SELECT c.status, v.valor_mensal_centavos AS valor,
         (SELECT count(*)::int FROM vida WHERE contrato_id = c.id) AS vidas,
         (SELECT count(*)::int FROM historico_status WHERE contrato_id = c.id) AS historico
       FROM contrato c JOIN versao_contrato v ON v.contrato_id = c.id`,
    );
    expect(rows).toEqual([{ status: "pendente", valor: 16980, vidas: 4, historico: 1 }]);
  });

  it("liga cada pessoa aos contratos em que está", async () => {
    const linhas = await db
      .select({ nome: pessoa.nome, contratos: count(vida.id) })
      .from(pessoa)
      .leftJoin(vida, eq(vida.pessoaId, pessoa.id))
      .groupBy(pessoa.id)
      .orderBy(asc(pessoa.nome));
    expect(linhas.map((l) => [l.nome.split(" ")[0], l.contratos])).toEqual([
      ["Carlos", 1],
      ["João", 1],
      ["Lia", 1],
      ["Maria", 1],
      ["Pedro", 0],
    ]);
  });

  it("o contrato de exemplo soma certo", async () => {
    const { rows } = await cliente.query<Record<string, number>>(
      `SELECT valor_plano_centavos AS plano, valor_funeral_centavos AS funeral,
         valor_dependente_extra_centavos AS extra, valor_mensal_centavos AS mensal
       FROM versao_contrato`,
    );
    expect(rows).toEqual([{ plano: 14990, funeral: 1990, extra: 0, mensal: 16980 }]);
    expect(rows[0].plano + rows[0].funeral + rows[0].extra).toBe(rows[0].mensal);
  });

  it("não duplica os dados se rodar de novo", async () => {
    expect(await semear(db)).toBe(false);
    const { rows } = await cliente.query<{ n: number }>("SELECT count(*)::int AS n FROM plano");
    expect(rows[0].n).toBe(3);
  });
});

describe("pessoa", () => {
  it("recusa CPF repetido", async () => {
    const { rows } = await cliente.query<{ cpf: string }>(
      "SELECT cpf FROM pessoa WHERE cpf IS NOT NULL LIMIT 1",
    );
    await expect(
      cliente.query("INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Teste', $1, '2000-01-01')", [
        rows[0].cpf,
      ]),
    ).rejects.toThrow(/pessoa_cpf_unique/);
  });

  it("recusa CPF com formato errado", async () => {
    await expect(
      cliente.query("INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Teste', '123', '2000-01-01')"),
    ).rejects.toThrow(/pessoa_cpf_11_digitos/);
  });

  it("exige data de nascimento", async () => {
    await expect(
      cliente.query("INSERT INTO pessoa (nome, cpf) VALUES ('Teste', $1)", [gerarCpfFicticio("900000099")]),
    ).rejects.toThrow(/data_nascimento/);
  });

  it("permite só um contato principal de cada tipo", async () => {
    const id = await umId("SELECT pessoa_id AS id FROM contato WHERE tipo = 'celular' AND principal LIMIT 1");
    await expect(
      cliente.query(
        "INSERT INTO contato (pessoa_id, tipo, valor, principal) VALUES ($1, 'celular', '21900000099', true)",
        [id],
      ),
    ).rejects.toThrow(/contato_um_principal_por_tipo/);
  });
});

describe("contrato", () => {
  it("exige origem", async () => {
    const titular = await umId("SELECT id FROM pessoa LIMIT 1");
    await expect(
      cliente.query("INSERT INTO contrato (titular_id, data_adesao) VALUES ($1, '2026-11-03')", [titular]),
    ).rejects.toThrow(/origem_id/);
  });

  it("exige titular ou empresa", async () => {
    await expect(
      cliente.query("INSERT INTO contrato (origem_id, data_adesao) VALUES ($1, '2026-11-03')", [
        await idOrigem(),
      ]),
    ).rejects.toThrow(/contrato_titular_ou_empresa/);
  });

  it("nasce como Pendente", async () => {
    const titular = await umId("SELECT id FROM pessoa WHERE nome LIKE 'Pedro%'");
    const { rows } = await cliente.query<{ status: string }>(
      "INSERT INTO contrato (titular_id, origem_id, data_adesao) VALUES ($1, $2, '2026-11-03') RETURNING status",
      [titular, await idOrigem()],
    );
    expect(rows[0].status).toBe("pendente");
  });

  it("não pode ser apagado", async () => {
    await expect(cliente.query("DELETE FROM contrato")).rejects.toThrow(/não pode ser apagado/);
  });

  it("aceita só os status previstos", async () => {
    await expect(
      cliente.query("UPDATE contrato SET status = 'pausado'"),
    ).rejects.toThrow(/status_contrato/);
  });
});

describe("versão do contrato", () => {
  it("permite só uma versão vigente", async () => {
    await expect(
      cliente.query(
        `INSERT INTO versao_contrato (contrato_id, numero, plano_id, composicao, forma_pagamento,
           dia_vencimento, valor_plano_centavos, valor_funeral_centavos,
           valor_dependente_extra_centavos, valor_primeira_mensalidade_centavos,
           valor_mensal_centavos, vigencia_inicio, motivo, autor)
         SELECT contrato_id, 2, plano_id, composicao, forma_pagamento, dia_vencimento,
           valor_plano_centavos, valor_funeral_centavos, valor_dependente_extra_centavos,
           valor_primeira_mensalidade_centavos, valor_mensal_centavos, '2026-12-01',
           'Teste', 'Teste' FROM versao_contrato LIMIT 1`,
      ),
    ).rejects.toThrow(/versao_uma_vigente_por_contrato/);
  });

  it("não deixa alterar o preço de uma versão", async () => {
    await expect(
      cliente.query("UPDATE versao_contrato SET valor_mensal_centavos = 1"),
    ).rejects.toThrow(/nunca é sobrescrita/);
  });

  it("não pode ser apagada", async () => {
    await expect(cliente.query("DELETE FROM versao_contrato")).rejects.toThrow(/não pode ser apagado/);
  });

  it("permite encerrar a vigência", async () => {
    const id = await umId("SELECT id FROM versao_contrato LIMIT 1");
    await cliente.query("UPDATE versao_contrato SET vigencia_fim = '2026-12-31' WHERE id = $1", [id]);
    const { rows } = await cliente.query<{ valor_mensal_centavos: number }>(
      "SELECT valor_mensal_centavos FROM versao_contrato WHERE id = $1",
      [id],
    );
    expect(rows[0].valor_mensal_centavos).toBe(16980);
    await cliente.query("UPDATE versao_contrato SET vigencia_fim = NULL WHERE id = $1", [id]);
  });
});

describe("vida", () => {
  it("não aceita a mesma pessoa duas vezes no contrato", async () => {
    await expect(
      cliente.query(
        `INSERT INTO vida (contrato_id, pessoa_id, papel, parentesco, data_entrada)
         SELECT contrato_id, pessoa_id, 'dependente', 'Teste', '2026-11-04'
         FROM vida WHERE papel = 'dependente' LIMIT 1`,
      ),
    ).rejects.toThrow(/vida_pessoa_uma_vez_no_contrato/);
  });

  it("exige parentesco do dependente", async () => {
    const pessoaId = await umId("SELECT id FROM pessoa WHERE nome LIKE 'Pedro%'");
    await expect(
      cliente.query(
        "INSERT INTO vida (contrato_id, pessoa_id, papel, data_entrada) VALUES ($1, $2, 'dependente', '2026-11-04')",
        [await idContrato(), pessoaId],
      ),
    ).rejects.toThrow(/vida_dependente_tem_parentesco/);
  });

  it("exige motivo e autor quando a vida sai", async () => {
    await expect(
      cliente.query("UPDATE vida SET data_saida = '2026-11-04' WHERE papel = 'dependente'"),
    ).rejects.toThrow(/vida_saida_tem_motivo_e_autor/);
  });

  it("não pode ser apagada", async () => {
    await expect(cliente.query("DELETE FROM vida")).rejects.toThrow(/não pode ser apagado/);
  });
});

describe("histórico de status", () => {
  it("não pode ser alterado", async () => {
    await expect(cliente.query("UPDATE historico_status SET autor = 'Outro'")).rejects.toThrow(
      /não pode ser alterado/,
    );
  });

  it("não pode ser apagado", async () => {
    await expect(cliente.query("DELETE FROM historico_status")).rejects.toThrow(/não pode ser apagado/);
  });
});

describe("fatura", () => {
  async function criarFatura(competencia: string) {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO fatura (contrato_id, competencia, valor_centavos, vencimento)
       VALUES ($1, $2, 16980, '2026-12-10') RETURNING id`,
      [await idContrato(), competencia],
    );
    return rows[0].id;
  }

  it("não aceita cancelamento sem autor e motivo", async () => {
    const id = await criarFatura("2026-12");
    await expect(
      cliente.query("UPDATE fatura SET status = 'cancelada' WHERE id = $1", [id]),
    ).rejects.toThrow(/fatura_cancelamento_completo/);
  });

  it("não pode ser apagada", async () => {
    await expect(cliente.query("DELETE FROM fatura")).rejects.toThrow(/não pode ser apagado/);
  });

  it("não aceita duas faturas válidas no mesmo mês", async () => {
    await expect(criarFatura("2026-12")).rejects.toThrow(/fatura_uma_valida_por_competencia/);
  });
});
