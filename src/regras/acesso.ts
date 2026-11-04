// Login, sessões, usuários e log de auditoria (PRD 1.1 a 1.3). Sem dependência de telas.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { Banco } from "../banco/conexao";
import { contrato, logAuditoria, origem, sessao, usuario, vida } from "../banco/esquema";
import { cpfValido, limparCpf } from "./cpf";
import { NOME_PERFIL, PERFIS, tem, type Perfil, type Permissao } from "./permissoes";
import { limparTexto } from "./titular";

const embaralhar = promisify(scrypt) as (senha: string, sal: string, tamanho: number) => Promise<Buffer>;

const MAX_TENTATIVAS = 5;
const MINUTOS_BLOQUEIO = 15;
// O PRD não define o tempo de sessão. Uma jornada de trabalho, como proposta.
const HORAS_SESSAO = 8;

type LeituraBanco = Pick<Banco, "select" | "selectDistinct">;
type Gravacao = Pick<Banco, "insert">;

export type UsuarioSessao = {
  id: string;
  nome: string;
  login: string;
  perfil: Perfil;
  trocarSenha: boolean;
};

export const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para esta ação";
const MENSAGEM_LOGIN_INVALIDO = "Usuário ou senha inválidos";

// ---------- Senha ----------

export function senhaAtendeRegra(senha: string) {
  return senha.length >= 8 && /[a-zA-Z]/.test(senha) && /\d/.test(senha);
}

export async function gerarHashSenha(senha: string) {
  const sal = randomBytes(16).toString("hex");
  const hash = await embaralhar(senha, sal, 64);
  return `${sal}:${hash.toString("hex")}`;
}

async function senhaConfere(senha: string, guardado: string) {
  const [sal, hash] = guardado.split(":");
  const calculado = await embaralhar(senha, sal, 64);
  return timingSafeEqual(Buffer.from(hash, "hex"), calculado);
}

/** Senha aleatória, com letras e números, sem caracteres fáceis de confundir. */
export function gerarSenhaTemporaria() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const escolher = (fonte: string) => fonte[randomInt(fonte.length)];
  const partes = Array.from({ length: 10 }, () => escolher(letras + numeros));
  partes.push(escolher(letras), escolher(numeros));
  return partes.join("");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// ---------- Log ----------

export type EntradaLog = {
  usuario: { id: string; nome: string } | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  detalhe?: string | null;
  resultado?: "ok" | "negado" | "falha";
  origem?: string;
  agora?: Date;
};

export async function registrarLog(db: Gravacao, entrada: EntradaLog) {
  await db.insert(logAuditoria).values({
    data: entrada.agora ?? new Date(),
    usuarioId: entrada.usuario?.id ?? null,
    usuarioNome: entrada.usuario?.nome ?? "Não identificado",
    acao: entrada.acao,
    entidade: entrada.entidade,
    entidadeId: entrada.entidadeId ?? null,
    detalhe: entrada.detalhe ?? null,
    resultado: entrada.resultado ?? "ok",
    origem: entrada.origem ?? "tela",
  });
}

export type FiltroLog = { usuarioId?: string; entidade?: string; de?: string; ate?: string; limite?: number };

/** Lista em ordem cronológica (PRD 1.3). Datas de filtro consideram o fuso de São Paulo. */
export async function consultarLog(db: LeituraBanco, filtro: FiltroLog = {}) {
  const condicoes = [];
  if (filtro.usuarioId) condicoes.push(eq(logAuditoria.usuarioId, filtro.usuarioId));
  if (filtro.entidade) condicoes.push(eq(logAuditoria.entidade, filtro.entidade));
  if (filtro.de) condicoes.push(gte(logAuditoria.data, new Date(`${filtro.de}T00:00:00-03:00`)));
  if (filtro.ate) condicoes.push(lte(logAuditoria.data, new Date(`${filtro.ate}T23:59:59.999-03:00`)));
  const recentes = await db
    .select()
    .from(logAuditoria)
    .where(condicoes.length > 0 ? and(...condicoes) : undefined)
    .orderBy(desc(logAuditoria.data))
    .limit(filtro.limite ?? 300);
  return recentes.reverse();
}

