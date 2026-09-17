# COORDENACAO.md — Fonte única de verdade

> **Modo término.** Merge em lote pelo Líder.

---

## 📋 Backlog (núcleo)

| ID | Tarefa | Status |
|----|--------|--------|
| T1–T2, T4, T6, T12 | — | CONCLUÍDAS |
| T3 | Frontend cliente | PR #70 · aguardando revisão |
| T5 | Frontend admin | com o Líder |
| T7 | Delivery | PR #73 · aguardando revisão |
| T8 | PIX dinâmico | PR #74 · aguardando revisão |
| T9 | Ops | PR #75 · aguardando revisão |
| T10 | E-mail | **PR aberto** · aguardando revisão |

---

## 👥 agente-ci — handoffs

| Tarefa | PR | Resumo |
|--------|-----|--------|
| T3 cliente | #70 | QR→menu→carrinho→checkout Idempotency-Key |
| T7 delivery | #73 | courier_status, listagem staff, testes |
| T8 PIX | #74 | MP sandbox via env, webhook idempotente |
| T9 ops | #75 | jobs queue, /ready DB, logger JSON |
| T10 e-mail | (novo) | Resend/console via env, signup real |

**Status agente-ci:** núcleo T3+T7–T10 entregue. Aguardando merge em lote. Fase 10 ainda CONGELADA até merge.
