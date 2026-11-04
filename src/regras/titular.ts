// Regras do cadastro de titular (PRD 2.1). A tela repete algumas para avisar antes,
// mas quem decide é sempre este arquivo, no servidor.
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Banco } from "../banco/conexao";
import { contato, contrato, origem, pessoa, vida } from "../banco/esquema";
import { cpfValido, limparCpf } from "./cpf";

export type EntradaTitular = {
  nome: string;
  cpf: string;
  dataNascimento: string;
  sexo: string;
  celular: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type CampoTitular = keyof EntradaTitular;
export type ErrosTitular = Partial<Record<CampoTitular, string>>;

export type TitularValidado = EntradaTitular & { sexo: string };

export type ResultadoValidacao =
  | { ok: true; dados: TitularValidado }
  | { ok: false; erros: ErrosTitular };

export type ResultadoCadastro =
  | { ok: true; id: string }
  | { ok: false; erros: ErrosTitular; cpfExistente?: PessoaExistente };

export type PessoaExistente = { id: string; nome: string };

const UFS = new Set(
  "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "),
);
export const SEXOS = ["feminino", "masculino", "outro"];

function soDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

export function limparTexto(valor: string) {
  return valor.trim().replace(/\s+/g, " ");
}

export function dataExiste(data: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const momento = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(momento.getTime()) && momento.toISOString().slice(0, 10) === data;
}

/** Data de hoje no fuso do negócio, no formato AAAA-MM-DD. */
export function hojeEmSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function validarTitular(
  entrada: EntradaTitular,
  hoje = hojeEmSaoPaulo(),
): ResultadoValidacao {
  const dados: TitularValidado = {
    nome: limparTexto(entrada.nome),
    cpf: limparCpf(entrada.cpf),
    dataNascimento: entrada.dataNascimento.trim(),
    sexo: entrada.sexo.trim(),
    celular: soDigitos(entrada.celular),
    email: entrada.email.trim().toLowerCase(),
    cep: soDigitos(entrada.cep),
    logradouro: limparTexto(entrada.logradouro),
    numero: limparTexto(entrada.numero),
    complemento: limparTexto(entrada.complemento),
    bairro: limparTexto(entrada.bairro),
    cidade: limparTexto(entrada.cidade),
    uf: entrada.uf.trim().toUpperCase(),
  };

  const erros: ErrosTitular = {};

  if (dados.nome.split(" ").length < 2) erros.nome = "Informe o nome completo";
  if (!cpfValido(dados.cpf)) erros.cpf = "CPF inválido";

  if (!dados.dataNascimento) {
    erros.dataNascimento = "Informe a data de nascimento";
  } else if (!dataExiste(dados.dataNascimento) || dados.dataNascimento < "1900-01-01") {
    erros.dataNascimento = "Data de nascimento inválida";
  } else if (dados.dataNascimento > hoje) {
    erros.dataNascimento = "A data de nascimento não pode ser no futuro";
  }

  if (dados.sexo && !SEXOS.includes(dados.sexo)) erros.sexo = "Opção inválida";
  // Celular brasileiro: DDD + 9 + oito números. É o número usado para WhatsApp e SMS.
  if (!/^[1-9][0-9]9[0-9]{8}$/.test(dados.celular)) {
    erros.celular = "Informe um celular com DDD, como (21) 90000-0000";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) erros.email = "E-mail inválido";

  if (!/^\d{8}$/.test(dados.cep)) erros.cep = "O CEP precisa ter 8 números";
  if (!dados.logradouro) erros.logradouro = "Informe a rua";
  if (!dados.bairro) erros.bairro = "Informe o bairro";
  if (!dados.cidade) erros.cidade = "Informe a cidade";
  if (!UFS.has(dados.uf)) erros.uf = "Informe a UF, como RJ";

  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, dados };
}

export async function buscarPessoaPorCpf(
  db: Banco,
  cpf: string,
): Promise<PessoaExistente | undefined> {
  const [existente] = await db
    .select({ id: pessoa.id, nome: pessoa.nome })
    .from(pessoa)
    .where(eq(pessoa.cpf, limparCpf(cpf)))
    .limit(1);
  return existente;
}

