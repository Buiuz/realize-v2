CREATE TABLE "cupom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"percentual" integer NOT NULL,
	"recorrente" boolean NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cupom_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "cupom_percentual_valido" CHECK ("cupom"."percentual" BETWEEN 1 AND 100),
	CONSTRAINT "cupom_vigencia_valida" CHECK ("cupom"."vigencia_fim" >= "cupom"."vigencia_inicio")
);
--> statement-breakpoint
ALTER TABLE "versao_contrato" DROP CONSTRAINT "versao_valor_nao_negativo";--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "valor_plano_centavos" integer;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "valor_funeral_centavos" integer;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "valor_dependente_extra_centavos" integer;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "cupom_id" uuid;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "cupom_percentual" integer;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "cupom_recorrente" boolean;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD COLUMN "valor_primeira_mensalidade_centavos" integer;--> statement-breakpoint
-- Contratos já existentes: separa o valor do plano do restante, que até aqui só podia ser funeral.
-- A proteção contra sobrescrita fica desligada apenas durante esta atualização de estrutura.
ALTER TABLE "versao_contrato" DISABLE TRIGGER "versao_contrato_sem_sobrescrita";--> statement-breakpoint
UPDATE "versao_contrato" v SET
	"valor_plano_centavos" = p."valor_centavos",
	"valor_funeral_centavos" = v."valor_mensal_centavos" - p."valor_centavos",
	"valor_dependente_extra_centavos" = 0,
	"valor_primeira_mensalidade_centavos" = v."valor_mensal_centavos"
FROM "preco_plano" p
WHERE p."plano_id" = v."plano_id" AND p."composicao" = v."composicao";--> statement-breakpoint
ALTER TABLE "versao_contrato" ENABLE TRIGGER "versao_contrato_sem_sobrescrita";--> statement-breakpoint
ALTER TABLE "versao_contrato" ALTER COLUMN "valor_plano_centavos" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "versao_contrato" ALTER COLUMN "valor_funeral_centavos" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "versao_contrato" ALTER COLUMN "valor_dependente_extra_centavos" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "versao_contrato" ALTER COLUMN "valor_primeira_mensalidade_centavos" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD CONSTRAINT "versao_contrato_cupom_id_cupom_id_fk" FOREIGN KEY ("cupom_id") REFERENCES "public"."cupom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD CONSTRAINT "versao_cupom_completo" CHECK (num_nonnulls("versao_contrato"."cupom_id", "versao_contrato"."cupom_percentual", "versao_contrato"."cupom_recorrente") IN (0, 3));--> statement-breakpoint
ALTER TABLE "versao_contrato" ADD CONSTRAINT "versao_valor_nao_negativo" CHECK (LEAST("versao_contrato"."valor_plano_centavos", "versao_contrato"."valor_funeral_centavos", "versao_contrato"."valor_dependente_extra_centavos", "versao_contrato"."valor_primeira_mensalidade_centavos", "versao_contrato"."valor_mensal_centavos") >= 0);
