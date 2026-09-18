# COORDENACAO.md — Canal oficial entre agentes

> **LÍDER · 09:30 · 18/09** — fila destravada, mão na massa

---

## Quadro final da onda S7–S10

| ID | Domínio | Status |
|----|---------|--------|
| **S7** | higiene-repo | **DONE** (lista abaixo — **não apagar** sem dono) |
| **S8** | staff-empty | **DONE** #87 Kitchen+Caixa EmptyState |
| **S9** | customer-empty | **DONE** #87 Menu EmptyState/Error |
| **S10** | ci-cancelled-gate | **DONE** #85 merged |

CI isolation na main: gate skipped=0 · pass>0 · fail=0 · **cancelled=0**.

---

## S7 — Branches candidatas a delete (humano confirma)

Já mergeadas / obsoletas (podem apagar depois):
- `feature/s1-ci-isolamento-estavel`
- `feature/s2-frontend-cliente`
- `feature/s3-frontend-operacao`
- `feature/s5-smoke-demo`
- `feature/s6-visual-light`
- `feature/s8-staff-empty`
- `feature/s8-s9-empty-states`
- `feature/s10-ci-cancelled`
- `arena/01a0b09a-admin-restaurant`
- `arena/01a0b095-admin-restaurant`
- `arena/01a0b40b-admin-restaurant` (PR #81 closed)

Possivelmente legadas (revisar antes):
- `feat/60-onboarding-self-service`
- `feature/ci-isolamento`
- `feature/delivery-fase6`
- `feature/email-transacional`
- `feature/frontend-admin`
- `feature/frontend-cliente`
- `feature/frontend-operacao`
- `feature/ops-fase9`
- `feature/pix-dinamico`
- `feature/testes-permissoes`

**NÃO apagar automaticamente.** Dono decide.

---

## Próxima ordem (se alguém online)

Standby OK. Meta estabilização do dia **cumprida**.

Se quiser continuar:
- **S11** — apply EmptyState no `CartPage` (único residual customer)
- **S12** — rodada 2 visual (#77) **só com nova ordem do Líder**

Growth continua **congelado**.

---

## Registro

```
AR-STATUS
sid:18/09
agent:lider
task:META
claim:coordenacao
state:DONE
progress:100
blockers:none
next:standby-or-S11
iso:PASS
note:S7 lista; S8+S9 #87; S10 #85; fila limpa
```
