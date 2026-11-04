import { abrirBanco, CAMINHO_BANCO_LOCAL } from "./conexao";

// Mantém uma única conexão aberta enquanto o servidor roda, mesmo quando o código recarrega.
const global = globalThis as unknown as { bancoRealize?: ReturnType<typeof abrirBanco> };

export function obterBanco() {
  global.bancoRealize ??= abrirBanco(CAMINHO_BANCO_LOCAL);
  return global.bancoRealize.db;
}
