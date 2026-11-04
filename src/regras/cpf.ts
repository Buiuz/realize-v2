function digitoVerificador(digitos: string): number {
  const pesoInicial = digitos.length + 1;
  const soma = [...digitos].reduce(
    (total, digito, indice) => total + Number(digito) * (pesoInicial - indice),
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function limparCpf(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function cpfValido(valor: string): boolean {
  const cpf = limparCpf(valor);
  if (!/^\d{11}$/.test(cpf)) return false;
  // Sequências como 111.111.111-11 passam na conta, mas não são CPFs válidos.
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const primeiro = digitoVerificador(cpf.slice(0, 9));
  const segundo = digitoVerificador(cpf.slice(0, 10));
  return cpf.endsWith(`${primeiro}${segundo}`);
}

/** Completa uma base de 9 dígitos com os dígitos verificadores. Usar só com dados de teste. */
export function gerarCpfFicticio(base: string): string {
  if (!/^\d{9}$/.test(base)) throw new Error("A base do CPF precisa ter 9 dígitos");
  const primeiro = digitoVerificador(base);
  const segundo = digitoVerificador(`${base}${primeiro}`);
  return `${base}${primeiro}${segundo}`;
}

export function formatarCpf(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
