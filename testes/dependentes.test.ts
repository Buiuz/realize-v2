import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { semear } from "../src/banco/dados-ficticios";
import { criarContrato } from "../src/regras/contratos";
import { gerarCpfFicticio } from "../src/regras/cpf";
import {
  ajustarFaixaVida,
  atualizarValorContrato,
  carregarPainel,
  decidirExcecao,
  incluirDependente,
  pedirExcecao,
  removerDependente,
  type EntradaDependente,
} from "../src/regras/dependentes";
import { adicionarDias, calcularVagas } from "../src/regras/vagas";

const HOJE = "2026-11-04";
let cliente: PGlite;
let db: Banco;
let total: string;
let sequencia = 700;

function novoCpf() {
  sequencia += 1;
  return gerarCpfFicticio(`900000${sequencia}`);
}

async function umId(consulta: string, parametros: unknown[] = []) {
  const { rows } = await cliente.query<{ id: string }>(consulta, parametros);
  return rows[0].id;
}

async function novoContrato(campos: { funeral?: boolean; composicao?: string; cupom?: string; nascimento?: string } = {}) {
  const titularId = await umId(
    "INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Titular de Teste', $1, $2) RETURNING id",
    [novoCpf(), campos.nascimento ?? "1990-01-01"],
  );
  const resultado = await criarContrato(
    db,
    {
      titularId,
      planoId: total,
      composicao: campos.composicao ?? "familiar",
      funeral: campos.funeral ?? false,
      cupom: campos.cupom ?? "",
      formaPagamento: "carne",
      diaVencimento: "10",
      origemTipo: "balcao",
      origemDetalhe: "",
    },
    HOJE,
  );
  if (!resultado.ok) throw new Error(JSON.stringify(resultado.erros));
  return resultado.id;
}

function dependente(campos: Partial<EntradaDependente> = {}): EntradaDependente {
  return {
    nome: "Dependente de Teste",
    cpf: novoCpf(),
    dataNascimento: "2000-01-01",
    parentesco: "Filho",
    confirmacao: "",
    ...campos,
  };
}

/** Inclui e, se o sistema pedir, confirma o valor mostrado. */
async function incluir(contratoId: string, campos: Partial<EntradaDependente> = {}, hoje = HOJE) {
  const dados = dependente(campos);
  const primeira = await incluirDependente(db, contratoId, dados, hoje);
  if (primeira.status !== "confirmar") return primeira;
  return incluirDependente(db, contratoId, { ...dados, confirmacao: primeira.previa.assinatura }, hoje);
}

async function incluirVarios(contratoId: string, quantidade: number) {
  for (let i = 0; i < quantidade; i += 1) {
    const resultado = await incluir(contratoId);
    expect(resultado.status).toBe("ok");
  }
}

async function versoes(contratoId: string) {
  const { rows } = await cliente.query<{
    numero: number;
    fim: string | null;
    plano: number;
    funeral: number;
    extra: number;
    mensal: number;
    motivo: string;
  }>(
    `SELECT numero, vigencia_fim::text AS fim, valor_plano_centavos AS plano, valor_funeral_centavos AS funeral,
       valor_dependente_extra_centavos AS extra, valor_mensal_centavos AS mensal, motivo
     FROM versao_contrato WHERE contrato_id = $1 ORDER BY numero`,
    [contratoId],
  );
  return rows;
}

const ultima = async (contratoId: string) => (await versoes(contratoId)).at(-1)!;

