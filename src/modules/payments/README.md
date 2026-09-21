> **Contrato de autenticação atualizado:** IDs não autorizam mais acesso ao fluxo
> mesa/QR. Pedidos, pagamentos e carrinho exigem JWT customer ou cookie staff com
> permissão. Veja [CUSTOMER-SESSIONS.md](../../../docs/CUSTOMER-SESSIONS.md).

# Payments (Fase 7 / Epic #8)

## Princípios

- **Nunca** armazenar dados de cartão (PAN, CVV, etc.) — `findForbiddenCardField` no POST
- Webhooks **idempotentes** via `payment_events (provider, external_event_id)` UNIQUE
- PIX estático (EMV) na v1; cartão via adapter (`provider-adapter.js`) + webhook
- Confirmação explícita (staff `POST /:id/confirm` ou webhook HMAC)
- Body do webhook **não é confiável** (storeId/paymentId ignorados); resolução por
  `(provider, provider_payment_id)`

## Tabelas

- `payments` — PENDING → PAID / FAILED / CANCELLED / REFUNDED
- `payment_events` — log de webhooks; duplicata não reprocessa; payload redigido

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/payments/pix-config` | tenant |
| POST | `/api/payments` | customer JWT ou `payments.create` |
| GET | `/api/payments/:id` | customer ou `payments.read` |
| GET | `/api/payments?sessionId=&orderId=` | staff `payments.read` |
| POST | `/api/payments/:id/confirm` | staff `payments.confirm` |
| POST | `/api/payments/:id/refund` | staff `payments.refund` |
| POST | `/api/payments/webhooks/:provider` | público + HMAC (`WEBHOOK_SECRET_<PROVIDER>`) |

## Cartão (CARD)

- API **não aceita** PAN/CVV/token (`CARD_DATA_FORBIDDEN`)
- `provider-adapter.js` gera `provider` + `providerPaymentId` (mock ou `CARD_PROVIDER`)
- Confirmação: webhook autenticado **ou** staff confirm
- Provider real (MP/Stripe) pluga no adapter sem mudar o modelo

## Config PIX

Por loja em `stores.settings.pix`:

```json
{ "key": "email@ou-cpf", "name": "NOME", "city": "CIDADE" }
```

Ou env: `PIX_CHAVE`, `PIX_NOME`, `PIX_CIDADE`.

## Webhook

```bash
export WEBHOOK_SECRET_MERCADOPAGO=...
# POST /api/payments/webhooks/mercadopago
# Header: x-signature: sha256=<hmac do body bruto>
```

Testes: `test/isolation/payment-webhook.test.js`.
