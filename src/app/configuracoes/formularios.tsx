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

export function FormularioPrazos({ x }: { x: number }) {
  const [estado, enviar, salvando] = useActionState(acaoSalvarPrazos, INICIAL);
  const [valorX, setValorX] = useState(String(x));
  return (
    <form onSubmit={enviarSemLimpar(enviar)} className="formulario" noValidate>
      <div className="campo">
        <label htmlFor="x">Dias depois do vencimento até o contrato ficar Inadimplente</label>
        <input id="x" name="x" inputMode="numeric" value={valorX} onChange={(e) => setValorX(e.target.value)} />
        <p className="dica-campo">
          Com 1, a conta que vence sem pagamento deixa o contrato Inadimplente no dia seguinte. Vazio volta para 1.
        </p>
      </div>
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
      {estado.ok ? <p className="sucesso">Prazo salvo.</p> : null}
      <div className="acoes">
        <button type="submit" className="botao" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar prazo"}
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
        </div>
      ) : null}
    </form>
  );
}
