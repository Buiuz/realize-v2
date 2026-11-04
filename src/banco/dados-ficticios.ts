// Somente dados fictícios (LGPD): nomes, contatos e endereços inventados.
import { and, eq, isNull } from "drizzle-orm";
import { gerarHashSenha, gerarSenhaTemporaria } from "../regras/acesso";
import { gerarCpfFicticio } from "../regras/cpf";
import { NOME_PERFIL, PERFIS } from "../regras/permissoes";
import type { Banco } from "./conexao";
import {
  adicional,
  configuracao,
  contato,
  contrato,
  cupom,
  historicoStatus,
  origem,
  pessoa,
  plano,
  planoFormaPagamento,
  precoAdicional,
  precoPlano,
  usuario,
  versaoAdicional,
  versaoContrato,
  vida,
} from "./esquema";

// O PRD diz que a tabela nova entra com o V2, sem data; esta é só uma data de exemplo.
const INICIO_TABELA = "2026-11-01";
const ADESAO = "2026-11-03";
const AUTOR = "Dados fictícios";

const ENDERECO = {
  cep: "00000000",
  logradouro: "Rua Fictícia",
  numero: "100",
  bairro: "Bairro Exemplo",
  cidade: "Cidade Exemplo",
  uf: "RJ",
};

export type CredencialTeste = { perfil: string; login: string; senha: string };

/**
 * Cria um usuário fictício por perfil, uma única vez, com senha aleatória.
 * Nenhuma senha fica no código: quem prepara o banco grava-as num arquivo fora do Git.
 * Sem troca obrigatória de senha, só para facilitar o teste de cada perfil.
 */
export async function semearUsuarios(db: Banco): Promise<CredencialTeste[]> {
  const existentes = await db.select({ id: usuario.id }).from(usuario).limit(1);
  if (existentes.length > 0) return [];

  const credenciais: CredencialTeste[] = [];
  const base = 900009000;
  for (const [indice, perfil] of PERFIS.entries()) {
    const login = perfil.replace("_", ".");
    const senha = gerarSenhaTemporaria();
    await db.insert(usuario).values({
      nome: `${NOME_PERFIL[perfil]} Fictício`,
      cpf: gerarCpfFicticio(String(base + indice)),
      email: `${login}@example.com`,
      login,
      perfil,
      senhaHash: await gerarHashSenha(senha),
      trocarSenha: false,
    });
    credenciais.push({ perfil: NOME_PERFIL[perfil], login, senha });
  }

  // Contratos antigos de origem Vendedor entram na carteira do vendedor de teste.
  const [vendedor] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.perfil, "vendedor")).limit(1);
  await db
    .update(origem)
    .set({ vendedorId: vendedor.id })
    .where(and(eq(origem.tipo, "vendedor"), isNull(origem.vendedorId)));
  return credenciais;
}

async function semearCupons(db: Banco) {
  const existentes = await db.select({ id: cupom.id }).from(cupom).limit(1);
  if (existentes.length > 0) return;
  await db.insert(cupom).values([
    // Vigência longa só para o protótipo: na vida real, troca-se o cupom todo mês (PRD 3.3).
    {
      codigo: "TESTE50",
      percentual: 50,
      recorrente: true,
      vigenciaInicio: INICIO_TABELA,
      vigenciaFim: "2030-12-31",
    },
    {
      codigo: "OUT26",
      percentual: 50,
      recorrente: true,
      vigenciaInicio: "2026-10-01",
      vigenciaFim: "2026-10-31",
    },
  ]);
}

