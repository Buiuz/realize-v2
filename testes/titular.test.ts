import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { consultarCep } from "../src/regras/cep";
import { gerarCpfFicticio } from "../src/regras/cpf";
import { mascararCelular, mascararCep, mascararCpf } from "../src/regras/formatacao";
import {
  buscarPessoaPorCpf,
  buscarPessoas,
  cadastrarTitular,
  hojeEmSaoPaulo,
  validarTitular,
  type EntradaTitular,
} from "../src/regras/titular";

const HOJE = "2026-11-04";

function entrada(campos: Partial<EntradaTitular> = {}): EntradaTitular {
  return {
    nome: "Ana Fictícia de Teste",
    cpf: gerarCpfFicticio("900000101"),
    dataNascimento: "1990-05-20",
    sexo: "",
    celular: "(21) 90000-0101",
    email: "ana@example.com",
    cep: "00000-000",
    logradouro: "Rua Fictícia",
    numero: "10",
    complemento: "",
    bairro: "Bairro Exemplo",
    cidade: "Cidade Exemplo",
    uf: "RJ",
    ...campos,
  };
}

function erroDe(campos: Partial<EntradaTitular>, campo: keyof EntradaTitular) {
  const resultado = validarTitular(entrada(campos), HOJE);
  return resultado.ok ? undefined : resultado.erros[campo];
}

describe("validação do titular", () => {
  it("aceita um cadastro completo e guarda só os números", () => {
    const resultado = validarTitular(entrada({ cpf: mascararCpf(gerarCpfFicticio("900000101")) }), HOJE);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.cpf).toBe(gerarCpfFicticio("900000101"));
      expect(resultado.dados.celular).toBe("21900000101");
      expect(resultado.dados.cep).toBe("00000000");
    }
  });

  it("exige nome completo", () => {
    expect(erroDe({ nome: "Ana" }, "nome")).toBe("Informe o nome completo");
    expect(erroDe({ nome: "   " }, "nome")).toBe("Informe o nome completo");
  });

  it("recusa CPF inválido", () => {
    expect(erroDe({ cpf: "111.111.111-11" }, "cpf")).toBe("CPF inválido");
  });

  it("exige data de nascimento válida e que já tenha passado", () => {
    expect(erroDe({ dataNascimento: "" }, "dataNascimento")).toBe("Informe a data de nascimento");
    expect(erroDe({ dataNascimento: "1990-02-31" }, "dataNascimento")).toBe("Data de nascimento inválida");
    expect(erroDe({ dataNascimento: "2026-11-05" }, "dataNascimento")).toBe(
      "A data de nascimento não pode ser no futuro",
    );
    expect(erroDe({ dataNascimento: HOJE }, "dataNascimento")).toBeUndefined();
  });

  it("exige celular com DDD e nono dígito", () => {
    expect(erroDe({ celular: "" }, "celular")).toBeDefined();
    expect(erroDe({ celular: "(21) 3000-0000" }, "celular")).toBeDefined();
    expect(erroDe({ celular: "(01) 90000-0000" }, "celular")).toBeDefined();
  });

  it("exige e-mail válido", () => {
    expect(erroDe({ email: "ana" }, "email")).toBe("E-mail inválido");
  });

  it("exige CEP e endereço, mesmo quando digitados à mão", () => {
    expect(erroDe({ cep: "123" }, "cep")).toBeDefined();
    expect(erroDe({ logradouro: "" }, "logradouro")).toBeDefined();
    expect(erroDe({ bairro: "" }, "bairro")).toBeDefined();
    expect(erroDe({ cidade: "" }, "cidade")).toBeDefined();
    expect(erroDe({ uf: "XX" }, "uf")).toBeDefined();
  });

  it("não exige sexo, número nem complemento", () => {
    expect(validarTitular(entrada({ sexo: "", numero: "", complemento: "" }), HOJE).ok).toBe(true);
  });

  it("usa o dia de São Paulo, não o de Londres", () => {
    expect(hojeEmSaoPaulo(new Date("2026-11-05T01:00:00Z"))).toBe("2026-11-04");
  });
});

