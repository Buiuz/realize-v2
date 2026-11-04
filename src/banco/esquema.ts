// Estrutura do banco de dados (Bloco 2 do PRD).
// Regras gerais: dinheiro em centavos (inteiro); momentos em UTC (timestamptz);
// datas de calendário (nascimento, vigência) sem hora.
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const statusContrato = pgEnum("status_contrato", [
  "pendente",
  "ativo",
  "inadimplente",
  "bloqueado",
  "cancelamento_solicitado",
  "cancelado",
]);
export const composicao = pgEnum("composicao", ["familiar", "individual"]);
export const formaPagamento = pgEnum("forma_pagamento", [
  "cartao_recorrente",
  "pix_automatico",
  "carne",
]);
export const tipoContato = pgEnum("tipo_contato", ["celular", "telefone", "email"]);
export const papelVida = pgEnum("papel_vida", ["titular", "dependente"]);
export const tipoOrigem = pgEnum("tipo_origem", [
  "vendedor",
  "link",
  "cupom",
  "influenciador",
  "site",
  "balcao",
  "reativacao",
  "migracao",
]);
export const tipoAdicional = pgEnum("tipo_adicional", ["funeral", "dependente_extra"]);
export const modoMudanca = pgEnum("modo_mudanca", ["manual", "automatico"]);
export const tipoDesconto = pgEnum("tipo_desconto", ["fixo", "percentual", "preco_proprio"]);
export const tipoCondicao = pgEnum("tipo_condicao", ["cortesia", "isencao", "preco_legado"]);
export const statusFatura = pgEnum("status_fatura", ["a_vencer", "vencida", "paga", "cancelada"]);
export const statusCobranca = pgEnum("status_cobranca", [
  "pendente",
  "paga",
  "falhou",
  "cancelada",
]);
export const tipoLancamento = pgEnum("tipo_lancamento", ["entrada", "saida"]);
export const tipoExcecao = pgEnum("tipo_excecao", ["nascimento", "obito", "divorcio"]);
export const statusExcecao = pgEnum("status_excecao", ["pendente", "aprovada", "recusada"]);
export const perfilUsuario = pgEnum("perfil_usuario", [
  "super_admin",
  "adm_operacional",
  "financeiro",
  "gestor_comercial",
  "atendimento",
  "vendedor",
  "auditor",
]);
export const resultadoLog = pgEnum("resultado_log", ["ok", "negado", "falha"]);

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).defaultNow().notNull();

// ---------- Acesso ----------

