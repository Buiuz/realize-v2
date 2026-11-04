import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { obterBanco } from "@/banco";
import { tem } from "@/regras/permissoes";
import { lerPrazos } from "@/regras/status";
import { hojeEmSaoPaulo } from "@/regras/titular";
import { exigirPagina, exigirUsuario } from "@/servidor/sessao";
import { SemPermissao } from "../sem-permissao";
import { FormularioPrazos, FormularioRotina } from "./formularios";

export const metadata: Metadata = { title: "Configurações — Realize V2" };

async function Conteudo() {
  await connection();
  const atual = await exigirUsuario();
  const podePrazos = tem(atual.perfil, "configurar_prazos");
  const podeRotina = tem(atual.perfil, "rodar_rotina");
  if (!podePrazos && !podeRotina) {
    await exigirPagina("configurar_prazos", "configuracao");
    return <SemPermissao />;
  }
  const prazos = await lerPrazos(obterBanco());
  return (
    <>
      {podePrazos ? (
      <section>
        <h2>Prazo de inadimplência</h2>
        <FormularioPrazos x={prazos.x} />
        <p className="detalhe prazos-fixos">
          O bloqueio é sempre manual. Outros prazos em uso, conforme proposta do PRD: {prazos.assinatura} dias
          para assinar depois do pagamento e {prazos.cancelamento} dias para efetivar um pedido de cancelamento.
        </p>
      </section>
      ) : null}
      {podeRotina ? (
      <section>
        <h2>Rotina diária</h2>
        <p className="detalhe">
          Vence faturas, marca contratos como Inadimplentes e atualiza valores de vagas liberadas. No protótipo, ela
          só roda por este botão.
        </p>
        <FormularioRotina hoje={hojeEmSaoPaulo()} />
      </section>
      ) : null}
    </>
  );
}

export default function PaginaConfiguracoes() {
  return (
    <main>
      <h1>Configurações</h1>
      <Suspense fallback={<p>Carregando…</p>}>
        <Conteudo />
      </Suspense>
    </main>
  );
}
