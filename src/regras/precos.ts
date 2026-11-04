// Motor de preços (PRD 3.2): a mesma conta para todas as telas. Sem acesso ao banco.

export type FaixaPreco = {
  idadeMinima: number;
  idadeMaxima: number | null;
  valorCentavos: number;
  idadeMaximaNovaContratacao: number | null;
};

export type DadosCupom = { percentual: number; recorrente: boolean };

export type EntradaCalculo = {
  valorPlanoCentavos: number;
  /** Idade de cada vida com funeral. */
  idadesComFuneral: number[];
  /** Idade de cada dependente além dos incluídos no plano. */
  idadesDependentesExtras: number[];
  faixasFuneral: FaixaPreco[];
  faixasDependenteExtra: FaixaPreco[];
  cupom: DadosCupom | null;
};

export type ResultadoCalculo = {
  valorPlanoCentavos: number;
  valorFuneralCentavos: number;
  valorDependenteExtraCentavos: number;
  mensalidadeCentavos: number;
  valorPrimeiraMensalidadeCentavos: number;
  /** Valor das mensalidades seguintes. */
  valorMensalCentavos: number;
};

/** Idade completa na data informada. Datas no formato AAAA-MM-DD. */
export function calcularIdade(nascimento: string, data: string): number {
  const [anoN, mesN, diaN] = nascimento.split("-").map(Number);
  const [anoD, mesD, diaD] = data.split("-").map(Number);
  const fezAniversario = mesD > mesN || (mesD === mesN && diaD >= diaN);
  return anoD - anoN - (fezAniversario ? 0 : 1);
}

export function faixaDaIdade(faixas: FaixaPreco[], idade: number): FaixaPreco {
  const faixa = faixas.find(
    (f) => idade >= f.idadeMinima && (f.idadeMaxima === null || idade <= f.idadeMaxima),
  );
  if (!faixa) throw new Error(`Não há preço cadastrado para a idade ${idade}`);
  return faixa;
}

/** Acima do limite não entra nova contratação, mas quem já tem funeral mantém (PRD 3.2). */
export function podeContratarNovaFaixa(faixas: FaixaPreco[], idade: number): boolean {
  const limite = faixaDaIdade(faixas, idade).idadeMaximaNovaContratacao;
  return limite === null || idade <= limite;
}

/** Aplica o desconto e arredonda só no valor final, com metade para cima. Conta em números inteiros. */
export function aplicarDesconto(valorCentavos: number, percentual: number): number {
  return Math.floor((valorCentavos * (100 - percentual) + 50) / 100);
}

/** Quanto se paga na primeira mensalidade e nas seguintes, com ou sem cupom. */
export function aplicarCupom(mensalidadeCentavos: number, cupom: DadosCupom | null) {
  const comDesconto = cupom ? aplicarDesconto(mensalidadeCentavos, cupom.percentual) : mensalidadeCentavos;
  return {
    valorPrimeiraMensalidadeCentavos: comDesconto,
    valorMensalCentavos: cupom?.recorrente ? comDesconto : mensalidadeCentavos,
  };
}

function somar(faixas: FaixaPreco[], idades: number[]) {
  return idades.reduce((total, idade) => total + faixaDaIdade(faixas, idade).valorCentavos, 0);
}

export function calcularMensalidade(entrada: EntradaCalculo): ResultadoCalculo {
  const valorFuneralCentavos = somar(entrada.faixasFuneral, entrada.idadesComFuneral);
  const valorDependenteExtraCentavos = somar(
    entrada.faixasDependenteExtra,
    entrada.idadesDependentesExtras,
  );
  const mensalidadeCentavos =
    entrada.valorPlanoCentavos + valorFuneralCentavos + valorDependenteExtraCentavos;

  return {
    valorPlanoCentavos: entrada.valorPlanoCentavos,
    valorFuneralCentavos,
    valorDependenteExtraCentavos,
    mensalidadeCentavos,
    ...aplicarCupom(mensalidadeCentavos, entrada.cupom),
  };
}
