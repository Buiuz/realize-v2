import { obterBanco } from "@/banco";
import { verificarPermissao } from "@/regras/acesso";
import { avaliarPreco } from "@/regras/contratos";
import { usuarioAtual } from "@/servidor/sessao";

/** Calcula o resumo do novo contrato. Não grava nada. */
export async function POST(pedido: Request) {
  const db = obterBanco();
  const atual = await usuarioAtual();
  const acesso = await verificarPermissao(db, atual, "criar_contrato", { entidade: "contrato" });
  if (!acesso.ok) {
    return Response.json({ erro: acesso.erro }, { status: atual ? 403 : 401 });
  }

  const corpo = await pedido.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") {
    return Response.json({ erro: "Pedido inválido" }, { status: 400 });
  }

  const avaliacao = await avaliarPreco(db, {
    titularId: String(corpo.titularId ?? ""),
    planoId: String(corpo.planoId ?? ""),
    composicao: String(corpo.composicao ?? ""),
    funeral: corpo.funeral === true,
    cupom: String(corpo.cupom ?? ""),
  });
  return Response.json(avaliacao);
}
