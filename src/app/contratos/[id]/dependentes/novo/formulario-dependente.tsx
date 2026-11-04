"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { salvarDependente, type EstadoDependente } from "@/app/contratos/dependentes-acoes";
import { formatarCentavos, formatarData, mascararCpf } from "@/regras/formatacao";
import { PedirExcecao } from "../../acoes-vagas";

const INICIAL: EstadoDependente = { erros: {} };

function Erro({ mensagem }: { mensagem?: string }) {
  return mensagem ? <p className="erro-campo">{mensagem}</p> : null;
}

export function FormularioDependente({
  contratoId,
  hoje,
  idadeCpf,
}: {
  contratoId: string;
  hoje: string;
  idadeCpf: number;
}) {
  const [estado, acao, salvando] = useActionState(salvarDependente, INICIAL);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [parentesco, setParentesco] = useState("");
  const { erros, previa, bloqueada } = estado;

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  }

  return (
    <>
      {bloqueada ? (
        <div className="cartao-aviso">
          <p>
            Não é possível incluir: há vaga bloqueada até <strong>{formatarData(bloqueada.liberaEm)}</strong>.
          </p>
          {bloqueada.excecaoPendente ? (
            <p>Já existe um pedido de exceção aguardando decisão, na ficha do contrato.</p>
          ) : (
            <PedirExcecao contratoId={contratoId} />
          )}
        </div>
      ) : null}

      <form onSubmit={aoEnviar} className="formulario" noValidate>
        <input type="hidden" name="contratoId" value={contratoId} />
        <input type="hidden" name="confirmacao" value={previa?.assinatura ?? ""} />
        <Erro mensagem={erros.geral} />

        <div className="campo">
          <label htmlFor="cpf">CPF</label>
          <input
            id="cpf"
            name="cpf"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => setCpf(mascararCpf(e.target.value))}
          />
          <p className="dica-campo">Obrigatório a partir de {idadeCpf} anos.</p>
          <Erro mensagem={erros.cpf} />
        </div>

        <div className="campo">
          <label htmlFor="nome">Nome completo</label>
          <input
            id="nome"
            name="nome"
            autoComplete="off"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <Erro mensagem={erros.nome} />
        </div>

        <div className="campo">
          <label htmlFor="dataNascimento">Data de nascimento</label>
          <input
            id="dataNascimento"
            name="dataNascimento"
            type="date"
            min="1900-01-01"
            max={hoje}
            value={dataNascimento}
            onChange={(e) => setDataNascimento(e.target.value)}
          />
          <Erro mensagem={erros.dataNascimento} />
        </div>

        <div className="campo">
          <label htmlFor="parentesco">Parentesco</label>
          <input
            id="parentesco"
            name="parentesco"
            autoComplete="off"
            placeholder="Ex.: Filho, Cônjuge, Mãe"
            value={parentesco}
            onChange={(e) => setParentesco(e.target.value)}
          />
          <Erro mensagem={erros.parentesco} />
        </div>

        {previa ? (
          <div className="resumo" aria-live="polite">
            <h2>Confirme a inclusão</h2>
            {previa.pessoaExistente ? (
              <p className="dica-campo">
                Este CPF já está cadastrado como <strong>{previa.pessoaExistente}</strong>. Será usado esse
                cadastro, e os nome e nascimento digitados serão ignorados.
              </p>
            ) : null}
            {previa.serExtra ? (
              <div className="linha-resumo">
                <span>Dependente extra</span>
                <span>{formatarCentavos(previa.valorExtraCentavos)}</span>
              </div>
            ) : null}
            {previa.valorFuneralCentavos > 0 ? (
              <div className="linha-resumo">
                <span>Funeral desta vida</span>
                <span>{formatarCentavos(previa.valorFuneralCentavos)}</span>
              </div>
            ) : null}
            {previa.semFuneralPorIdade ? (
              <p className="dica-campo">
                Esta vida entra sem funeral: não é aceito em nova contratação acima de 80 anos.
              </p>
            ) : null}
            <div className="linha-resumo">
              <span>Valor cobrado hoje</span>
              <span>{formatarCentavos(previa.valorAtualCentavos)}</span>
            </div>
            <div className="linha-resumo linha-destaque">
              <span>Novo valor cobrado</span>
              <span>{formatarCentavos(previa.valorNovoCentavos)}</span>
            </div>
          </div>
        ) : null}

        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando}>
            {salvando ? "Salvando…" : previa ? "Confirmar inclusão" : "Incluir dependente"}
          </button>
          <Link href={`/contratos/${contratoId}`} className="botao botao-secundario">
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
