# Orders module

## Status machine (backend only)

```text
PENDING → CONFIRMED → PREPARING → READY → DELIVERED
                ↘ CANCELLED (from PENDING/CONFIRMED/PREPARING)
```

## Routes

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/orders` | tenant |
| GET | `/api/orders/:id` | tenant |
| PATCH | `/api/orders/:id/status` | tenant + store access |

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
- Prices always from DB
- Same idempotency key → same order (200 replay)
- Invalid status transition → 409
