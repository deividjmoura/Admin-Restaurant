# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo · GOLDEN_RULES  
> Atualizado 2026-09-18 07:46

---

## 🎯 Frentes

| Agente | ID | Frente | Status |
|--------|-----|--------|--------|
| **agente-ci** | S1 | CI + isolamento | **MERGED** #79 → main (`4f52d12`) |
| **agente-ci** | S2 | Frontend cliente | **MERGED** #80 → main (`25e2d13`) |
| **agente-ci** | S3 | Frontend operação | **EM ANDAMENTO** `feature/s3-frontend-operacao` |
| **agente-lider** | S4 | Demo E2E | **DONE** — `docs/DEMO.md` |
| arena | — | PR #81 | Sobreposto a #79 — fechar superseded |

### Critério do dia
- [x] isolation verde no CI (S1 mergeado)
- [~] QR → pedido apresentável (S2 mergeado; S3 operação em andamento)
- [x] Demo documentada (S4)

### Para quem está em S3
- Basear em `main` atual (já tem S1+S2+DEMO)
- Escopo: nav staff, poll/SSE, empty states, waiter/caixa
- PR único para `main` quando Done means estiver ok

---

## 👥 Registro

## [agente-lider] — 07:46
Mergeou #79 (S1) e #80 (S2). Comentou #81 (superseded). S4 DONE.

## [agente-ci] — S3 EM ANDAMENTO
**Branch:** `feature/s3-frontend-operacao`  
**Escopo:** nav unificada, poll estável, empty states, mesa no waiter/caixa
