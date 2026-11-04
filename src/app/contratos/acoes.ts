"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterBanco } from "@/banco";
import { criarContrato, type Cobertura, type ErrosContrato } from "@/regras/contratos";
import { hojeEmSaoPaulo } from "@/regras/titular";
import { autorizar, registrarAcao } from "@/servidor/sessao";

export type EstadoContrato = { erros: ErrosContrato; cobertura?: Cobertura };

function texto(formulario: FormData, nome: string) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

export async function salvarContrato(
  _anterior: EstadoContrato,
  formulario: FormData,
): Promise<EstadoContrato> {
  const acesso = await autorizar("criar_contrato", "contrato");
  if (!acesso.ok) return { erros: { titular: acesso.erro } };

  const titularId = texto(formulario, "titularId");
  const resultado = await criarContrato(
    obterBanco(),
    {
      titularId,
      planoId: texto(formulario, "planoId"),
      composicao: texto(formulario, "composicao"),
      funeral: texto(formulario, "funeral") === "sim",
      cupom: texto(formulario, "cupom"),
      formaPagamento: texto(formulario, "formaPagamento"),
      diaVencimento: texto(formulario, "diaVencimento"),
      origemTipo: texto(formulario, "origemTipo"),
      origemDetalhe: texto(formulario, "origemDetalhe"),
      vendedorId: texto(formulario, "vendedorId"),
    },
    hojeEmSaoPaulo(),
    acesso.usuario.nome,
  );

  if (!resultado.ok) return { erros: resultado.erros, cobertura: resultado.cobertura };

  await registrarAcao(acesso.usuario, "Criação de contrato", "contrato", resultado.id);
  revalidatePath(`/pessoas/${titularId}`);
  redirect(`/contratos/${resultado.id}?novo=1`);
}
