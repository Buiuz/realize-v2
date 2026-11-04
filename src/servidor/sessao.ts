// Liga as regras de acesso ao navegador: lê o cookie da sessão e confere permissões.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { obterBanco } from "@/banco";
import {
  buscarUsuarioDaSessao,
  registrarLog,
  verificarPermissao,
  type UsuarioSessao,
} from "@/regras/acesso";
import { tem, type Permissao } from "@/regras/permissoes";

export const COOKIE_SESSAO = "realize_sessao";

export async function tokenAtual() {
  return (await cookies()).get(COOKIE_SESSAO)?.value ?? null;
}

export async function usuarioAtual(): Promise<UsuarioSessao | null> {
  // Sessão depende do pedido e da hora: nunca pode ser resolvida na preparação prévia da página.
  await connection();
  const token = await tokenAtual();
  return token ? buscarUsuarioDaSessao(obterBanco(), token) : null;
}

export async function gravarCookieSessao(token: string, expiraEm: Date) {
  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiraEm,
  });
}

export async function apagarCookieSessao() {
  (await cookies()).delete(COOKIE_SESSAO);
}

/** Para páginas: sem login vai para a entrada; com senha temporária, para a troca de senha. */
export async function exigirUsuario(): Promise<UsuarioSessao> {
  const atual = await usuarioAtual();
  if (!atual) redirect("/login");
  if (atual.trocarSenha) redirect("/trocar-senha");
  return atual;
}

/** Para páginas: devolve o usuário, ou null (com a tentativa no log) se ele não tiver permissão. */
export async function exigirPagina(permissao: Permissao, entidade: string): Promise<UsuarioSessao | null> {
  const atual = await exigirUsuario();
  if (tem(atual.perfil, permissao)) return atual;
  await registrarLog(obterBanco(), {
    usuario: atual,
    acao: `Tentativa negada: ${permissao}`,
    entidade,
    resultado: "negado",
  });
  return null;
}

export type Autorizacao = { ok: true; usuario: UsuarioSessao } | { ok: false; erro: string };

/** Primeira linha de toda ação do servidor. Nega e registra quando não há permissão. */
export async function autorizar(
  permissao: Permissao,
  entidade: string,
  entidadeId?: string | null,
): Promise<Autorizacao> {
  const atual = await usuarioAtual();
  const resultado = await verificarPermissao(obterBanco(), atual, permissao, { entidade, entidadeId });
  if (!resultado.ok || !atual) return { ok: false, erro: resultado.ok ? "Faça login novamente" : resultado.erro };
  return { ok: true, usuario: atual };
}

/** Registra no log uma ação concluída. */
export async function registrarAcao(
  usuario: UsuarioSessao,
  acao: string,
  entidade: string,
  entidadeId?: string | null,
  detalhe?: string | null,
) {
  await registrarLog(obterBanco(), { usuario, acao, entidade, entidadeId, detalhe });
}
