"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterBanco } from "@/banco";
import {
  ajustarFaixaVida,
  atualizarValorContrato,
  decidirExcecao,
  incluirDependente,
  pedirExcecao,
  removerDependente,
  type ErrosDependente,
  type PreviaInclusao,
} from "@/regras/dependentes";
import { hojeEmSaoPaulo } from "@/regras/titular";
import { autorizar, registrarAcao } from "@/servidor/sessao";

export type EstadoDependente = {
  erros: ErrosDependente;
  previa?: PreviaInclusao;
  bloqueada?: { liberaEm: string; excecaoPendente: boolean };
};

export type EstadoAcao = { erro?: string; ok?: boolean };

function texto(formulario: FormData, nome: string) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

export async function salvarDependente(
  _anterior: EstadoDependente,
  formulario: FormData,
): Promise<EstadoDependente> {
  const contratoId = texto(formulario, "contratoId");
  const acesso = await autorizar("gerir_dependentes", "contrato", contratoId);
  if (!acesso.ok) return { erros: { geral: acesso.erro } };

  const resultado = await incluirDependente(
    obterBanco(),
    contratoId,
    {
      nome: texto(formulario, "nome"),
      cpf: texto(formulario, "cpf"),
      dataNascimento: texto(formulario, "dataNascimento"),
      parentesco: texto(formulario, "parentesco"),
      confirmacao: texto(formulario, "confirmacao"),
    },
    hojeEmSaoPaulo(),
    acesso.usuario.nome,
  );

  if (resultado.status === "erro") return { erros: resultado.erros };
  if (resultado.status === "confirmar") return { erros: {}, previa: resultado.previa };
  if (resultado.status === "bloqueada") {
    return {
      erros: {},
      bloqueada: { liberaEm: resultado.liberaEm, excecaoPendente: resultado.excecaoPendente },
    };
  }

  await registrarAcao(acesso.usuario, "Inclusão de dependente", "contrato", contratoId);
  revalidatePath(`/contratos/${contratoId}`);
  redirect(`/contratos/${contratoId}?dependente=1`);
}

export async function acaoRemoverDependente(
  _anterior: EstadoAcao,
  formulario: FormData,
): Promise<EstadoAcao> {
  const contratoId = texto(formulario, "contratoId");
  const acesso = await autorizar("gerir_dependentes", "contrato", contratoId);
  if (!acesso.ok) return { erro: acesso.erro };

  const motivo = texto(formulario, "motivo");
  const resultado = await removerDependente(
    obterBanco(),
    texto(formulario, "vidaId"),
    motivo,
    hojeEmSaoPaulo(),
    acesso.usuario.nome,
  );
  if (!resultado.ok) return { erro: resultado.erro };
  await registrarAcao(acesso.usuario, "Remoção de dependente", "contrato", contratoId, motivo);
  revalidatePath(`/contratos/${contratoId}`);
  return { ok: true };
}

export async function acaoPedirExcecao(
  _anterior: EstadoAcao,
  formulario: FormData,
): Promise<EstadoAcao> {
  const contratoId = texto(formulario, "contratoId");
  const acesso = await autorizar("pedir_excecao", "contrato", contratoId);
  if (!acesso.ok) return { erro: acesso.erro };

  const tipo = texto(formulario, "tipo");
  const resultado = await pedirExcecao(
    obterBanco(),
    contratoId,
    tipo,
    texto(formulario, "descricao"),
    hojeEmSaoPaulo(),
    acesso.usuario.nome,
  );
  if (!resultado.ok) return { erro: resultado.erro };
  await registrarAcao(acesso.usuario, "Pedido de exceção", "contrato", contratoId, tipo);
  revalidatePath(`/contratos/${contratoId}`);
  return { ok: true };
}

export async function acaoDecidirExcecao(
  _anterior: EstadoAcao,
  formulario: FormData,
): Promise<EstadoAcao> {
  const contratoId = texto(formulario, "contratoId");
  const acesso = await autorizar("liberar_excecao", "contrato", contratoId);
  if (!acesso.ok) return { erro: acesso.erro };

  const aprovar = texto(formulario, "decisao") === "aprovar";
  const motivo = texto(formulario, "motivo");
  const resultado = await decidirExcecao(
    obterBanco(),
    texto(formulario, "excecaoId"),
    aprovar,
    motivo,
    hojeEmSaoPaulo(),
    acesso.usuario.nome,
  );
  if (!resultado.ok) return { erro: resultado.erro };
  await registrarAcao(
    acesso.usuario,
    aprovar ? "Exceção aprovada" : "Exceção recusada",
    "contrato",
    contratoId,
    motivo,
  );
  revalidatePath(`/contratos/${contratoId}`);
  return { ok: true };
}

export async function acaoAtualizarValor(contratoId: string) {
  const acesso = await autorizar("alterar_valor", "contrato", contratoId);
  if (!acesso.ok) return;
  await atualizarValorContrato(obterBanco(), contratoId, hojeEmSaoPaulo(), acesso.usuario.nome);
  await registrarAcao(acesso.usuario, "Atualização de valor por vaga liberada", "contrato", contratoId);
  revalidatePath(`/contratos/${contratoId}`);
}

export async function acaoAjustarFaixa(contratoId: string, vidaId: string) {
  const acesso = await autorizar("alterar_valor", "contrato", contratoId);
  if (!acesso.ok) return;
  await ajustarFaixaVida(obterBanco(), vidaId, hojeEmSaoPaulo(), acesso.usuario.nome);
  await registrarAcao(acesso.usuario, "Ajuste de valor por faixa de idade", "contrato", contratoId);
  revalidatePath(`/contratos/${contratoId}`);
}
