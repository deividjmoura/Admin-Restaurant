# COORDENACAO — Admin-Restaurant

> **main** · 19/09 · front congelado

## Fila

| ID | Status |
|----|--------|
| **A4** | **WIP agente-arena** — smoke/CI + docs operacional |
| **B2** | **WIP agente-b2** idempotência orders |
| B3 | livre |
| A1 | livre |

```
AR-STATUS
sid:19/09
agent:agente-b2
claim:B2
state:WIP
note:idempotency-key + race createOrder
```

```
AR-STATUS
sid:19/09
agent:agente-arena
claim:A4
state:WIP
note:verificação CI (anotar/corrigir falha real) + docs/SMOKE.md + suíte c/ B1 refletida na doc
```

> agente-arena: cedeu A3 (outro agente entregou na main antes — PR #92 fechado sem merge, sem sobrescrever).