const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüç";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuuc";

function semAcento(texto: string) {
  return [...texto.toLowerCase()]
    .map((letra) => {
      const posicao = COM_ACENTO.indexOf(letra);
      return posicao >= 0 ? SEM_ACENTO[posicao] : letra;
    })
    .join("");
}

function escaparBusca(texto: string) {
  return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

/** Busca por nome (com ou sem acento) ou por CPF (com ou sem pontuação). */
export async function buscarPessoas(db: Banco, busca: string, limite: number, carteiraDe?: string) {
  const termo = busca.trim();
  const digitos = limparCpf(termo);
  const nomeNormalizado = sql`translate(lower(${pessoa.nome}), ${COM_ACENTO}, ${SEM_ACENTO})`;

  const filtro = termo
    ? or(
        sql`${nomeNormalizado} LIKE ${`%${escaparBusca(semAcento(termo))}%`}`,
        digitos ? like(pessoa.cpf, `%${digitos}%`) : undefined,
      )
    : undefined;

  // Vendedor só enxerga quem está nos contratos da própria carteira.
  const carteira = carteiraDe
    ? inArray(
        pessoa.id,
        db
          .select({ id: vida.pessoaId })
          .from(vida)
          .innerJoin(contrato, eq(contrato.id, vida.contratoId))
          .innerJoin(origem, eq(origem.id, contrato.origemId))
          .where(eq(origem.vendedorId, carteiraDe)),
      )
    : undefined;

  return db
    .select({
      id: pessoa.id,
      nome: pessoa.nome,
      cpf: pessoa.cpf,
      nascimento: pessoa.dataNascimento,
    })
    .from(pessoa)
    .where(and(filtro, carteira))
    .orderBy(asc(pessoa.nome))
    .limit(limite);
}

function ehCpfRepetido(erro: unknown) {
  const causa = (erro as { cause?: { constraint?: string; message?: string } })?.cause;
  const texto = `${(erro as Error)?.message ?? ""} ${causa?.constraint ?? ""} ${causa?.message ?? ""}`;
  return texto.includes("pessoa_cpf_unique");
}

const MENSAGEM_CPF_REPETIDO = "Este CPF já está cadastrado";

export async function cadastrarTitular(
  db: Banco,
  entrada: EntradaTitular,
  hoje = hojeEmSaoPaulo(),
): Promise<ResultadoCadastro> {
  const validacao = validarTitular(entrada, hoje);
  if (!validacao.ok) return { ok: false, erros: validacao.erros };
  const { dados } = validacao;

  const existente = await buscarPessoaPorCpf(db, dados.cpf);
  if (existente) {
    return { ok: false, erros: { cpf: MENSAGEM_CPF_REPETIDO }, cpfExistente: existente };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const [nova] = await tx
        .insert(pessoa)
        .values({
          nome: dados.nome,
          cpf: dados.cpf,
          dataNascimento: dados.dataNascimento,
          sexo: dados.sexo || null,
          cep: dados.cep,
          logradouro: dados.logradouro,
          numero: dados.numero || null,
          complemento: dados.complemento || null,
          bairro: dados.bairro,
          cidade: dados.cidade,
          uf: dados.uf,
        })
        .returning({ id: pessoa.id });
      await tx.insert(contato).values([
        { pessoaId: nova.id, tipo: "celular", valor: dados.celular, principal: true },
        { pessoaId: nova.id, tipo: "email", valor: dados.email, principal: true },
      ]);
      return nova.id;
    });
    return { ok: true, id };
  } catch (erro) {
    // Duas pessoas salvando o mesmo CPF ao mesmo tempo: o banco barra a segunda.
    if (ehCpfRepetido(erro)) {
      return {
        ok: false,
        erros: { cpf: MENSAGEM_CPF_REPETIDO },
        cpfExistente: await buscarPessoaPorCpf(db, dados.cpf),
      };
    }
    throw erro;
  }
}
