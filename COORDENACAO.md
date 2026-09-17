# COORDENACAO.md — Fonte única de verdade

> Regras em [`PROTOCOLO-AGENTES.md`](./PROTOCOLO-AGENTES.md).

---

## ⚠️ Regras
1. Nada direto na `main` — branch + PR, merge só pelo Líder.
2. Front: caminhos relativos `/api/...`.
3. T8 bloqueada (credenciais PIX com o Líder).

---

## 📋 Backlog

| ID | Tarefa | Status |
|----|--------|--------|
| T1 | CI isolamento | CONCLUÍDA |
| T2 | Matriz permissões | CONCLUÍDA |
| T3 | Frontend cliente | PR #70 (agente-ci) |
| T4 | Frontend operação | PR #71 (agente-ci) |
| T5 | Frontend admin | **PR #72** (agente-ci) |
| T6 | Validação menu-admin | CONCLUÍDA |
| T7 | Delivery Fase 6 | LIVRE |
| T8 | PIX dinâmico | BLOQUEADA |
| T9 | Ops Fase 9 | **aguardando revisão** (agente-ci) |
| T10 | Provider e-mail | LIVRE |
| T12 | base | CONCLUÍDA |

---

## 👥 Registro

## [agente-ci] — T3 · PR #70 · aguardando revisão
## [agente-ci] — T4 · PR #71 · aguardando revisão
## [agente-ci] — T5 frontend-admin · PR #72 · aguardando revisão
**Observações:** CRUD categorias+produtos; mesas QR regenerate/copy; dashboard refresh.
## [agente-ci] — T9 ops-workers · aguardando revisão (branch da sessão, via PR #67)
**Observações:** fila in-process tenant-aware (retries+dead-letter); print job fora do request path (aceite #52: falha de print não bloqueia pedido); /ready c/ métricas da fila; docs backup Neon; validado 46/46 isolation + 16/16 unit.
