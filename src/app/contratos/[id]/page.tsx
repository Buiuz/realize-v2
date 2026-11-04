import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { obterBanco } from "@/banco";
import {
  contrato,
  cupom,
  historicoStatus,
  origem,
  pessoa,
  plano,
  versaoContrato,
  vida,
} from "@/banco/esquema";
import { acaoAjustarFaixa, acaoAtualizarValor } from "@/app/contratos/dependentes-acoes";
import { ehIdValido } from "@/regras/contratos";
import { carregarPainel } from "@/regras/dependentes";
import { formatarCentavos, formatarData, formatarMomento } from "@/regras/formatacao";
import { podeVerContrato } from "@/regras/acesso";
import { tem, type Permissao } from "@/regras/permissoes";
import { carregarPainelStatus, PERMISSAO_DA_ACAO } from "@/regras/status";
import { exigirPagina } from "@/servidor/sessao";
import { SemPermissao } from "../../sem-permissao";
import { hojeEmSaoPaulo } from "@/regras/titular";
import {
  NOME_COMPOSICAO,
  NOME_FORMA_PAGAMENTO,
  NOME_ORIGEM,
  NOME_STATUS,
} from "@/regras/nomes";

import { AcaoStatus, NovaFatura, PagarFatura, RegistrarAdesao } from "./acoes-status";
import { DecidirExcecao, PedirExcecao, RemoverDependente } from "./acoes-vagas";

export const metadata: Metadata = { title: "Contrato — Realize V2" };

const NOME_EXCECAO: Record<string, string> = {
  nascimento: "Nascimento",
  obito: "Óbito",
  divorcio: "Divórcio",
};

const NOME_STATUS_FATURA: Record<string, string> = {
  a_vencer: "A vencer",
  vencida: "Vencida",
  paga: "Paga",
  cancelada: "Cancelada",
};

const NOME_STATUS_EXCECAO: Record<string, string> = {
  pendente: "Aguardando decisão",
  aprovada: "Aprovada",
  recusada: "Recusada",
};

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="dado">
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={destaque ? "linha-resumo linha-destaque" : "linha-resumo"}>
      <span>{rotulo}</span>
      <span>{valor}</span>
    </div>
  );
}

