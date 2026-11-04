"use server";

import { revalidatePath } from "next/cache";
import { obterBanco } from "@/banco";
import { registrarLog } from "@/regras/acesso";
import {
  criarFaturaTeste,
  executarAcaoManual,
  pagarFatura,
  registrarAssinatura,
  registrarPagamentoAdesao,
  rodarRotinaDiaria,
  salvarPrazoInadimplencia,
  PERMISSAO_DA_ACAO,
  type AcaoManual,
  type RelatorioRotina,
} from "@/regras/status";
import { autorizar, registrarAcao } from "@/servidor/sessao";

export type EstadoStatus = { erro?: string; ok?: boolean };
export type EstadoRotina = { erro?: string; relatorio?: RelatorioRotina };

function texto(formulario: FormData, nome: string) {
  const valor = formulario.get(nome);
  return typeof valor === "string" ? valor : "";
}

function concluir(contratoId: string, resultado: { ok: true } | { ok: false; erro: string }): EstadoStatus {
  if (!resultado.ok) return { erro: resultado.erro };
  revalidatePath(`/contratos/${contratoId}`);
  return { ok: true };
}

export async function acaoManualStatus(_anterior: EstadoStatus, formulario: FormData): Promise<EstadoStatus> {
  const contratoId = texto(formulario, "contratoId");
  const acao = texto(formulario, "acao");
  const permissao = PERMISSAO_DA_ACAO[acao as AcaoManual];
  if (!permissao) return { erro: "Ação inválida" };
  const acesso = await autorizar(permissao, "contrato", contratoId);
  if (!acesso.ok) return { erro: acesso.erro };

  const motivo = texto(formulario, "motivo");
  const resultado = await executarAcaoManual(obterBanco(), contratoId, acao, motivo, new Date(), acesso.usuario.nome);
  if (resultado.ok) await registrarAcao(acesso.usuario, `Status: ${acao}`, "contrato", contratoId, motivo);
  return concluir(contratoId, resultado);
}

export async function acaoRegistrarAdesao(_anterior: EstadoStatus, formulario: FormData): Promise<EstadoStatus> {
  const contratoId = texto(formulario, "contratoId");
  const pagamento = texto(formulario, "etapa") === "pagamento";
  const acesso = await autorizar(
    pagamento ? "registrar_pagamento_adesao" : "registrar_assinatura",
    "contrato",
    contratoId,
  );
  if (!acesso.ok) return { erro: acesso.erro };

  const registrar = pagamento ? registrarPagamentoAdesao : registrarAssinatura;
  const resultado = await registrar(obterBanco(), contratoId);
  if (resultado.ok) {
    await registrarAcao(
      acesso.usuario,
      pagamento ? "Pagamento da adesão registrado" : "Assinatura registrada",
      "contrato",
      contratoId,
    );
  }
  return concluir(contratoId, resultado);
}

export async function acaoCriarFatura(_anterior: EstadoStatus, formulario: FormData): Promise<EstadoStatus> {
  const contratoId = texto(formulario, "contratoId");
  const acesso = await autorizar("gerar_fatura_teste", "fatura", contratoId);
  if (!acesso.ok) return { erro: acesso.erro };

  const competencia = texto(formulario, "competencia");
  const resultado = await criarFaturaTeste(obterBanco(), contratoId, competencia);
  if (resultado.ok) await registrarAcao(acesso.usuario, "Fatura de teste gerada", "fatura", contratoId, competencia);
  return concluir(contratoId, resultado);
}

export async function acaoPagarFatura(_anterior: EstadoStatus, formulario: FormData): Promise<EstadoStatus> {
  const faturaId = texto(formulario, "faturaId");
  const acesso = await autorizar("baixar_fatura", "fatura", faturaId);
  if (!acesso.ok) return { erro: acesso.erro };

  const resultado = await pagarFatura(obterBanco(), faturaId);
  if (resultado.ok) await registrarAcao(acesso.usuario, "Baixa de fatura", "fatura", faturaId);
  return concluir(texto(formulario, "contratoId"), resultado);
}

export async function acaoSalvarPrazos(_anterior: EstadoStatus, formulario: FormData): Promise<EstadoStatus> {
  const acesso = await autorizar("configurar_prazos", "configuracao");
  if (!acesso.ok) return { erro: acesso.erro };

  const valorX = texto(formulario, "x");
  const resultado = await salvarPrazoInadimplencia(obterBanco(), valorX);
  if (!resultado.ok) return { erro: resultado.erro };
  await registrarAcao(
    acesso.usuario,
    "Prazo de inadimplência alterado",
    "configuracao",
    null,
    `Dias: ${valorX || "padrão"}`,
  );
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function acaoRodarRotina(_anterior: EstadoRotina, formulario: FormData): Promise<EstadoRotina> {
  const acesso = await autorizar("rodar_rotina", "configuracao");
  if (!acesso.ok) return { erro: acesso.erro };

  const data = texto(formulario, "data");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) {
    return { erro: "Escolha uma data válida" };
  }
  const db = obterBanco();
  // Meio-dia em São Paulo, para o dia nunca mudar por causa do fuso.
  const relatorio = await rodarRotinaDiaria(db, new Date(`${data}T15:00:00Z`));
  await registrarLog(db, {
    usuario: acesso.usuario,
    acao: "Rotina diária executada",
    entidade: "configuracao",
    detalhe: `Data ${data}: ${relatorio.faturasVencidas} faturas vencidas, ${relatorio.mudancas.length} mudanças de status`,
    origem: "rotina automática",
  });
  revalidatePath("/", "layout");
  return { relatorio };
}
