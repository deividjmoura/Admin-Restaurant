# Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [AGENTES.md](./AGENTES.md) | **Guia dos agentes**: claim de tarefa, branch, PR, testes, DoD, backlog |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Visão da arquitetura multi-tenant, pastas, papéis, eventos |
| [GOLDEN_RULES.md](./GOLDEN_RULES.md) | Checklist obrigatório antes de qualquer feature + prioridades |
| [DECISIONS.md](./DECISIONS.md) | Registro de decisões arquiteturais (ADR leve) |
| [SMOKE.md](./SMOKE.md) | Smoke **só de API** em 5–10 min (`curl`): login → mesa → pedido → cozinha → caixa + isolamento |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | Logs estruturados, `/health`, `/ready`, `/metrics`, contexto de requisição |
| [../src/modules/cash/README.md](../src/modules/cash/README.md) | **Caixa**: gaveta, ledger, pagamento combinado, fechamento (#107–#110) |

Ordem sugerida de leitura para novos contribuidores:

1. `AGENTES.md` (como trabalhar aqui)
2. `ARCHITECTURE.md`
3. `GOLDEN_RULES.md`
4. `SMOKE.md` (subir a API e validar o fluxo ponta a ponta)
5. Issues do Epic de Fundação / Fase 1
