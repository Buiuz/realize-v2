import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as esquema from "./esquema";

// Pasta local do banco; fica fora do Git. Sem caminho, o banco roda só na memória (usado nos testes).
export const CAMINHO_BANCO_LOCAL = path.join(process.cwd(), ".dados", "banco");

export function abrirBanco(caminho?: string) {
  const cliente = new PGlite(caminho);
  const db = drizzle(cliente, { schema: esquema });
  return { cliente, db };
}

export type Banco = ReturnType<typeof abrirBanco>["db"];

export async function aplicarMigracoes(db: Banco) {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src", "banco", "migracoes") });
}