// Usuário nunca é apagado, só desativado, para preservar a autoria no log (PRD 1.1).
export const usuario = pgTable(
  "usuario",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nome: text("nome").notNull(),
    cpf: varchar("cpf", { length: 11 }).notNull().unique(),
    email: text("email").notNull().unique(),
    login: text("login").notNull().unique(),
    perfil: perfilUsuario("perfil").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    // Só o resultado do embaralhamento da senha; a senha em si nunca é guardada.
    senhaHash: text("senha_hash").notNull(),
    trocarSenha: boolean("trocar_senha").notNull().default(true),
    tentativasErradas: integer("tentativas_erradas").notNull().default(0),
    bloqueadoAte: timestamp("bloqueado_ate", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [check("usuario_cpf_11_digitos", sql`${t.cpf} ~ '^[0-9]{11}$'`)],
);

export const sessao = pgTable("sessao", {
  id: uuid("id").defaultRandom().primaryKey(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  // Só o resultado do embaralhamento do código que fica no navegador.
  tokenHash: text("token_hash").notNull().unique(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  encerradaEm: timestamp("encerrada_em", { withTimezone: true }),
  criadoEm: criadoEm(),
});

// Só aceita inclusão: o banco recusa alterar ou apagar, inclusive para administrador (PRD 1.3).
export const logAuditoria = pgTable("log_auditoria", {
  id: uuid("id").defaultRandom().primaryKey(),
  data: timestamp("data", { withTimezone: true }).defaultNow().notNull(),
  usuarioId: uuid("usuario_id").references(() => usuario.id),
  // Copiado para continuar legível mesmo se o nome do usuário mudar.
  usuarioNome: text("usuario_nome").notNull(),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: text("entidade_id"),
  detalhe: text("detalhe"),
  resultado: resultadoLog("resultado").notNull().default("ok"),
  origem: text("origem").notNull().default("tela"),
});

// ---------- Pessoas ----------

export const pessoa = pgTable(
  "pessoa",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nome: text("nome").notNull(),
    // Pode ficar vazio só para dependente abaixo da idade configurada (decisão provisória 2).
    cpf: varchar("cpf", { length: 11 }).unique(),
    dataNascimento: date("data_nascimento").notNull(),
    sexo: text("sexo"),
    fotoUrl: text("foto_url"),
    cep: varchar("cep", { length: 8 }),
    logradouro: text("logradouro"),
    numero: text("numero"),
    complemento: text("complemento"),
    bairro: text("bairro"),
    cidade: text("cidade"),
    uf: char("uf", { length: 2 }),
    criadoEm: criadoEm(),
  },
  (t) => [check("pessoa_cpf_11_digitos", sql`${t.cpf} ~ '^[0-9]{11}$'`)],
);

export const contato = pgTable(
  "contato",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pessoaId: uuid("pessoa_id")
      .notNull()
      .references(() => pessoa.id),
    tipo: tipoContato("tipo").notNull(),
    valor: text("valor").notNull(),
    principal: boolean("principal").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("contato_um_principal_por_tipo")
      .on(t.pessoaId, t.tipo)
      .where(sql`${t.principal} = true`),
  ],
);

// ---------- Planos e preços ----------

export const plano = pgTable("plano", {
  id: uuid("id").defaultRandom().primaryKey(),
  nome: text("nome").notNull().unique(),
  divulgado: boolean("divulgado").notNull().default(true),
  aceitaFuneral: boolean("aceita_funeral").notNull().default(false),
  criadoEm: criadoEm(),
});

export const planoFormaPagamento = pgTable(
  "plano_forma_pagamento",
  {
    planoId: uuid("plano_id")
      .notNull()
      .references(() => plano.id),
    forma: formaPagamento("forma").notNull(),
  },
  (t) => [primaryKey({ columns: [t.planoId, t.forma] })],
);

export const precoPlano = pgTable(
  "preco_plano",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planoId: uuid("plano_id")
      .notNull()
      .references(() => plano.id),
    composicao: composicao("composicao").notNull(),
    valorCentavos: integer("valor_centavos").notNull(),
    // A composição Individual existe, mas não aparece no link público (PRD 3.1).
    divulgado: boolean("divulgado").notNull().default(true),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("preco_plano_unico_por_vigencia").on(t.planoId, t.composicao, t.vigenciaInicio),
    check("preco_plano_valor_nao_negativo", sql`${t.valorCentavos} >= 0`),
  ],
);

export const adicional = pgTable("adicional", {
  id: uuid("id").defaultRandom().primaryKey(),
  tipo: tipoAdicional("tipo").notNull().unique(),
  nome: text("nome").notNull(),
  criadoEm: criadoEm(),
});

export const precoAdicional = pgTable(
  "preco_adicional",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adicionalId: uuid("adicional_id")
      .notNull()
      .references(() => adicional.id),
    idadeMinima: integer("idade_minima").notNull(),
    // Vazio = sem limite de idade para o preço.
    idadeMaxima: integer("idade_maxima"),
    valorCentavos: integer("valor_centavos").notNull(),
    // Acima desta idade não aceita nova contratação, mas mantém quem já tem (PRD 3.2).
    idadeMaximaNovaContratacao: integer("idade_maxima_nova_contratacao"),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("preco_adicional_valor_nao_negativo", sql`${t.valorCentavos} >= 0`),
    check(
      "preco_adicional_faixa_valida",
      sql`${t.idadeMaxima} IS NULL OR ${t.idadeMaxima} >= ${t.idadeMinima}`,
    ),
  ],
);

// ---------- Empresa e origem ----------

export const empresa = pgTable(
  "empresa",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cnpj: varchar("cnpj", { length: 14 }).notNull().unique(),
    razaoSocial: text("razao_social").notNull(),
    responsavel: text("responsavel"),
    contato: text("contato"),
    endereco: text("endereco"),
    tipoDesconto: tipoDesconto("tipo_desconto"),
    // Centavos para "fixo" e "preco_proprio"; centésimos de ponto percentual para "percentual".
    valorDesconto: integer("valor_desconto"),
    criadoEm: criadoEm(),
  },
  (t) => [check("empresa_cnpj_14_digitos", sql`${t.cnpj} ~ '^[0-9]{14}$'`)],
);

