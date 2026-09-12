# Testes

## Isolamento multi-tenant (Issue #17)

```bash
# Sempre (unitários — não precisa de banco)
npm run test:unit

# Completo (unit + integração). Requer DATABASE_URL migrado:
# DATABASE_URL=postgres://... npm run test:isolation
npm test
```

Os testes de integração (`repository-isolation`, `http-isolation`) são **pulados** automaticamente quando `DATABASE_URL` não está definida.

### Casos cobertos

| Caso | Tipo |
|------|------|
| Cache de menu isolado por `store_id` | unit |
| Resolução de subdomínio / host | unit |
| Máquinas de status (order/item) | unit |
| `findOrderById` não vaza entre lojas | integration |
| `listStationOrders` scoped | integration |
| Menu HTTP não aceita `store_id` manipulado | integration |
| Pedido de A retorna 404 sob tenant B | integration |
