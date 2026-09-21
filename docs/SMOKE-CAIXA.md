# SMOKE — Caixa físico (gaveta)

> Complemento de [`SMOKE.md`](./SMOKE.md). **Produção multi-tenant** — sem modo demo.
> Contrato: [`src/modules/cash/README.md`](../src/modules/cash/README.md).

## Pré-requisitos

```bash
export API=http://localhost:3000
export TENANT=demo   # slug do seed local (fixture de dev, não produto "demo")
export EMAIL=owner@demo.local
export SENHA=demo-senha-local

# cookie staff (OWNER)
curl -s -c /tmp/ar.cookie -X POST $API/api/auth/store/login \
  -H 'Content-Type: application/json' \
  -H "X-Tenant-Slug: $TENANT" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$SENHA\"}"
```

Se `/api/auth/store/login` não existir no seu checkout, use o login documentado em `SMOKE.md` §3.2.

---

## 1. Abrir gaveta

```bash
KEY_OPEN="open-$(date +%s)"
curl -s -w '\nHTTP %{http_code}\n' -b /tmp/ar.cookie \
  -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $KEY_OPEN" \
  -X POST $API/api/cash/sessions \
  -d '{"openingAmount":150.00,"notes":"Turno smoke"}'
# 201 · session.status=open · totals.expected ≈ 150
# Retry mesma chave → 200 replayed:true
```

```bash
CASH_SID=<session.id>
```

Segunda abertura sem fechar → `409 CASH_SESSION_ALREADY_OPEN` (sessão existente no body).

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" $API/api/cash/sessions/active
# session.id == $CASH_SID · status open
```

---

## 2. Movimentos manuais

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: supply-$(date +%s)" \
  -X POST $API/api/cash/sessions/$CASH_SID/movements \
  -d '{"type":"SUPPLY","amount":50,"reason":"Troco extra"}'
# 201 · type SUPPLY · direction IN

curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: wd-$(date +%s)" \
  -X POST $API/api/cash/sessions/$CASH_SID/movements \
  -d '{"type":"WITHDRAWAL","amount":20,"reason":"Sangria depósito"}'
# 201 · type WITHDRAWAL · direction OUT
# reason < 3 chars → 400
```

---

## 3. Pagamento na gaveta (CASH)

Requer mesa/sessão com valor devido (fluxo mesa em `SMOKE.md` §3.3–3.8).

```bash
# SID = table session com consumo aberto
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: pay-$(date +%s)" \
  -X POST $API/api/cash/sessions/$CASH_SID/payments \
  -d "{\"sessionId\":\"$SID\",\"items\":[{\"method\":\"CASH\",\"amount\":22.90,\"tenderedAmount\":50}]}"
# 201 · payments[0].status=PAID · change ≈ 27.10 · session.totals.expected atualizado
# Soma > due → 409 AMOUNT_EXCEEDS_DUE
```

---

## 4. Fechar gaveta (OWNER/MANAGER)

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -X POST $API/api/cash/sessions/$CASH_SID/close \
  -d '{"countedAmount":202.90,"notes":"Conferido smoke"}'
# 200 · status=closed · expectedAmount · countedAmount · differenceAmount · reconciled
# Sem countedAmount → 400 CASH_COUNT_REQUIRED
# Já fechada → 200 alreadyClosed
```

```bash
curl -s -b /tmp/ar.cookie -H "X-Tenant-Slug: $TENANT" \
  $API/api/cash/sessions/$CASH_SID/report
# reconciliation: opening, cashSales, supplies, withdrawals, expected, counted, difference
```

---

## 5. RBAC — STAFF não fecha

Com cookie de usuário STAFF (se o seed tiver) ou papel sem `cashier.cash.close`:

```bash
curl -s -w ' HTTP %{http_code}\n' -b /tmp/staff.cookie \
  -H "X-Tenant-Slug: $TENANT" -H 'Content-Type: application/json' \
  -X POST $API/api/cash/sessions/$CASH_SID/close \
  -d '{"countedAmount":100}'
# 403 FORBIDDEN (não 404)
```

Cross-tenant (`X-Tenant-Slug: loja2` na sessão da demo) → **404**, nunca 403.

---

## 6. UI `/cashier` (manual)

```bash
npm run dev    # API
npm run web    # Vite
# http://<slug>.localhost:5173/login → owner → /cashier
```

Checklist:

- [ ] Abrir gaveta com fundo de troco
- [ ] Ver expected atualizar após movimento
- [ ] Cobrar mesa em dinheiro (troco)
- [ ] Fechar gaveta (OWNER)
- [ ] STAFF: botão fechar ausente ou API 403

---

## Critérios

| Passo | OK |
|-------|----|
| Open + idempotência | |
| Active + movements | |
| Payment CASH + troco | |
| Close + report | |
| STAFF 403 no close | |
| UI exercitada | |
