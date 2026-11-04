"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { acaoTrocarSenha, entrar, type EstadoAcesso } from "./acoes";

const INICIAL: EstadoAcesso = {};

function enviarSemLimpar(acao: (dados: FormData) => void) {
  return (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  };
}

export function FormularioEntrar() {
  const [estado, enviar, enviando] = useActionState(entrar, INICIAL);
  return (
    <form onSubmit={enviarSemLimpar(enviar)} className="formulario" noValidate>
      <div className="campo">
        <label htmlFor="login">Usuário</label>
        <input id="login" name="login" autoComplete="username" autoCapitalize="none" />
      </div>
      <div className="campo">
        <label htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" />
      </div>
      {estado.erro ? (
        <p className="erro-campo" role="alert">
          {estado.erro}
        </p>
      ) : null}
      <div className="acoes">
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </form>
  );
}

export function FormularioTrocarSenha() {
  const [estado, enviar, enviando] = useActionState(acaoTrocarSenha, INICIAL);
  return (
    <form onSubmit={enviarSemLimpar(enviar)} className="formulario" noValidate>
      <div className="campo">
        <label htmlFor="atual">Senha atual</label>
        <input id="atual" name="atual" type="password" autoComplete="current-password" />
      </div>
      <div className="campo">
        <label htmlFor="nova">Nova senha</label>
        <input id="nova" name="nova" type="password" autoComplete="new-password" />
        <p className="dica-campo">No mínimo 8 caracteres, com letras e números.</p>
      </div>
      <div className="campo">
        <label htmlFor="confirmacao">Repita a nova senha</label>
        <input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" />
      </div>
      {estado.erro ? (
        <p className="erro-campo" role="alert">
          {estado.erro}
        </p>
      ) : null}
      <div className="acoes">
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? "Salvando…" : "Trocar senha"}
        </button>
      </div>
    </form>
  );
}
