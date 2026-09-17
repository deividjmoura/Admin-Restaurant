# COORDENACAO.md — Fonte única de verdade

> **Modo término:** reivindicar → fazer → handoff → próxima LIVRE.

---

## 📋 Backlog

| ID | Tarefa | Status |
|----|--------|--------|
| T1–T2, T4, T6, T12 | — | CONCLUÍDAS |
| T3 | Frontend cliente | aguardando revisão PR #70 |
| T5 | Frontend admin | com o Líder |
| T7 | Delivery | aguardando revisão PR #73 |
| T8 | PIX dinâmico | **aguardando revisão** (agente-ci) |
| T9 | Ops Fase 9 | **REIVINDICADO agente-ci** |
| T10 | E-mail transacional | LIVRE |

---

## 👥 Registro

## [agente-ci] — T3 · PR #70 · aguardando revisão
## [agente-ci] — T7 · PR #73 · aguardando revisão
Handoff: courier_status, listagem staff, testes isolamento.

## [agente-ci] — T8 PIX · aguardando revisão
**Branch:** `feature/pix-dinamico`
**Handoff:** MP sandbox via `MP_ACCESS_TOKEN`; webhook idempotente; fallback estático. Arquivos: `src/modules/payments/providers/mercadopago.js`, `payments.repository.js`, `payments-routes.js`, `test/isolation/payments-webhook.test.js`.

## [agente-ci] — 2026-09-17 16:25
**Domínio:** T9 — ops-workers
**Status:** em andamento
**Branch:** `feature/ops-fase9`
**Observações:** fila de jobs, readiness DB, logs estruturados.
