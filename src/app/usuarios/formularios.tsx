"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { mascararCpf } from "@/regras/formatacao";
import { NOME_PERFIL, PERFIS, type Perfil } from "@/regras/permissoes";
import {
  acaoAlterarPerfil,
  acaoAlterarSituacao,
  acaoCriarUsuario,
  acaoRedefinirSenha,
  type EstadoNovoUsuario,
  type EstadoUsuario,
} from "./acoes";

const INICIAL: EstadoUsuario = {};
const INICIAL_NOVO: EstadoNovoUsuario = { erros: {} };

function enviarSemLimpar(acao: (dados: FormData) => void) {
  return (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  };
}

function SenhaTemporaria({ login, senha }: { login?: string; senha: string }) {
  return (
    <div className="cartao-aviso">
      <p>
        {login ? (
          <>
            Usuário <strong>{login}</strong> pronto.{" "}
          </>
        ) : null}
        Senha temporária, que aparece só agora:
      </p>
      <code className="senha-temporaria">{senha}</code>
      <p className="dica-campo">A pessoa será obrigada a trocá-la no primeiro acesso.</p>
    </div>
  );
}

export function NovoUsuario() {
  const [estado, enviar, salvando] = useActionState(acaoCriarUsuario, INICIAL_NOVO);
  const { erros } = estado;
  const erro = (mensagem?: string) => (mensagem ? <p className="erro-campo">{mensagem}</p> : null);
  return (
    <details className="acao-recolhida">
      <summary>Novo usuário</summary>
      <form onSubmit={enviarSemLimpar(enviar)} className="formulario formulario-usuario" noValidate>
        {estado.senhaTemporaria ? <SenhaTemporaria login={estado.login} senha={estado.senhaTemporaria} /> : null}
        {erro(erros.geral)}
        <div className="campo">
          <label htmlFor="nome">Nome completo</label>
          <input id="nome" name="nome" autoComplete="off" />
          {erro(erros.nome)}
        </div>
        <div className="campo">
          <label htmlFor="cpf">CPF</label>
          <input
            id="cpf"
            name="cpf"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            onChange={(e) => {
              e.target.value = mascararCpf(e.target.value);
            }}
          />
          {erro(erros.cpf)}
        </div>
        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="off" />
          {erro(erros.email)}
        </div>
        <div className="campo">
          <label htmlFor="login">Login</label>
          <input id="login" name="login" autoComplete="off" autoCapitalize="none" />
          {erro(erros.login)}
        </div>
        <div className="campo">
          <label htmlFor="perfil">Perfil</label>
          <select id="perfil" name="perfil" defaultValue="">
            <option value="">Escolha…</option>
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {NOME_PERFIL[p]}
              </option>
            ))}
          </select>
          {erro(erros.perfil)}
        </div>
        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando}>
            {salvando ? "Criando…" : "Criar usuário"}
          </button>
        </div>
      </form>
    </details>
  );
}

export function AcoesUsuario({
  usuarioId,
  perfil,
  ativo,
}: {
  usuarioId: string;
  perfil: Perfil;
  ativo: boolean;
}) {
  const [estadoPerfil, enviarPerfil, salvandoPerfil] = useActionState(acaoAlterarPerfil, INICIAL);
  const [estadoAtivo, enviarAtivo, salvandoAtivo] = useActionState(acaoAlterarSituacao, INICIAL);
  const [estadoSenha, enviarSenha, salvandoSenha] = useActionState(acaoRedefinirSenha, INICIAL);
  const erro = estadoPerfil.erro ?? estadoAtivo.erro ?? estadoSenha.erro;
  return (
    <details className="acao-recolhida">
      <summary>Alterar</summary>
      <div className="formulario-curto">
        <form onSubmit={enviarSemLimpar(enviarPerfil)} className="linha-acao">
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <label htmlFor={`perfil-${usuarioId}`}>Perfil</label>
          <select id={`perfil-${usuarioId}`} name="perfil" defaultValue={perfil} key={perfil}>
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {NOME_PERFIL[p]}
              </option>
            ))}
          </select>
          <button type="submit" className="botao botao-secundario" disabled={salvandoPerfil}>
            Salvar perfil
          </button>
        </form>
        <div className="acoes">
          <form onSubmit={enviarSemLimpar(enviarAtivo)}>
            <input type="hidden" name="usuarioId" value={usuarioId} />
            <input type="hidden" name="ativo" value={ativo ? "nao" : "sim"} />
            <button type="submit" className="botao botao-secundario" disabled={salvandoAtivo}>
              {ativo ? "Desativar" : "Reativar"}
            </button>
          </form>
          <form onSubmit={enviarSemLimpar(enviarSenha)}>
            <input type="hidden" name="usuarioId" value={usuarioId} />
            <button type="submit" className="botao botao-secundario" disabled={salvandoSenha}>
              Gerar senha temporária
            </button>
          </form>
        </div>
        {erro ? <p className="erro-campo">{erro}</p> : null}
        {estadoSenha.senhaTemporaria ? <SenhaTemporaria senha={estadoSenha.senhaTemporaria} /> : null}
      </div>
    </details>
  );
}
