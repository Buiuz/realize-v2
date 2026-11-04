"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import {
  acaoRodarRotina,
  acaoSalvarPrazos,
  type EstadoRotina,
  type EstadoStatus,
} from "@/app/contratos/status-acoes";
import { formatarData } from "@/regras/formatacao";
import { NOME_STATUS } from "@/regras/nomes";

const INICIAL: EstadoStatus = {};
const INICIAL_ROTINA: EstadoRotina = {};

function enviarSemLimpar(acao: (dados: FormData) => void) {
  return (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  };
}

export function FormularioPrazos({ x, y }: { x: number | null; y: number | null }) {
  const [estado, enviar, salvando] = useActionState(acaoSalvarPrazos, INICIAL);
  const [valorX, setValorX] = useState(x === null ? "" : String(x));
  const [valorY, setValorY] = useState(y === null ? "" : String(y));
  return (
    <form onSubmit={enviarSemLimpar(enviar)} className="formulario" noValidate>
      <div className="campos-lado-a-lado">
        <div className="campo">
          <label htmlFor="x">Prazo X: de fatura vencida até Inadimplente (dias)</label>
          <input
            id="x"
            name="x"
            inputMode="numeric"
            placeholder="Ainda não definido"
            value={valorX}
            onChange={(e) => setValorX(e.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="y">Prazo Y: de Inadimplente até Bloqueado (dias)</label>
          <input
            id="y"
            name="y"
            inputMode="numeric"
            placeholder="Ainda não definido"
            value={valorY}
            onChange={(e) => setValorY(e.target.value)}
          />
        </div>
      </div>
      <p className="dica-campo">
        Deixe vazio enquanto o prazo não estiver definido: a rotina não aplica essa mudança.
      </p>
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
      {estado.ok ? <p className="sucesso">Prazos salvos.</p> : null}
      <div className="acoes">
        <button type="submit" className="botao" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar prazos"}
        </button>
      </div>
    </form>
  );
}

export function FormularioRotina({ hoje }: { hoje: string }) {
  const [estado, enviar, rodando] = useActionState(acaoRodarRotina, INICIAL_ROTINA);
  const [data, setData] = useState(hoje);
  const { relatorio } = estado;
  return (
    <form onSubmit={enviarSemLimpar(enviar)} className="formulario" noValidate>
      <div className="campo">
        <label htmlFor="data">Rodar como se hoje fosse</label>
        <input id="data" name="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <p className="dica-campo">
          Uma data futura serve para simular a passagem do tempo. As mudanças ficam gravadas de verdade no
          banco de teste.
        </p>
      </div>
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
      <div className="acoes">
        <button type="submit" className="botao" disabled={rodando}>
          {rodando ? "Rodando…" : "Rodar rotina diária"}
        </button>
      </div>

      {relatorio ? (
        <div className="resumo" aria-live="polite">
          <h2>Resultado de {formatarData(relatorio.data)}</h2>
          <p className="dica-campo">Faturas que venceram: {relatorio.faturasVencidas}</p>
          {relatorio.mudancas.length === 0 ? (
            <p className="dica-campo">Nenhum contrato mudou de status.</p>
          ) : (
            relatorio.mudancas.map((m) => (
              <p key={`${m.numero}-${m.para}`} className="dica-campo">
                Contrato nº {m.numero}: {NOME_STATUS[m.de]} → {NOME_STATUS[m.para]}. {m.motivo}.
              </p>
            ))
          )}
          {relatorio.valoresAtualizados.map((numero) => (
            <p key={numero} className="dica-campo">
              Contrato nº {numero}: vaga liberada, e o valor foi atualizado.
            </p>
          ))}
          {relatorio.avisos.map((aviso) => (
            <p key={aviso} className="erro-campo">
              {aviso}
            </p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
