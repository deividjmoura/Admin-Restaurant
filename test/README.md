# Testes

## Isolamento multi-tenant (Issue #17)

```bash
# Sempre (unitários — não precisa de banco)
npm run test:unit

# Completo (unit + integração). Requer DATABASE_URL migrado:
# DATABASE_URL=postgres://... npm run test:isolation
npm test
```

> **Por que `test/isolation/*.test.js` (e não `**`)?** O `node --test` só
> interpreta glob a partir do Node 21; o shell (sh) não expande `**` sem
> globstar. O `*.test.js` simples é expandido pelo shell e funciona no Node
> 20+ (engines do projeto) — sem `**`, a suíte falhava silenciosamente no
> Node 20 (issue #53 / T1, CI). Mantenha os arquivos de teste flat em
> `test/isolation/`.
>
> `npm test` equivale a `npm run test:isolation` (todos os testes do
> repositório estão em `test/isolation/`); a diferença prática é o banco:
> os unitários rodam sem `DATABASE_URL`, os de integração pulam sem ele.

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
| Onboarding self-service (issue #60) | integration |
| **API admin cardápio (issue #49)**: 401/403, CRUD cat/prod/addon, reordenação, cache pós-mutação + isolamento, cross-store 404 | integration |
