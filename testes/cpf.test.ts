import { describe, expect, it } from "vitest";
import { cpfValido, formatarCpf, gerarCpfFicticio, limparCpf } from "../src/regras/cpf";

describe("CPF", () => {
  it("aceita CPF gerado com dígitos verificadores corretos", () => {
    expect(cpfValido(gerarCpfFicticio("900000001"))).toBe(true);
  });

  it("aceita CPF com pontos e traço", () => {
    expect(cpfValido(formatarCpf(gerarCpfFicticio("900000002")))).toBe(true);
  });

  it("calcula os dígitos verificadores conforme a regra oficial", () => {
    expect(gerarCpfFicticio("123456789")).toBe("12345678909");
  });

  it("recusa dígito verificador errado", () => {
    const cpf = gerarCpfFicticio("900000001");
    const ultimoErrado = (Number(cpf[10]) + 1) % 10;
    expect(cpfValido(`${cpf.slice(0, 10)}${ultimoErrado}`)).toBe(false);
  });

  it("recusa sequências de um só número", () => {
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("00000000000")).toBe(false);
  });

  it("recusa tamanho errado e valor vazio", () => {
    expect(cpfValido("123")).toBe(false);
    expect(cpfValido("")).toBe(false);
    expect(cpfValido("123456789012")).toBe(false);
  });

  it("guarda só os números", () => {
    expect(limparCpf("123.456.789-09")).toBe("12345678909");
  });

  it("recusa base com tamanho errado ao gerar", () => {
    expect(() => gerarCpfFicticio("123")).toThrow();
  });
});
