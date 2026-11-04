CREATE TYPE "public"."status_excecao" AS ENUM('pendente', 'aprovada', 'recusada');--> statement-breakpoint
CREATE TYPE "public"."tipo_excecao" AS ENUM('nascimento', 'obito', 'divorcio');--> statement-breakpoint
CREATE TABLE "excecao_vaga" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"vida_removida_id" uuid NOT NULL,
	"tipo" "tipo_excecao" NOT NULL,
	"descricao" text,
	"status" "status_excecao" DEFAULT 'pendente' NOT NULL,
	"solicitada_por" text NOT NULL,
	"solicitada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidida_por" text,
	"decidida_em" timestamp with time zone,
	"motivo_decisao" text,
	CONSTRAINT "excecao_decisao_completa" CHECK (("excecao_vaga"."status" = 'pendente') = (num_nonnulls("excecao_vaga"."decidida_por", "excecao_vaga"."decidida_em", "excecao_vaga"."motivo_decisao") = 0)
        AND ("excecao_vaga"."status" = 'pendente' OR num_nonnulls("excecao_vaga"."decidida_por", "excecao_vaga"."decidida_em", "excecao_vaga"."motivo_decisao") = 3))
);
--> statement-breakpoint
ALTER TABLE "vida" ADD COLUMN "valor_funeral_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vida" ADD COLUMN "valor_extra_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vida" ADD COLUMN "vaga_bloqueada_ate" date;--> statement-breakpoint
ALTER TABLE "excecao_vaga" ADD CONSTRAINT "excecao_vaga_contrato_id_contrato_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contrato"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excecao_vaga" ADD CONSTRAINT "excecao_vaga_vida_removida_id_vida_id_fk" FOREIGN KEY ("vida_removida_id") REFERENCES "public"."vida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "excecao_uma_aberta_por_vaga" ON "excecao_vaga" USING btree ("vida_removida_id") WHERE "excecao_vaga"."status" <> 'recusada';--> statement-breakpoint
ALTER TABLE "vida" ADD CONSTRAINT "vida_valores_nao_negativos" CHECK (LEAST("vida"."valor_funeral_centavos", "vida"."valor_extra_centavos") >= 0);--> statement-breakpoint
-- Vidas já existentes: fixa os valores pela idade que tinham ao entrar no contrato.
UPDATE "vida" v SET "valor_funeral_centavos" = COALESCE((
	SELECT pa."valor_centavos"
	FROM "preco_adicional" pa
	JOIN "adicional" a ON a."id" = pa."adicional_id"
	JOIN "pessoa" p ON p."id" = v."pessoa_id"
	WHERE a."tipo" = 'funeral'
		AND date_part('year', age(v."data_entrada", p."data_nascimento")) >= pa."idade_minima"
		AND (pa."idade_maxima" IS NULL OR date_part('year', age(v."data_entrada", p."data_nascimento")) <= pa."idade_maxima")
	LIMIT 1
), 0)
WHERE v."carencia_funeral_inicio" IS NOT NULL;
--> statement-breakpoint
UPDATE "vida" v SET "valor_extra_centavos" = COALESCE((
	SELECT pa."valor_centavos"
	FROM "preco_adicional" pa
	JOIN "adicional" a ON a."id" = pa."adicional_id"
	JOIN "pessoa" p ON p."id" = v."pessoa_id"
	WHERE a."tipo" = 'dependente_extra'
		AND date_part('year', age(v."data_entrada", p."data_nascimento")) >= pa."idade_minima"
		AND (pa."idade_maxima" IS NULL OR date_part('year', age(v."data_entrada", p."data_nascimento")) <= pa."idade_maxima")
	LIMIT 1
), 0)
WHERE v."papel" = 'dependente';
--> statement-breakpoint
CREATE TRIGGER excecao_vaga_sem_exclusao BEFORE DELETE ON excecao_vaga
	FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
