import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <main>
      <h1>Página não encontrada</h1>
      <p className="detalhe">O endereço não existe ou o cadastro não foi encontrado.</p>
      <Link href="/pessoas">Voltar para pessoas</Link>
    </main>
  );
}
