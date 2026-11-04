"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterBanco } from "@/banco";
import { autenticar, encerrarSessao, trocarSenha } from "@/regras/acesso";
import { apagarCookieSessao, gravarCookieSessao, tokenAtual, usuarioAtual } from "@/servidor/sessao";

export type EstadoAcesso = { erro?: string };

function texto(formulario: FormData, nome: string) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

export async function entrar(_anterior: EstadoAcesso, formulario: FormData): Promise<EstadoAcesso> {
  const resultado = await autenticar(obterBanco(), texto(formulario, "login"), texto(formulario, "senha"));
  if (!resultado.ok) return { erro: resultado.erro };
  await gravarCookieSessao(resultado.token, resultado.expiraEm);
  // O cabeçalho mostra o menu de acordo com o perfil: precisa ser refeito.
  revalidatePath("/", "layout");
  redirect(resultado.trocarSenha ? "/trocar-senha" : "/pessoas");
}

export async function sair() {
  const token = await tokenAtual();
  if (token) await encerrarSessao(obterBanco(), token);
  await apagarCookieSessao();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function acaoTrocarSenha(_anterior: EstadoAcesso, formulario: FormData): Promise<EstadoAcesso> {
  const atual = await usuarioAtual();
  if (!atual) redirect("/login");
  const nova = texto(formulario, "nova");
  if (nova !== texto(formulario, "confirmacao")) return { erro: "A confirmação não é igual à nova senha" };
  const resultado = await trocarSenha(obterBanco(), atual, texto(formulario, "atual"), nova);
  if (!resultado.ok) return { erro: resultado.erro };
  revalidatePath("/", "layout");
  redirect("/pessoas");
}