async function vidasDependentes(contratoId: string) {
  const { rows } = await cliente.query<{ id: string; bloqueio: string | null; saida: string | null }>(
    `SELECT id, vaga_bloqueada_ate::text AS bloqueio, data_saida::text AS saida
     FROM vida WHERE contrato_id = $1 AND papel = 'dependente' ORDER BY data_entrada, criado_em, id`,
    [contratoId],
  );
  return rows;
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

describe("cálculo de vagas", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("até 3 não há extra", () => {
    expect(calcularVagas(ids.slice(0, 3), [], 3, HOJE).extras).toEqual([]);
    expect(calcularVagas(ids.slice(0, 2), [], 3, HOJE).vagasLivres).toBe(1);
  });

  it("os últimos incluídos são os extras (decisão 3)", () => {
    expect(calcularVagas(ids, [], 3, HOJE).extras).toEqual(["d", "e"]);
  });

  it("vaga bloqueada reduz a capacidade, até a data de liberar", () => {
    const bloqueio = "2027-02-02";
    expect(calcularVagas(ids.slice(0, 3), [bloqueio], 3, "2027-02-01").extras).toEqual(["c"]);
    expect(calcularVagas(ids.slice(0, 3), [bloqueio], 3, bloqueio).extras).toEqual([]);
  });

  it("soma 90 dias corretamente", () => {
    expect(adicionarDias("2026-11-04", 90)).toBe("2027-02-02");
    expect(adicionarDias("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("inclusão dentro dos 3 incluídos", () => {
  it("não muda o preço, não cria versão e não pede confirmação", async () => {
    const id = await novoContrato();
    for (let i = 0; i < 3; i += 1) {
      const resultado = await incluirDependente(db, id, dependente(), HOJE);
      expect(resultado).toEqual({ status: "ok", novaVersao: false });
    }
    expect(await versoes(id)).toHaveLength(1);
    expect((await ultima(id)).mensal).toBe(14990);
  });
});

describe("4º dependente em diante", () => {
  it("mostra o valor, só grava depois de confirmar e cria nova versão", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    const dados = dependente({ dataNascimento: "1990-01-01" });

    const pedido = await incluirDependente(db, id, dados, HOJE);
    expect(pedido.status).toBe("confirmar");
    if (pedido.status !== "confirmar") return;
    expect(pedido.previa).toMatchObject({
      serExtra: true,
      valorExtraCentavos: 1490,
      valorAtualCentavos: 14990,
      valorNovoCentavos: 16480,
    });
    expect(await vidasDependentes(id)).toHaveLength(3);

    const gravado = await incluirDependente(db, id, { ...dados, confirmacao: pedido.previa.assinatura }, HOJE);
    expect(gravado).toEqual({ status: "ok", novaVersao: true });
    expect(await versoes(id)).toMatchObject([
      { numero: 1, fim: HOJE, mensal: 14990 },
      { numero: 2, fim: null, extra: 1490, mensal: 16480, motivo: "Inclusão de dependente" },
    ]);
  });

  it("cobra R$ 39,90 a partir de 65 anos, e R$ 14,90 aos 64", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    await incluir(id, { dataNascimento: "1962-01-01" }); // 64 anos
    expect((await ultima(id)).extra).toBe(1490);
    await incluir(id, { dataNascimento: "1961-01-01" }); // 65 anos
    expect((await ultima(id)).extra).toBe(1490 + 3990);
  });

  it("não aceita confirmação de um valor diferente do mostrado", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    const resultado = await incluirDependente(db, id, dependente({ confirmacao: "1:" }), HOJE);
    expect(resultado.status).toBe("confirmar");
    expect(await vidasDependentes(id)).toHaveLength(3);
  });

  it("aplica o cupom recorrente sobre o extra", async () => {
    const id = await novoContrato({ cupom: "TESTE50" });
    await incluirVarios(id, 3);
    await incluir(id);
    expect(await ultima(id)).toMatchObject({ extra: 1490, mensal: 8240 });
  });

  it("mantém o preço antigo do plano na nova versão, mesmo com tabela nova", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    await cliente.query(
      `INSERT INTO preco_plano (plano_id, composicao, valor_centavos, vigencia_inicio)
       SELECT plano_id, 'familiar', 99999, '2026-11-04' FROM versao_contrato WHERE contrato_id = $1 LIMIT 1
       ON CONFLICT DO NOTHING`,
      [id],
    );
    await incluir(id);
    expect((await ultima(id)).plano).toBe(14990);
    await cliente.query("DELETE FROM preco_plano WHERE valor_centavos = 99999");
  });
});

