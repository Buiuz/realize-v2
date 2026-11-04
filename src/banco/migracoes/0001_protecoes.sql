-- Regra do projeto: nada é apagado de verdade. O próprio banco recusa, mesmo se o código errar.
CREATE FUNCTION impedir_exclusao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro de % não pode ser apagado: use cancelamento com motivo e autor', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contrato_sem_exclusao BEFORE DELETE ON contrato
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER versao_contrato_sem_exclusao BEFORE DELETE ON versao_contrato
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER versao_adicional_sem_exclusao BEFORE DELETE ON versao_adicional
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER vida_sem_exclusao BEFORE DELETE ON vida
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER historico_status_sem_exclusao BEFORE DELETE ON historico_status
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER condicao_especial_sem_exclusao BEFORE DELETE ON condicao_especial
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER fatura_sem_exclusao BEFORE DELETE ON fatura
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER cobranca_sem_exclusao BEFORE DELETE ON cobranca
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER lancamento_financeiro_sem_exclusao BEFORE DELETE ON lancamento_financeiro
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
-- O histórico de status é só de acréscimo.
CREATE FUNCTION impedir_alteracao_historico() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de status não pode ser alterado';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER historico_status_sem_alteracao BEFORE UPDATE ON historico_status
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_historico();
--> statement-breakpoint
-- Uma versão do contrato nunca é sobrescrita: só pode receber a data de fim da vigência.
CREATE FUNCTION proteger_versao_contrato() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'vigencia_fim') <> (to_jsonb(OLD) - 'vigencia_fim') THEN
    RAISE EXCEPTION 'Uma versão do contrato nunca é sobrescrita: crie uma nova versão';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER versao_contrato_sem_sobrescrita BEFORE UPDATE ON versao_contrato
  FOR EACH ROW EXECUTE FUNCTION proteger_versao_contrato();
