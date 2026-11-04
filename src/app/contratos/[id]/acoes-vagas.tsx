"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import {
  acaoDecidirExcecao,
  acaoPedirExcecao,
  acaoRemoverDependente,
  type EstadoAcao,
} from "@/app/contratos/dependentes-acoes";

const INICIAL: EstadoAcao = {};

/** Envia sem a limpeza automática do formulário, para não perder o que foi digitado quando há erro. */
export function useEnvio(acao: (dados: FormData) => void) {
  return (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const dados = new FormData(formulario, (evento.nativeEvent as SubmitEvent).submitter);
    startTransition(() => acao(dados));
  };
}

export function RemoverDependente({
  contratoId,
  vidaId,
  nome,
}: {
  contratoId: string;
  vidaId: string;
  nome: string;
}) {
  const [estado, acao, salvando] = useActionState(acaoRemoverDependente, INICIAL);
  const aoEnviar = useEnvio(acao);
  return (
    <details className="acao-recolhida">
      <summary>Remover</summary>
      <form onSubmit={aoEnviar} className="formulario-curto" noValidate>
        <input type="hidden" name="contratoId" value={contratoId} />
        <input type="hidden" name="vidaId" value={vidaId} />
        <label htmlFor={`motivo-${vidaId}`}>Motivo da remoção de {nome}</label>
        <input id={`motivo-${vidaId}`} name="motivo" autoComplete="off" />
        {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
        <p className="dica-campo">
          A saída é imediata. Quem ocupa uma das vagas incluídas deixa a vaga bloqueada por 90 dias.
        </p>
        <button type="submit" className="botao botao-secundario" disabled={salvando}>
          {salvando ? "Removendo…" : "Confirmar remoção"}
        </button>
      </form>
    </details>
  );
}

export function PedirExcecao({ contratoId }: { contratoId: string }) {
  const [estado, acao, salvando] = useActionState(acaoPedirExcecao, INICIAL);
  const aoEnviar = useEnvio(acao);
  if (estado.ok) return <p className="sucesso">Pedido de exceção registrado. Aguardando decisão.</p>;
  return (
    <details className="acao-recolhida">
      <summary>Pedir exceção</summary>
      <form onSubmit={aoEnviar} className="formulario-curto" noValidate>
        <input type="hidden" name="contratoId" value={contratoId} />
        <label htmlFor="tipo-excecao">Motivo</label>
        <select id="tipo-excecao" name="tipo" defaultValue="">
          <option value="">Escolha…</option>
          <option value="nascimento">Nascimento</option>
          <option value="obito">Óbito</option>
          <option value="divorcio">Divórcio</option>
        </select>
        <label htmlFor="descricao-excecao">Detalhes (opcional)</label>
        <input id="descricao-excecao" name="descricao" autoComplete="off" />
        {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
        <button type="submit" className="botao botao-secundario" disabled={salvando}>
          {salvando ? "Enviando…" : "Enviar pedido"}
        </button>
      </form>
    </details>
  );
}

export function DecidirExcecao({ contratoId, excecaoId }: { contratoId: string; excecaoId: string }) {
  const [estado, acao, salvando] = useActionState(acaoDecidirExcecao, INICIAL);
  const aoEnviar = useEnvio(acao);
  return (
    <form onSubmit={aoEnviar} className="formulario-curto" noValidate>
      <input type="hidden" name="contratoId" value={contratoId} />
      <input type="hidden" name="excecaoId" value={excecaoId} />
      <label htmlFor={`decisao-${excecaoId}`}>Motivo da decisão</label>
      <input id={`decisao-${excecaoId}`} name="motivo" autoComplete="off" />
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
      <div className="acoes">
        <button type="submit" name="decisao" value="aprovar" className="botao" disabled={salvando}>
          Aprovar
        </button>
        <button
          type="submit"
          name="decisao"
          value="recusar"
          className="botao botao-secundario"
          disabled={salvando}
        >
          Recusar
        </button>
      </div>
    </form>
  );
}
