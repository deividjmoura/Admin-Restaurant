# Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Visão da arquitetura multi-tenant, pastas, papéis, eventos |
| [GOLDEN_RULES.md](./GOLDEN_RULES.md) | Checklist obrigatório antes de qualquer feature + prioridades |
| [DECISIONS.md](./DECISIONS.md) | Registro de decisões arquiteturais (ADR leve) |
| [SMOKE.md](./SMOKE.md) | Smoke **só de API** em 5–10 min (`curl`): login → mesa → pedido → cozinha → caixa + isolamento |

Ordem sugerida de leitura para novos contribuidores:

1. `ARCHITECTURE.md`
2. `GOLDEN_RULES.md`
3. `SMOKE.md` (subir a API e validar o fluxo ponta a ponta)
4. Issues do Epic de Fundação / Fase 1
