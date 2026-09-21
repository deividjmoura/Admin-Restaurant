# Briefing — SMOKE do caixa + validação da UI de produção

> Para o próximo agente. **Não inventar demo.** Projeto = produção multi-tenant.

## Contexto

A UI de caixa físico já está na `main` (`frontend/src/pages/staff/CashierPage.jsx`, commit `7580279`):

- Abre/fecha **gaveta** via `/api/cash/*`
- Sangria/suprimento com motivo
- Lista **mesas** via `/api/cashier/sessions` (consumo)
- Cobrança na gaveta: `POST /api/cash/sessions/:id/payments`
- Botão “Fechar gaveta” só se papel OWNER/MANAGER (heurística no front; API é a fonte da verdade)

## Sua missão

### 1. Atualizar `docs/SMOKE.md`

Incluir seção **Caixa físico (gaveta)** com fluxo HTTP mínimo:

1. Login staff OWNER
2. `POST /api/cash/sessions` + `Idempotency-Key` → 201
3. `GET /api/cash/sessions/active` → sessão open + expected
4. (Opcional) abrir mesa/pedido via fluxo já documentado
5. `POST /api/cash/sessions/:id/payments` com CASH + `tenderedAmount`
6. `POST /api/cash/sessions/:id/movements` SUPPLY/WITHDRAWAL com reason ≥ 3
7. `POST /api/cash/sessions/:id/close` com `countedAmount` → difference
8. STAFF não fecha → 403 em close

Referência de contrato: `src/modules/cash/README.md`.

### 2. Validar / ajustar UI se achar gap real

Só mexer em `CashierPage.jsx` se:

- Erro 409 `CASH_SESSION_ALREADY_OPEN` não recuperar a sessão do body
- Shape de `session.totals.expected` diferente do que a API devolve (inspecionar resposta real)
- `user.storeRole` / `user.role` no `/api/me` não bater com a heurística de fechamento — alinhar ao campo real do payload

**Não** reescrever a página do zero. **Não** tocar backend cash/migrations.

### 3. Checklist manual (local)

```bash
git pull origin main
npm ci && npm run db:migrate && npm run db:seed
npm run dev   # terminal 1
npm run web   # terminal 2 — frontend
```

- `http://<slug>.localhost:5173/login` → owner seed
- `/cashier` → abrir gaveta → movimento → cobrar mesa (se houver) → fechar gaveta (owner)
- Login como STAFF (se o seed tiver) → não deve fechar gaveta (API 403)

### 4. Fora de escopo

- SSE no front da cozinha
- Fiscal / fila / multiunidade
- Renomear seed `demo` (fixture de dev ok)
- Deploy Render/Vercel

## Critérios de aceite

- [ ] `docs/SMOKE.md` com seção caixa físico reproduzível
- [ ] UI de `/cashier` exercitada no smoke manual (notas no PR)
- [ ] Build frontend verde: `npm run web:build`
- [ ] Zero menção a “modo demo” / DEFAULT_STORE_SLUG

## Branch / PR

```text
feat/smoke-cash-ui
```

Título: `docs+qa: smoke de caixa físico e validação da UI de gaveta`
