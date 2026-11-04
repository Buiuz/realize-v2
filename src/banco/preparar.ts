// Cria ou atualiza o banco local e coloca os dados fictícios. Roda sozinho antes de "npm run dev".
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abrirBanco, aplicarMigracoes, CAMINHO_BANCO_LOCAL } from "./conexao";
import { semear, semearUsuarios } from "./dados-ficticios";

async function preparar() {
  mkdirSync(path.dirname(CAMINHO_BANCO_LOCAL), { recursive: true });
  const { cliente, db } = abrirBanco(CAMINHO_BANCO_LOCAL);
  await aplicarMigracoes(db);
  const inseriu = await semear(db);
  const credenciais = await semearUsuarios(db);
  if (credenciais.length > 0) {
    // Fora do Git, como o banco: senhas de teste nunca ficam no código.
    const arquivo = path.join(path.dirname(CAMINHO_BANCO_LOCAL), "credenciais-teste.txt");
    const linhas = credenciais.map((c) => `${c.perfil}: login ${c.login} / senha ${c.senha}`);
    writeFileSync(arquivo, `Usuários fictícios para testar o protótipo\n\n${linhas.join("\n")}\n`);
    console.log(`Usuários de teste criados. Veja os acessos em ${arquivo}`);
  }
  await cliente.close();
  console.log(inseriu ? "Banco pronto, com dados fictícios." : "Banco pronto.");
}

preparar().catch((erro) => {
  console.error("Não foi possível preparar o banco:", erro);
  process.exit(1);
});
