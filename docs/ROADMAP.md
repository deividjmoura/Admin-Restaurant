# Roadmap — Admin-Restaurant

> Fonte viva do plano de evolução. Issues seguem este documento.
> **Política explícita (2026-09-21):** não há mais “demo pública”. O projeto é tratado como **produção** multi-tenant desde já. Seed local (`db:seed`) existe só para desenvolvimento e testes; não há loja/feature/ambiente chamado “demo” como objetivo de produto.

## Estado atual (2026-09-21)

- **Backend:** caixa, pagamentos (PIX + CARD adapter + webhooks), observabilidade, multi-tenant, pedidos, delivery.
- **Frontend produção:** dashboard, KDS (`?station=`), EmptyStates, admin, garçom, **caixa físico** (`/cashier`).
- **Epic #8 (pagamentos):** fechada — adapter CARD, rejeição de dados sensíveis, `providerPaymentId` no create.
- **Smoke caixa:** `docs/SMOKE-CAIXA.md` (API + checklist UI).

## Fases

### Ondas 0–4 — fechadas (backend + fundação)
Multi-tenancy, cardápio, mesas, pedidos, delivery, caixa API, observabilidade, Redis.

### Onda 3 — Caixa
- [x] API gaveta / ledger / split / fechamento
- [x] UI `/cashier` (gaveta + mesas + pagamento)
- [x] SMOKE gaveta — `docs/SMOKE-CAIXA.md`

### Onda 5 — Frontend de produção
- [x] Dashboard, KDS, EmptyState, admin, garçom, caixa
- [ ] Entry-contexts / build checklist contínuo (opcional)

### Onda 6 — Hardening
- [ ] Fechar issues já entregues no GitHub (#49 UI?, #50 SPA, #56 reports…)
- [ ] SECURITY.md alinhado
- [ ] CI suite completa (#53)

### Onda 7+ — Growth (#58)
Onboarding, billing, PIX dinâmico (#51), IA WhatsApp (#59)…

## Como contribuir agora

1. Exercitar **SMOKE-CAIXA** localmente e anotar gaps de UI
2. Fechar issues já implementadas (comentário + `gh issue close`)
3. `npm run test:suite` + `npm run web:build`
4. Sem modo demo / DEFAULT_STORE_SLUG de produto

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