export async function listarEntidadesLog(db: LeituraBanco) {
  const linhas = await db
    .selectDistinct({ entidade: logAuditoria.entidade })
    .from(logAuditoria)
    .orderBy(asc(logAuditoria.entidade));
  return linhas.map((l) => l.entidade);
}

// ---------- Permissão ----------

export type ResultadoAutorizacao = { ok: true } | { ok: false; erro: string };

/** Confere a permissão e, se negar, registra a tentativa no log (PRD 1.2). */
export async function verificarPermissao(
  db: Gravacao,
  atual: UsuarioSessao | null,
  permissao: Permissao,
  alvo: { entidade: string; entidadeId?: string | null },
): Promise<ResultadoAutorizacao> {
  if (atual && !atual.trocarSenha && tem(atual.perfil, permissao)) return { ok: true };
  await registrarLog(db, {
    usuario: atual,
    acao: `Tentativa negada: ${permissao}`,
    entidade: alvo.entidade,
    entidadeId: alvo.entidadeId,
    resultado: "negado",
  });
  return { ok: false, erro: MENSAGEM_SEM_PERMISSAO };
}

// ---------- Carteira do vendedor ----------

export async function contratosDaCarteira(db: LeituraBanco, vendedorId: string) {
  const linhas = await db
    .select({ id: contrato.id })
    .from(contrato)
    .innerJoin(origem, eq(origem.id, contrato.origemId))
    .where(eq(origem.vendedorId, vendedorId));
  return linhas.map((l) => l.id);
}

export async function pessoasDaCarteira(db: LeituraBanco, vendedorId: string) {
  const contratos = await contratosDaCarteira(db, vendedorId);
  if (contratos.length === 0) return [];
  const linhas = await db
    .selectDistinct({ pessoaId: vida.pessoaId })
    .from(vida)
    .where(inArray(vida.contratoId, contratos));
  return linhas.map((l) => l.pessoaId);
}

/** Vendedor só enxerga a própria carteira; os demais perfis, tudo. */
export async function podeVerContrato(db: LeituraBanco, atual: UsuarioSessao, contratoId: string) {
  if (atual.perfil !== "vendedor") return true;
  return (await contratosDaCarteira(db, atual.id)).includes(contratoId);
}

export async function podeVerPessoa(db: LeituraBanco, atual: UsuarioSessao, pessoaId: string) {
  if (atual.perfil !== "vendedor") return true;
  return (await pessoasDaCarteira(db, atual.id)).includes(pessoaId);
}

// ---------- Login e sessão ----------

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date; trocarSenha: boolean }
  | { ok: false; erro: string };

