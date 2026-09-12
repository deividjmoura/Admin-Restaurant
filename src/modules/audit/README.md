# Audit module

## Table `audit_logs`

| Column         | Notes |
|----------------|--------|
| store_id       | NULL for platform-level SUPER_ADMIN actions |
| actor_user_id  | Who performed the action |
| action         | e.g. `product.price_updated`, `order.cancelled` |
| resource       | e.g. `product`, `order` |
| resource_id    | id as text |
| metadata       | JSON — **no secrets** |
| ip / user_agent| optional request context |

## Usage

```js
import { writeAuditLog } from '../audit/index.js';

await writeAuditLog({
  storeId: request.storeId,
  actorUserId: request.user.id,
  action: 'order.cancelled',
  resource: 'order',
  resourceId: order.id,
  metadata: { reason: 'customer_request' },
  ip: request.ip,
});
```

Hooks that call this on every admin mutation come in a follow-up PR.
