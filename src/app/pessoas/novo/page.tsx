import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { hojeEmSaoPaulo } from "@/regras/titular";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../../sem-permissao";
import { FormularioTitular } from "./formulario-titular";

export const metadata: Metadata = { title: "Novo titular — Realize V2" };

async function Conteudo() {
  await connection();
  const atual = await exigirPagina("cadastrar_pessoa", "pessoa");
  if (!atual) return <SemPermissao />;
  return (
    <>
      <h1>Novo titular</h1>
      <p className="aviso">Use somente dados fictícios neste protótipo.</p>
      <section>
        <FormularioTitular hoje={hojeEmSaoPaulo()} />
      </section>
    </>
  );
}

export default function PaginaNovoTitular() {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </main>
  );
}
