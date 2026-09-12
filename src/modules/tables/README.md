# Tables module

## Tables

| Column        | Notes |
|---------------|--------|
| store_id      | Tenant isolation |
| number        | Unique per store |
| public_token  | UUID for QR URL — **not** the table number |
| status        | free \| occupied |

QR URL shape (later):

```text
https://{slug}.seudominio.com/table/{public_token}
```

## table_sessions

- One **open** session per table (partial unique index)
- Shared cart/orders will attach to `table_sessions.id`

## Next

- Public route by token + open session
- Seed demo tables
- Shared cart concurrency (issue #22)
