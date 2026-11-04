import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/banco/esquema.ts",
  out: "./src/banco/migracoes",
});