export async function autenticar(
  db: Banco,
  loginDigitado: string,
  senha: string,
  agora = new Date(),
): Promise<ResultadoLogin> {
  const login = loginDigitado.trim().toLowerCase();
  const [encontrado] = await db.select().from(usuario).where(eq(usuario.login, login)).limit(1);

  const negar = async (detalhe: string, alvo?: typeof encontrado) => {
    await registrarLog(db, {
      usuario: alvo ? { id: alvo.id, nome: alvo.nome } : null,
      acao: "Login negado",
      entidade: "acesso",
      detalhe: alvo ? detalhe : `${detalhe} (login digitado: ${login.slice(0, 60)})`,
      resultado: "negado",
      agora,
    });
  };

  if (!encontrado) {
    await negar("Usuário não existe");
    return { ok: false, erro: MENSAGEM_LOGIN_INVALIDO };
  }
  if (!encontrado.ativo) {
    await negar("Usuário desativado", encontrado);
    return { ok: false, erro: MENSAGEM_LOGIN_INVALIDO };
  }
  if (encontrado.bloqueadoAte && encontrado.bloqueadoAte > agora) {
    await negar("Conta bloqueada por senha errada", encontrado);
    return { ok: false, erro: `Conta bloqueada por ${MINUTOS_BLOQUEIO} minutos, depois de ${MAX_TENTATIVAS} senhas erradas` };
  }

  if (!(await senhaConfere(senha, encontrado.senhaHash))) {
    const tentativas = encontrado.tentativasErradas + 1;
    const bloquear = tentativas >= MAX_TENTATIVAS;
    await db
      .update(usuario)
      .set({
        tentativasErradas: bloquear ? 0 : tentativas,
        bloqueadoAte: bloquear ? new Date(agora.getTime() + MINUTOS_BLOQUEIO * 60_000) : null,
      })
      .where(eq(usuario.id, encontrado.id));
    await negar(bloquear ? `Senha errada: conta bloqueada por ${MINUTOS_BLOQUEIO} minutos` : "Senha errada", encontrado);
    return {
      ok: false,
      erro: bloquear
        ? `Conta bloqueada por ${MINUTOS_BLOQUEIO} minutos, depois de ${MAX_TENTATIVAS} senhas erradas`
        : MENSAGEM_LOGIN_INVALIDO,
    };
  }

  await db
    .update(usuario)
    .set({ tentativasErradas: 0, bloqueadoAte: null })
    .where(eq(usuario.id, encontrado.id));

  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(agora.getTime() + HORAS_SESSAO * 3_600_000);
  await db.insert(sessao).values({ usuarioId: encontrado.id, tokenHash: hashToken(token), expiraEm });
  await registrarLog(db, {
    usuario: { id: encontrado.id, nome: encontrado.nome },
    acao: "Login",
    entidade: "acesso",
    agora,
  });
  return { ok: true, token, expiraEm, trocarSenha: encontrado.trocarSenha };
}

export async function buscarUsuarioDaSessao(
  db: LeituraBanco,
  token: string,
  agora = new Date(),
): Promise<UsuarioSessao | null> {
  const [linha] = await db
    .select({
      id: usuario.id,
      nome: usuario.nome,
      login: usuario.login,
      perfil: usuario.perfil,
      trocarSenha: usuario.trocarSenha,
      ativo: usuario.ativo,
      expiraEm: sessao.expiraEm,
    })
    .from(sessao)
    .innerJoin(usuario, eq(usuario.id, sessao.usuarioId))
    .where(and(eq(sessao.tokenHash, hashToken(token)), isNull(sessao.encerradaEm)))
    .limit(1);
  if (!linha || !linha.ativo || linha.expiraEm <= agora) return null;
  return {
    id: linha.id,
    nome: linha.nome,
    login: linha.login,
    perfil: linha.perfil,
    trocarSenha: linha.trocarSenha,
  };
}

export async function encerrarSessao(db: Banco, token: string, agora = new Date()) {
  const atual = await buscarUsuarioDaSessao(db, token, agora);
  await db.update(sessao).set({ encerradaEm: agora }).where(eq(sessao.tokenHash, hashToken(token)));
  if (atual) await registrarLog(db, { usuario: atual, acao: "Logout", entidade: "acesso", agora });
}

export type ResultadoSimples = { ok: true } | { ok: false; erro: string };

export async function trocarSenha(
  db: Banco,
  atual: UsuarioSessao,
  senhaAtual: string,
  novaSenha: string,
): Promise<ResultadoSimples> {
  const [dados] = await db.select().from(usuario).where(eq(usuario.id, atual.id)).limit(1);
  if (!dados || !(await senhaConfere(senhaAtual, dados.senhaHash))) {
    return { ok: false, erro: "A senha atual está incorreta" };
  }
  if (!senhaAtendeRegra(novaSenha)) {
    return { ok: false, erro: "A nova senha precisa ter no mínimo 8 caracteres, com letras e números" };
  }
  if (novaSenha === senhaAtual) return { ok: false, erro: "A nova senha precisa ser diferente da atual" };
  await db
    .update(usuario)
    .set({ senhaHash: await gerarHashSenha(novaSenha), trocarSenha: false })
    .where(eq(usuario.id, atual.id));
  await registrarLog(db, { usuario: atual, acao: "Troca de senha", entidade: "usuario", entidadeId: atual.id });
  return { ok: true };
}