describe("remoção", () => {
  it("é imediata, com motivo, e bloqueia a vaga por 90 dias", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 1);
    const [alvo] = await vidasDependentes(id);
    expect(await removerDependente(db, alvo.id, "Mudou de cidade", HOJE)).toEqual({ ok: true });
    const [depois] = await vidasDependentes(id);
    expect(depois).toMatchObject({ saida: HOJE, bloqueio: "2027-02-02" });
  });

  it("exige motivo", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 1);
    const [alvo] = await vidasDependentes(id);
    expect(await removerDependente(db, alvo.id, "  ", HOJE)).toEqual({ ok: false, erro: "Informe o motivo da remoção" });
  });

  it("não remove o titular nem remove duas vezes", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 1);
    const titular = await umId("SELECT id FROM vida WHERE contrato_id = $1 AND papel = 'titular'", [id]);
    expect((await removerDependente(db, titular, "Teste", HOJE)).ok).toBe(false);
    const [alvo] = await vidasDependentes(id);
    await removerDependente(db, alvo.id, "Teste", HOJE);
    expect((await removerDependente(db, alvo.id, "Teste", HOJE)).ok).toBe(false);
  });

  it("remover quem paga como extra não bloqueia vaga e reduz o valor (decisão 6)", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 4);
    const vidas = await vidasDependentes(id);
    await removerDependente(db, vidas[3].id, "Teste", HOJE);
    const depois = await vidasDependentes(id);
    expect(depois[3].bloqueio).toBeNull();
    expect((await ultima(id)).mensal).toBe(14990);
    expect((await carregarPainel(db, id, HOJE))?.bloqueios).toEqual([]);
  });
});

describe("vaga bloqueada", () => {
  async function comVagaBloqueada(extras = 0) {
    const id = await novoContrato();
    await incluirVarios(id, 3 + extras);
    const [primeiro] = await vidasDependentes(id);
    await removerDependente(db, primeiro.id, "Teste", HOJE);
    return id;
  }

  it("recusa a inclusão e informa a data, até a véspera", async () => {
    const id = await comVagaBloqueada();
    const resultado = await incluir(id, {}, "2027-02-01");
    expect(resultado).toEqual({ status: "bloqueada", liberaEm: "2027-02-02", excecaoPendente: false });
  });

  it("aceita no dia em que libera", async () => {
    const id = await comVagaBloqueada();
    expect((await incluir(id, {}, "2027-02-02")).status).toBe("ok");
  });

  it("não deixa incluir pagando como extra enquanto há bloqueio (decisão 5)", async () => {
    const id = await comVagaBloqueada(1);
    expect((await incluir(id)).status).toBe("bloqueada");
  });

  it("extra continua pagando durante o bloqueio e deixa de pagar quando libera (decisão 4)", async () => {
    const id = await comVagaBloqueada(1);
    expect((await ultima(id)).extra).toBe(1490);

    const durante = await carregarPainel(db, id, "2027-02-01");
    expect(durante?.valorEsperadoCentavos).toBe(durante?.valorAtualCentavos);

    const depois = await carregarPainel(db, id, "2027-02-02");
    expect(depois?.valorAtualCentavos).toBe(16480);
    expect(depois?.valorEsperadoCentavos).toBe(14990);

    await atualizarValorContrato(db, id, "2027-02-02");
    expect(await ultima(id)).toMatchObject({ extra: 0, mensal: 14990 });
  });

  it("sem vaga bloqueada, extra deixa de pagar se a vaga liberou (decisão 4)", async () => {
    const id = await comVagaBloqueada(1);
    await atualizarValorContrato(db, id, "2027-02-02");
    const painel = await carregarPainel(db, id, "2027-02-02");
    expect(painel?.extras).toEqual([]);
  });
});

