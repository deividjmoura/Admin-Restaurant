# Realtime

In-process pub/sub keyed by `storeId`.

```text
store:{storeId}:orders
```

For multiple Node processes, replace with Redis pub/sub using the same channel names.