async function Ficha({
  parametros,
  busca,
}: {
  parametros: PageProps<"/contratos/[id]">["params"];
  busca: PageProps<"/contratos/[id]">["searchParams"];
}) {
  await connection();
  const atual = await exigirPagina("ver_cadastros", "contrato");
  if (!atual) return <SemPermissao />;
  const pode = (permissao: Permissao) => tem(atual.perfil, permissao);
  const { id } = await parametros;
  const { novo, dependente } = await busca;
  if (!ehIdValido(id)) notFound();

  const db = obterBanco();
  // Fora da carteira do vendedor, é como se o registro não existisse (PRD 1.2).
  if (!(await podeVerContrato(db, atual, id))) notFound();
  const [dados] = await db
    .select({
      numero: contrato.numero,
      status: contrato.status,
      dataAdesao: contrato.dataAdesao,
      titularId: contrato.titularId,
      titular: pessoa.nome,
      origemTipo: origem.tipo,
      origemDetalhe: origem.detalhe,
    })
    .from(contrato)
    .innerJoin(origem, eq(origem.id, contrato.origemId))
    .leftJoin(pessoa, eq(pessoa.id, contrato.titularId))
    .where(eq(contrato.id, id))
    .limit(1);
  if (!dados) notFound();

  const [versao] = await db
    .select({
      numero: versaoContrato.numero,
      plano: plano.nome,
      composicao: versaoContrato.composicao,
      formaPagamento: versaoContrato.formaPagamento,
      diaVencimento: versaoContrato.diaVencimento,
      valorPlano: versaoContrato.valorPlanoCentavos,
      valorFuneral: versaoContrato.valorFuneralCentavos,
      valorExtra: versaoContrato.valorDependenteExtraCentavos,
      cupomCodigo: cupom.codigo,
      cupomPercentual: versaoContrato.cupomPercentual,
      cupomRecorrente: versaoContrato.cupomRecorrente,
      valorPrimeira: versaoContrato.valorPrimeiraMensalidadeCentavos,
      valorMensal: versaoContrato.valorMensalCentavos,
      vigenciaInicio: versaoContrato.vigenciaInicio,
    })
    .from(versaoContrato)
    .innerJoin(plano, eq(plano.id, versaoContrato.planoId))
    .leftJoin(cupom, eq(cupom.id, versaoContrato.cupomId))
    .where(eq(versaoContrato.contratoId, id))
    .orderBy(desc(versaoContrato.numero))
    .limit(1);

  const vidas = await db
    .select({
      id: vida.id,
      pessoaId: pessoa.id,
      nome: pessoa.nome,
      papel: vida.papel,
      parentesco: vida.parentesco,
      entrada: vida.dataEntrada,
      saida: vida.dataSaida,
      carencia: vida.carenciaFuneralInicio,
      valorFuneral: vida.valorFuneralCentavos,
      valorExtra: vida.valorExtraCentavos,
      motivoSaida: vida.motivoSaida,
      bloqueioAte: vida.vagaBloqueadaAte,
    })
    .from(vida)
    .innerJoin(pessoa, eq(pessoa.id, vida.pessoaId))
    .where(eq(vida.contratoId, id))
    .orderBy(asc(vida.papel), asc(vida.dataEntrada), asc(pessoa.nome));

  const versoes = await db
    .select()
    .from(versaoContrato)
    .where(eq(versaoContrato.contratoId, id))
    .orderBy(asc(versaoContrato.numero));

  const painel = await carregarPainel(db, id);
  const painelStatus = await carregarPainelStatus(db, id);
  const adesaoVisivel =
    painelStatus?.status === "pendente" && (pode("registrar_pagamento_adesao") || pode("registrar_assinatura"));
  const acoesPermitidas = (painelStatus?.acoes ?? []).filter((acao) => pode(PERMISSAO_DA_ACAO[acao]));
  const ativos = vidas.filter((v) => v.papel === "dependente" && !v.saida).length;

  const historico = await db
    .select()
    .from(historicoStatus)
    .where(eq(historicoStatus.contratoId, id))
    .orderBy(asc(historicoStatus.data));

  const mensalidade = versao ? versao.valorPlano + versao.valorFuneral + versao.valorExtra : 0;

  return (
    <>
      <p className="voltar">
        {dados.titularId ? (
          <Link href={`/pessoas/${dados.titularId}`}>← Voltar para {dados.titular}</Link>
        ) : (
          <Link href="/pessoas">← Voltar para pessoas</Link>
        )}
      </p>
      <div className="titulo-contrato">
        <h1>Contrato nº {dados.numero}</h1>
        <span className={`selo-status selo-${dados.status}`}>{NOME_STATUS[dados.status]}</span>
      </div>
      {novo ? <p className="sucesso">Contrato criado com status Pendente.</p> : null}
      {dependente ? <p className="sucesso">Dependente incluído.</p> : null}

      {painel && painel.valorEsperadoCentavos !== painel.valorAtualCentavos ? (
        <div className="cartao-aviso alerta-contrato">
          <p>
            Uma vaga foi liberada e um dependente extra deixa de pagar. O valor cobrado passa de{" "}
            {formatarCentavos(painel.valorAtualCentavos)} para{" "}
            {formatarCentavos(painel.valorEsperadoCentavos)}.
          </p>
          {pode("alterar_valor") ? (
            <form action={acaoAtualizarValor.bind(null, id)}>
              <button type="submit" className="botao botao-secundario">
                Atualizar valor
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {painel?.alertasIdade.map((a) => (
        <div key={`${a.vidaId}-${a.tipo}`} className="cartao-aviso alerta-contrato">
          <p>
            {a.nome} tem {a.idade} anos e mudou de faixa
            {a.tipo === "funeral" ? " do funeral" : " do dependente extra"}: de{" "}
            {formatarCentavos(a.valorAtualCentavos)} para {formatarCentavos(a.valorNovoCentavos)}. O valor
            não muda sozinho: fale com o cliente antes de ajustar.
          </p>
          {pode("alterar_valor") ? (
            <form action={acaoAjustarFaixa.bind(null, id, a.vidaId)}>
              <button type="submit" className="botao botao-secundario">
                Ajustar valor
              </button>
            </form>
          ) : null}
        </div>
      ))}

      <section>
        <h2>Dados do contrato</h2>
        <dl className="dados">
          <Dado rotulo="Titular" valor={dados.titular ?? "—"} />
          <Dado rotulo="Data de adesão" valor={formatarData(dados.dataAdesao)} />
          <Dado
            rotulo="Origem"
            valor={`${NOME_ORIGEM[dados.origemTipo]}${dados.origemDetalhe ? ` — ${dados.origemDetalhe}` : ""}`}
          />
        </dl>
      </section>

      {painelStatus && (adesaoVisivel || acoesPermitidas.length > 0) ? (
        <section>
          <h2>Ações do contrato</h2>
          {adesaoVisivel ? (
            <>
              <p className="detalhe">
                O contrato fica Ativo sozinho quando o pagamento e a assinatura estiverem registrados. No
                protótipo, os dois são simulados.
              </p>
              {painelStatus.faltas.length > 0 ? (
                <p className="aviso">Falta para ativar: {painelStatus.faltas.join(", ")}.</p>
              ) : null}
              <div className="acoes acoes-adesao">
                {painelStatus.pagaEm || !pode("registrar_pagamento_adesao") ? null : (
                  <RegistrarAdesao contratoId={id} etapa="pagamento" rotulo="Registrar pagamento" />
                )}
                {painelStatus.assinadoEm || !pode("registrar_assinatura") ? null : (
                  <RegistrarAdesao contratoId={id} etapa="assinatura" rotulo="Registrar assinatura" />
                )}
              </div>
            </>
          ) : null}
          <div className="lista-acoes">
            {acoesPermitidas.map((acao) => (
              <AcaoStatus key={acao} contratoId={id} acao={acao} />
            ))}
          </div>
        </section>
      ) : null}

      {versao ? (
        <section>
          <h2>Plano e valores (versão {versao.numero})</h2>
          <dl className="dados">
            <Dado rotulo="Plano" valor={`${versao.plano} (${NOME_COMPOSICAO[versao.composicao]})`} />
            <Dado rotulo="Forma de pagamento" valor={NOME_FORMA_PAGAMENTO[versao.formaPagamento]} />
            <Dado rotulo="Vencimento" valor={`Dia ${versao.diaVencimento}`} />
            <Dado rotulo="Vigência desde" valor={formatarData(versao.vigenciaInicio)} />
          </dl>
          <div className="resumo">
            <Linha rotulo="Plano" valor={formatarCentavos(versao.valorPlano)} />
            {versao.valorFuneral > 0 ? (
              <Linha rotulo="Funeral" valor={formatarCentavos(versao.valorFuneral)} />
            ) : null}
            {versao.valorExtra > 0 ? (
              <Linha rotulo="Dependentes extras" valor={formatarCentavos(versao.valorExtra)} />
            ) : null}
            <Linha rotulo="Mensalidade" valor={formatarCentavos(mensalidade)} />
            {versao.cupomPercentual !== null ? (
              <Linha
                rotulo={`Cupom ${versao.cupomCodigo} (−${versao.cupomPercentual}%${versao.cupomRecorrente ? ", todas as mensalidades" : ", só na primeira"})`}
                valor={`− ${formatarCentavos(mensalidade - versao.valorPrimeira)}`}
              />
            ) : null}
            {versao.valorPrimeira !== versao.valorMensal ? (
              <Linha rotulo="Primeira mensalidade" valor={formatarCentavos(versao.valorPrimeira)} />
            ) : null}
            <Linha
              rotulo={versao.valorPrimeira !== versao.valorMensal ? "Mensalidades seguintes" : "Valor cobrado"}
              valor={formatarCentavos(versao.valorMensal)}
              destaque
            />
          </div>
        </section>
      ) : null}

      <section>
        <h2>Vidas</h2>
        {painel ? (
          <p className="detalhe">
            {painel.aceitaDependentes
              ? `Dependentes ativos: ${ativos} · Vagas incluídas: ${painel.incluidos} · Pagando como extra: ${painel.extras.length} · Vagas bloqueadas: ${painel.bloqueios.length}`
              : "Contrato individual: não aceita dependentes."}
          </p>
        ) : null}
        <ul className="lista-vidas">
          {vidas.map((v) => (
            <li key={v.id}>
              <div>
                <Link href={`/pessoas/${v.pessoaId}`}>
                  <strong>{v.nome}</strong>
                </Link>
                <span>
                  {v.papel === "titular" ? "Titular" : `Dependente (${v.parentesco})`}
                  {painel?.extras.includes(v.id) ? ` · Extra: ${formatarCentavos(v.valorExtra)}` : ""}
                </span>
                <span>
                  Entrada: {formatarData(v.entrada)}
                  {v.saida ? ` · Saída: ${formatarData(v.saida)}` : ""}
                </span>
                <span>
                  {v.carencia
                    ? `Funeral: ${formatarCentavos(v.valorFuneral)} · Carência desde ${formatarData(v.carencia)}`
                    : "Sem funeral"}
                </span>
                {v.saida && v.motivoSaida ? <span>Motivo da saída: {v.motivoSaida}</span> : null}
                {v.bloqueioAte ? <span>Vaga bloqueada até {formatarData(v.bloqueioAte)}</span> : null}
              </div>
              {v.papel === "dependente" && !v.saida && painel?.podeAlterar && pode("gerir_dependentes") ? (
                <RemoverDependente contratoId={id} vidaId={v.id} nome={v.nome} />
              ) : null}
            </li>
          ))}
        </ul>
        {painel?.aceitaDependentes && painel.podeAlterar && pode("gerir_dependentes") ? (
          <p className="acoes-secao">
            <Link href={`/contratos/${id}/dependentes/novo`} className="botao">
              Incluir dependente
            </Link>
          </p>
        ) : null}
      </section>

      {painel && (painel.bloqueios.length > 0 || painel.excecoes.length > 0) ? (
        <section>
          <h2>Exceções de vaga bloqueada</h2>
          {painel.excecoes.map((e) => (
            <div key={e.id} className="excecao">
              <p>
                <strong>{NOME_EXCECAO[e.tipo]}</strong> · Vaga de {e.nomeRemovido} ·{" "}
                {NOME_STATUS_EXCECAO[e.status]}
              </p>
              {e.descricao ? <p className="detalhe">{e.descricao}</p> : null}
              {e.status !== "pendente" ? (
                <p className="detalhe">
                  Decisão de {e.decididaPor}: {e.motivoDecisao}
                </p>
              ) : pode("liberar_excecao") ? (
                <DecidirExcecao contratoId={id} excecaoId={e.id} />
              ) : null}
            </div>
          ))}
          {pode("pedir_excecao") && painel.bloqueios.length > painel.excecoes.filter((e) => e.status === "pendente").length ? (
            <PedirExcecao contratoId={id} />
          ) : null}
        </section>
      ) : null}

      {painelStatus ? (
        <section>
          <h2>Faturas de teste</h2>
          <p className="detalhe">
            Simulação para validar os status: o módulo de cobrança está fora do protótipo.
          </p>
          {painelStatus.faturas.length > 0 ? (
            <div className="tabela">
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Situação</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {painelStatus.faturas.map((f) => (
                    <tr key={f.id}>
                      <td>{f.competencia}</td>
                      <td>{formatarData(f.vencimento)}</td>
                      <td>{formatarCentavos(f.valorCentavos)}</td>
                      <td>
                        {NOME_STATUS_FATURA[f.status]}
                        {f.motivoCancelamento ? ` (${f.motivoCancelamento})` : ""}
                      </td>
                      <td>
                        {(f.status === "a_vencer" || f.status === "vencida") && pode("baixar_fatura") ? (
                          <PagarFatura contratoId={id} faturaId={f.id} />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="detalhe">Nenhuma fatura ainda.</p>
          )}
          {!painelStatus.podeGerarFatura ? (
            <p className="detalhe">Contrato {NOME_STATUS[dados.status]} não gera faturas novas.</p>
          ) : pode("gerar_fatura_teste") ? (
            <NovaFatura contratoId={id} mesInicial={hojeEmSaoPaulo().slice(0, 7)} />
          ) : null}
        </section>
      ) : null}

      <section>
        <h2>Versões do contrato</h2>
        <div className="tabela">
          <table>
            <thead>
              <tr>
                <th>Versão</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Valor cobrado</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {versoes.map((v) => (
                <tr key={v.numero}>
                  <td>{v.numero}</td>
                  <td>{formatarData(v.vigenciaInicio)}</td>
                  <td>{v.vigenciaFim ? formatarData(v.vigenciaFim) : "Vigente"}</td>
                  <td>{formatarCentavos(v.valorMensalCentavos)}</td>
                  <td>{v.motivo}</td>
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
                <th>Data</th>
                <th>Anterior</th>
                <th>Novo</th>
                <th>Modo</th>
                <th>Autor</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.id}>
                  <td>{formatarMomento(h.data)}</td>
                  <td>{h.statusAnterior ? NOME_STATUS[h.statusAnterior] : "—"}</td>
                  <td>{NOME_STATUS[h.statusNovo]}</td>
                  <td>{h.modo === "manual" ? "Manual" : "Automático"}</td>
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

export default function PaginaContrato({ params, searchParams }: PageProps<"/contratos/[id]">) {
  return (
    <main>
      <Suspense fallback={<p>Carregando…</p>}>
        <Ficha parametros={params} busca={searchParams} />
      </Suspense>
    </main>
  );
}
