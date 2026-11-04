import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirBanco, aplicarMigracoes, type Banco } from "../src/banco/conexao";
import { semear } from "../src/banco/dados-ficticios";
import {
  alterarPerfil,
  alterarSituacaoUsuario,
  autenticar,
  buscarUsuarioDaSessao,
  consultarLog,
  criarUsuario,
  encerrarSessao,
  gerarHashSenha,
  gerarSenhaTemporaria,
  podeVerContrato,
  podeVerPessoa,
  redefinirSenha,
  senhaAtendeRegra,
  trocarSenha,
  verificarPermissao,
  type UsuarioSessao,
} from "../src/regras/acesso";
import { criarContrato } from "../src/regras/contratos";
import { gerarCpfFicticio } from "../src/regras/cpf";
import { PERFIS, PERMISSOES, tem, type Perfil, type Permissao } from "../src/regras/permissoes";
import { buscarPessoas } from "../src/regras/titular";

// Senha gerada a cada execução: nenhum valor fixo fica no código.
const SENHA = gerarSenhaTemporaria();
const agora = new Date("2026-11-04T15:00:00Z");

let cliente: PGlite;
let db: Banco;
let sequencia = 100;
let chefe: UsuarioSessao;

function novoCpf() {
  sequencia += 1;
  return gerarCpfFicticio(`900002${sequencia}`);
}

