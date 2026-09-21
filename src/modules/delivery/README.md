# Delivery (Fase 6 / Epic #7)

## Modelo

- **Zonas** por loja: taxa fixa, pedido mínimo, ETA min/max
- **Pedido delivery**: `orders.channel = DELIVERY` + linha em `delivery_orders` (endereço + fee snapshot + segredo do checkout)
- **Credencial por checkout**: criação emite JWT customer próprio
  (`iss=restaurant:delivery`); tracking/cancelamento/pagamentos a exigem
  (ver [docs/DELIVERY-CHECKOUT.md](../../docs/DELIVERY-CHECKOUT.md))
- Tracking: status do pedido + SSE já existente (`order.created`, `order.status_changed`)

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/delivery/zones` | tenant (público da loja) |
| GET | `/api/delivery/zones/admin` | staff |
| POST | `/api/delivery/zones` | staff |
| PATCH | `/api/delivery/zones/:id` | staff |
| POST | `/api/delivery/quote` | tenant |
| POST | `/api/delivery/orders` | tenant (público, rate-limited; emite a credencial do checkout) |
| GET | `/api/delivery/orders/:orderId` | credencial do checkout **ou** staff `orders.read` |
| POST | `/api/delivery/orders/:orderId/cancel` | credencial própria (janela/status) **ou** staff `orders.status.write` |
| POST | `/api/delivery/orders/:orderId/credential/revoke` | staff `delivery.checkout.revoke` |

## Isolamento

Tudo filtrado por `store_id`. Zona de outra loja → 404. Credencial vale
somente para o `orderId` que ela identifica (404 para os demais, 403 para
outro host/outro plano). O segredo do checkout (`delivery_orders.checkout_token`)
nunca sai na API; girá-lo revoga as credenciais emitidas.

