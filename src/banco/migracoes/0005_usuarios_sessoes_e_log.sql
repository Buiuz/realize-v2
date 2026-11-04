CREATE TYPE "public"."perfil_usuario" AS ENUM('super_admin', 'adm_operacional', 'financeiro', 'gestor_comercial', 'atendimento', 'vendedor', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."resultado_log" AS ENUM('ok', 'negado', 'falha');--> statement-breakpoint
CREATE TABLE "log_auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" uuid,
	"usuario_nome" text NOT NULL,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"detalhe" text,
	"resultado" "resultado_log" DEFAULT 'ok' NOT NULL,
	"origem" text DEFAULT 'tela' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"encerrada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessao_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cpf" varchar(11) NOT NULL,
	"email" text NOT NULL,
	"login" text NOT NULL,
	"perfil" "perfil_usuario" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"senha_hash" text NOT NULL,
	"trocar_senha" boolean DEFAULT true NOT NULL,
	"tentativas_erradas" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_cpf_unique" UNIQUE("cpf"),
	CONSTRAINT "usuario_email_unique" UNIQUE("email"),
	CONSTRAINT "usuario_login_unique" UNIQUE("login"),
	CONSTRAINT "usuario_cpf_11_digitos" CHECK ("usuario"."cpf" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION impedir_alteracao_log() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'O log de auditoria não pode ser alterado nem apagado';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER log_auditoria_somente_inclusao BEFORE UPDATE OR DELETE ON log_auditoria
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_log();
--> statement-breakpoint
CREATE TRIGGER log_auditoria_sem_limpeza BEFORE TRUNCATE ON log_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION impedir_alteracao_log();
--> statement-breakpoint
CREATE TRIGGER usuario_sem_exclusao BEFORE DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
