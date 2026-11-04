"use client";

import { useActionState } from "react";
import {
  acaoCriarFatura,
  acaoManualStatus,
  acaoPagarFatura,
  acaoRegistrarAdesao,
  type EstadoStatus,
} from "@/app/contratos/status-acoes";
import type { AcaoManual } from "@/regras/status";
import { useEnvio } from "./acoes-vagas";

const INICIAL: EstadoStatus = {};

const ROTULOS: Record<AcaoManual, { titulo: string; botao: string; dica?: string }> = {
  bloquear: {
    titulo: "Bloquear contrato",
    botao: "Confirmar bloqueio",
    dica: "O cliente fica só com a área financeira, e a fatura do mês que ainda não venceu é cancelada.",
  },
  negociar: { titulo: "Registrar negociação", botao: "Voltar para Ativo" },
  solicitar_cancelamento: {
    titulo: "Registrar pedido de cancelamento",
    botao: "Registrar pedido",
    dica: "O acesso continua até o cancelamento ser efetivado. Sem decisão, ele acontece sozinho em 30 dias.",
  },
  reter: { titulo: "Cliente ficou (retenção)", botao: "Voltar para Ativo" },
  confirmar_cancelamento: {
    titulo: "Confirmar cancelamento",
    botao: "Cancelar contrato",
    dica: "É definitivo. Para voltar, o cliente precisa de um contrato novo.",
  },
};

export function AcaoStatus({ contratoId, acao }: { contratoId: string; acao: AcaoManual }) {
  const [estado, enviar, salvando] = useActionState(acaoManualStatus, INICIAL);
  const aoEnviar = useEnvio(enviar);
  const rotulo = ROTULOS[acao];
  return (
    <details className="acao-recolhida">
      <summary>{rotulo.titulo}</summary>
      <form onSubmit={aoEnviar} className="formulario-curto" noValidate>
        <input type="hidden" name="contratoId" value={contratoId} />
        <input type="hidden" name="acao" value={acao} />
        <label htmlFor={`motivo-${acao}`}>Motivo</label>
        <input id={`motivo-${acao}`} name="motivo" autoComplete="off" />
        {rotulo.dica ? <p className="dica-campo">{rotulo.dica}</p> : null}
        {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
        <button type="submit" className="botao botao-secundario" disabled={salvando}>
          {salvando ? "Salvando…" : rotulo.botao}
        </button>
      </form>
    </details>
  );
}

export function RegistrarAdesao({
  contratoId,
  etapa,
  rotulo,
}: {
  contratoId: string;
  etapa: "pagamento" | "assinatura";
  rotulo: string;
}) {
  const [estado, enviar, salvando] = useActionState(acaoRegistrarAdesao, INICIAL);
  const aoEnviar = useEnvio(enviar);
  return (
    <form onSubmit={aoEnviar}>
      <input type="hidden" name="contratoId" value={contratoId} />
      <input type="hidden" name="etapa" value={etapa} />
      <button type="submit" className="botao botao-secundario" disabled={salvando}>
        {salvando ? "Registrando…" : rotulo}
      </button>
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
    </form>
  );
}

export function NovaFatura({ contratoId, mesInicial }: { contratoId: string; mesInicial: string }) {
  const [estado, enviar, salvando] = useActionState(acaoCriarFatura, INICIAL);
  const aoEnviar = useEnvio(enviar);
  return (
    <form onSubmit={aoEnviar} className="formulario-curto" noValidate>
      <input type="hidden" name="contratoId" value={contratoId} />
      <label htmlFor="competencia">Mês da nova fatura de teste</label>
      <input id="competencia" name="competencia" type="month" defaultValue={mesInicial} />
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
      <button type="submit" className="botao botao-secundario" disabled={salvando}>
        {salvando ? "Gerando…" : "Gerar fatura de teste"}
      </button>
    </form>
  );
}

export function PagarFatura({ contratoId, faturaId }: { contratoId: string; faturaId: string }) {
  const [estado, enviar, salvando] = useActionState(acaoPagarFatura, INICIAL);
  const aoEnviar = useEnvio(enviar);
  return (
    <form onSubmit={aoEnviar}>
      <input type="hidden" name="contratoId" value={contratoId} />
      <input type="hidden" name="faturaId" value={faturaId} />
      <button type="submit" className="link-botao" disabled={salvando}>
        {salvando ? "Registrando…" : "Marcar como paga"}
      </button>
      {estado.erro ? <p className="erro-campo">{estado.erro}</p> : null}
    </form>
  );
}
