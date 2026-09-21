# Billing — planos e assinaturas (issue #61)

## Modelo

- `plans` — catálogo (Start, Gestão, Enterprise)
- `subscriptions` — 1 por `store_id` (trial / active / past_due / cancelled / suspended)
- Lojas **sem** assinatura = `legacy` (tudo liberado) até o onboarding forçar plano

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/billing/plans` | público |
| GET | `/api/billing/subscription` | staff da loja |
| POST | `/api/billing/subscribe` | `store.settings.write` |
| POST | `/api/billing/webhooks/:provider` | público (+ `BILLING_WEBHOOK_SECRET_*`) |

## Feature-gating

```js
import { resolveEntitlements, hasModule } from './billing.repository.js';

const ent = await resolveEntitlements(storeId);
if (!hasModule(ent, 'delivery')) {
  throw new AppError('PLAN_FEATURE_LOCKED', 'Delivery não incluso no plano.', 403);
}
```

Status `cancelled` / `suspended` → `allowed: false`.

## Gateway

`gateway.js` — mock por padrão (`BILLING_PROVIDER=mock_billing`). Checkout hospedado e webhooks reais entram sem mudar tabelas.

## Env

| Var | Uso |
|-----|-----|
| `BILLING_PROVIDER` | `mock_billing` (default) |
| `BILLING_CHECKOUT_BASE_URL` | URL do checkout hospedado |
| `BILLING_WEBHOOK_SECRET_<PROVIDER>` | validação simples de assinatura |