/** Insere os dados uma única vez. Devolve false se os dados principais já existiam. */
export async function semear(db: Banco): Promise<boolean> {
  // Separado para chegar também a bancos criados antes de o cupom existir.
  await semearCupons(db);

  const existentes = await db.select({ id: plano.id }).from(plano).limit(1);
  if (existentes.length > 0) return false;

  await db.transaction(async (tx) => {
    // Planos e preços (PRD 3.1)
    const tabela = [
      { nome: "Realize Digital", aceitaFuneral: false, familiar: 8990, individual: 5490 },
      { nome: "Realize Clínicas", aceitaFuneral: true, familiar: 8990, individual: 5490 },
      { nome: "Realize Total", aceitaFuneral: true, familiar: 14990, individual: 8990 },
    ];
    const idsPlanos: Record<string, string> = {};
    for (const item of tabela) {
      const [novo] = await tx
        .insert(plano)
        .values({ nome: item.nome, aceitaFuneral: item.aceitaFuneral })
        .returning({ id: plano.id });
      idsPlanos[item.nome] = novo.id;
      await tx.insert(precoPlano).values([
        {
          planoId: novo.id,
          composicao: "familiar",
          valorCentavos: item.familiar,
          vigenciaInicio: INICIO_TABELA,
        },
        {
          planoId: novo.id,
          composicao: "individual",
          valorCentavos: item.individual,
          divulgado: false,
          vigenciaInicio: INICIO_TABELA,
        },
      ]);
      // O PRD não define as formas por plano: por enquanto, todas aceitas em todos.
      await tx.insert(planoFormaPagamento).values([
        { planoId: novo.id, forma: "cartao_recorrente" },
        { planoId: novo.id, forma: "pix_automatico" },
        { planoId: novo.id, forma: "carne" },
      ]);
    }

    // Adicionais (PRD 3.2)
    const [funeral] = await tx
      .insert(adicional)
      .values({ tipo: "funeral", nome: "Adicional de funeral" })
      .returning({ id: adicional.id });
    const [extra] = await tx
      .insert(adicional)
      .values({ tipo: "dependente_extra", nome: "Dependente extra" })
      .returning({ id: adicional.id });
    await tx.insert(precoAdicional).values([
      {
        adicionalId: funeral.id,
        idadeMinima: 0,
        idadeMaxima: 64,
        valorCentavos: 0,
        idadeMaximaNovaContratacao: 80,
        vigenciaInicio: INICIO_TABELA,
      },
      {
        adicionalId: funeral.id,
        idadeMinima: 65,
        idadeMaxima: 70,
        valorCentavos: 1990,
        idadeMaximaNovaContratacao: 80,
        vigenciaInicio: INICIO_TABELA,
      },
      {
        adicionalId: funeral.id,
        idadeMinima: 71,
        valorCentavos: 4990,
        idadeMaximaNovaContratacao: 80,
        vigenciaInicio: INICIO_TABELA,
      },
      {
        adicionalId: extra.id,
        idadeMinima: 0,
        idadeMaxima: 64,
        valorCentavos: 1490,
        vigenciaInicio: INICIO_TABELA,
      },
      {
        adicionalId: extra.id,
        idadeMinima: 65,
        valorCentavos: 3990,
        vigenciaInicio: INICIO_TABELA,
      },
    ]);

    // Valores configuráveis (decisões provisórias)
    await tx.insert(configuracao).values([
      {
        chave: "idade_cpf_dependente_obrigatorio",
        valor: 18,
        descricao: "Idade a partir da qual o dependente precisa de CPF",
      },
      {
        chave: "dias_vencimento_permitidos",
        valor: [5, 10, 15, 20],
        descricao: "Dias de vencimento que podem ser escolhidos no contrato",
      },
      {
        chave: "dependentes_incluidos",
        valor: 3,
        descricao: "Dependentes incluídos na composição familiar, sem custo extra",
      },
      {
        chave: "dias_bloqueio_vaga",
        valor: 90,
        descricao: "Dias em que a vaga fica bloqueada depois de um dependente sair",
      },
    ]);

    // Pessoas fictícias
    const pessoas = await tx
      .insert(pessoa)
      .values([
        {
          nome: "Maria Fictícia de Teste",
          cpf: gerarCpfFicticio("900000001"),
          dataNascimento: "1985-04-10",
          ...ENDERECO,
        },
        {
          nome: "João Fictício de Teste",
          cpf: gerarCpfFicticio("900000002"),
          dataNascimento: "1983-09-22",
          ...ENDERECO,
        },
        {
          nome: "Carlos Exemplo de Teste",
          cpf: gerarCpfFicticio("900000003"),
          dataNascimento: "1960-03-15",
          ...ENDERECO,
        },
        // Menor de 18 anos, sem CPF (decisão provisória 2).
        { nome: "Lia Fictícia de Teste", cpf: null, dataNascimento: "2016-07-05", ...ENDERECO },
        {
          nome: "Pedro Exemplo de Teste",
          cpf: gerarCpfFicticio("900000004"),
          dataNascimento: "1995-12-01",
          ...ENDERECO,
        },
      ])
      .returning({ id: pessoa.id, nome: pessoa.nome });
    const [maria, joao, carlos, lia] = pessoas;

    await tx.insert(contato).values([
      { pessoaId: maria.id, tipo: "celular", valor: "21900000001", principal: true },
      { pessoaId: maria.id, tipo: "email", valor: "maria@example.com", principal: true },
      { pessoaId: pessoas[4].id, tipo: "celular", valor: "21900000002", principal: true },
    ]);

    // Contrato de exemplo: Total familiar com funeral.
    // R$ 149,90 + R$ 19,90 de funeral do Carlos, que tem 66 anos = R$ 169,80.
    const [balcao] = await tx
      .insert(origem)
      .values({ tipo: "balcao", detalhe: "Exemplo fictício" })
      .returning({ id: origem.id });
    const [novoContrato] = await tx
      .insert(contrato)
      .values({ titularId: maria.id, origemId: balcao.id, dataAdesao: ADESAO })
      .returning({ id: contrato.id });
    const [versao] = await tx
      .insert(versaoContrato)
      .values({
        contratoId: novoContrato.id,
        numero: 1,
        planoId: idsPlanos["Realize Total"],
        composicao: "familiar",
        formaPagamento: "cartao_recorrente",
        diaVencimento: 10,
        valorPlanoCentavos: 14990,
        valorFuneralCentavos: 1990,
        valorDependenteExtraCentavos: 0,
        valorPrimeiraMensalidadeCentavos: 16980,
        valorMensalCentavos: 16980,
        vigenciaInicio: ADESAO,
        motivo: "Adesão",
        autor: AUTOR,
      })
      .returning({ id: versaoContrato.id });
    await tx.insert(versaoAdicional).values({ versaoId: versao.id, adicionalId: funeral.id });
    const comFuneral = { contratoId: novoContrato.id, dataEntrada: ADESAO, carenciaFuneralInicio: ADESAO };
    await tx.insert(vida).values([
      { ...comFuneral, pessoaId: maria.id, papel: "titular" },
      { ...comFuneral, pessoaId: joao.id, papel: "dependente", parentesco: "Cônjuge", valorExtraCentavos: 1490 },
      {
        ...comFuneral,
        pessoaId: carlos.id,
        papel: "dependente",
        parentesco: "Pai",
        valorFuneralCentavos: 1990,
        valorExtraCentavos: 3990,
      },
      { ...comFuneral, pessoaId: lia.id, papel: "dependente", parentesco: "Filha", valorExtraCentavos: 1490 },
    ]);
    await tx.insert(historicoStatus).values({
      contratoId: novoContrato.id,
      statusNovo: "pendente",
      autor: AUTOR,
      motivo: "Contrato criado",
      modo: "automatico",
    });
  });

  return true;
}
