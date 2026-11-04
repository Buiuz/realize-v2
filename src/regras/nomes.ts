// Como cada valor interno aparece para quem usa o sistema.

export const NOME_STATUS: Record<string, string> = {
  pendente: "Pendente",
  ativo: "Ativo",
  inadimplente: "Inadimplente",
  bloqueado: "Bloqueado",
  cancelamento_solicitado: "Cancelamento solicitado",
  cancelado: "Cancelado",
};

export const NOME_FORMA_PAGAMENTO: Record<string, string> = {
  cartao_recorrente: "Cartão recorrente",
  pix_automatico: "PIX Automático",
  carne: "Carnê",
};

export const NOME_ORIGEM: Record<string, string> = {
  vendedor: "Vendedor",
  link: "Link",
  cupom: "Cupom",
  influenciador: "Influenciador",
  site: "Site",
  balcao: "Balcão",
  reativacao: "Reativação",
  migracao: "Migração",
};

export const NOME_COMPOSICAO: Record<string, string> = {
  familiar: "Familiar",
  individual: "Individual",
};
