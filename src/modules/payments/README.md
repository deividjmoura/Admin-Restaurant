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
| POST | `/api/payments/:id/confirm` | staff |
| POST | `/api/payments/webhooks/:provider` | público (assinatura futura) |

## Config PIX

Por loja em `stores.settings.pix`:

```json
{ "key": "email@ou-cpf", "name": "NOME", "city": "CIDADE" }
```

Ou env global: `PIX_CHAVE`, `PIX_NOME`, `PIX_CIDADE`.