// ---------- Gestão de usuários ----------

export type EntradaUsuario = { nome: string; cpf: string; email: string; login: string; perfil: string };
export type CampoUsuario = keyof EntradaUsuario;
export type ErrosUsuario = Partial<Record<CampoUsuario | "geral", string>>;
export type ResultadoCriarUsuario =
  | { ok: true; id: string; senhaTemporaria: string }
  | { ok: false; erros: ErrosUsuario };

const MENSAGEM_DUPLICADO = "Já existe um usuário com este login/e-mail";

export async function criarUsuario(
  db: Banco,
  autor: UsuarioSessao,
  entrada: EntradaUsuario,
): Promise<ResultadoCriarUsuario> {
  const dados = {
    nome: limparTexto(entrada.nome),
    cpf: limparCpf(entrada.cpf),
    email: entrada.email.trim().toLowerCase(),
    login: entrada.login.trim().toLowerCase(),
  };
  const perfil = PERFIS.find((p) => p === entrada.perfil);
  const erros: ErrosUsuario = {};
  if (dados.nome.split(" ").length < 2) erros.nome = "Informe o nome completo";
  if (!cpfValido(dados.cpf)) erros.cpf = "CPF inválido";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) erros.email = "E-mail inválido";
  if (!/^[a-z0-9._-]{3,40}$/.test(dados.login)) erros.login = "Use de 3 a 40 letras, números, ponto ou traço";
  if (!perfil) erros.perfil = "Escolha o perfil";
  if (Object.keys(erros).length > 0 || !perfil) return { ok: false, erros };

  const [repetido] = await db
    .select({ login: usuario.login, email: usuario.email, cpf: usuario.cpf })
    .from(usuario)
    .where(or(eq(usuario.login, dados.login), eq(usuario.email, dados.email), eq(usuario.cpf, dados.cpf)))
    .limit(1);
  if (repetido) {
    if (repetido.cpf === dados.cpf) return { ok: false, erros: { cpf: "Já existe um usuário com este CPF" } };
    return { ok: false, erros: { geral: MENSAGEM_DUPLICADO } };
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  try {
    const [novo] = await db
      .insert(usuario)
      .values({ ...dados, perfil, senhaHash: await gerarHashSenha(senhaTemporaria), trocarSenha: true })
      .returning({ id: usuario.id });
    await registrarLog(db, {
      usuario: autor,
      acao: "Criação de usuário",
      entidade: "usuario",
      entidadeId: novo.id,
      detalhe: `Login ${dados.login}, perfil ${NOME_PERFIL[perfil]}`,
    });
    return { ok: true, id: novo.id, senhaTemporaria };
  } catch (erro) {
    const texto = `${(erro as Error)?.message ?? ""} ${(erro as { cause?: Error })?.cause?.message ?? ""}`;
    if (texto.includes("usuario_")) return { ok: false, erros: { geral: MENSAGEM_DUPLICADO } };
    throw erro;
  }
}

async function contarSuperAdminsAtivos(db: LeituraBanco, excetoId: string) {
  const linhas = await db
    .select({ id: usuario.id })
    .from(usuario)
    .where(and(eq(usuario.perfil, "super_admin"), eq(usuario.ativo, true), ne(usuario.id, excetoId)));
  return linhas.length;
}