describe("exceção", () => {
  async function comPedido() {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    const [primeiro] = await vidasDependentes(id);
    await removerDependente(db, primeiro.id, "Teste", HOJE);
    expect(await pedirExcecao(db, id, "nascimento", "Nascimento de filha", HOJE)).toEqual({ ok: true });
    const excecaoId = await umId("SELECT id FROM excecao_vaga WHERE contrato_id = $1", [id]);
    return { id, excecaoId };
  }

  it("só pode ser pedida se há vaga bloqueada e com motivo válido", async () => {
    const id = await novoContrato();
    expect((await pedirExcecao(db, id, "nascimento", "", HOJE)).ok).toBe(false);
    const { id: comBloqueio } = await comPedido();
    expect((await pedirExcecao(db, comBloqueio, "viagem", "", HOJE)).ok).toBe(false);
  });

  it("não aceita dois pedidos abertos para a mesma vaga", async () => {
    const { id } = await comPedido();
    expect(await pedirExcecao(db, id, "obito", "", HOJE)).toEqual({
      ok: false,
      erro: "Já existe um pedido de exceção aguardando decisão",
    });
  });

  it("enquanto aguarda, a inclusão continua recusada", async () => {
    const { id } = await comPedido();
    expect(await incluir(id)).toMatchObject({ status: "bloqueada", excecaoPendente: true });
  });

  it("aprovada libera a inclusão e registra autor e motivo", async () => {
    const { id, excecaoId } = await comPedido();
    expect((await decidirExcecao(db, excecaoId, true, "   ", HOJE)).ok).toBe(false);
    expect(await decidirExcecao(db, excecaoId, true, "Certidão apresentada", HOJE)).toEqual({ ok: true });

    const { rows } = await cliente.query<Record<string, unknown>>(
      "SELECT status, motivo_decisao, decidida_por IS NOT NULL AS tem_autor FROM excecao_vaga WHERE id = $1",
      [excecaoId],
    );
    expect(rows[0]).toEqual({ status: "aprovada", motivo_decisao: "Certidão apresentada", tem_autor: true });
    expect((await incluir(id)).status).toBe("ok");
    expect((await ultima(id)).mensal).toBe(14990);
  });

  it("recusada mantém o bloqueio e permite novo pedido", async () => {
    const { id, excecaoId } = await comPedido();
    await decidirExcecao(db, excecaoId, false, "Sem comprovação", HOJE);
    expect((await incluir(id)).status).toBe("bloqueada");
    expect((await decidirExcecao(db, excecaoId, true, "Mudou", HOJE)).ok).toBe(false);
    expect((await pedirExcecao(db, id, "nascimento", "", HOJE)).ok).toBe(true);
  });

  it("vale só para a vaga pedida: outra remoção volta a bloquear", async () => {
    const { id, excecaoId } = await comPedido();
    await decidirExcecao(db, excecaoId, true, "Certidão", HOJE);
    const ativos = (await vidasDependentes(id)).filter((v) => !v.saida);
    await removerDependente(db, ativos[0].id, "Teste", HOJE);
    expect((await incluir(id)).status).toBe("bloqueada");
  });

  it("não pode ser apagada", async () => {
    const { excecaoId } = await comPedido();
    await expect(cliente.query("DELETE FROM excecao_vaga WHERE id = $1", [excecaoId])).rejects.toThrow(
      /não pode ser apagado/,
    );
  });
});

