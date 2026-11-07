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
| POST | `/api/billing/webhooks/:provider` | HMAC obrigatório; somente mock configurado |

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
| `BILLING_WEBHOOK_SECRET_MOCK_BILLING` | segredo HMAC do contrato mock |

## Webhook de billing endurecido (contrato mock)

Apenas `mock_billing` tem contrato de webhook implementado. Sem
`BILLING_WEBHOOK_SECRET_MOCK_BILLING` a rota retorna 404; providers reais e
providers desconhecidos permanecem desabilitados, mesmo com variável de segredo.
Use segredo aleatório forte, distinto dos demais. `x-billing-signature` (ou
`x-signature`) contém HMAC-SHA256 hexadecimal do **corpo JSON bruto**, com
prefixo opcional `sha256=`. Enviar, por exemplo, `id` (ID único do evento),
`subscription_id` (referência externa registrada) e `type` (um dos tipos de
assinatura suportados na rota). `storeId` é opcional e, se fornecido, deve
coincidir com a loja da assinatura resolvida pelo par provider/referência.
O segredo simples no header deixa de ser aceito: integração anterior precisa
ser atualizada antes de habilitar a rota. A migration 0030 é obrigatória.

O evento e a alteração são atômicos; IDs repetidos com mesmo corpo são no-op,
e IDs reaproveitados com outro corpo são rejeitados. O hash é persistido, não
os dados brutos. A deduplicação não protege contra eventos antigos com IDs
*distintos* ou reordenação: provedores reais precisam de adaptador específico,
verificação de assinatura e política de ordem/tempo/reconciliação antes de uso.
Checkout de billing continua mock/placeholder, não é integração de produção.
