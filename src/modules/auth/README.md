# Auth module

## Schema
- `users` — global accounts (`is_super_admin`)
- `store_users` — membership per store + role

## Session
- httpOnly cookie `ar_session` (JWT via `jose`)
- Password: Node `scrypt` (`salt:hash` hex)

## Routes
| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | required |

## Middlewares
- `app.requireAuth`
- `app.requireStoreAccess` — auth + membership on `request.storeId` (SUPER_ADMIN bypass)

## Seed users
See `scripts/seed.js` (SUPER_ADMIN + OWNER on demo store).
