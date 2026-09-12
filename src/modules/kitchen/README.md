# Kitchen module

## Routes

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/kitchen/orders` | tenant + store access |
| GET | `/api/kitchen/events` | tenant + store access (SSE) |

## SSE channel

`store:{storeId}:orders`

Events:
- `connected`
- `order.created`
- `order.status_changed`
- `order.cancelled`

Isolation: subscription is always bound to `request.storeId` from the server tenant context.

## Client sketch

```js
const es = new EventSource('/api/kitchen/events', { withCredentials: true });
es.addEventListener('order.created', (e) => {
  const data = JSON.parse(e.data);
  // refresh board or append order
});
```

Note: native EventSource does not send custom headers; prefer cookie session auth.
