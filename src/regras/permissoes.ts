// Matriz de permissões por perfil. Os perfis ficam fixos aqui por enquanto: a edição por tela,
// prevista no PRD, vem depois de a matriz ser validada (pergunta 20 do PRD).

export const PERFIS = [
  "super_admin",
  "adm_operacional",
  "financeiro",
  "gestor_comercial",
  "atendimento",
  "vendedor",
  "auditor",
] as const;

export type Perfil = (typeof PERFIS)[number];

export const NOME_PERFIL: Record<Perfil, string> = {
  super_admin: "Super Admin",
  adm_operacional: "Adm. Operacional",
  financeiro: "Financeiro",
  gestor_comercial: "Gestor Comercial",
  atendimento: "Atendimento",
  vendedor: "Vendedor",
  auditor: "Auditor",
};

const SA: Perfil = "super_admin";
const ADM: Perfil = "adm_operacional";
const FIN: Perfil = "financeiro";
const GES: Perfil = "gestor_comercial";
const ATE: Perfil = "atendimento";
const VEN: Perfil = "vendedor";
const AUD: Perfil = "auditor";

type Regra = {
  nome: string;
  perfis: Perfil[];
  /** Definida na matriz de ações sensíveis do PRD; as demais são a proposta provisória. */
  doPrd?: boolean;
  /** Ainda não existe tela para esta ação no protótipo. */
  semTela?: boolean;
};

export const PERMISSOES = {
  // Definidas no PRD
  cancelar_contrato: { nome: "Cancelar contrato (pedido, retenção e confirmação)", perfis: [SA, ADM, ATE], doPrd: true },
  bloquear_contrato: { nome: "Bloquear contrato manualmente", perfis: [SA, ADM, ATE], doPrd: true },
  cancelar_fatura: { nome: "Cancelar fatura", perfis: [SA, ADM, FIN], doPrd: true, semTela: true },
  reverter_pagamento: { nome: "Reverter pagamento / estorno", perfis: [SA, FIN], doPrd: true, semTela: true },
  alterar_valor: { nome: "Alterar plano, composição ou valor", perfis: [SA, ADM, FIN], doPrd: true },
  liberar_excecao: { nome: "Liberar exceção de dependente", perfis: [SA, ADM, ATE], doPrd: true },
  configurar_cupom: { nome: "Configurar cupom", perfis: [SA, GES], doPrd: true, semTela: true },
  configurar_regua: { nome: "Configurar régua de cobrança", perfis: [SA, ADM, FIN], doPrd: true, semTela: true },
  exportar_base: {
    nome: "Exportar base / consulta em massa",
    perfis: [SA, ADM, FIN, GES, AUD],
    doPrd: true,
    semTela: true,
  },
  configurar_usuarios: { nome: "Configurar usuários e perfis", perfis: [SA], doPrd: true },

  // Proposta provisória
  cadastrar_pessoa: { nome: "Cadastrar pessoa", perfis: [SA, ADM, ATE] },
  criar_contrato: { nome: "Criar contrato", perfis: [SA, ADM, ATE] },
  gerir_dependentes: { nome: "Incluir e remover dependente", perfis: [SA, ADM, ATE] },
  pedir_excecao: { nome: "Pedir exceção de dependente", perfis: [SA, ADM, ATE] },
  negociar_bloqueio: { nome: "Negociar bloqueio", perfis: [SA, ADM, FIN] },
  registrar_pagamento_adesao: { nome: "Registrar pagamento da adesão", perfis: [SA, ADM, FIN, ATE] },
  registrar_assinatura: { nome: "Registrar assinatura", perfis: [SA, ADM, ATE] },
  gerar_fatura_teste: { nome: "Gerar fatura de teste", perfis: [SA, ADM, FIN] },
  baixar_fatura: { nome: "Dar baixa em fatura", perfis: [SA, ADM, FIN, ATE] },
  configurar_prazos: { nome: "Configurar prazos X e Y", perfis: [SA, ADM, FIN] },
  rodar_rotina: { nome: "Rodar rotina diária", perfis: [SA, ADM] },
  ver_usuarios: { nome: "Ver usuários e perfis", perfis: [SA, AUD] },
  ver_auditoria: { nome: "Ver log de auditoria", perfis: [SA, AUD] },
  ver_conferencia: { nome: "Ver conferência do banco", perfis: [SA, ADM, FIN, GES, ATE, AUD] },
  ver_cadastros: { nome: "Ver pessoas e contratos (Vendedor: só a própria carteira)", perfis: [SA, ADM, FIN, GES, ATE, VEN, AUD] },
} as const satisfies Record<string, Regra>;

export type Permissao = keyof typeof PERMISSOES;

export function tem(perfil: Perfil, permissao: Permissao): boolean {
  return (PERMISSOES[permissao].perfis as readonly Perfil[]).includes(perfil);
}
