# Payments (Fase 7 / Epic #8 / T8)

## Princípios

- **Nunca** armazenar dados de cartão (PAN, CVV, etc.)
- **Nunca** colocar credenciais no código — só `process.env`
- Webhooks idempotentes via `payment_events (provider, external_event_id)` UNIQUE
- PIX: dinâmico (Mercado Pago) se `MP_ACCESS_TOKEN`; senão estático EMV

## Env (sandbox / produção)

| Variável | Uso |
|----------|-----|
| `MP_ACCESS_TOKEN` | Token MP (teste ou prod) — ativa PIX dinâmico |
| `MP_WEBHOOK_SECRET` | Opcional; se setado, exige header de assinatura |
| `MP_NOTIFICATION_URL` | URL pública do webhook enviada ao criar payment |
| `MP_API_BASE` | Default `https://api.mercadopago.com` |
| `PIX_CHAVE` / `PIX_NOME` / `PIX_CIDADE` | Fallback estático global |

## Fluxo PIX dinâmico

1. `POST /api/payments` com `method: PIX` → cria payment no MP → grava `provider_payment_id` + `pix_copy_paste`
2. Cliente paga → MP notifica `POST /api/payments/webhooks/mercadopago`
3. Evento inserido em `payment_events` (duplicata → 200 `{ duplicate: true }`)
4. Se status `approved` no MP → marca payment `PAID`

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/payments/pix-config` | tenant |
| POST | `/api/payments` | tenant (+ Idempotency-Key) |
| GET | `/api/payments/:id` | tenant |
| GET | `/api/payments?sessionId=` | staff |
| POST | `/api/payments/:id/confirm` | staff |
| POST | `/api/payments/webhooks/:provider` | público |
