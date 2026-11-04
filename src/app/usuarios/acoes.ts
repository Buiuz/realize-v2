"use server";

import { revalidatePath } from "next/cache";
import { obterBanco } from "@/banco";
import {
  alterarPerfil,
  alterarSituacaoUsuario,
  criarUsuario,
  redefinirSenha,
  type ErrosUsuario,
} from "@/regras/acesso";
import { autorizar } from "@/servidor/sessao";

export type EstadoNovoUsuario = { erros: ErrosUsuario; senhaTemporaria?: string; login?: string };
export type EstadoUsuario = { erro?: string; senhaTemporaria?: string };

function texto(formulario: FormData, nome: string) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

export async function acaoCriarUsuario(
  _anterior: EstadoNovoUsuario,
  formulario: FormData,
): Promise<EstadoNovoUsuario> {
  const acesso = await autorizar("configurar_usuarios", "usuario");
  if (!acesso.ok) return { erros: { geral: acesso.erro } };
  const login = texto(formulario, "login");
  const resultado = await criarUsuario(obterBanco(), acesso.usuario, {
    nome: texto(formulario, "nome"),
    cpf: texto(formulario, "cpf"),
    email: texto(formulario, "email"),
    login,
    perfil: texto(formulario, "perfil"),
  });
  if (!resultado.ok) return { erros: resultado.erros };
  revalidatePath("/usuarios");
  // Sem envio de e-mail no protótipo: a senha temporária aparece uma única vez para o Super Admin.
  return { erros: {}, senhaTemporaria: resultado.senhaTemporaria, login: login.trim().toLowerCase() };
}

export async function acaoAlterarPerfil(_anterior: EstadoUsuario, formulario: FormData): Promise<EstadoUsuario> {
  const usuarioId = texto(formulario, "usuarioId");
  const acesso = await autorizar("configurar_usuarios", "usuario", usuarioId);
  if (!acesso.ok) return { erro: acesso.erro };
  const resultado = await alterarPerfil(obterBanco(), acesso.usuario, usuarioId, texto(formulario, "perfil"));
  if (!resultado.ok) return { erro: resultado.erro };
  revalidatePath("/usuarios");
  return {};
}

export async function acaoAlterarSituacao(_anterior: EstadoUsuario, formulario: FormData): Promise<EstadoUsuario> {
  const usuarioId = texto(formulario, "usuarioId");
  const acesso = await autorizar("configurar_usuarios", "usuario", usuarioId);
  if (!acesso.ok) return { erro: acesso.erro };
  const resultado = await alterarSituacaoUsuario(
    obterBanco(),
    acesso.usuario,
    usuarioId,
    texto(formulario, "ativo") === "sim",
  );
  if (!resultado.ok) return { erro: resultado.erro };
  revalidatePath("/usuarios");
  return {};
}

export async function acaoRedefinirSenha(_anterior: EstadoUsuario, formulario: FormData): Promise<EstadoUsuario> {
  const usuarioId = texto(formulario, "usuarioId");
  const acesso = await autorizar("configurar_usuarios", "usuario", usuarioId);
  if (!acesso.ok) return { erro: acesso.erro };
  const resultado = await redefinirSenha(obterBanco(), acesso.usuario, usuarioId);
  if (!resultado.ok) return { erro: resultado.erro };
  revalidatePath("/usuarios");
  return { senhaTemporaria: resultado.senhaTemporaria };
}
