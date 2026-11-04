import Link from "next/link";
import { sair } from "@/app/login/acoes";
import { NOME_PERFIL, tem } from "@/regras/permissoes";
import { usuarioAtual } from "@/servidor/sessao";

export async function MenuUsuario() {
  const atual = await usuarioAtual();
  if (!atual) return null;
  const pode = (permissao: Parameters<typeof tem>[1]) => tem(atual.perfil, permissao);
  const liberado = !atual.trocarSenha;

  return (
    <>
      {liberado ? (
        <nav className="menu" aria-label="Menu principal">
          <Link href="/pessoas">Pessoas</Link>
          {pode("configurar_prazos") || pode("rodar_rotina") ? (
            <Link href="/configuracoes">Configurações</Link>
          ) : null}
          {pode("ver_usuarios") ? <Link href="/usuarios">Usuários</Link> : null}
          {pode("ver_auditoria") ? <Link href="/auditoria">Auditoria</Link> : null}
          {pode("ver_conferencia") ? <Link href="/conferencia">Conferência</Link> : null}
        </nav>
      ) : null}
      <div className="usuario-logado">
        <span>
          {atual.nome} · {NOME_PERFIL[atual.perfil]}
        </span>
        {liberado ? <Link href="/trocar-senha">Trocar senha</Link> : null}
        <form action={sair}>
          <button type="submit" className="link-claro">
            Sair
          </button>
        </form>
      </div>
    </>
  );
}
