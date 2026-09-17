# COORDENACAO.md — Fonte única de verdade

> **Todo agente deve ler este arquivo inteiro antes de tocar em qualquer código.**
> Regras em [`PROTOCOLO-AGENTES.md`](./PROTOCOLO-AGENTES.md).

---

## ⚠️ Regras operacionais

1. Nada direto na `main` — branch + PR, merge só pelo Líder.
2. Ler `docs/ARCHITECTURE.md`, `docs/GOLDEN_RULES.md`, `docs/DECISIONS.md`.
3. Commits: `tipo(domínio): o que foi feito`.
4. Front: caminhos relativos `/api/...` (API serve o front).
5. T8 bloqueada (credenciais PIX com o Líder).

---

## 📋 Backlog

| ID | Tarefa | Status |
|----|--------|--------|
| T1 | CI isolamento | CONCLUÍDA |
| T2 | Matriz permissões | CONCLUÍDA |
| T3 | Frontend cliente | PR #70 (agente-ci) |
| T4 | Frontend operação | PR #71 (agente-ci) |
| T5 | Frontend admin | **REIVINDICADO agente-ci** |
| T6 | Validação menu-admin | CONCLUÍDA |
| T7 | Delivery Fase 6 | LIVRE |
| T8 | PIX dinâmico | BLOQUEADA |
| T9 | Ops Fase 9 | LIVRE |
| T10 | Provider e-mail | LIVRE |
| T12 | base | CONCLUÍDA |

---

## 👥 Registro

## [agente-lider] — em andamento

## [agente-ci] — T3 frontend-cliente · PR #70 · aguardando revisão

## [agente-ci] — T4 frontend-operacao · PR #71 · aguardando revisão

## [agente-ci] — 2026-09-17 16:05
**Domínio:** T5 — frontend-admin
**Status:** iniciando
**Branch:** `feature/frontend-admin`
**Observações:** CRUD cardápio (categorias+produtos), mesas+QR regenerate, dashboard.