export const origem = pgTable("origem", {
  id: uuid("id").defaultRandom().primaryKey(),
  tipo: tipoOrigem("tipo").notNull(),
  detalhe: text("detalhe"),
  // Define a carteira do vendedor.
  vendedorId: uuid("vendedor_id").references(() => usuario.id),
  criadoEm: criadoEm(),
});

// Versão simples, sem tela de gestão (decisão provisória 10).
export const cupom = pgTable(
  "cupom",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codigo: text("codigo").notNull().unique(),
    percentual: integer("percentual").notNull(),
    // Recorrente vale em todas as mensalidades; caso contrário, só na primeira.
    recorrente: boolean("recorrente").notNull(),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("cupom_percentual_valido", sql`${t.percentual} BETWEEN 1 AND 100`),
    check("cupom_vigencia_valida", sql`${t.vigenciaFim} >= ${t.vigenciaInicio}`),
  ],
);

// ---------- Contrato ----------

export const contrato = pgTable(
  "contrato",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    numero: serial("numero").notNull().unique(),
    titularId: uuid("titular_id").references(() => pessoa.id),
    empresaId: uuid("empresa_id").references(() => empresa.id),
    origemId: uuid("origem_id")
      .notNull()
      .references(() => origem.id),
    status: statusContrato("status").notNull().default("pendente"),
    dataAdesao: date("data_adesao").notNull(),
    // No protótipo, gateway e assinatura eletrônica são simulados por estes registros.
    adesaoPagaEm: timestamp("adesao_paga_em", { withTimezone: true }),
    assinadoEm: timestamp("assinado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("contrato_titular_ou_empresa", sql`num_nonnulls(${t.titularId}, ${t.empresaId}) = 1`),
  ],
);

export const versaoContrato = pgTable(
  "versao_contrato",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contrato.id),
    numero: integer("numero").notNull(),
    planoId: uuid("plano_id")
      .notNull()
      .references(() => plano.id),
    composicao: composicao("composicao").notNull(),
    formaPagamento: formaPagamento("forma_pagamento").notNull(),
    diaVencimento: integer("dia_vencimento").notNull(),
    // Preços guardados no contrato: não mudam se a tabela de preços mudar depois.
    valorPlanoCentavos: integer("valor_plano_centavos").notNull(),
    valorFuneralCentavos: integer("valor_funeral_centavos").notNull(),
    valorDependenteExtraCentavos: integer("valor_dependente_extra_centavos").notNull(),
    // Cupom copiado para cá: quem já tem mantém o desconto, mesmo depois de o cupom encerrar.
    cupomId: uuid("cupom_id").references(() => cupom.id),
    cupomPercentual: integer("cupom_percentual"),
    cupomRecorrente: boolean("cupom_recorrente"),
    valorPrimeiraMensalidadeCentavos: integer("valor_primeira_mensalidade_centavos").notNull(),
    // Valor cobrado nas mensalidades seguintes.
    valorMensalCentavos: integer("valor_mensal_centavos").notNull(),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
    motivo: text("motivo").notNull(),
    autor: text("autor").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("versao_numero_unico_no_contrato").on(t.contratoId, t.numero),
    uniqueIndex("versao_uma_vigente_por_contrato")
      .on(t.contratoId)
      .where(sql`${t.vigenciaFim} IS NULL`),
    check(
      "versao_valor_nao_negativo",
      sql`LEAST(${t.valorPlanoCentavos}, ${t.valorFuneralCentavos}, ${t.valorDependenteExtraCentavos}, ${t.valorPrimeiraMensalidadeCentavos}, ${t.valorMensalCentavos}) >= 0`,
    ),
    check(
      "versao_cupom_completo",
      sql`num_nonnulls(${t.cupomId}, ${t.cupomPercentual}, ${t.cupomRecorrente}) IN (0, 3)`,
    ),
    check("versao_dia_vencimento_valido", sql`${t.diaVencimento} BETWEEN 1 AND 31`),
    check(
      "versao_vigencia_valida",
      sql`${t.vigenciaFim} IS NULL OR ${t.vigenciaFim} >= ${t.vigenciaInicio}`,
    ),
  ],
);

