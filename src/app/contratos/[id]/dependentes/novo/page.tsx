import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { obterBanco } from "@/banco";
import { configuracao, contrato } from "@/banco/esquema";
import { ehIdValido } from "@/regras/contratos";
import { carregarPainel } from "@/regras/dependentes";
import { formatarData } from "@/regras/formatacao";
import { hojeEmSaoPaulo } from "@/regras/titular";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../../../../sem-permissao";
import { FormularioDependente } from "./formulario-dependente";

export const metadata: Metadata = { title: "Incluir dependente — Realize V2" };

async function Conteudo({ parametros }: { parametros: Promise<{ id: string }> }) {
  await connection();
  const atual = await exigirPagina("gerir_dependentes", "contrato");
  if (!atual) return <SemPermissao />;
  const { id } = await parametros;
  if (!ehIdValido(id)) notFound();

  const db = obterBanco();
  const [dados] = await db
    .select({ numero: contrato.numero })
    .from(contrato)
    .where(eq(contrato.id, id))
    .limit(1);
  const painel = dados ? await carregarPainel(db, id) : null;
  if (!dados || !painel) notFound();

  const [idadeCpf] = await db
    .select({ valor: configuracao.valor })
    .from(configuracao)
    .where(eq(configuracao.chave, "idade_cpf_dependente_obrigatorio"))
    .limit(1);

  const impedimento = !painel.aceitaDependentes
    ? "Contrato individual não aceita dependentes."
    : !painel.podeAlterar
      ? "Contrato cancelado não pode ter dependentes alterados."
      : null;

  return (
    <>
      <p className="voltar">
        <Link href={`/contratos/${id}`}>← Voltar para o contrato nº {dados.numero}</Link>
      </p>
      <h1>Incluir dependente</h1>
      {impedimento ? (
        <p className="aviso">{impedimento}</p>
      ) : (
        <>
          <p className="aviso">Use somente dados fictícios neste protótipo.</p>
          {painel.bloqueios.length > 0 ? (
            <p className="detalhe">
              Há vaga bloqueada até {formatarData(painel.bloqueios[0].liberaEm)}: a inclusão só é aceita
              com exceção aprovada.
            </p>
          ) : null}
          <section>
            <FormularioDependente
              contratoId={id}
              hoje={hojeEmSaoPaulo()}
              idadeCpf={typeof idadeCpf?.valor === "number" ? idadeCpf.valor : 18}
            />
          </section>
        </>
      )}
    </>
  );
}

export default function PaginaIncluirDependente({
  params,
}: PageProps<"/contratos/[id]/dependentes/novo">) {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo parametros={params} />
      </Suspense>
    </main>
  );
}
