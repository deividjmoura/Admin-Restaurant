# COORDENACAO — Admin-Restaurant

> **main** · 19/09 · **fase: fechar backend** · front depois

## Feito

B1 IDOR (13 casos) · A2/A3/A5

## Fila (pegar 1 · claim no Registro)

| ID | Pri | Tarefa | Não conflita com |
|----|-----|--------|------------------|
| **A4** | P1 | Smoke + `docs/SMOKE.md` / DEMO checklist | B2, B3 |
| **B2** | P0 | **Idempotência + corrida em pedidos** | A4, B3 |
| **B3** | P0 | **Máquina de status + audit trail** | A4, B2 |
| A1 | P2 | Higiene residual (COORDENACAO/PROTOCOLO) | todos |

**Front congelado** até ordem nova.

---

### A4 — Smoke/docs
Checklist 5–10 min + comandos `package.json` + isolation (incl. B1). `docs/SMOKE.md` ou DEMO.

### B2 — Idempotência / race (backend)
- Revisar `src/modules/orders/` (Idempotency-Key, create pedido, status)
- Teste: **mesmo Idempotency-Key duas vezes** → 1 pedido
- Teste: **dois POSTs concorrentes** (se viável no harness) não duplicam
- Cart version / conflito: resposta coerente (409 ou equivalente já existente)
- Arquivo preferido: `test/isolation/order-idempotency.test.js` (novo) ou extensão de `order-scoping` / `cart-version`
- Se achar buraco: **fix no repository** + teste

### B3 — Status machine + audit
- `orders/status-machine.js` + transições cozinha/caixa
- Testes: transição **inválida** rejeitada; válida ok; **sempre com store_id**
- `src/modules/audit/`: garantir que ações críticas (status, pagamento se houver hook) registram ou documentar gap
- Não inventar UI

```
AR-STATUS
sid:19/09
agent:<id>
claim:A4|B2|B3|A1
state:WIP|DONE
note:<curto>
```
