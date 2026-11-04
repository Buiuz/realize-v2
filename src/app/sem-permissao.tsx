import Link from "next/link";

export function SemPermissao() {
  return (
    <>
      <h1>Sem permissão</h1>
      <p className="aviso">O seu perfil não dá acesso a esta tela. A tentativa ficou registrada.</p>
      <p className="voltar acoes-secao">
        <Link href="/pessoas">Voltar para pessoas</Link>
      </p>
    </>
  );
}
