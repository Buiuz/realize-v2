import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { obterBanco } from "@/banco";
import { pessoa } from "@/banco/esquema";
import {
  buscarCobertura,
  carregarOpcoes,
  ehIdValido,
  ORIGENS_DISPONIVEIS,
} from "@/regras/contratos";
import { listarVendedores } from "@/regras/acesso";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../../../sem-permissao";
import { FormularioContrato } from "./formulario-contrato";

export const metadata: Metadata = { title: "Novo contrato — Realize V2" };

async function Conteudo({ parametros }: { parametros: Promise<{ id: string }> }) {
  await connection();
  const atual = await exigirPagina("criar_contrato", "contrato");
  if (!atual) return <SemPermissao />;
  const { id } = await parametros;
  if (!ehIdValido(id)) notFound();

  const db = obterBanco();
  const [titular] = await db.select().from(pessoa).where(eq(pessoa.id, id)).limit(1);
  if (!titular) notFound();

  const voltar = (
    <p className="voltar">
      <Link href={`/pessoas/${id}`}>← Voltar para {titular.nome}</Link>
    </p>
  );

  if (!titular.cpf) {
    return (
      <>
        {voltar}
        <h1>Novo contrato</h1>
        <p className="aviso">Esta pessoa não tem CPF, e o titular do contrato precisa ter.</p>
      </>
    );
  }

  const cobertura = await buscarCobertura(db, id);
  if (cobertura) {
    return (
      <>
        {voltar}
        <h1>Novo contrato</h1>
        <div className="cartao-aviso">
          <p>
            {titular.nome} já está no contrato nº {cobertura.numero}.
          </p>
          <Link href={`/contratos/${cobertura.contratoId}`} className="botao botao-secundario">
            Abrir contrato
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {voltar}
      <h1>Novo contrato</h1>
      <p className="detalhe">Titular: {titular.nome}</p>
      <section>
        <FormularioContrato
          titularId={id}
          opcoes={await carregarOpcoes(db, titular.dataNascimento)}
          origens={ORIGENS_DISPONIVEIS}
          vendedores={await listarVendedores(db)}
        />
      </section>
    </>
  );
}

export default function PaginaNovoContrato({ params }: PageProps<"/pessoas/[id]/novo-contrato">) {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo parametros={params} />
      </Suspense>
    </main>
  );
}
