import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { obterBanco } from "@/banco";
import { formatarCpf } from "@/regras/cpf";
import { formatarData } from "@/regras/formatacao";
import { tem } from "@/regras/permissoes";
import { buscarPessoas } from "@/regras/titular";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../sem-permissao";

export const metadata: Metadata = { title: "Pessoas — Realize V2" };

const LIMITE = 50;

async function Resultado({ parametros }: { parametros: Promise<{ busca?: string | string[] }> }) {
  await connection();
  const atual = await exigirPagina("ver_cadastros", "pessoa");
  if (!atual) return <SemPermissao />;
  const { busca: bruta } = await parametros;
  const busca = (typeof bruta === "string" ? bruta : "").trim();
  const pessoas = await buscarPessoas(obterBanco(), busca, LIMITE, atual.perfil === "vendedor" ? atual.id : undefined);

  return (
    <>
      <div className="titulo-com-acao">
        <h1>Pessoas</h1>
        {tem(atual.perfil, "cadastrar_pessoa") ? (
          <Link href="/pessoas/novo" className="botao">
            Novo titular
          </Link>
        ) : null}
      </div>
      {atual.perfil === "vendedor" ? (
        <p className="detalhe">Mostrando só os clientes da sua carteira.</p>
      ) : null}
      <section>
      <form action="/pessoas" className="busca" role="search">
        <label htmlFor="busca">Buscar por nome ou CPF</label>
        <div className="busca-linha">
          <input id="busca" name="busca" type="search" defaultValue={busca} autoComplete="off" />
          <button type="submit" className="botao botao-secundario">
            Buscar
          </button>
        </div>
      </form>

      {pessoas.length === 0 ? (
        <p className="detalhe">
          {busca ? `Ninguém encontrado para "${busca}".` : "Nenhuma pessoa cadastrada ainda."}
        </p>
      ) : (
        <ul className="lista">
          {pessoas.map((p) => (
            <li key={p.id}>
              <Link href={`/pessoas/${p.id}`}>
                <strong>{p.nome}</strong>
                <span>
                  {p.cpf ? formatarCpf(p.cpf) : "Sem CPF"} · Nascimento: {formatarData(p.nascimento)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pessoas.length === LIMITE ? (
        <p className="detalhe">Mostrando as primeiras {LIMITE}. Use a busca para encontrar outras.</p>
      ) : null}
      </section>
    </>
  );
}

export default function PaginaPessoas({ searchParams }: PageProps<"/pessoas">) {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Resultado parametros={searchParams} />
      </Suspense>
    </main>
  );
}
