// Regras de vagas de dependentes (PRD 2.3 e decisões provisórias 3 a 6). Sem acesso ao banco.

export type SituacaoVagas = {
  /** Vagas incluídas no plano que podem ser usadas hoje. */
  capacidade: number;
  bloqueiosVigentes: string[];
  /** Dependentes que pagam como extra: sempre os últimos incluídos. */
  extras: string[];
  /** Vagas incluídas que estão livres e não bloqueadas. */
  vagasLivres: number;
};

/**
 * @param dependentes ids dos dependentes ativos, do primeiro ao último incluído
 * @param bloqueios data em que cada vaga bloqueada libera (AAAA-MM-DD), já sem as exceções aprovadas
 */
export function calcularVagas(
  dependentes: string[],
  bloqueios: string[],
  incluidos: number,
  hoje: string,
): SituacaoVagas {
  const bloqueiosVigentes = bloqueios.filter((data) => hoje < data).sort();
  const capacidade = Math.max(0, incluidos - bloqueiosVigentes.length);
  return {
    capacidade,
    bloqueiosVigentes,
    extras: dependentes.slice(capacidade),
    vagasLivres: Math.max(0, capacidade - dependentes.length),
  };
}

export function adicionarDias(data: string, dias: number): string {
  const momento = new Date(`${data}T00:00:00Z`);
  momento.setUTCDate(momento.getUTCDate() + dias);
  return momento.toISOString().slice(0, 10);
}
