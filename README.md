# Realize V2 — Protótipo

Protótipo para validar o escopo do PRD. Não é o sistema de produção e usa somente dados fictícios.
As regras do projeto estão em [CLAUDE.md](CLAUDE.md).

## Como ver funcionando

```bash
npm run dev
```

Depois abra http://localhost:3000 no navegador. A conferência do banco fica em http://localhost:3000/conferencia. O banco local é criado sozinho na primeira vez.

## Como entrar

Na primeira preparação do banco, o sistema cria um usuário fictício por perfil, com senha aleatória. Os acessos ficam em `.dados/credenciais-teste.txt`, fora do Git.

## Como rodar os testes

```bash
npm test
```

## Onde fica cada coisa

| Pasta | O que tem |
|---|---|
| `src/app` | Telas |
| `src/regras` | Regras de negócio |
| `src/banco` | Estrutura do banco e dados fictícios |
| `testes` | Testes automáticos |

Para recomeçar com um banco limpo, pare o servidor e apague a pasta `.dados`.
