"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterBanco } from "@/banco";
import { consultarCep } from "@/regras/cep";
import { cpfValido } from "@/regras/cpf";
import {
  buscarPessoaPorCpf,
  cadastrarTitular,
  type EntradaTitular,
  type ErrosTitular,
  type PessoaExistente,
} from "@/regras/titular";
import { autorizar, registrarAcao } from "@/servidor/sessao";

export type EstadoFormulario = {
  erros: ErrosTitular;
  cpfExistente?: PessoaExistente;
  cpfEnviado?: string;
};

function campo(formulario: FormData, nome: keyof EntradaTitular) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

export async function salvarTitular(
  _anterior: EstadoFormulario,
  formulario: FormData,
): Promise<EstadoFormulario> {
  const acesso = await autorizar("cadastrar_pessoa", "pessoa");
  if (!acesso.ok) return { erros: { nome: acesso.erro } };

  const resultado = await cadastrarTitular(obterBanco(), {
    nome: campo(formulario, "nome"),
    cpf: campo(formulario, "cpf"),
    dataNascimento: campo(formulario, "dataNascimento"),
    sexo: campo(formulario, "sexo"),
    celular: campo(formulario, "celular"),
    email: campo(formulario, "email"),
    cep: campo(formulario, "cep"),
    logradouro: campo(formulario, "logradouro"),
    numero: campo(formulario, "numero"),
    complemento: campo(formulario, "complemento"),
    bairro: campo(formulario, "bairro"),
    cidade: campo(formulario, "cidade"),
    uf: campo(formulario, "uf"),
  });

  if (!resultado.ok) {
    return {
      erros: resultado.erros,
      cpfExistente: resultado.cpfExistente,
      cpfEnviado: campo(formulario, "cpf"),
    };
  }

  await registrarAcao(acesso.usuario, "Cadastro de titular", "pessoa", resultado.id);
  revalidatePath("/pessoas");
  redirect(`/pessoas/${resultado.id}?novo=1`);
}

export async function verificarCpf(cpf: string): Promise<PessoaExistente | null> {
  const acesso = await autorizar("cadastrar_pessoa", "pessoa");
  if (!acesso.ok || !cpfValido(cpf)) return null;
  return (await buscarPessoaPorCpf(obterBanco(), cpf)) ?? null;
}

export async function buscarEnderecoPorCep(cep: string) {
  const acesso = await autorizar("cadastrar_pessoa", "pessoa");
  if (!acesso.ok) return null;
  return consultarCep(cep);
}
