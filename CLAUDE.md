# Realize V2 — Protótipo

## O que é este projeto
Protótipo da plataforma própria de gestão da **Realize** (benefícios de saúde e assistência: rede credenciada com preços reduzidos, telemedicina, funeral), em Araruama/Iguaba Grande (RJ).
O V2 vai substituir aos poucos o ERP atual (Core/Limber).

**Este repositório é um protótipo para validar o escopo (PRD) e aprender.** Ele NÃO é o sistema de produção. Nenhum cliente real usa este código.

O escopo completo está no Notion: "PRD — Ecossistema Realize V2" (responsável: Bruno; validação de negócio: Vinicius; validação técnica: Nicolas).

## Quem está pedindo
O Bruno é responsável pelo produto e **não sabe programar**. Por isso:
- Sempre responda em **português do Brasil**, em linguagem simples, sem jargão. Quando um termo técnico for necessário, explique em uma frase.
- Antes de uma mudança grande, explique o plano em poucos passos e espere o "ok".
- Ao terminar cada tarefa, diga: (1) o que foi feito, (2) como ver funcionando, (3) qual o próximo passo sugerido.
- Faça uma coisa por vez. Prefira entregas pequenas que funcionam a entregas grandes pela metade.
- Se algo do escopo estiver ambíguo, pergunte em vez de inventar uma regra de negócio.

## Regras que não podem ser quebradas
- **Somente dados fictícios.** Nunca usar CPF, nome, telefone ou endereço de pessoas reais (LGPD). Gere CPFs fictícios válidos para testes.
- Nenhum segredo (senha, chave de API) dentro do código. Usar variáveis de ambiente (.env, fora do Git).
- Toda regra de negócio (preço, permissão, status) fica no **servidor**, nunca só na tela.
- Valores em dinheiro guardados em **centavos** (número inteiro).
- Datas no banco em UTC, exibidas no fuso America/Sao_Paulo.
- **Nada é apagado de verdade**: contrato, fatura, pagamento e log usam status/cancelamento com motivo e autor.
- Toda mudança de status do contrato gera histórico (anterior, novo, data, autor, motivo, manual/automático).

## Stack
- Next.js (TypeScript) para telas e API.
- PostgreSQL (no futuro via Supabase). No começo do protótipo, pode rodar com banco local, sem contas externas.
- Interface simples, mobile-first onde fizer sentido, em português.

## Ordem de construção (primeiras etapas)
1. **Modelo de dados** (Bloco 2 do PRD): Pessoa, Empresa contratante, Produto/Plano, Adicional, Contrato (versionado), Vida, Canal/Origem, Condição especial, Fatura, Cobrança, Lançamento financeiro.
2. **Cadastro de titular** (2.1): nome, CPF válido e único, nascimento, celular, e-mail, CEP com endereço automático.
3. **Contrato pessoa física** (2.2): plano, adicionais, origem obrigatória, forma de pagamento, dia de vencimento; nasce "Pendente".
4. **Dependentes** (2.3): até 3 incluídos; 4º em diante cobra extra (R$ 14,90 até 64 anos; R$ 39,90 a partir de 65); vaga removida fica bloqueada 90 dias; CPF não pode estar em outro contrato ativo.
5. **Status do contrato** (2.6): Pendente → Ativo → Inadimplente → Bloqueado; Cancelamento solicitado → Cancelado. Prazos X e Y ainda não definidos: deixar configuráveis.
6. **Perfis de acesso** (Personas & Papéis): Super Admin, Adm. Operacional, Financeiro, Gestor Comercial, Atendimento, Vendedor, Auditor.

Fora do protótipo por enquanto: gateway de pagamento, NFS-e, TopMed, WhatsApp, assinatura eletrônica, migração do Core.

## Testes
Criar testes automáticos para as regras críticas (CPF, limite de dependentes, preço do dependente extra, máquina de status).
