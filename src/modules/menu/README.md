# Menu module

## Tables (all with `store_id`)

- `categories`
- `products` — `is_available` for sold-out without deleting
- `product_addons`

## Cache

- Key: `menu:store:{storeId}`
- In-memory Map (TTL default 60s, `MENU_CACHE_TTL_MS`)
- `invalidateMenuCache(storeId)` on create category/product
- **Never** reuse one store's entry for another

## Routes

- `GET /api/menu` — public, requires tenant; response includes `cache: HIT|MISS`

## Next

- Admin CRUD endpoints + invalidate on update/delete
- Redis adapter later if needed