export const versaoAdicional = pgTable(
  "versao_adicional",
  {
    versaoId: uuid("versao_id")
      .notNull()
      .references(() => versaoContrato.id),
    adicionalId: uuid("adicional_id")
      .notNull()
      .references(() => adicional.id),
  },
  (t) => [primaryKey({ columns: [t.versaoId, t.adicionalId] })],
);

export const vida = pgTable(
  "vida",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contrato.id),
    pessoaId: uuid("pessoa_id")
      .notNull()
      .references(() => pessoa.id),
    papel: papelVida("papel").notNull(),
    parentesco: text("parentesco"),
    dataEntrada: date("data_entrada").notNull(),
    // A data de saída é o que define o bloqueio de 90 dias da vaga.
    dataSaida: date("data_saida"),
    motivoSaida: text("motivo_saida"),
    autorSaida: text("autor_saida"),
    // Vazio = esta vida não tem funeral. Preservada na migração do Core.
    carenciaFuneralInicio: date("carencia_funeral_inicio"),
    // Valores fixados na entrada: mudar de faixa de idade não altera a cobrança sozinho (PRD 3.2).
    valorFuneralCentavos: integer("valor_funeral_centavos").notNull().default(0),
    // Quanto esta vida paga se for um dependente extra.
    valorExtraCentavos: integer("valor_extra_centavos").notNull().default(0),
    // Vazio quando a saída não bloqueia vaga (dependente extra, decisão provisória 6).
    vagaBloqueadaAte: date("vaga_bloqueada_ate"),
    criadoEm: criadoEm(),
  },
  (t) => [
    check(
      "vida_valores_nao_negativos",
      sql`LEAST(${t.valorFuneralCentavos}, ${t.valorExtraCentavos}) >= 0`,
    ),
    uniqueIndex("vida_pessoa_uma_vez_no_contrato")
      .on(t.contratoId, t.pessoaId)
      .where(sql`${t.dataSaida} IS NULL`),
    uniqueIndex("vida_um_titular_por_contrato")
      .on(t.contratoId)
      .where(sql`${t.papel} = 'titular' AND ${t.dataSaida} IS NULL`),
    check("vida_dependente_tem_parentesco", sql`${t.papel} = 'titular' OR ${t.parentesco} IS NOT NULL`),
    check(
      "vida_saida_tem_motivo_e_autor",
      sql`${t.dataSaida} IS NULL OR (${t.motivoSaida} IS NOT NULL AND ${t.autorSaida} IS NOT NULL)`,
    ),
  ],
);

// Pedido para liberar uma vaga bloqueada antes dos 90 dias (PRD 2.3).
export const excecaoVaga = pgTable(
  "excecao_vaga",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contrato.id),
    // A saída que bloqueou a vaga: a exceção vale só para ela.
    vidaRemovidaId: uuid("vida_removida_id")
      .notNull()
      .references(() => vida.id),
    tipo: tipoExcecao("tipo").notNull(),
    descricao: text("descricao"),
    status: statusExcecao("status").notNull().default("pendente"),
    solicitadaPor: text("solicitada_por").notNull(),
    solicitadaEm: timestamp("solicitada_em", { withTimezone: true }).defaultNow().notNull(),
    decididaPor: text("decidida_por"),
    decididaEm: timestamp("decidida_em", { withTimezone: true }),
    motivoDecisao: text("motivo_decisao"),
  },
  (t) => [
    uniqueIndex("excecao_uma_aberta_por_vaga")
      .on(t.vidaRemovidaId)
      .where(sql`${t.status} <> 'recusada'`),
    check(
      "excecao_decisao_completa",
      sql`(${t.status} = 'pendente') = (num_nonnulls(${t.decididaPor}, ${t.decididaEm}, ${t.motivoDecisao}) = 0)
        AND (${t.status} = 'pendente' OR num_nonnulls(${t.decididaPor}, ${t.decididaEm}, ${t.motivoDecisao}) = 3)`,
    ),
  ],
);

