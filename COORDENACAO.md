# COORDENACAO — Admin-Restaurant

> **main** · 19/09/2026

## Fila

| ID | Status |
|----|--------|
| **B1** | **DONE** IDOR isolation (`a92d262`) |
| A1 | livre |
| A4 | livre |

## Registro B1

```
AR-STATUS
sid:19/09
agent:agente-b1
claim:B1
state:DONE
note:13 casos HTTP em test/isolation/idor-modules.test.js; repos já amarravam store_id — sem fix de buraco; prova coupons/wallets/billing/reports/whatsapp
```

### Casos
- coupons: GET by id cross-tenant 404 · list B sem código A · validate B falha · PATCH 404
- wallets: list B sem wallet A · txs de wallet A em B vazias · OWNER_B em A → 403
- billing: subscription storeId scoped · POST cross 403
- reports: OWNER_B em A → 403 · dashboard B só storeId B
- whatsapp: messages B sem seed A · OWNER_B em A → 403

Arquivo: `test/isolation/idor-modules.test.js`