async function novoUsuario(perfil: Perfil, campos: { trocar?: boolean } = {}): Promise<UsuarioSessao> {
  sequencia += 1;
  const login = `usuario${sequencia}`;
  const { rows } = await cliente.query<{ id: string }>(
    `INSERT INTO usuario (nome, cpf, email, login, perfil, senha_hash, trocar_senha)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [`Usuário ${login}`, novoCpf(), `${login}@example.com`, login, perfil, await gerarHashSenha(SENHA), campos.trocar ?? false],
  );
  return { id: rows[0].id, nome: `Usuário ${login}`, login, perfil, trocarSenha: campos.trocar ?? false };
}

async function ultimoLog() {
  const linhas = await consultarLog(db);
  return linhas.at(-1);
}

beforeAll(async () => {
  const banco = abrirBanco();
  cliente = banco.cliente;
  db = banco.db;
  await aplicarMigracoes(db);
  await semear(db);
  chefe = await novoUsuario("super_admin");
});

afterAll(async () => {
  await cliente.close();
});

describe("matriz de ações sensíveis do PRD", () => {
  const LINHAS: [Permissao, Perfil[]][] = [
    ["cancelar_contrato", ["super_admin", "adm_operacional", "atendimento"]],
    ["bloquear_contrato", ["super_admin", "adm_operacional", "atendimento"]],
    ["cancelar_fatura", ["super_admin", "adm_operacional", "financeiro"]],
    ["reverter_pagamento", ["super_admin", "financeiro"]],
    ["alterar_valor", ["super_admin", "adm_operacional", "financeiro"]],
    ["liberar_excecao", ["super_admin", "adm_operacional", "atendimento"]],
    ["configurar_cupom", ["super_admin", "gestor_comercial"]],
    ["configurar_regua", ["super_admin", "adm_operacional", "financeiro"]],
    ["exportar_base", ["super_admin", "adm_operacional", "financeiro", "gestor_comercial", "auditor"]],
    ["configurar_usuarios", ["super_admin"]],
  ];

  it.each(LINHAS)("%s", (permissao, esperados) => {
    for (const perfil of PERFIS) {
      expect(tem(perfil, permissao), `${perfil} em ${permissao}`).toBe(esperados.includes(perfil));
    }
  });

  it("Vendedor e Auditor não fazem nenhuma ação de escrita", () => {
    const leitura: Permissao[] = ["ver_cadastros", "ver_auditoria", "ver_usuarios", "ver_conferencia", "exportar_base"];
    for (const perfil of ["vendedor", "auditor"] as Perfil[]) {
      for (const permissao of Object.keys(PERMISSOES) as Permissao[]) {
        if (!leitura.includes(permissao)) expect(tem(perfil, permissao), `${perfil} em ${permissao}`).toBe(false);
      }
    }
    expect(tem("vendedor", "ver_conferencia")).toBe(false);
  });
});

describe("toda ação do servidor confere a permissão", () => {
  function arquivosDeAcao(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = path.join(pasta, nome);
      if (statSync(caminho).isDirectory()) return arquivosDeAcao(caminho);
      return /\.tsx?$/.test(nome) && readFileSync(caminho, "utf8").startsWith('"use server"') ? [caminho] : [];
    });
  }

  it("cada função exportada verifica o acesso antes de agir", () => {
    const arquivos = arquivosDeAcao(path.join(process.cwd(), "src", "app"));
    expect(arquivos.length).toBeGreaterThanOrEqual(3);
    // Login e troca de senha são as únicas que acontecem antes de haver permissão a conferir.
    const LIVRES = new Set(["entrar", "sair", "acaoTrocarSenha"]);
    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, "utf8");
      const blocos = fonte.split(/\nexport async function /).slice(1);
      expect(blocos.length, arquivo).toBeGreaterThan(0);
      for (const bloco of blocos) {
        const nome = bloco.split("(")[0];
        if (LIVRES.has(nome)) continue;
        expect(bloco, `${nome} em ${arquivo}`).toMatch(/autorizar\(/);
      }
    }
  });
});

describe("verificação de permissão", () => {
  it("permite e não registra negação", async () => {
    const atendente = await novoUsuario("atendimento");
    expect(await verificarPermissao(db, atendente, "criar_contrato", { entidade: "contrato" })).toEqual({ ok: true });
  });

  it("nega e registra a tentativa no log, com o usuário", async () => {
    const auditor = await novoUsuario("auditor");
    const resultado = await verificarPermissao(db, auditor, "cancelar_contrato", { entidade: "contrato", entidadeId: "abc" });
    expect(resultado.ok).toBe(false);
    expect(await ultimoLog()).toMatchObject({
      usuarioId: auditor.id,
      resultado: "negado",
      entidade: "contrato",
      entidadeId: "abc",
    });
  });

  it("nega quem não está logado", async () => {
    expect((await verificarPermissao(db, null, "ver_cadastros", { entidade: "pessoa" })).ok).toBe(false);
    expect(await ultimoLog()).toMatchObject({ usuarioId: null, resultado: "negado" });
  });

  it("nega quem ainda precisa trocar a senha", async () => {
    const novo = await novoUsuario("super_admin", { trocar: true });
    expect((await verificarPermissao(db, novo, "ver_cadastros", { entidade: "pessoa" })).ok).toBe(false);
  });
});

describe("login", () => {
  it("entra com a senha certa, cria sessão e registra no log", async () => {
    const u = await novoUsuario("financeiro");
    const r = await autenticar(db, ` ${u.login.toUpperCase()} `, SENHA, agora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await buscarUsuarioDaSessao(db, r.token, agora)).toMatchObject({ id: u.id, perfil: "financeiro" });
    expect((await consultarLog(db, { usuarioId: u.id })).at(-1)).toMatchObject({ acao: "Login", resultado: "ok" });
  });

  it("não diz se o usuário existe ou se a senha está errada", async () => {
    const u = await novoUsuario("financeiro");
    const senhaErrada = await autenticar(db, u.login, `${SENHA}x`, agora);
    const naoExiste = await autenticar(db, "ninguem", SENHA, agora);
    expect(senhaErrada).toEqual(naoExiste);
    expect(senhaErrada).toEqual({ ok: false, erro: "Usuário ou senha inválidos" });
  });

  it("não guarda a senha nem o código da sessão de forma legível", async () => {
    const u = await novoUsuario("financeiro");
    const r = await autenticar(db, u.login, SENHA, agora);
    if (!r.ok) throw new Error("falhou");
    const { rows } = await cliente.query<Record<string, string>>(
      `SELECT u.senha_hash, s.token_hash FROM usuario u JOIN sessao s ON s.usuario_id = u.id WHERE u.id = $1`,
      [u.id],
    );
    expect(rows[0].senha_hash).not.toContain(SENHA);
    expect(rows[0].token_hash).not.toContain(r.token);
  });

  it("bloqueia por 15 minutos na 5ª senha errada e registra", async () => {
    const u = await novoUsuario("financeiro");
    for (let i = 0; i < 4; i += 1) {
      expect(await autenticar(db, u.login, "errada123", agora)).toEqual({ ok: false, erro: "Usuário ou senha inválidos" });
    }
    const quinta = await autenticar(db, u.login, "errada123", agora);
    expect(quinta.ok).toBe(false);
    if (!quinta.ok) expect(quinta.erro).toContain("15 minutos");
    expect((await consultarLog(db, { usuarioId: u.id })).some((l) => l.detalhe?.includes("bloqueada"))).toBe(true);

    // Nem a senha certa entra durante o bloqueio.
    expect((await autenticar(db, u.login, SENHA, new Date(agora.getTime() + 14 * 60_000))).ok).toBe(false);
    expect((await autenticar(db, u.login, SENHA, new Date(agora.getTime() + 15 * 60_000))).ok).toBe(true);
  });

  it("acertar a senha zera a contagem de erros", async () => {
    const u = await novoUsuario("financeiro");
    for (let i = 0; i < 4; i += 1) await autenticar(db, u.login, "errada123", agora);
    await autenticar(db, u.login, SENHA, agora);
    for (let i = 0; i < 4; i += 1) await autenticar(db, u.login, "errada123", agora);
    expect((await autenticar(db, u.login, SENHA, agora)).ok).toBe(true);
  });

  it("sessão expira em 8 horas e termina ao sair", async () => {
    const u = await novoUsuario("financeiro");
    const r = await autenticar(db, u.login, SENHA, agora);
    if (!r.ok) throw new Error("falhou");
    expect(await buscarUsuarioDaSessao(db, r.token, new Date(agora.getTime() + 7 * 3_600_000))).not.toBeNull();
    expect(await buscarUsuarioDaSessao(db, r.token, new Date(agora.getTime() + 8 * 3_600_000))).toBeNull();

    await encerrarSessao(db, r.token, agora);
    expect(await buscarUsuarioDaSessao(db, r.token, agora)).toBeNull();
    expect((await consultarLog(db, { usuarioId: u.id })).some((l) => l.acao === "Logout")).toBe(true);
  });

  it("código de sessão inventado não entra", async () => {
    expect(await buscarUsuarioDaSessao(db, "codigo-inventado", agora)).toBeNull();
  });
});

describe("primeiro acesso e senha", () => {
  it("regra: 8 caracteres, com letras e números", () => {
    expect(senhaAtendeRegra("abc12345")).toBe(true);
    expect(senhaAtendeRegra("abc1234")).toBe(false);
    expect(senhaAtendeRegra("abcdefgh")).toBe(false);
    expect(senhaAtendeRegra("12345678")).toBe(false);
  });

  it("a senha temporária atende à regra", () => {
    for (let i = 0; i < 50; i += 1) expect(senhaAtendeRegra(gerarSenhaTemporaria())).toBe(true);
  });

  it("usuário novo entra obrigado a trocar a senha; depois de trocar, fica liberado", async () => {
    sequencia += 1;
    const criado = await criarUsuario(db, chefe, {
      nome: "Pessoa Nova de Teste",
      cpf: novoCpf(),
      email: `nova${sequencia}@example.com`,
      login: `nova${sequencia}`,
      perfil: "atendimento",
    });
    expect(criado.ok).toBe(true);
    if (!criado.ok) return;

    const login = await autenticar(db, `nova${sequencia}`, criado.senhaTemporaria, agora);
    expect(login).toMatchObject({ ok: true, trocarSenha: true });
    if (!login.ok) return;
    const atual = await buscarUsuarioDaSessao(db, login.token, agora);
    expect(atual?.trocarSenha).toBe(true);
    if (!atual) return;

    expect(await trocarSenha(db, atual, "errada123", "NovaSenha123")).toEqual({
      ok: false,
      erro: "A senha atual está incorreta",
    });
    expect((await trocarSenha(db, atual, criado.senhaTemporaria, "curta1")).ok).toBe(false);
    expect((await trocarSenha(db, atual, criado.senhaTemporaria, criado.senhaTemporaria)).ok).toBe(false);
    expect(await trocarSenha(db, atual, criado.senhaTemporaria, "NovaSenha123")).toEqual({ ok: true });

    expect((await buscarUsuarioDaSessao(db, login.token, agora))?.trocarSenha).toBe(false);
    expect((await autenticar(db, `nova${sequencia}`, criado.senhaTemporaria, agora)).ok).toBe(false);
    expect((await autenticar(db, `nova${sequencia}`, "NovaSenha123", agora)).ok).toBe(true);
  });
});

describe("gestão de usuários", () => {
  const dados = () => {
    sequencia += 1;
    return {
      nome: "Pessoa de Teste",
      cpf: novoCpf(),
      email: `pessoa${sequencia}@example.com`,
      login: `pessoa${sequencia}`,
      perfil: "atendimento",
    };
  };

  it("cria e registra no log", async () => {
    const entrada = dados();
    const r = await criarUsuario(db, chefe, entrada);
    expect(r.ok).toBe(true);
    expect(await ultimoLog()).toMatchObject({ usuarioId: chefe.id, acao: "Criação de usuário" });
  });

  it("valida os campos", async () => {
    const r = await criarUsuario(db, chefe, { nome: "Ana", cpf: "123", email: "x", login: "a", perfil: "rei" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(["cpf", "email", "login", "nome", "perfil"]);
  });

  it("recusa login ou e-mail repetido", async () => {
    const primeira = dados();
    await criarUsuario(db, chefe, primeira);
    const mesmoLogin = await criarUsuario(db, chefe, { ...dados(), login: primeira.login });
    const mesmoEmail = await criarUsuario(db, chefe, { ...dados(), email: primeira.email.toUpperCase() });
    for (const r of [mesmoLogin, mesmoEmail]) {
      expect(r).toEqual({ ok: false, erros: { geral: "Já existe um usuário com este login/e-mail" } });
    }
  });

  it("desativar nega o login e encerra as sessões na hora", async () => {
    const u = await novoUsuario("financeiro");
    const r = await autenticar(db, u.login, SENHA, agora);
    if (!r.ok) throw new Error("falhou");
    await alterarSituacaoUsuario(db, chefe, u.id, false, agora);
    expect(await buscarUsuarioDaSessao(db, r.token, agora)).toBeNull();
    expect((await autenticar(db, u.login, SENHA, agora)).ok).toBe(false);
    await alterarSituacaoUsuario(db, chefe, u.id, true, agora);
    expect((await autenticar(db, u.login, SENHA, agora)).ok).toBe(true);
  });

  it("usuário nunca é apagado", async () => {
    const u = await novoUsuario("financeiro");
    await expect(cliente.query("DELETE FROM usuario WHERE id = $1", [u.id])).rejects.toThrow(/não pode ser apagado/);
  });

  it("muda o perfil, com valor anterior e novo no log", async () => {
    const u = await novoUsuario("financeiro");
    expect(await alterarPerfil(db, chefe, u.id, "auditor")).toEqual({ ok: true });
    expect(await ultimoLog()).toMatchObject({ acao: "Mudança de perfil", detalhe: "De Financeiro para Auditor" });
    expect((await alterarPerfil(db, chefe, u.id, "rei")).ok).toBe(false);
  });

  it("não deixa o sistema sem Super Admin ativo", async () => {
    await cliente.query("UPDATE usuario SET ativo = false WHERE perfil = 'super_admin' AND id <> $1", [chefe.id]);
    expect((await alterarSituacaoUsuario(db, chefe, chefe.id, false)).ok).toBe(false);
    expect((await alterarPerfil(db, chefe, chefe.id, "auditor")).ok).toBe(false);
  });

  it("nova senha temporária obriga a trocar e encerra as sessões", async () => {
    const u = await novoUsuario("financeiro");
    const r = await autenticar(db, u.login, SENHA, agora);
    if (!r.ok) throw new Error("falhou");
    const nova = await redefinirSenha(db, chefe, u.id);
    expect(nova.ok).toBe(true);
    if (!nova.ok) return;
    expect(await buscarUsuarioDaSessao(db, r.token, agora)).toBeNull();
    expect(await autenticar(db, u.login, nova.senhaTemporaria, agora)).toMatchObject({ ok: true, trocarSenha: true });
  });
});

describe("log de auditoria", () => {
  it("o banco recusa editar, apagar e limpar", async () => {
    const [registro] = await consultarLog(db, { limite: 1 });
    await expect(cliente.query("UPDATE log_auditoria SET detalhe = 'x' WHERE id = $1", [registro.id])).rejects.toThrow(
      /não pode ser alterado nem apagado/,
    );
    await expect(cliente.query("DELETE FROM log_auditoria WHERE id = $1", [registro.id])).rejects.toThrow(
      /não pode ser alterado nem apagado/,
    );
    await expect(cliente.query("TRUNCATE log_auditoria")).rejects.toThrow(/não pode ser alterado nem apagado/);
  });

  it("filtra por usuário e período, em ordem cronológica", async () => {
    const u = await novoUsuario("auditor");
    const dia = (d: string) => new Date(`${d}T12:00:00Z`);
    await autenticar(db, u.login, SENHA, dia("2026-01-10"));
    await autenticar(db, u.login, SENHA, dia("2026-01-20"));
    await autenticar(db, u.login, SENHA, dia("2026-01-30"));

    const todos = await consultarLog(db, { usuarioId: u.id });
    expect(todos.map((l) => l.data.toISOString().slice(0, 10))).toEqual(["2026-01-10", "2026-01-20", "2026-01-30"]);
    const periodo = await consultarLog(db, { usuarioId: u.id, de: "2026-01-15", ate: "2026-01-25" });
    expect(periodo).toHaveLength(1);
    expect(await consultarLog(db, { usuarioId: u.id, entidade: "contrato" })).toEqual([]);
  });
});

describe("carteira do vendedor", () => {
  async function contratoDe(vendedorId: string | undefined, origemTipo = "vendedor") {
    const { rows } = await cliente.query<{ id: string }>(
      "INSERT INTO pessoa (nome, cpf, data_nascimento) VALUES ('Cliente Fictício Carteira', $1, '1990-01-01') RETURNING id",
      [novoCpf()],
    );
    const { rows: planos } = await cliente.query<{ id: string }>("SELECT id FROM plano WHERE nome = 'Realize Total'");
    const r = await criarContrato(
      db,
      {
        titularId: rows[0].id,
        planoId: planos[0].id,
        composicao: "familiar",
        funeral: false,
        cupom: "",
        formaPagamento: "carne",
        diaVencimento: "10",
        origemTipo,
        origemDetalhe: "",
        vendedorId,
      },
      "2026-11-04",
    );
    return { resultado: r, pessoaId: rows[0].id };
  }

  it("origem Vendedor exige um vendedor ativo", async () => {
    const semVendedor = await contratoDe(undefined);
    expect(semVendedor.resultado).toMatchObject({ ok: false, erros: { vendedorId: "Escolha o vendedor" } });
    const naoVendedor = await novoUsuario("financeiro");
    expect((await contratoDe(naoVendedor.id)).resultado.ok).toBe(false);
  });

  it("vê só os próprios contratos e clientes, mesmo pelo endereço direto", async () => {
    const eu = await novoUsuario("vendedor");
    const outro = await novoUsuario("vendedor");
    const meu = await contratoDe(eu.id);
    const alheio = await contratoDe(outro.id);
    if (!meu.resultado.ok || !alheio.resultado.ok) throw new Error("falhou");

    expect(await podeVerContrato(db, eu, meu.resultado.id)).toBe(true);
    expect(await podeVerContrato(db, eu, alheio.resultado.id)).toBe(false);
    expect(await podeVerPessoa(db, eu, meu.pessoaId)).toBe(true);
    expect(await podeVerPessoa(db, eu, alheio.pessoaId)).toBe(false);

    const lista = (await buscarPessoas(db, "", 500, eu.id)).map((p) => p.id);
    expect(lista).toEqual([meu.pessoaId]);
    expect(await buscarPessoas(db, "Cliente", 500, eu.id)).toHaveLength(1);
  });

  it("vendedor sem carteira não vê ninguém", async () => {
    const eu = await novoUsuario("vendedor");
    expect(await buscarPessoas(db, "", 500, eu.id)).toEqual([]);
  });

  it("os demais perfis veem tudo", async () => {
    const atendente = await novoUsuario("atendimento");
    const auditor = await novoUsuario("auditor");
    const dono = await novoUsuario("vendedor");
    const c = await contratoDe(dono.id);
    if (!c.resultado.ok) throw new Error("falhou");
    expect(await podeVerContrato(db, atendente, c.resultado.id)).toBe(true);
    expect(await podeVerPessoa(db, auditor, c.pessoaId)).toBe(true);
  });
});
