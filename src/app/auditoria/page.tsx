import type { Metadata } from "next";
import { Suspense } from "react";
import { obterBanco } from "@/banco";
import { consultarLog, listarEntidadesLog, listarUsuarios } from "@/regras/acesso";
import { formatarMomento } from "@/regras/formatacao";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../sem-permissao";

export const metadata: Metadata = { title: "Auditoria — Realize V2" };

const NOME_RESULTADO: Record<string, string> = { ok: "Feito", negado: "Negado", falha: "Falha" };
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_ID = /^[0-9a-f-]{36}$/i;

async function Conteudo({ parametros }: { parametros: PageProps<"/auditoria">["searchParams"] }) {
  const atual = await exigirPagina("ver_auditoria", "log_auditoria");
  if (!atual) return <SemPermissao />;
  const busca = await parametros;
  const valor = (nome: string) => (typeof busca[nome] === "string" ? (busca[nome] as string) : "");
  const usuarioId = FORMATO_ID.test(valor("usuario")) ? valor("usuario") : "";
  const entidade = valor("entidade");
  const de = FORMATO_DATA.test(valor("de")) ? valor("de") : "";
  const ate = FORMATO_DATA.test(valor("ate")) ? valor("ate") : "";

  const db = obterBanco();
  const [registros, usuarios, entidades] = await Promise.all([
    consultarLog(db, {
      usuarioId: usuarioId || undefined,
      entidade: entidade || undefined,
      de: de || undefined,
      ate: ate || undefined,
    }),
    listarUsuarios(db),
    listarEntidadesLog(db),
  ]);

  return (
    <>
      <h1>Auditoria</h1>
      <section>
        <form action="/auditoria" className="filtros-log">
          <div className="campo">
            <label htmlFor="usuario">Usuário</label>
            <select id="usuario" name="usuario" defaultValue={usuarioId}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="entidade">Área</label>
            <select id="entidade" name="entidade" defaultValue={entidade}>
              <option value="">Todas</option>
              {entidades.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="de">De</label>
            <input id="de" name="de" type="date" defaultValue={de} />
          </div>
          <div className="campo">
            <label htmlFor="ate">Até</label>
            <input id="ate" name="ate" type="date" defaultValue={ate} />
          </div>
          <button type="submit" className="botao botao-secundario">
            Filtrar
          </button>
        </form>
      </section>

      <section>
        <h2>Registros</h2>
        <p className="detalhe">
          Em ordem cronológica, até os 300 mais recentes. Nenhum registro pode ser editado ou apagado.
        </p>
        {registros.length === 0 ? (
          <p className="detalhe">Nenhum registro encontrado.</p>
        ) : (
          <div className="tabela">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Usuário</th>
                  <th>Ação</th>
                  <th>Área</th>
                  <th>Detalhe</th>
                  <th>Resultado</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className={r.resultado === "negado" ? "linha-negada" : undefined}>
                    <td>{formatarMomento(r.data)}</td>
                    <td>{r.usuarioNome}</td>
                    <td>{r.acao}</td>
                    <td>{r.entidade}</td>
                    <td>{r.detalhe ?? "—"}</td>
                    <td>{NOME_RESULTADO[r.resultado]}</td>
                    <td>{r.origem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function PaginaAuditoria({ searchParams }: PageProps<"/auditoria">) {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo parametros={searchParams} />
      </Suspense>
    </main>
  );
}
