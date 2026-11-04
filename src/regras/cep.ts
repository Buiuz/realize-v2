export type EnderecoCep = {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

/**
 * Busca o endereço pelo CEP no serviço público ViaCEP. Só o CEP é enviado.
 * Devolve null se não encontrar ou se o serviço falhar: nos dois casos,
 * os campos ficam livres para digitação manual (PRD 2.1).
 */
export async function consultarCep(
  valor: string,
  buscar: typeof fetch = fetch,
): Promise<EnderecoCep | null> {
  const cep = valor.replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) return null;

  try {
    const resposta = await buscar(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    if (dados.erro) return null;
    return {
      logradouro: dados.logradouro ?? "",
      bairro: dados.bairro ?? "",
      cidade: dados.localidade ?? "",
      uf: dados.uf ?? "",
    };
  } catch {
    return null;
  }
}
