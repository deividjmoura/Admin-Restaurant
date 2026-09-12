# Orders module

## Status machine (backend only)

```text
PENDING → CONFIRMED → PREPARING → READY → DELIVERED
                ↘ CANCELLED (from PENDING/CONFIRMED/PREPARING)
```

## Tables
- `orders` — `store_id`, optional `table_session_id`, `idempotency_key`
- `order_items` — price/name **snapshots**
- `order_item_addons` — addon snapshots

## Rules
- Never trust client prices
- Same `idempotency_key` + `store_id` → same order (no duplicate)
- All queries filter by `store_id`

## Next
- HTTP routes POST /api/orders + PATCH status
- Cancellation window rules
