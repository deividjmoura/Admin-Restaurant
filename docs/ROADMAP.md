# Roadmap — Admin-Restaurant

> Fonte viva do plano de evolução. Issues seguem este documento.
> **Política explícita (2026-09-21):** não há mais “demo pública”. O projeto é tratado como **produção** multi-tenant desde já. Seed local (`db:seed`) existe só para desenvolvimento e testes; não há loja/feature/ambiente chamado “demo” como objetivo de produto.

## Estado atual (2026-09-21)

- **Backend:** caixa, observabilidade, multi-tenant, pedidos, delivery — suíte de isolamento.
- **Frontend produção:** dashboard (série/prep/live), KDS (`?station=`), EmptyStates, admin cardápio/mesas, garçom.
- **Caixa UI:** gaveta (`/api/cash/*`) + mesas (`/api/cashier/sessions`) + cobrança na gaveta em `CashierPage.jsx`.
- **Próximo:** smoke documentado + QA da UI de caixa — `docs/AGENT-BRIEF-SMOKE-CAIXA.md`.

## Fases

### Ondas 0–4 — fechadas (backend + fundação)
Multi-tenancy, cardápio, mesas, pedidos, delivery, caixa API, observabilidade, Redis.

### Onda 3 — Caixa
- [x] API gaveta / ledger / split / fechamento
- [x] UI `/cashier` (gaveta + mesas + pagamento)

### Onda 5 — Frontend de produção
- [x] Dashboard, KDS, EmptyState, admin, garçom
- [x] Caixa físico na UI
- [ ] SMOKE.md com fluxo de gaveta (`docs/AGENT-BRIEF-SMOKE-CAIXA.md`)
- [ ] Entry-contexts / build checklist contínuo

### Onda 6 — Hardening
- [ ] Fechar issues já entregues
- [ ] SECURITY.md alinhado a caixa + obs
- [ ] Resíduos de linguagem “demo” no seed (labels apenas)

### Onda 7 — Futuro
Rate-limit Redis, fila, fiscal, multiunidade, CRM…

## Como contribuir agora

1. Prioridade: **SMOKE do caixa** — `docs/AGENT-BRIEF-SMOKE-CAIXA.md`
2. Branch `feat/smoke-cash-ui`
3. `npm run test:suite` + `npm run web:build`
4. Sem modo demo / DEFAULT_STORE_SLUG

## Operação

```bash
npm ci && npm run db:migrate && npm run db:seed
npm run test:suite
npm run dev   # + npm run web
```

## Docs

- `src/modules/cash/README.md`
- `docs/AGENT-BRIEF-SMOKE-CAIXA.md`
- `docs/OBSERVABILITY.md`
