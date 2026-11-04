// Primeira barreira: sem cookie de sessão, nem chega a abrir a página.
// A conferência de verdade, com sessão e permissão, acontece no servidor em cada página e ação.
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_SESSAO = "realize_sessao";

export function proxy(pedido: NextRequest) {
  if (pedido.cookies.has(COOKIE_SESSAO)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", pedido.url));
}

export const config = {
  // Fora daqui: entrada, chamadas da API (que respondem 401 sozinhas) e arquivos do site.
  matcher: ["/((?!login|api|_next|favicon.ico|logo-realize-branca.png).*)"],
};