describe("CPF do dependente", () => {
  it("recusa CPF inválido", async () => {
    const id = await novoContrato();
    expect(await incluir(id, { cpf: "111.111.111-11" })).toEqual({
      status: "erro",
      erros: { cpf: "CPF inválido" },
    });
  });

  it("exige a partir de 18 anos e dispensa antes (decisão 2)", async () => {
    const id = await novoContrato();
    expect(await incluir(id, { cpf: "", dataNascimento: "2008-11-04" })).toEqual({
      status: "erro",
      erros: { cpf: "CPF obrigatório a partir de 18 anos" },
    });
    expect((await incluir(id, { cpf: "", dataNascimento: "2008-11-05" })).status).toBe("ok");
  });

  it("usa a idade configurada", async () => {
    await cliente.query("UPDATE configuracao SET valor = '12' WHERE chave = 'idade_cpf_dependente_obrigatorio'");
    const id = await novoContrato();
    const resultado = await incluir(id, { cpf: "", dataNascimento: "2013-01-01" });
    await cliente.query("UPDATE configuracao SET valor = '18' WHERE chave = 'idade_cpf_dependente_obrigatorio'");
    expect(resultado).toEqual({ status: "erro", erros: { cpf: "CPF obrigatório a partir de 12 anos" } });
  });

  it("recusa quem é titular de outro contrato e informa a situação", async () => {
    const id = await novoContrato();
    const cpf = novoCpf();
    const titular = await umId(
      "INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Outro Titular', $1, '1980-01-01') RETURNING id",
      [cpf],
    );
    const outro = await criarContrato(
      db,
      {
        titularId: titular,
        planoId: total,
        composicao: "familiar",
        funeral: false,
        cupom: "",
        formaPagamento: "carne",
        diaVencimento: "10",
        origemTipo: "balcao",
        origemDetalhe: "",
      },
      HOJE,
    );
    expect(outro.ok).toBe(true);
    const resultado = await incluir(id, { cpf });
    expect(resultado.status).toBe("erro");
    if (resultado.status === "erro") {
      expect(resultado.erros.cpf).toMatch(/já está no contrato nº \d+ como titular \(status Pendente\)/);
    }
  });

  it("recusa quem é dependente em outro contrato, ou neste", async () => {
    const primeiro = await novoContrato();
    const segundo = await novoContrato();
    const cpf = novoCpf();
    await incluir(primeiro, { cpf });
    for (const contrato of [primeiro, segundo]) {
      const resultado = await incluir(contrato, { cpf });
      expect(resultado.status).toBe("erro");
      if (resultado.status === "erro") expect(resultado.erros.cpf).toMatch(/como dependente/);
    }
  });

  it("aceita depois que o outro contrato é cancelado, sem duplicar a pessoa (decisão 8)", async () => {
    const primeiro = await novoContrato();
    const cpf = novoCpf();
    await incluir(primeiro, { cpf });
    await cliente.query("UPDATE contrato SET status = 'cancelado' WHERE id = $1", [primeiro]);

    const segundo = await novoContrato();
    const dados = dependente({ cpf, nome: "Nome Digitado Diferente" });
    const pedido = await incluirDependente(db, segundo, dados, HOJE);
    expect(pedido.status).toBe("confirmar");
    if (pedido.status !== "confirmar") return;
    expect(pedido.previa.pessoaExistente).toBe("Dependente de Teste");
    expect(
      (await incluirDependente(db, segundo, { ...dados, confirmacao: pedido.previa.assinatura }, HOJE)).status,
    ).toBe("ok");
    const { rows } = await cliente.query<{ n: number }>("SELECT count(*)::int AS n FROM pessoa WHERE cpf = $1", [cpf]);
    expect(rows[0].n).toBe(1);
  });

  it("uma pessoa que saiu do contrato pode entrar em outro", async () => {
    const primeiro = await novoContrato();
    const cpf = novoCpf();
    await incluir(primeiro, { cpf });
    const [alvo] = await vidasDependentes(primeiro);
    await removerDependente(db, alvo.id, "Teste", HOJE);
    const segundo = await novoContrato();
    expect((await incluir(segundo, { cpf })).status).toBe("ok");
  });
});

describe("demais validações", () => {
  it("exige nome completo, nascimento e parentesco", async () => {
    const id = await novoContrato();
    const resultado = await incluir(id, { nome: "Ana", dataNascimento: "", parentesco: " " });
    expect(resultado).toMatchObject({
      status: "erro",
      erros: {
        nome: "Informe o nome completo",
        dataNascimento: "Informe a data de nascimento",
        parentesco: "Informe o parentesco",
      },
    });
  });

  it("recusa nascimento no futuro", async () => {
    const id = await novoContrato();
    expect(await incluir(id, { dataNascimento: "2026-11-05" })).toMatchObject({
      erros: { dataNascimento: "A data de nascimento não pode ser no futuro" },
    });
  });

  it("contrato individual não aceita dependentes (decisão 1)", async () => {
    const id = await novoContrato({ composicao: "individual" });
    expect(await incluir(id)).toEqual({
      status: "erro",
      erros: { geral: "Contrato individual não aceita dependentes" },
    });
  });

  it("contrato cancelado não aceita alterações", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 1);
    const [alvo] = await vidasDependentes(id);
    await cliente.query("UPDATE contrato SET status = 'cancelado' WHERE id = $1", [id]);
    expect((await incluir(id)).status).toBe("erro");
    expect((await removerDependente(db, alvo.id, "Teste", HOJE)).ok).toBe(false);
  });

  it("não ocupa a mesma vaga com duas inclusões ao mesmo tempo", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 2);
    const resultados = await Promise.all([
      incluirDependente(db, id, dependente(), HOJE),
      incluirDependente(db, id, dependente(), HOJE),
    ]);
    expect(resultados.filter((r) => r.status === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "confirmar")).toHaveLength(1);
  });
});

