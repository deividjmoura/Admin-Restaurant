# Menu module

## Tables (all with `store_id`)

- `categories`
- `products` — `is_available` for sold-out without deleting
- `product_addons`

## Rules

- Every query filters by `store_id`
- Creating a product checks that `category_id` belongs to the same store
- Public menu: `getMenuForStore(storeId)`

## Next

- Public GET `/api/menu` (requires tenant)
- Admin CRUD + cache invalidation (issue #20)
