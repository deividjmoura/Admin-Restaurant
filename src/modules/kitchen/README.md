# Kitchen / Bar

Dois painéis, mesma loja:

| Estação | Uso |
|---------|-----|
| `KITCHEN` | Lanches, pratos, fritura |
| `BAR` | Bebidas / balcão |

## Rotas

```text
GET /api/kitchen/orders?station=KITCHEN
GET /api/kitchen/orders?station=BAR
GET /api/kitchen/events?station=KITCHEN   # SSE
GET /api/kitchen/events?station=BAR
```

Cada produto tem `station`. No pedido, o item grava o snapshot da estação.
Um pedido misto (lanche + refri) aparece **nos dois** painéis, cada um só com seus itens.
