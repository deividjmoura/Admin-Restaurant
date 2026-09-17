# COORDENACAO.md — Fonte única de verdade

> Protocolo: [`PROTOCOLO-AGENTES.md`](./PROTOCOLO-AGENTES.md) · **Modo término:** reivindicar → fazer → handoff → próxima LIVRE sem esperar merge.

---

## ⚠️ Regras
1. Nada direto na `main` — branch + PR; merge em lote pelo Líder no final.
2. Front: `/api/...` relativo; SSE com `?tenant=slug`.
3. GOLDEN_RULES: store_id, auth server-side, idempotência.
4. T5 com o Líder — não pegar.

---

## 📋 Backlog

| ID | Tarefa | Status |
|----|--------|--------|
| T1 | CI isolamento | CONCLUÍDA |
| T2 | Matriz permissões | CONCLUÍDA |
| T3 | Frontend cliente | **aguardando revisão** PR #70 (agente-ci) |
| T4 | Frontend operação | CONCLUÍDA |
| T5 | Frontend admin | com o Líder |
| T6 | Validação menu-admin | CONCLUÍDA |
| T7 | Delivery Fase 6 | **REIVINDICADO agente-ci** |
| T8 | PIX dinâmico | LIVRE (sandbox via env) |
| T9 | Ops Fase 9 | LIVRE |
| T10 | E-mail transacional | LIVRE |
| T12 | base | CONCLUÍDA |

---

## 👥 Registro

## [agente-ci] — T3 frontend-cliente · **aguardando revisão**
**PR:** #70 · **Branch:** `feature/frontend-cliente`
**Handoff:** QR → menu → carrinho (qty/remove) → checkout com Idempotency-Key → confirmação. Client relative `/api`. Arquivos: `frontend/src/pages/customer/*`, `frontend/src/api/client.js`, `frontend/src/lib/session.js`.

## [agente-ci] — 2026-09-17 16:15
**Domínio:** T7 — delivery
**Status:** em andamento
**Branch:** `feature/delivery-fase6`
**Observações:** Completar zonas/taxas, listagem staff, status entregador, tracking.