describe("funeral com dependentes", () => {
  it("cobra pela idade e inicia a carência na inclusão", async () => {
    const id = await novoContrato({ funeral: true });
    const resultado = await incluir(id, { dataNascimento: "1960-03-15" }); // 66 anos
    expect(resultado).toEqual({ status: "ok", novaVersao: true });
    expect(await ultima(id)).toMatchObject({ funeral: 1990, mensal: 16980 });
    const { rows } = await cliente.query<{ carencia: string }>(
      "SELECT carencia_funeral_inicio::text AS carencia FROM vida WHERE contrato_id = $1 AND papel = 'dependente'",
      [id],
    );
    expect(rows[0].carencia).toBe(HOJE);
  });

  it("mantém o funeral na nova versão", async () => {
    const id = await novoContrato({ funeral: true });
    await incluir(id, { dataNascimento: "1960-03-15" });
    const { rows } = await cliente.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM versao_adicional va
       JOIN versao_contrato v ON v.id = va.versao_id WHERE v.contrato_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(2);
  });

  it("vida acima de 80 anos entra sem funeral, avisando antes", async () => {
    const id = await novoContrato({ funeral: true });
    await incluirVarios(id, 3);
    const dados = dependente({ dataNascimento: "1945-01-01" });
    const pedido = await incluirDependente(db, id, dados, HOJE);
    expect(pedido.status).toBe("confirmar");
    if (pedido.status === "confirmar") {
      expect(pedido.previa).toMatchObject({ semFuneralPorIdade: true, valorFuneralCentavos: 0, valorExtraCentavos: 3990 });
    }
  });

  it("contrato sem funeral não cobra funeral", async () => {
    const id = await novoContrato();
    await incluir(id, { dataNascimento: "1960-03-15" });
    expect((await ultima(id)).funeral).toBe(0);
  });
});

describe("mudança de faixa de idade (decisão 9)", () => {
  it("não muda a cobrança sozinha: cria alerta, e o valor muda só ao ajustar", async () => {
    const id = await novoContrato({ funeral: true });
    await incluir(id, { dataNascimento: "1961-11-05", nome: "Quase Sessenta Cinco" }); // 64 anos hoje
    expect((await ultima(id)).funeral).toBe(0);
    expect((await carregarPainel(db, id, HOJE))?.alertasIdade).toEqual([]);

    const depois = await carregarPainel(db, id, "2026-11-05");
    expect(depois?.alertasIdade).toMatchObject([
      { nome: "Quase Sessenta Cinco", idade: 65, tipo: "funeral", valorAtualCentavos: 0, valorNovoCentavos: 1990 },
    ]);
    expect((await ultima(id)).funeral).toBe(0);

    // Outra inclusão não pode levar o aumento junto, sem ninguém ver.
    await incluir(id, {}, "2026-11-05");
    expect((await ultima(id)).funeral).toBe(0);

    const vidaId = depois?.alertasIdade[0].vidaId as string;
    expect(await ajustarFaixaVida(db, vidaId, "2026-11-05")).toEqual({ ok: true });
    expect(await ultima(id)).toMatchObject({ funeral: 1990, motivo: "Ajuste por mudança de faixa de idade" });
    expect((await carregarPainel(db, id, "2026-11-05"))?.alertasIdade).toEqual([]);
  });

  it("avisa também o dependente extra que chega aos 65", async () => {
    const id = await novoContrato();
    await incluirVarios(id, 3);
    await incluir(id, { dataNascimento: "1961-11-05", nome: "Extra Sessenta Cinco" });
    expect((await ultima(id)).extra).toBe(1490);
    const painel = await carregarPainel(db, id, "2026-11-05");
    expect(painel?.alertasIdade).toMatchObject([
      { tipo: "dependente_extra", valorAtualCentavos: 1490, valorNovoCentavos: 3990 },
    ]);
    await ajustarFaixaVida(db, painel?.alertasIdade[0].vidaId as string, "2026-11-05");
    expect((await ultima(id)).extra).toBe(3990);
  });
});

describe("dados fictícios", () => {
  it("o contrato de exemplo confere com o valor guardado em cada vida", async () => {
    const id = await umId("SELECT id FROM contrato WHERE numero = 1");
    const painel = await carregarPainel(db, id, "2026-11-04");
    expect(painel?.valorEsperadoCentavos).toBe(16980);
    expect(painel?.valorAtualCentavos).toBe(16980);
  });
});
