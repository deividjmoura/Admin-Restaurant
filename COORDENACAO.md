# COORDENACAO.md — Fonte única de verdade

> **Modo término:** reivindicar → fazer → handoff → próxima LIVRE. Merge em lote pelo Líder no final.

---

## ⚠️ Regras
1. Nada direto na `main`.
2. Front: `/api/...` relativo; SSE `?tenant=slug`.
3. GOLDEN_RULES: store_id, auth server-side, idempotência.
4. T5 com o Líder.

---

## 📋 Backlog

| ID | Tarefa | Status |
|----|--------|--------|
| T1 | CI isolamento | CONCLUÍDA |
| T2 | Matriz permissões | CONCLUÍDA |
| T3 | Frontend cliente | aguardando revisão PR #70 |
| T4 | Frontend operação | CONCLUÍDA |
| T5 | Frontend admin | com o Líder |
| T6 | Validação menu-admin | CONCLUÍDA |
| T7 | Delivery Fase 6 | **aguardando revisão** (agente-ci) |
| T8 | PIX dinâmico | **REIVINDICADO agente-ci** |
| T9 | Ops Fase 9 | LIVRE |
| T10 | E-mail transacional | LIVRE |
| T12 | base | CONCLUÍDA |

---

## 👥 Registro

## [agente-ci] — T3 · PR #70 · aguardando revisão
Handoff: QR→menu→carrinho→checkout Idempotency-Key. `frontend/src/pages/customer/*`, `api/client.js`.

## [agente-ci] — T7 delivery · aguardando revisão
**Branch:** `feature/delivery-fase6`
**Handoff:** courier_status machine + migration 0015; listagem staff; PATCH courier-status; testes isolamento. Arquivos: `migrations/0015_*`, `src/modules/delivery/*`, `test/isolation/delivery.test.js`.

## [agente-ci] — 2026-09-17 16:20
**Domínio:** T8 — PIX dinâmico
**Status:** em andamento
**Branch:** `feature/pix-dinamico`
**Observações:** Provider Mercado Pago sandbox via env; webhook assinado + idempotente (`payment_events`). Credenciais nunca no código.
