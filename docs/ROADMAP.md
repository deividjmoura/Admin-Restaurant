# Roadmap — Admin-Restaurant

> **Política:** produção multi-tenant. Seed local só para dev/testes — não há produto “demo”.

## Estado (2026-09-21)

- Núcleo operacional + SPA + CI (#53) fechados.
- **#52 jobs/worker** + **#61 billing** entregues nesta rodada.
- Pagamentos: PIX estático + CARD adapter; PIX dinâmico (#51) ainda aberto.

## Fechado recentemente

| Issue | Entrega |
|-------|----------|
| #52 | Fila `jobs`, worker, print mock, BACKUP.md |
| #61 | Planos, subscriptions, feature-gating, gateway mock |
| #53 | CI isolation suite |
| #8 | Payments + webhooks + CARD intent |

## Aberto (prioridade de negócio)

1. **#51** — PIX dinâmico (Mercado Pago)
2. **#59** — chatbot WhatsApp (growth)
3. Middleware global de feature-gating nas rotas (helper já existe)
4. Fiscal / multiunidade / financeiro (ondas 6–8)

## Operação local

```bash
git pull origin main
npm ci && npm run db:migrate && npm run db:seed
npm run test:suite
npm run dev
```

Docs: `src/modules/jobs/README.md` · `src/modules/billing/README.md` · `docs/BACKUP.md` · `docs/SMOKE-CAIXA.md`
