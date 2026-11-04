"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { salvarContrato, type EstadoContrato } from "@/app/contratos/acoes";
import type { AvaliacaoPreco, ErrosContrato, OpcoesContrato } from "@/regras/contratos";
import { formatarCentavos } from "@/regras/formatacao";
import { NOME_COMPOSICAO, NOME_FORMA_PAGAMENTO, NOME_ORIGEM } from "@/regras/nomes";

const ESTADO_INICIAL: EstadoContrato = { erros: {} };
const FORMAS = ["cartao_recorrente", "pix_automatico", "carne"];

type Propriedades = {
  titularId: string;
  opcoes: OpcoesContrato;
  origens: readonly string[];
  vendedores: { id: string; nome: string }[];
};

function Erro({ mensagem }: { mensagem?: string }) {
  return mensagem ? <p className="erro-campo">{mensagem}</p> : null;
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={destaque ? "linha-resumo linha-destaque" : "linha-resumo"}>
      <span>{rotulo}</span>
      <span>{valor}</span>
    </div>
  );
}

export function FormularioContrato({ titularId, opcoes, origens, vendedores }: Propriedades) {
  const [estado, acao, salvando] = useActionState(salvarContrato, ESTADO_INICIAL);
  const [planoId, setPlanoId] = useState("");
  const [composicao, setComposicao] = useState("familiar");
  const [funeralMarcado, setFuneralMarcado] = useState(false);
  const [forma, setForma] = useState("");
  const [dia, setDia] = useState("");
  const [origemTipo, setOrigemTipo] = useState("");
  const [origemDetalhe, setOrigemDetalhe] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [cupom, setCupom] = useState("");
  const [avaliacao, setAvaliacao] = useState<AvaliacaoPreco | null>(null);

  const plano = opcoes.planos.find((p) => p.id === planoId);
  const funeralDisponivel = Boolean(plano?.aceitaFuneral) && opcoes.funeralPermitidoPelaIdade;
  const funeral = funeralMarcado && funeralDisponivel;
  const formaValida = plano?.formas.includes(forma as never) ? forma : "";

  useEffect(() => {
    if (!planoId) return;
    const controle = new AbortController();
    // Espera um instante para não consultar a cada letra do cupom.
    const espera = setTimeout(async () => {
      try {
        const resposta = await fetch("/api/contratos/simular", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titularId, planoId, composicao, funeral, cupom }),
          signal: controle.signal,
        });
        if (resposta.ok) setAvaliacao(await resposta.json());
      } catch {
        // Consulta substituída por outra mais nova: nada a fazer. Sem resposta, some o resumo antigo.
        if (!controle.signal.aborted) setAvaliacao(null);
      }
    }, 250);
    return () => {
      controle.abort();
      clearTimeout(espera);
    };
  }, [titularId, planoId, composicao, funeral, cupom]);

  // Evita a limpeza automática do formulário, que apagaria as escolhas quando há erro.
  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  }

  const erros: ErrosContrato = estado.erros;
  const erroCupom = cupom.trim() ? avaliacao?.erros.cupom : erros.cupom;
  const calculo = planoId ? avaliacao?.calculo : null;
  const cupomAplicado = planoId ? avaliacao?.cupom : null;

  function motivoFuneralIndisponivel() {
    if (!plano) return "Escolha um plano para ver se o funeral está disponível.";
    if (!plano.aceitaFuneral) return "Este plano não aceita o adicional de funeral.";
    if (!opcoes.funeralPermitidoPelaIdade) {
      return `O funeral não é aceito em nova contratação para vidas acima de 80 anos. O titular tem ${opcoes.idadeTitular} anos, e o plano pode ser contratado sem funeral.`;
    }
    return null;
  }
  const motivoFuneral = motivoFuneralIndisponivel();
  const algumaFormaRecusada = Boolean(plano) && FORMAS.some((f) => !plano?.formas.includes(f as never));

  return (
    <form onSubmit={aoEnviar} className="formulario" noValidate>
      <input type="hidden" name="titularId" value={titularId} />

      {erros.titular ? (
        <div className="cartao-aviso">
          <p>{erros.titular}</p>
          {estado.cobertura ? (
            <Link href={`/contratos/${estado.cobertura.contratoId}`} className="botao botao-secundario">
              Abrir contrato
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="campo">
        <label htmlFor="planoId">Plano</label>
        <select id="planoId" name="planoId" value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
          <option value="">Escolha…</option>
          {opcoes.planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <Erro mensagem={erros.planoId} />
      </div>

      <div className="campo">
        <label htmlFor="composicao">Composição</label>
        <select
          id="composicao"
          name="composicao"
          value={composicao}
          onChange={(e) => setComposicao(e.target.value)}
        >
          <option value="familiar">Familiar (titular + até 3 dependentes)</option>
          <option value="individual">Individual (não divulgada ao público)</option>
        </select>
        <Erro mensagem={erros.composicao} />
        {plano ? (
          <p className="dica-campo">
            {plano.precos
              .map((p) => `${NOME_COMPOSICAO[p.composicao]}: ${formatarCentavos(p.valorCentavos)}`)
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="campo">
        <label className="opcao">
          <input
            type="checkbox"
            name="funeral"
            value="sim"
            checked={funeral}
            disabled={!funeralDisponivel}
            onChange={(e) => setFuneralMarcado(e.target.checked)}
          />
          Adicional de funeral
        </label>
        {motivoFuneral ? <p className="dica-campo">{motivoFuneral}</p> : null}
        <Erro mensagem={erros.funeral} />
      </div>

      <div className="campo">
        <label htmlFor="formaPagamento">Forma de pagamento</label>
        <select
          id="formaPagamento"
          name="formaPagamento"
          value={formaValida}
          onChange={(e) => setForma(e.target.value)}
        >
          <option value="">Escolha…</option>
          {FORMAS.map((f) => {
            const aceita = !plano || plano.formas.includes(f as never);
            return (
              <option key={f} value={f} disabled={!aceita}>
                {NOME_FORMA_PAGAMENTO[f]}
                {aceita ? "" : " (não aceito neste plano)"}
              </option>
            );
          })}
        </select>
        {algumaFormaRecusada ? (
          <p className="dica-campo">As opções desabilitadas não são aceitas por este plano.</p>
        ) : null}
        <Erro mensagem={erros.formaPagamento} />
      </div>

      <div className="campo">
        <label htmlFor="diaVencimento">Dia de vencimento</label>
        <select
          id="diaVencimento"
          name="diaVencimento"
          value={dia}
          onChange={(e) => setDia(e.target.value)}
        >
          <option value="">Escolha…</option>
          {opcoes.dias.map((d) => (
            <option key={d} value={d}>
              Dia {d}
            </option>
          ))}
        </select>
        <Erro mensagem={erros.diaVencimento} />
      </div>

      <div className="campo">
        <label htmlFor="origemTipo">Origem</label>
        <select
          id="origemTipo"
          name="origemTipo"
          value={origemTipo}
          onChange={(e) => setOrigemTipo(e.target.value)}
        >
          <option value="">Escolha…</option>
          {origens.map((o) => (
            <option key={o} value={o}>
              {NOME_ORIGEM[o]}
            </option>
          ))}
        </select>
        <Erro mensagem={erros.origemTipo} />
      </div>

      {origemTipo === "vendedor" ? (
        <div className="campo">
          <label htmlFor="vendedorId">Vendedor</label>
          <select
            id="vendedorId"
            name="vendedorId"
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
          >
            <option value="">Escolha…</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
          <p className="dica-campo">O contrato entra na carteira deste vendedor.</p>
          <Erro mensagem={erros.vendedorId} />
        </div>
      ) : null}

      <div className="campo">
        <label htmlFor="origemDetalhe">Detalhe da origem (opcional)</label>
        <input
          id="origemDetalhe"
          name="origemDetalhe"
          value={origemDetalhe}
          placeholder="Ex.: nome do vendedor ou da campanha"
          autoComplete="off"
          onChange={(e) => setOrigemDetalhe(e.target.value)}
        />
      </div>

      <div className="campo">
        <label htmlFor="cupom">Cupom (opcional)</label>
        <input
          id="cupom"
          name="cupom"
          value={cupom}
          autoComplete="off"
          onChange={(e) => setCupom(e.target.value.toUpperCase())}
        />
        <Erro mensagem={erroCupom} />
      </div>

      <div className="resumo" aria-live="polite">
        <h2>Resumo</h2>
        {calculo ? (
          <>
            <Linha rotulo="Plano" valor={formatarCentavos(calculo.valorPlanoCentavos)} />
            {funeral ? (
              <Linha rotulo="Funeral" valor={formatarCentavos(calculo.valorFuneralCentavos)} />
            ) : null}
            <Linha rotulo="Mensalidade" valor={formatarCentavos(calculo.mensalidadeCentavos)} />
            {cupomAplicado ? (
              <>
                <Linha
                  rotulo={`Cupom ${cupomAplicado.codigo} (−${cupomAplicado.percentual}%${cupomAplicado.recorrente ? ", todas as mensalidades" : ", só na primeira"})`}
                  valor={`− ${formatarCentavos(calculo.mensalidadeCentavos - calculo.valorPrimeiraMensalidadeCentavos)}`}
                />
                {cupomAplicado.recorrente ? null : (
                  <Linha
                    rotulo="Primeira mensalidade"
                    valor={formatarCentavos(calculo.valorPrimeiraMensalidadeCentavos)}
                  />
                )}
              </>
            ) : null}
            <Linha
              rotulo={cupomAplicado && !cupomAplicado.recorrente ? "Mensalidades seguintes" : "Valor cobrado"}
              valor={formatarCentavos(calculo.valorMensalCentavos)}
              destaque
            />
            <p className="dica-campo">O contrato nasce como Pendente.</p>
          </>
        ) : (
          <p className="detalhe">Escolha um plano para ver o valor.</p>
        )}
      </div>

      <div className="acoes">
        <button type="submit" className="botao" disabled={salvando}>
          {salvando ? "Salvando…" : "Criar contrato"}
        </button>
        <Link href={`/pessoas/${titularId}`} className="botao botao-secundario">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
