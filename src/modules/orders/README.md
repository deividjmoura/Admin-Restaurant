> **Contrato de autenticação atualizado:** IDs não autorizam mais acesso ao fluxo
> mesa/QR. Pedidos, pagamentos e carrinho exigem JWT customer ou cookie staff com
> permissão. Veja [CUSTOMER-SESSIONS.md](../../../docs/CUSTOMER-SESSIONS.md).

# Orders module

## Status machine (order — backend only)

```text
PENDING → CONFIRMED → PREPARING → READY → DELIVERED
                ↘ CANCELLED (from PENDING / CONFIRMED / PREPARING)
```

## Status machine (item)

```text
PENDING → PREPARING → READY → DELIVERED
                  ↘ CANCELLED
```

Quando todos os itens de um pedido chegam em READY/DELIVERED/CANCELLED, o pedido pai é avançado automaticamente (best-effort).

## Routes

| Method | Path | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/orders` | tenant | Cria pedido (idempotente) |
| GET | `/api/orders/:id` | tenant | Detalhe do pedido |
| POST | `/api/orders/:id/cancel` | tenant | Cancelamento pelo cliente (janela) |
| PATCH | `/api/orders/:id/status` | tenant + store | Transição de status do pedido |
| PATCH | `/api/orders/items/:itemId/status` | tenant + store | Transição de status do item |
| GET | `/api/waiter/ready-items` | tenant + store | Itens READY (garçom) |
| PATCH | `/api/waiter/items/:itemId/deliver` | tenant + store | Marca item como DELIVERED |
| GET | `/api/cashier/sessions` | tenant + store | Sessões abertas + totais |
| GET | `/api/cashier/sessions/:id` | tenant + store | Detalhe / consumo da sessão |
| POST | `/api/cashier/sessions/:id/close` | tenant + store | Fecha sessão e libera mesa |

### Create body

```json
{
  "tableSessionId": "uuid-optional",
  "channel": "TABLE",
  "notes": null,
  "idempotencyKey": "client-generated-key",
  "items": [
    { "productId": "uuid", "quantity": 1, "addonIds": [], "notes": null }
  ]
}
```

Header `Idempotency-Key` is also accepted.

## Rules
- Prices always from DB (snapshot)
- Same idempotency key → same order (200 replay)
- Invalid status transition → 409
- Item status changes emit `order.item_status_changed` / `order.item_delivered`
- Session close emits `session.closed`
- Totals no caixa ignoram itens CANCELLED
