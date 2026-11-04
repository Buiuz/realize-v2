import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { obterBanco } from "@/banco";
import { contato, contrato, pessoa, vida } from "@/banco/esquema";
import { formatarCpf } from "@/regras/cpf";
import { contratosDaCarteira, podeVerPessoa } from "@/regras/acesso";
import { buscarCobertura } from "@/regras/contratos";
import { formatarData, mascararCelular, mascararCep } from "@/regras/formatacao";
import { NOME_STATUS } from "@/regras/nomes";
import { tem } from "@/regras/permissoes";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../../sem-permissao";

export const metadata: Metadata = { title: "Ficha da pessoa — Realize V2" };

const FORMATO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOME_CONTATO: Record<string, string> = {
  celular: "Celular",
  telefone: "Telefone",
  email: "E-mail",
};

const NOME_SEXO: Record<string, string> = {
  feminino: "Feminino",
  masculino: "Masculino",
  outro: "Outro",
};

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="dado">
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

async function Ficha({
  parametros,
  busca,
}: {
  parametros: PageProps<"/pessoas/[id]">["params"];
  busca: PageProps<"/pessoas/[id]">["searchParams"];
}) {
  await connection();
  const atual = await exigirPagina("ver_cadastros", "pessoa");
  if (!atual) return <SemPermissao />;
  const { id } = await parametros;
  const { novo } = await busca;
  if (!FORMATO_ID.test(id)) notFound();

  const db = obterBanco();
  // Fora da carteira do vendedor, é como se o registro não existisse (PRD 1.2).
  if (!(await podeVerPessoa(db, atual, id))) notFound();
  const [dados] = await db.select().from(pessoa).where(eq(pessoa.id, id)).limit(1);
  if (!dados) notFound();

  const contatos = await db
    .select()
    .from(contato)
    .where(eq(contato.pessoaId, id))
    .orderBy(desc(contato.principal), asc(contato.tipo));

  const todosContratos = await db
    .select({
      id: contrato.id,
      numero: contrato.numero,
      status: contrato.status,
      papel: vida.papel,
      entrada: vida.dataEntrada,
      saida: vida.dataSaida,
    })
    .from(vida)
    .innerJoin(contrato, eq(contrato.id, vida.contratoId))
    .where(eq(vida.pessoaId, id))
    .orderBy(asc(contrato.numero));

  const carteira = atual.perfil === "vendedor" ? await contratosDaCarteira(db, atual.id) : null;
  const contratos = carteira ? todosContratos.filter((c) => carteira.includes(c.id)) : todosContratos;
  const podeCriarContrato =
    tem(atual.perfil, "criar_contrato") && Boolean(dados.cpf) && !(await buscarCobertura(db, id));
  const endereco = [dados.logradouro, dados.numero, dados.complemento].filter(Boolean).join(", ");
  const cidade = [dados.bairro, dados.cidade, dados.uf].filter(Boolean).join(" — ");

  return (
    <>
      <h1>{dados.nome}</h1>
      {novo ? <p className="sucesso">Cadastro salvo.</p> : null}

      <section>
        <h2>Dados pessoais</h2>
        <dl className="dados">
          <Dado rotulo="CPF" valor={dados.cpf ? formatarCpf(dados.cpf) : "Sem CPF"} />
          <Dado rotulo="Nascimento" valor={formatarData(dados.dataNascimento)} />
          <Dado rotulo="Sexo" valor={dados.sexo ? NOME_SEXO[dados.sexo] : "Não informado"} />
        </dl>
      </section>

      <section>
        <h2>Contatos</h2>
        {contatos.length === 0 ? (
          <p className="detalhe">Nenhum contato cadastrado.</p>
        ) : (
          <dl className="dados">
            {contatos.map((c) => (
              <Dado
                key={c.id}
                rotulo={`${NOME_CONTATO[c.tipo]}${c.principal ? " (principal)" : ""}`}
                valor={c.tipo === "email" ? c.valor : mascararCelular(c.valor)}
              />
            ))}
          </dl>
        )}
      </section>

      <section>
        <h2>Endereço</h2>
        <dl className="dados">
          <Dado rotulo="CEP" valor={dados.cep ? mascararCep(dados.cep) : "Não informado"} />
          <Dado rotulo="Rua" valor={endereco || "Não informada"} />
          <Dado rotulo="Bairro, cidade e UF" valor={cidade || "Não informado"} />
        </dl>
      </section>

      <section>
        <h2>Contratos</h2>
        {contratos.length === 0 ? (
          <p className="detalhe">Esta pessoa ainda não está em nenhum contrato.</p>
        ) : (
          <div className="tabela">
            <table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Papel</th>
                  <th>Entrada</th>
                  <th>Saída</th>
                  <th>Status do contrato</th>
                </tr>
              </thead>
              <tbody>
                {contratos.map((c) => (
                  <tr key={`${c.id}-${c.entrada}`}>
                    <td>
                      <Link href={`/contratos/${c.id}`}>{c.numero}</Link>
                    </td>
                    <td>{c.papel === "titular" ? "Titular" : "Dependente"}</td>
                    <td>{formatarData(c.entrada)}</td>
                    <td>{c.saida ? formatarData(c.saida) : "—"}</td>
                    <td>{NOME_STATUS[c.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {podeCriarContrato ? (
          <p className="acoes-secao">
            <Link href={`/pessoas/${id}/novo-contrato`} className="botao">
              Novo contrato
            </Link>
          </p>
        ) : null}
      </section>
    </>
  );
}

export default function PaginaPessoa({ params, searchParams }: PageProps<"/pessoas/[id]">) {
  return (
    <main>
      <p className="voltar">
        <Link href="/pessoas">← Voltar para pessoas</Link>
      </p>
      <Suspense fallback={<p>Carregando…</p>}>
        <Ficha parametros={params} busca={searchParams} />
      </Suspense>
    </main>
  );
}
