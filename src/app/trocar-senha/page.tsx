import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FormularioTrocarSenha } from "@/app/login/formularios";
import { usuarioAtual } from "@/servidor/sessao";

export const metadata: Metadata = { title: "Trocar senha — Realize V2" };

async function Conteudo() {
  const atual = await usuarioAtual();
  if (!atual) redirect("/login");
  return (
    <>
      {atual.trocarSenha ? (
        <p className="aviso">Este é o seu primeiro acesso com senha temporária: troque a senha para continuar.</p>
      ) : null}
      <section>
        <FormularioTrocarSenha />
      </section>
    </>
  );
}

export default function PaginaTrocarSenha() {
  return (
    <main className="pagina-estreita">
      <h1>Trocar senha</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </main>
  );
}
