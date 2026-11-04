CREATE TYPE "public"."composicao" AS ENUM('familiar', 'individual');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('cartao_recorrente', 'pix_automatico', 'carne');--> statement-breakpoint
CREATE TYPE "public"."modo_mudanca" AS ENUM('manual', 'automatico');--> statement-breakpoint
CREATE TYPE "public"."papel_vida" AS ENUM('titular', 'dependente');--> statement-breakpoint
CREATE TYPE "public"."status_cobranca" AS ENUM('pendente', 'paga', 'falhou', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_contrato" AS ENUM('pendente', 'ativo', 'inadimplente', 'bloqueado', 'cancelamento_solicitado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."status_fatura" AS ENUM('a_vencer', 'vencida', 'paga', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_adicional" AS ENUM('funeral', 'dependente_extra');--> statement-breakpoint
CREATE TYPE "public"."tipo_condicao" AS ENUM('cortesia', 'isencao', 'preco_legado');--> statement-breakpoint
CREATE TYPE "public"."tipo_contato" AS ENUM('celular', 'telefone', 'email');--> statement-breakpoint
CREATE TYPE "public"."tipo_desconto" AS ENUM('fixo', 'percentual', 'preco_proprio');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TYPE "public"."tipo_origem" AS ENUM('vendedor', 'link', 'cupom', 'influenciador', 'site', 'balcao', 'reativacao', 'migracao');--> statement-breakpoint
CREATE TABLE "adicional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_adicional" NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adicional_tipo_unique" UNIQUE("tipo")
);
--> statement-breakpoint
CREATE TABLE "cobranca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fatura_id" uuid NOT NULL,
	"meio" "forma_pagamento" NOT NULL,
	"valor_centavos" integer NOT NULL,
	"status" "status_cobranca" DEFAULT 'pendente' NOT NULL,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" text,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cobranca_valor_nao_negativo" CHECK ("cobranca"."valor_centavos" >= 0),
	CONSTRAINT "cobranca_cancelamento_completo" CHECK (("cobranca"."status" = 'cancelada') = (num_nonnulls("cobranca"."cancelada_em", "cobranca"."cancelada_por", "cobranca"."motivo_cancelamento") = 3))
);
--> statement-breakpoint
CREATE TABLE "condicao_especial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"tipo" "tipo_condicao" NOT NULL,
	"motivo" text NOT NULL,
	"autor" text NOT NULL,
	"aprovador" text NOT NULL,
	"data_fim" date NOT NULL,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" text,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "condicao_cancelamento_completo" CHECK (num_nonnulls("condicao_especial"."cancelada_em", "condicao_especial"."cancelada_por", "condicao_especial"."motivo_cancelamento") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "configuracao" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"descricao" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pessoa_id" uuid NOT NULL,
	"tipo" "tipo_contato" NOT NULL,
	"valor" text NOT NULL,
	"principal" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contrato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" serial NOT NULL,
	"titular_id" uuid,
	"empresa_id" uuid,
	"origem_id" uuid NOT NULL,
	"status" "status_contrato" DEFAULT 'pendente' NOT NULL,
	"data_adesao" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contrato_numero_unique" UNIQUE("numero"),
	CONSTRAINT "contrato_titular_ou_empresa" CHECK (num_nonnulls("contrato"."titular_id", "contrato"."empresa_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" varchar(14) NOT NULL,
	"razao_social" text NOT NULL,
	"responsavel" text,
	"contato" text,
	"endereco" text,
	"tipo_desconto" "tipo_desconto",
	"valor_desconto" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresa_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "empresa_cnpj_14_digitos" CHECK ("empresa"."cnpj" ~ '^[0-9]{14}$')
);
--> statement-breakpoint
CREATE TABLE "fatura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"competencia" char(7) NOT NULL,
	"valor_centavos" integer NOT NULL,
	"vencimento" date NOT NULL,
	"status" "status_fatura" DEFAULT 'a_vencer' NOT NULL,
	"paga_em" timestamp with time zone,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" text,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fatura_competencia_valida" CHECK ("fatura"."competencia" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "fatura_valor_nao_negativo" CHECK ("fatura"."valor_centavos" >= 0),
	CONSTRAINT "fatura_cancelamento_completo" CHECK (("fatura"."status" = 'cancelada') = (num_nonnulls("fatura"."cancelada_em", "fatura"."cancelada_por", "fatura"."motivo_cancelamento") = 3))
);
--> statement-breakpoint
CREATE TABLE "historico_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"status_anterior" "status_contrato",
	"status_novo" "status_contrato" NOT NULL,
	"data" timestamp with time zone DEFAULT now() NOT NULL,
	"autor" text NOT NULL,
	"motivo" text NOT NULL,
	"modo" "modo_mudanca" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lancamento_financeiro" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_lancamento" NOT NULL,
	"valor_centavos" integer NOT NULL,
	"data" date NOT NULL,
	"conta" text NOT NULL,
	"centro_custo" text,
	"descricao" text,
	"fatura_id" uuid,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" text,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lancamento_valor_positivo" CHECK ("lancamento_financeiro"."valor_centavos" > 0),
	CONSTRAINT "lancamento_cancelamento_completo" CHECK (num_nonnulls("lancamento_financeiro"."cancelado_em", "lancamento_financeiro"."cancelado_por", "lancamento_financeiro"."motivo_cancelamento") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "origem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_origem" NOT NULL,
	"detalhe" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pessoa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cpf" varchar(11),
	"data_nascimento" date NOT NULL,
	"sexo" text,
	"foto_url" text,
	"cep" varchar(8),
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"cidade" text,
	"uf" char(2),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pessoa_cpf_unique" UNIQUE("cpf"),
	CONSTRAINT "pessoa_cpf_11_digitos" CHECK ("pessoa"."cpf" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
CREATE TABLE "plano" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"divulgado" boolean DEFAULT true NOT NULL,
	"aceita_funeral" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plano_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "plano_forma_pagamento" (
	"plano_id" uuid NOT NULL,
	"forma" "forma_pagamento" NOT NULL,
	CONSTRAINT "plano_forma_pagamento_plano_id_forma_pk" PRIMARY KEY("plano_id","forma")
);
--> statement-breakpoint
CREATE TABLE "preco_adicional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adicional_id" uuid NOT NULL,
	"idade_minima" integer NOT NULL,
	"idade_maxima" integer,
	"valor_centavos" integer NOT NULL,
	"idade_maxima_nova_contratacao" integer,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preco_adicional_valor_nao_negativo" CHECK ("preco_adicional"."valor_centavos" >= 0),
	CONSTRAINT "preco_adicional_faixa_valida" CHECK ("preco_adicional"."idade_maxima" IS NULL OR "preco_adicional"."idade_maxima" >= "preco_adicional"."idade_minima")
);
--> statement-breakpoint
CREATE TABLE "preco_plano" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plano_id" uuid NOT NULL,
	"composicao" "composicao" NOT NULL,
	"valor_centavos" integer NOT NULL,
	"divulgado" boolean DEFAULT true NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preco_plano_unico_por_vigencia" UNIQUE("plano_id","composicao","vigencia_inicio"),
	CONSTRAINT "preco_plano_valor_nao_negativo" CHECK ("preco_plano"."valor_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "versao_adicional" (
	"versao_id" uuid NOT NULL,
	"adicional_id" uuid NOT NULL,
	CONSTRAINT "versao_adicional_versao_id_adicional_id_pk" PRIMARY KEY("versao_id","adicional_id")
);
--> statement-breakpoint
CREATE TABLE "versao_contrato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"plano_id" uuid NOT NULL,
	"composicao" "composicao" NOT NULL,
	"forma_pagamento" "forma_pagamento" NOT NULL,
	"dia_vencimento" integer NOT NULL,
	"valor_mensal_centavos" integer NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	"motivo" text NOT NULL,
	"autor" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versao_numero_unico_no_contrato" UNIQUE("contrato_id","numero"),
	CONSTRAINT "versao_valor_nao_negativo" CHECK ("versao_contrato"."valor_mensal_centavos" >= 0),
	CONSTRAINT "versao_dia_vencimento_valido" CHECK ("versao_contrato"."dia_vencimento" BETWEEN 1 AND 31),
	CONSTRAINT "versao_vigencia_valida" CHECK ("versao_contrato"."vigencia_fim" IS NULL OR "versao_contrato"."vigencia_fim" >= "versao_contrato"."vigencia_inicio")
);
--> statement-breakpoint
CREATE TABLE "vida" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"pessoa_id" uuid NOT NULL,
	"papel" "papel_vida" NOT NULL,
	"parentesco" text,
	"data_entrada" date NOT NULL,
	"data_saida" date,
	"motivo_saida" text,
	"autor_saida" text,
	"carencia_funeral_inicio" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vida_dependente_tem_parentesco" CHECK ("vida"."papel" = 'titular' OR "vida"."parentesco" IS NOT NULL),
	CONSTRAINT "vida_saida_tem_motivo_e_autor" CHECK ("vida"."data_saida" IS NULL OR ("vida"."motivo_saida" IS NOT NULL AND "vida"."autor_saida" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_fatura_id_fatura_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."fatura"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condicao_especial" ADD CONSTRAINT "condicao_especial_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contato" ADD CONSTRAINT "contato_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_titular_id_pessoa_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."pessoa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato" ADD CONSTRAINT "contrato_origem_id_origem_id_fk" FOREIGN KEY ("origem_id") REFERENCES "public"."origem"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fatura" ADD CONSTRAINT "fatura_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_status" ADD CONSTRAINT "historico_status_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_financeiro" ADD CONSTRAINT "lancamento_financeiro_fatura_id_fatura_id_fk" FOREIGN KEY ("fatura_id") REFERENCES "public"."fatura"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_forma_pagamento" ADD CONSTRAINT "plano_forma_pagamento_plano_id_plano_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."plano"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco_adicional" ADD CONSTRAINT "preco_adicional_adicional_id_adicional_id_fk" FOREIGN KEY ("adicional_id") REFERENCES "public"."adicional"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco_plano" ADD CONSTRAINT "preco_plano_plano_id_plano_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."plano"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_adicional" ADD CONSTRAINT "versao_adicional_versao_id_versao_contrato_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."versao_contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_adicional" ADD CONSTRAINT "versao_adicional_adicional_id_adicional_id_fk" FOREIGN KEY ("adicional_id") REFERENCES "public"."adicional"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD CONSTRAINT "versao_contrato_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD CONSTRAINT "versao_contrato_plano_id_plano_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."plano"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vida" ADD CONSTRAINT "vida_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vida" ADD CONSTRAINT "vida_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contato_um_principal_por_tipo" ON "contato" USING btree ("pessoa_id","tipo") WHERE "contato"."principal" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "fatura_uma_valida_por_competencia" ON "fatura" USING btree ("contrato_id","competencia") WHERE "fatura"."status" <> 'cancelada';--> statement-breakpoint
CREATE UNIQUE INDEX "versao_uma_vigente_por_contrato" ON "versao_contrato" USING btree ("contrato_id") WHERE "versao_contrato"."vigencia_fim" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vida_pessoa_uma_vez_no_contrato" ON "vida" USING btree ("contrato_id","pessoa_id") WHERE "vida"."data_saida" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vida_um_titular_por_contrato" ON "vida" USING btree ("contrato_id") WHERE "vida"."papel" = 'titular' AND "vida"."data_saida" IS NULL;