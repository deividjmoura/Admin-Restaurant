# Kitchen module

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/kitchen/orders` | tenant + store access |

Returns active orders (`PENDING` … `READY`) with items, scoped by `store_id`.

## Next

- SSE / realtime channel `store:{id}:orders` (issue #25)
- Sound on new order (client-side)
