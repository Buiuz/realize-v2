import { describe, expect, it } from "vitest";
import {
  aplicarDesconto,
  calcularIdade,
  calcularMensalidade,
  podeContratarNovaFaixa,
  type EntradaCalculo,
  type FaixaPreco,
} from "../src/regras/precos";

const faixa = (
  idadeMinima: number,
  idadeMaxima: number | null,
  valorCentavos: number,
  idadeMaximaNovaContratacao: number | null = null,
): FaixaPreco => ({ idadeMinima, idadeMaxima, valorCentavos, idadeMaximaNovaContratacao });

const FUNERAL = [faixa(0, 64, 0, 80), faixa(65, 70, 1990, 80), faixa(71, null, 4990, 80)];
const EXTRA = [faixa(0, 64, 1490), faixa(65, null, 3990)];

function entrada(campos: Partial<EntradaCalculo> = {}): EntradaCalculo {
  return {
    valorPlanoCentavos: 14990,
    idadesComFuneral: [],
    idadesDependentesExtras: [],
    faixasFuneral: FUNERAL,
    faixasDependenteExtra: EXTRA,
    cupom: null,
    ...campos,
  };
}

describe("exemplos do PRD", () => {
  it("Total familiar com funeral e duas vidas de 66 anos: R$ 189,70", () => {
    const r = calcularMensalidade(entrada({ idadesComFuneral: [66, 66] }));
    expect(r.valorFuneralCentavos).toBe(3980);
    expect(r.mensalidadeCentavos).toBe(18970);
    expect(r.valorMensalCentavos).toBe(18970);
  });

  it("Cupom de 50% recorrente sobre R$ 189,70: R$ 94,85 em todas", () => {
    const r = calcularMensalidade(
      entrada({ idadesComFuneral: [66, 66], cupom: { percentual: 50, recorrente: true } }),
    );
    expect(r.valorPrimeiraMensalidadeCentavos).toBe(9485);
    expect(r.valorMensalCentavos).toBe(9485);
  });
});

describe("funeral por faixa de idade", () => {
  const valor = (idade: number) =>
    calcularMensalidade(entrada({ idadesComFuneral: [idade] })).valorFuneralCentavos;

  it("usa o valor certo em cada limite", () => {
    expect(valor(64)).toBe(0);
    expect(valor(65)).toBe(1990);
    expect(valor(70)).toBe(1990);
    expect(valor(71)).toBe(4990);
    expect(valor(85)).toBe(4990);
  });

  it("aceita nova contratação até 80 anos, e não a partir de 81", () => {
    expect(podeContratarNovaFaixa(FUNERAL, 80)).toBe(true);
    expect(podeContratarNovaFaixa(FUNERAL, 81)).toBe(false);
  });
});

describe("dependente extra", () => {
  const valor = (idade: number) =>
    calcularMensalidade(entrada({ idadesDependentesExtras: [idade] })).valorDependenteExtraCentavos;

  it("cobra R$ 14,90 até 64 anos e R$ 39,90 a partir de 65", () => {
    expect(valor(64)).toBe(1490);
    expect(valor(65)).toBe(3990);
  });

  it("soma na mensalidade antes do cupom", () => {
    const r = calcularMensalidade(
      entrada({ idadesDependentesExtras: [30], cupom: { percentual: 50, recorrente: true } }),
    );
    expect(r.mensalidadeCentavos).toBe(16480);
    expect(r.valorMensalCentavos).toBe(8240);
  });
});

describe("cupom", () => {
  it("só na primeira: as seguintes voltam ao valor cheio", () => {
    const r = calcularMensalidade(entrada({ cupom: { percentual: 50, recorrente: false } }));
    expect(r.valorPrimeiraMensalidadeCentavos).toBe(7495);
    expect(r.valorMensalCentavos).toBe(14990);
  });

  it("arredonda só no final, com metade para cima", () => {
    // R$ 89,90 com 45% de desconto = R$ 49,445, que vira R$ 49,45.
    expect(aplicarDesconto(8990, 45)).toBe(4945);
  });

  it("não sai do centavo inteiro", () => {
    for (let valor = 1; valor < 3000; valor += 37) {
      for (const percentual of [1, 33, 45, 50, 99, 100]) {
        expect(Number.isInteger(aplicarDesconto(valor, percentual))).toBe(true);
      }
    }
  });

  it("100% zera o valor", () => {
    expect(aplicarDesconto(8990, 100)).toBe(0);
  });
});

describe("idade", () => {
  it("só muda depois do aniversário", () => {
    expect(calcularIdade("1960-03-15", "2026-03-14")).toBe(65);
    expect(calcularIdade("1960-03-15", "2026-03-15")).toBe(66);
    expect(calcularIdade("1960-03-15", "2026-11-04")).toBe(66);
  });

  it("nascido em 29 de fevereiro faz aniversário em 1º de março", () => {
    expect(calcularIdade("2000-02-29", "2026-02-28")).toBe(25);
    expect(calcularIdade("2000-02-29", "2026-03-01")).toBe(26);
  });
});