export async function alterarPerfil(
  db: Banco,
  autor: UsuarioSessao,
  usuarioId: string,
  novoPerfil: string,
): Promise<ResultadoSimples> {
  const perfil = PERFIS.find((p) => p === novoPerfil);
  if (!perfil) return { ok: false, erro: "Escolha o perfil" };
  const [alvo] = await db.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
  if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
  if (alvo.perfil === perfil) return { ok: true };
  if (alvo.perfil === "super_admin" && (await contarSuperAdminsAtivos(db, alvo.id)) === 0) {
    return { ok: false, erro: "O sistema precisa de pelo menos um Super Admin ativo" };
  }
  await db.update(usuario).set({ perfil }).where(eq(usuario.id, usuarioId));
  await registrarLog(db, {
    usuario: autor,
    acao: "Mudança de perfil",
    entidade: "usuario",
    entidadeId: usuarioId,
    detalhe: `De ${NOME_PERFIL[alvo.perfil]} para ${NOME_PERFIL[perfil]}`,
  });
  return { ok: true };
}

export async function alterarSituacaoUsuario(
  db: Banco,
  autor: UsuarioSessao,
  usuarioId: string,
  ativo: boolean,
  agora = new Date(),
): Promise<ResultadoSimples> {
  const [alvo] = await db.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
  if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
  if (alvo.ativo === ativo) return { ok: true };
  if (!ativo && alvo.perfil === "super_admin" && (await contarSuperAdminsAtivos(db, alvo.id)) === 0) {
    return { ok: false, erro: "O sistema precisa de pelo menos um Super Admin ativo" };
  }
  await db.transaction(async (tx) => {
    await tx.update(usuario).set({ ativo }).where(eq(usuario.id, usuarioId));
    // Desativado: as sessões abertas são encerradas na hora (PRD 1.1).
    if (!ativo) {
      await tx
        .update(sessao)
        .set({ encerradaEm: agora })
        .where(and(eq(sessao.usuarioId, usuarioId), isNull(sessao.encerradaEm)));
    }
    await registrarLog(tx, {
      usuario: autor,
      acao: ativo ? "Reativação de usuário" : "Desativação de usuário",
      entidade: "usuario",
      entidadeId: usuarioId,
      detalhe: `Login ${alvo.login}`,
      agora,
    });
  });
  return { ok: true };
}

export async function redefinirSenha(
  db: Banco,
  autor: UsuarioSessao,
  usuarioId: string,
): Promise<{ ok: true; senhaTemporaria: string } | { ok: false; erro: string }> {
  const [alvo] = await db.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
  if (!alvo) return { ok: false, erro: "Usuário não encontrado" };
  const senhaTemporaria = gerarSenhaTemporaria();
  await db.transaction(async (tx) => {
    await tx
      .update(usuario)
      .set({
        senhaHash: await gerarHashSenha(senhaTemporaria),
        trocarSenha: true,
        tentativasErradas: 0,
        bloqueadoAte: null,
      })
      .where(eq(usuario.id, usuarioId));
    await tx
      .update(sessao)
      .set({ encerradaEm: new Date() })
      .where(and(eq(sessao.usuarioId, usuarioId), isNull(sessao.encerradaEm)));
    await registrarLog(tx, {
      usuario: autor,
      acao: "Redefinição de senha",
      entidade: "usuario",
      entidadeId: usuarioId,
      detalhe: `Login ${alvo.login}`,
    });
  });
  return { ok: true, senhaTemporaria };
}

export async function listarUsuarios(db: LeituraBanco) {
  return db
    .select({
      id: usuario.id,
      nome: usuario.nome,
      login: usuario.login,
      email: usuario.email,
      perfil: usuario.perfil,
      ativo: usuario.ativo,
      bloqueadoAte: usuario.bloqueadoAte,
    })
    .from(usuario)
    .orderBy(asc(usuario.nome));
}

export async function listarVendedores(db: LeituraBanco) {
  return db
    .select({ id: usuario.id, nome: usuario.nome })
    .from(usuario)
    .where(and(eq(usuario.perfil, "vendedor"), eq(usuario.ativo, true)))
    .orderBy(asc(usuario.nome));
}
