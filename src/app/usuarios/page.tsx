import type { Metadata } from "next";
import { Suspense } from "react";
import { obterBanco } from "@/banco";
import { listarUsuarios } from "@/regras/acesso";
import { NOME_PERFIL, PERFIS, PERMISSOES, tem, type Permissao } from "@/regras/permissoes";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../sem-permissao";
import { AcoesUsuario, NovoUsuario } from "./formularios";

export const metadata: Metadata = { title: "Usuários — Realize V2" };

async function Conteudo() {
  const atual = await exigirPagina("ver_usuarios", "usuario");
  if (!atual) return <SemPermissao />;
  const usuarios = await listarUsuarios(obterBanco());
  const podeEditar = tem(atual.perfil, "configurar_usuarios");
  const agora = new Date();

  return (
    <>
      <h1>Usuários</h1>
      <section>
        <h2>Usuários do sistema</h2>
        <ul className="lista-vidas">
          {usuarios.map((u) => (
            <li key={u.id}>
              <div>
                <strong>{u.nome}</strong>
                <span>
                  {u.login} · {u.email}
                </span>
                <span>
                  {NOME_PERFIL[u.perfil]} · {u.ativo ? "Ativo" : "Desativado"}
                  {u.bloqueadoAte && u.bloqueadoAte > agora ? " · Bloqueado por senha errada" : ""}
                </span>
              </div>
              {podeEditar ? <AcoesUsuario usuarioId={u.id} perfil={u.perfil} ativo={u.ativo} /> : null}
            </li>
          ))}
        </ul>
        {podeEditar ? (
          <div className="acoes-secao">
            <NovoUsuario />
          </div>
        ) : null}
      </section>

      <section>
        <h2>Perfis e permissões</h2>
        <p className="detalhe">
          Consulta. Os perfis são fixos por enquanto. Marcadas com * são as ações sensíveis definidas no
          PRD; as demais são proposta provisória.
        </p>
        <div className="tabela">
          <table className="tabela-matriz">
            <thead>
              <tr>
                <th>Ação</th>
                {PERFIS.map((p) => (
                  <th key={p}>{NOME_PERFIL[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PERMISSOES) as Permissao[]).map((permissao) => {
                const regra: { nome: string; doPrd?: boolean; semTela?: boolean } = PERMISSOES[permissao];
                return (
                  <tr key={permissao}>
                    <td>
                      {regra.nome}
                      {regra.doPrd ? " *" : ""}
                      {regra.semTela ? " (ainda sem tela)" : ""}
                    </td>
                    {PERFIS.map((p) => (
                      <td key={p} className="celula-matriz">
                        {tem(p, permissao) ? "Sim" : "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function PaginaUsuarios() {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </main>
  );
}
