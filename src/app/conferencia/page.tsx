import { connection } from "next/server";
import { Suspense } from "react";
import { asc, count, eq, isNull, sql } from "drizzle-orm";
import { obterBanco } from "@/banco";
import {
  adicional,
  contrato,
  historicoStatus,
  pessoa,
  plano,
  precoAdicional,
  precoPlano,
  versaoContrato,
  vida,
} from "@/banco/esquema";
import { formatarCpf } from "@/regras/cpf";
import { formatarCentavos, formatarData, formatarMomento } from "@/regras/formatacao";
import { NOME_STATUS } from "@/regras/nomes";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../sem-permissao";

function faixaDeIdade(minima: number, maxima: number | null) {
  if (minima === 0 && maxima !== null) return `Até ${maxima} anos`;
  if (maxima === null) return `${minima} anos ou mais`;
  return `${minima} a ${maxima} anos`;
}

async function Conferencia() {
  await connection();
  const atual = await exigirPagina("ver_conferencia", "conferencia");
  if (!atual) return <SemPermissao />;
  const db = obterBanco();

  const planos = await db
    .select({
      nome: plano.nome,
      aceitaFuneral: plano.aceitaFuneral,
      composicao: precoPlano.composicao,
      valor: precoPlano.valorCentavos,
      divulgado: precoPlano.divulgado,
    })
    .from(precoPlano)
    .innerJoin(plano, eq(plano.id, precoPlano.planoId))
    .where(isNull(precoPlano.vigenciaFim))
    .orderBy(asc(precoPlano.valorCentavos), asc(plano.nome));

  const adicionais = await db
    .select({
      nome: adicional.nome,
      minima: precoAdicional.idadeMinima,
      maxima: precoAdicional.idadeMaxima,
      valor: precoAdicional.valorCentavos,
    })
    .from(precoAdicional)
    .innerJoin(adicional, eq(adicional.id, precoAdicional.adicionalId))
    .orderBy(asc(adicional.nome), asc(precoAdicional.idadeMinima));

  const pessoas = await db
    .select({
      nome: pessoa.nome,
      cpf: pessoa.cpf,
      nascimento: pessoa.dataNascimento,
      contratos: count(vida.id),
    })
    .from(pessoa)
    .leftJoin(vida, eq(vida.pessoaId, pessoa.id))
    .groupBy(pessoa.id)
    .orderBy(asc(pessoa.nome));

  const contratos = await db
    .select({
      numero: contrato.numero,
      status: contrato.status,
      titular: pessoa.nome,
      plano: plano.nome,
      composicao: versaoContrato.composicao,
      valor: versaoContrato.valorMensalCentavos,
      vencimento: versaoContrato.diaVencimento,
      vidas: sql<number>`(SELECT count(*)::int FROM ${vida} WHERE ${vida.contratoId} = ${contrato.id})`,
    })
    .from(contrato)
    .innerJoin(versaoContrato, eq(versaoContrato.contratoId, contrato.id))
    .innerJoin(plano, eq(plano.id, versaoContrato.planoId))
    .innerJoin(pessoa, eq(pessoa.id, contrato.titularId))
    .where(isNull(versaoContrato.vigenciaFim))
    .orderBy(asc(contrato.numero));

  const historico = await db
    .select({
      numero: contrato.numero,
      novo: historicoStatus.statusNovo,
      data: historicoStatus.data,
      autor: historicoStatus.autor,
      motivo: historicoStatus.motivo,
    })
    .from(historicoStatus)
    .innerJoin(contrato, eq(contrato.id, historicoStatus.contratoId))
    .orderBy(asc(historicoStatus.data));

  return (
    <>
      <section>
        <h2>Planos e preços</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Plano</th>
                <th>Composição</th>
                <th>Preço</th>
                <th>Aparece ao público</th>
                <th>Aceita funeral</th>
              </tr>
            </thead>
            <tbody>
              {planos.map((p) => (
                <tr key={`${p.nome}-${p.composicao}`}>
                  <td>{p.nome}</td>
                  <td>{p.composicao === "familiar" ? "Familiar" : "Individual"}</td>
                  <td>{formatarCentavos(p.valor)}</td>
                  <td>{p.divulgado ? "Sim" : "Não"}</td>
                  <td>{p.aceitaFuneral ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Adicionais</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Adicional</th>
                <th>Idade</th>
                <th>Valor por vida</th>
              </tr>
            </thead>
            <tbody>
              {adicionais.map((a) => (
                <tr key={`${a.nome}-${a.minima}`}>
                  <td>{a.nome}</td>
                  <td>{faixaDeIdade(a.minima, a.maxima)}</td>
                  <td>{formatarCentavos(a.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Pessoas de teste</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF fictício</th>
                <th>Nascimento</th>
                <th>Contratos em que está</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => (
                <tr key={p.nome}>
                  <td>{p.nome}</td>
                  <td>{p.cpf ? formatarCpf(p.cpf) : "Sem CPF (menor de 18)"}</td>
                  <td>{formatarData(p.nascimento)}</td>
                  <td>{p.contratos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Contratos</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Titular</th>
                <th>Plano</th>
                <th>Valor mensal</th>
                <th>Vencimento</th>
                <th>Vidas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.numero}>
                  <td>{c.numero}</td>
                  <td>{c.titular}</td>
                  <td>
                    {c.plano} ({c.composicao === "familiar" ? "Familiar" : "Individual"})
                  </td>
                  <td>{formatarCentavos(c.valor)}</td>
                  <td>Dia {c.vencimento}</td>
                  <td>{c.vidas}</td>
                  <td>{NOME_STATUS[c.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Histórico de status</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Novo status</th>
                <th>Data</th>
                <th>Autor</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={`${h.numero}-${h.data.toISOString()}`}>
                  <td>{h.numero}</td>
                  <td>{NOME_STATUS[h.novo]}</td>
                  <td>{formatarMomento(h.data)}</td>
                  <td>{h.autor}</td>
                  <td>{h.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function Pagina() {
  return (
    <main>
      <h1>Realize V2 — Conferência do banco de dados</h1>
      <p className="detalhe">Esta página só mostra o que está guardado no banco.</p>
      <p className="aviso">Protótipo com dados fictícios. Nenhuma informação aqui é de pessoa real.</p>
      <Suspense fallback={<p>Carregando dados…</p>}>
        <Conferencia />
      </Suspense>
    </main>
  );
}
