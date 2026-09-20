# Payments (Fase 7 / Epic #8)

## Princípios

- **Nunca** armazenar dados de cartão (PAN, CVV, etc.)
- Webhooks idempotentes via `payment_events (provider, external_event_id)` UNIQUE
- PIX estático (EMV) na v1; provider real entra depois sem quebrar o modelo
- Confirmação de pagamento é explícita (caixa ou webhook)

## Tabelas

- `payments` — PENDING → PAID / FAILED / CANCELLED / REFUNDED
- `payment_events` — log de webhooks; duplicata não reprocessa

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/payments/pix-config` | tenant |
| POST | `/api/payments` | tenant |
| GET | `/api/payments/:id` | tenant |
| GET | `/api/payments?sessionId=&orderId=` | staff |
| POST | `/api/payments/:id/confirm` | staff (`payments.confirm`) |
| POST | `/api/payments/:id/refund` | owner (`payments.refund`) |
| POST | `/api/payments/webhooks/:provider` | público (assinatura futura) |

## Pagamento parcial / combinado (issue #109)

Várias formas de pagamento no mesmo alvo numa **única transação** e com uma
`Idempotency-Key` (o grupo todo é idempotente):

```http
POST /api/cash/sessions/:cashSessionId/payments

{ "orderId": "...", "items": [
    { "method": "CASH", "amount": 40.00, "tenderedAmount": 50.00 },
    { "method": "PIX",  "amount": 60.00 } ] }
```

Regras: soma ≤ valor devido (senão `409 AMOUNT_EXCEEDS_DUE`); `CASH`/`CARD`/
`OTHER` já nascem `PAID` (presenciais), `PIX` fica `PENDING` até confirmar;
troco derivado no servidor; `CASH` lança `SALE` no ledger da gaveta na mesma
transação (ver [`../cash/README.md`](../cash/README.md)). Estorno é idempotente
por `(payment_id, type)` e devolve o dinheiro à gaveta como `REFUND`.

No `confirm`, o corpo aceita `{ cashSessionId?, tenderedAmount? }` — sem
`cashSessionId` usa-se a gaveta aberta do operador (resolvida no servidor).

## Config PIX

Por loja em `stores.settings.pix`:

```json
{ "key": "email@ou-cpf", "name": "NOME", "city": "CIDADE" }
```

Ou env global: `PIX_CHAVE`, `PIX_NOME`, `PIX_CIDADE`.