describe("cadastro no banco", () => {
  let cliente: PGlite;
  let db: Banco;

  beforeAll(async () => {
    const banco = abrirBanco();
    cliente = banco.cliente;
    db = banco.db;
    await aplicarMigracoes(db);
  });

  afterAll(async () => {
    await cliente.close();
  });

  it("cria a pessoa com celular e e-mail principais", async () => {
    const cpf = gerarCpfFicticio("900000201");
    const resultado = await cadastrarTitular(db, entrada({ cpf }), HOJE);
    expect(resultado.ok).toBe(true);
    const { rows } = await cliente.query<{ tipo: string; valor: string; principal: boolean }>(
      `SELECT c.tipo, c.valor, c.principal FROM contato c JOIN pessoa p ON p.id = c.pessoa_id
       WHERE p.cpf = $1 ORDER BY c.tipo`,
      [cpf],
    );
    expect(rows).toEqual([
      { tipo: "celular", valor: "21900000101", principal: true },
      { tipo: "email", valor: "ana@example.com", principal: true },
    ]);
  });

  it("não duplica CPF e aponta o cadastro existente", async () => {
    const cpf = gerarCpfFicticio("900000202");
    const primeiro = await cadastrarTitular(db, entrada({ cpf }), HOJE);
    const segundo = await cadastrarTitular(db, entrada({ cpf: mascararCpf(cpf), nome: "Outra Pessoa" }), HOJE);
    expect(segundo.ok).toBe(false);
    if (primeiro.ok && !segundo.ok) {
      expect(segundo.erros.cpf).toBe("Este CPF já está cadastrado");
      expect(segundo.cpfExistente?.id).toBe(primeiro.id);
    }
  });

  it("salva só um quando o mesmo CPF chega ao mesmo tempo", async () => {
    const cpf = gerarCpfFicticio("900000203");
    const resultados = await Promise.all([
      cadastrarTitular(db, entrada({ cpf }), HOJE),
      cadastrarTitular(db, entrada({ cpf }), HOJE),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const recusado = resultados.find((r) => !r.ok);
    expect(recusado && !recusado.ok && recusado.cpfExistente).toBeTruthy();
  });

  describe("busca", () => {
    beforeAll(async () => {
      await cadastrarTitular(
        db,
        entrada({ nome: "João Conceição de Teste", cpf: gerarCpfFicticio("900000301") }),
        HOJE,
      );
    });

    const nomes = async (termo: string) =>
      (await buscarPessoas(db, termo, 50)).map((p) => p.nome);

    it("acha o nome com ou sem acento e com qualquer caixa", async () => {
      for (const termo of ["João", "joao", "JOAO", "conceicao", "CONCEIÇÃO"]) {
        expect(await nomes(termo)).toContain("João Conceição de Teste");
      }
    });

    it("acha pelo CPF com ou sem pontuação", async () => {
      const cpf = gerarCpfFicticio("900000301");
      expect(await nomes(cpf)).toEqual(["João Conceição de Teste"]);
      expect(await nomes(mascararCpf(cpf))).toEqual(["João Conceição de Teste"]);
    });

    it("trata símbolos como texto comum", async () => {
      expect(await nomes("%")).toEqual([]);
      expect(await nomes("_")).toEqual([]);
    });

    it("não acha quem não existe e lista todos sem termo", async () => {
      expect(await nomes("Ninguém Mesmo")).toEqual([]);
      expect((await nomes("")).length).toBeGreaterThan(1);
    });

    it("respeita o limite", async () => {
      expect(await buscarPessoas(db, "", 1)).toHaveLength(1);
    });
  });

  it("não grava nada quando os dados são inválidos", async () => {
    const cpf = gerarCpfFicticio("900000204");
    const resultado = await cadastrarTitular(db, entrada({ cpf, email: "errado" }), HOJE);
    expect(resultado.ok).toBe(false);
    expect(await buscarPessoaPorCpf(db, cpf)).toBeUndefined();
  });
});

describe("consulta de CEP", () => {
  const responder = (corpo: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(corpo), { status })) as typeof fetch;

  it("traduz o endereço encontrado", async () => {
    const endereco = await consultarCep(
      "01001-000",
      responder({ logradouro: "Rua A", bairro: "Centro", localidade: "Cidade B", uf: "SP" }),
    );
    expect(endereco).toEqual({ logradouro: "Rua A", bairro: "Centro", cidade: "Cidade B", uf: "SP" });
  });

  it("libera digitação quando o CEP não existe", async () => {
    expect(await consultarCep("99999-999", responder({ erro: "true" }))).toBeNull();
  });

  it("libera digitação quando o serviço está fora do ar", async () => {
    const falha = (async () => {
      throw new Error("sem internet");
    }) as typeof fetch;
    expect(await consultarCep("01001-000", falha)).toBeNull();
    expect(await consultarCep("01001-000", responder({}, 500))).toBeNull();
  });

  it("nem consulta um CEP incompleto", async () => {
    const naoDeveChamar = (async () => {
      throw new Error("não deveria consultar");
    }) as typeof fetch;
    expect(await consultarCep("123", naoDeveChamar)).toBeNull();
  });
});

describe("máscaras", () => {
  it("formatam enquanto se digita", () => {
    expect(mascararCpf("1234")).toBe("123.4");
    expect(mascararCpf("12345678909")).toBe("123.456.789-09");
    expect(mascararCelular("2190")).toBe("(21) 90");
    expect(mascararCelular("21900000101")).toBe("(21) 90000-0101");
    expect(mascararCep("00000000")).toBe("00000-000");
  });
});