export const historicoStatus = pgTable("historico_status", {
  id: uuid("id").defaultRandom().primaryKey(),
  contratoId: uuid("contrato_id")
    .notNull()
    .references(() => contrato.id),
  // Vazio apenas no registro de criação do contrato.
  statusAnterior: statusContrato("status_anterior"),
  statusNovo: statusContrato("status_novo").notNull(),
  data: timestamp("data", { withTimezone: true }).defaultNow().notNull(),
  autor: text("autor").notNull(),
  motivo: text("motivo").notNull(),
  modo: modoMudanca("modo").notNull(),
});

// ---------- Previstos, ainda sem tela ----------

export const condicaoEspecial = pgTable(
  "condicao_especial",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contrato.id),
    tipo: tipoCondicao("tipo").notNull(),
    motivo: text("motivo").notNull(),
    autor: text("autor").notNull(),
    aprovador: text("aprovador").notNull(),
    dataFim: date("data_fim").notNull(),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    canceladaPor: text("cancelada_por"),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: criadoEm(),
  },
  (t) => [
    check(
      "condicao_cancelamento_completo",
      sql`num_nonnulls(${t.canceladaEm}, ${t.canceladaPor}, ${t.motivoCancelamento}) IN (0, 3)`,
    ),
  ],
);

export const fatura = pgTable(
  "fatura",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contrato.id),
    // Mês de referência, no formato AAAA-MM.
    competencia: char("competencia", { length: 7 }).notNull(),
    valorCentavos: integer("valor_centavos").notNull(),
    vencimento: date("vencimento").notNull(),
    status: statusFatura("status").notNull().default("a_vencer"),
    pagaEm: timestamp("paga_em", { withTimezone: true }),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    canceladaPor: text("cancelada_por"),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: criadoEm(),
  },
  (t) => [
    uniqueIndex("fatura_uma_valida_por_competencia")
      .on(t.contratoId, t.competencia)
      .where(sql`${t.status} <> 'cancelada'`),
    check("fatura_competencia_valida", sql`${t.competencia} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("fatura_valor_nao_negativo", sql`${t.valorCentavos} >= 0`),
    check(
      "fatura_cancelamento_completo",
      sql`(${t.status} = 'cancelada') = (num_nonnulls(${t.canceladaEm}, ${t.canceladaPor}, ${t.motivoCancelamento}) = 3)`,
    ),
  ],
);

export const cobranca = pgTable(
  "cobranca",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    faturaId: uuid("fatura_id")
      .notNull()
      .references(() => fatura.id),
    meio: formaPagamento("meio").notNull(),
    valorCentavos: integer("valor_centavos").notNull(),
    status: statusCobranca("status").notNull().default("pendente"),
    canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
    canceladaPor: text("cancelada_por"),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("cobranca_valor_nao_negativo", sql`${t.valorCentavos} >= 0`),
    check(
      "cobranca_cancelamento_completo",
      sql`(${t.status} = 'cancelada') = (num_nonnulls(${t.canceladaEm}, ${t.canceladaPor}, ${t.motivoCancelamento}) = 3)`,
    ),
  ],
);

export const lancamentoFinanceiro = pgTable(
  "lancamento_financeiro",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tipo: tipoLancamento("tipo").notNull(),
    valorCentavos: integer("valor_centavos").notNull(),
    data: date("data").notNull(),
    conta: text("conta").notNull(),
    centroCusto: text("centro_custo"),
    descricao: text("descricao"),
    faturaId: uuid("fatura_id").references(() => fatura.id),
    canceladoEm: timestamp("cancelado_em", { withTimezone: true }),
    canceladoPor: text("cancelado_por"),
    motivoCancelamento: text("motivo_cancelamento"),
    criadoEm: criadoEm(),
  },
  (t) => [
    check("lancamento_valor_positivo", sql`${t.valorCentavos} > 0`),
    check(
      "lancamento_cancelamento_completo",
      sql`num_nonnulls(${t.canceladoEm}, ${t.canceladoPor}, ${t.motivoCancelamento}) IN (0, 3)`,
    ),
  ],
);

// Valores que o administrador poderá mudar sem alterar o código.
export const configuracao = pgTable("configuracao", {
  chave: text("chave").primaryKey(),
  valor: jsonb("valor").notNull(),
  descricao: text("descricao").notNull(),
});
