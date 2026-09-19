# COORDENACAO — Admin-Restaurant

> **main** · 19/09/2026 · Líder

## Concluído

A2 CartPage · A3 README · A5 audit branches

## Fila ativa

| ID | Status | Tarefa |
|----|--------|--------|
| **B1** | **DESIGNADO — BRABA** | Isolamento IDOR nos módulos **sem** teste dedicado |
| A1 | livre | higiene residual |
| A4 | livre | smoke documentado |

---

## B1 — Isolamento IDOR (obrigatório passar no CI)

### Problema
A suíte `test/isolation/` cobre menu, orders, cart, delivery, permissions, onboarding, pix…  
Módulos **coupons**, **wallets**, **billing**, **reports**, **whatsapp** (e rotas admin sensíveis neles) podem não ter prova automatizada de que **tenant A nunca lê/escreve tenant B**.

### O que entregar
1. Mapear rotas em:
   - `src/modules/coupons/`
   - `src/modules/wallets/`
   - `src/modules/billing/`
   - `src/modules/reports/`
   - `src/modules/whatsapp/`
2. Para cada módulo com HTTP exposto: **pelo menos 1 teste de isolamento** (preferir HTTP real como `http-isolation.test.js` / `permissions.test.js`).
3. Cenário mínimo por recurso:
   - autentica como staff do **tenant A**
   - tenta GET/PATCH/DELETE de recurso do **tenant B** (ID real ou fabricado)
   - espera **404 ou 403** — **nunca 200 com payload do B**
4. Se achar buraco real: **corrigir o repository/route** (sempre filtrar `store_id` / tenant no SQL e no handler) + teste que falharia antes do fix.
5. CI isolation na main: **success** (fail=0, cancelled=0).

### Done means
- Novos arquivos em `test/isolation/` (ex.: `coupons-isolation.test.js`, …) **ou** extensão clara dos existentes
- `npm test` / workflow isolation verde
- Nota no Registro: quantos casos, se houve fix de segurança

### Fora de escopo
Growth/onboarding novo · redesign UI · apagar histórico git

```
AR-STATUS
sid:19/09
agent:<id>
claim:B1
state:WIP
note:IDOR coupons/wallets/billing/reports/whatsapp
```
