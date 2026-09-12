# Delivery (Fase 6 / Epic #7)

## Modelo

- **Zonas** por loja: taxa fixa, pedido mínimo, ETA min/max
- **Pedido delivery**: `orders.channel = DELIVERY` + linha em `delivery_orders` (endereço + fee snapshot)
- Tracking: status do pedido + SSE já existente (`order.created`, `order.status_changed`)

## Rotas

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/delivery/zones` | tenant (público da loja) |
| GET | `/api/delivery/zones/admin` | staff |
| POST | `/api/delivery/zones` | staff |
| PATCH | `/api/delivery/zones/:id` | staff |
| POST | `/api/delivery/quote` | tenant |
| POST | `/api/delivery/orders` | tenant |
| GET | `/api/delivery/orders/:orderId` | tenant (tracking) |

## Isolamento

Tudo filtrado por `store_id`. Zona de outra loja → 404.
