# Roadmap — Admin-Restaurant

> Fonte viva do plano de evolução. Issues seguem este documento.
> **Política explícita (2026-09-21):** não há mais “demo pública”. O projeto é tratado como **produção** multi-tenant desde já. Seed local (`db:seed`) existe só para desenvolvimento e testes; não há loja/feature/ambiente chamado “demo” como objetivo de produto.

## Estado atual (2026-09-21)

- **Backend:** caixa, pagamentos (PIX + CARD adapter + webhooks), delivery, menu admin, reports, observabilidade, multi-tenant.
- **Frontend produção:** dashboard, KDS, EmptyStates, admin, garçom, caixa, cliente.
- **CI (#53):** Postgres 18 + `test:suite` (fail 0 ∧ skipped 0 ∧ ≥281) + build frontend — **fechada**.
- **Issues fechadas nesta limpeza:** #7 delivery · #9 reports · #49 menu admin · #50 SPA · #53 CI · #47 ruído · #8 payments · #56 reports base.

## Fases

### Ondas 0–5 — fechadas (núcleo operacional)
Multi-tenancy, cardápio admin, mesas, pedidos, delivery, caixa API+UI, pagamentos, dashboard, SPA, CI.

### Onda 6 — Hardening (resto)
- [x] CI isolation suite (#53)
- [ ] SECURITY.md revisão final
- [ ] Workers/filas (#52 / #10 parcial — obs. já existe)

### Onda 7+ — Growth (#58) e financeiro
Onboarding, billing, PIX dinâmico (#51), cartão real (#62), IA WhatsApp (#59), fiscal, multiunidade…

## Como contribuir agora

1. Exercitar `docs/SMOKE.md` + `docs/SMOKE-CAIXA.md` localmente
2. Growth / PIX provider real (#51) ou billing (#61) conforme prioridade de negócio
3. `npm run test:suite` + `npm run web:build` antes de PR

## Operação

```bash
npm ci && npm run db:migrate && npm run db:seed
npm run test:suite
npm run dev   # + npm run web
```

## Docs

- `src/modules/cash/README.md` · `src/modules/payments/README.md`
- `docs/SMOKE.md` · `docs/SMOKE-CAIXA.md`
- `docs/OBSERVABILITY.md` · `docs/SECURITY.md`
