# Tables module

## Security model (Discussion #41)

1. **QR token** = UUID v4 (`public_token`) — not guessable
2. **QR sticker is permanent**; it hits `/api/tables/by-token/:token` which opens/resumes a **session**
3. **Session TTL** (default **6 hours**, `TABLE_SESSION_TTL_HOURS`) — expired open sessions are closed on next scan
4. **store_id** always enforced when tenant context exists

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/tables/by-token/:token` | public |
| GET | `/api/tables` | tenant + store access |

## Schema
- `tables` — `public_token`
- `table_sessions` — one `open` row per table (partial unique index)
