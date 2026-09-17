# Delivery (Fase 6 / Epic #7)

## Modelo

- **Zonas** por loja: taxa fixa, pedido mínimo, ETA min/max
- **Pedido delivery**: `orders.channel = DELIVERY` + linha em `delivery_orders` (endereço + fee snapshot)
- **Courier status** (independente da cozinha): `PENDING → CONFIRMED → OUT_FOR_DELIVERY → DELIVERED | CANCELLED`
- Tracking: status do pedido + SSE (`order.created`, `order.status_changed`, `delivery.courier_status_changed`)

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/delivery/zones` | tenant (público da loja) |
| GET | `/api/delivery/zones/admin` | staff |
| POST | `/api/delivery/zones` | staff |
| PATCH | `/api/delivery/zones/:id` | staff |
| POST | `/api/delivery/quote` | tenant |
| POST | `/api/delivery/orders` | tenant (+ Idempotency-Key) |
| GET | `/api/delivery/orders` | staff (lista ativos) |
| GET | `/api/delivery/orders/:orderId` | tenant (tracking) |
| PATCH | `/api/delivery/orders/:orderId/courier-status` | staff |

## Isolamento

Tudo filtrado por `store_id`. Zona/pedido de outra loja → 404.
