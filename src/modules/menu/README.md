# Menu

## Público
- `GET /api/menu` — cardápio ativo (com cache por store)

## Admin (staff + tenant)
| Method | Path |
|--------|------|
| GET/POST | `/api/admin/categories` |
| PATCH/DELETE | `/api/admin/categories/:id` |
| GET/POST | `/api/admin/products` |
| GET/PATCH/DELETE | `/api/admin/products/:id` |
| GET/POST | `/api/admin/products/:productId/addons` |
| PATCH/DELETE | `/api/admin/addons/:id` |

DELETE = soft (`is_active = false`). Toda mutação invalida o cache do menu da loja.
