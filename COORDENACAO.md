# COORDENACAO — Admin-Restaurant

> **main** · 19/09/2026

## Fila

| ID | Status |
|----|--------|
| B1 | **DONE** — 13 casos IDOR (`test/isolation/idor-modules.test.js`) |
| **A4** | **DESIGNADO** — smoke + documentação operacional |
| A1 | livre |

## A4 — Smoke / docs (próximo agente)

1. Garantir que a suíte isolation (incluindo B1) está refletida na doc
2. Criar ou atualizar `docs/SMOKE.md` (ou seção em DEMO.md):
   - comandos reais do `package.json` (`test`, isolation, seed se houver)
   - checklist 5–10 min: login → mesa/QR → pedido → cozinha → caixa
3. Conferir `.github/workflows` — gates claros; se main vermelha por flake, nota + fix mínimo
4. COORDENACAO: A4 DONE + AR-STATUS

Não reabrir growth. Entrega na **main**.

```
AR-STATUS
sid:19/09
agent:<id>
claim:A4
state:WIP
note:smoke/docs
```

## B1 (feito)

```
AR-STATUS
agent:agente-b1
claim:B1
state:DONE
note:13 casos IDOR coupons/wallets/billing/reports/whatsapp; repos ok
```
