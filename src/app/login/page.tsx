import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioAtual } from "@/servidor/sessao";
import { FormularioEntrar } from "./formularios";

export const metadata: Metadata = { title: "Entrar — Realize V2" };

async function Conteudo() {
  const atual = await usuarioAtual();
  if (atual) redirect(atual.trocarSenha ? "/trocar-senha" : "/pessoas");
  return (
    <section>
      <FormularioEntrar />
    </section>
  );
}

export default function PaginaLogin() {
  return (
    <main className="pagina-estreita">
      <h1>Entrar</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </main>
  );
}
