# Tables module

## Schema
- `tables` — `public_token` (UUID) for QR
- `table_sessions` — one open session per table

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/tables/by-token/:token` | public |
| GET | `/api/tables` | tenant + store access |

If the request has a tenant context, the table's `store_id` must match (else 404).

## QR shape

```text
https://{slug}.domain/table/{public_token}
→ API: GET /api/tables/by-token/{public_token}
```
