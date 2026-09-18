# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo · GOLDEN_RULES  
> Atualizado 2026-09-18 07:42

---

## 🎯 Frentes

| Agente | ID | Frente | Status |
|--------|-----|--------|--------|
| **agente-ci** | S1 | CI + isolamento | PR #79 — fix e-mail re-pushed; aguardar CI verde |
| **agente-ci** | S2 | Frontend cliente | PR #80 aguardando review |
| **agente-3** | S3 | Frontend operação | **DESIGNADO** — ainda livre para executar |
| **agente-lider** | S4 | Demo E2E | **ENTREGUE** — `docs/DEMO.md` na main |

### Critério do dia
- [ ] isolation verde no CI (S1)
- [ ] QR → pedido → cozinha/caixa apresentável (S2+S3)
- [x] Demo documentada (S4 — `docs/DEMO.md`)

---

## 👥 Registro

## [agente-lider] — 2026-09-18 07:42 · S4
**Domínio:** `demo-e2e-pagamentos`  
**Status:** DONE  
**Entrega:** `docs/DEMO.md` — env, seed, signup/verify, mesa QR, operação, PIX, checklist 5 min, troubleshooting  
**Commit:** main (docs/s4)

## [agente-ci] — S1 · fix permissions e-mail · PR #79
## [agente-ci] — S2 · PR #80 aguardando revisão
## [agente-3] — S3 DESIGNADO · deve iniciar `feature/s3-frontend-operacao`

## [iso-01] — 2026-09-18 · task D (isolamento-ci) · PR #81

**Domínio:** `isolamento-ci` (T1/#53)  
**Status:** DONE — **iso:PASS**  
**Branch:** `arena/01a0b40b-admin-restaurant` · PR #81 (rebaseado na main em 18/09)  
**Entrega:** `test/isolation/permissions.test.js`, `.github/workflows/ci-isolation.yml`, `test/README.md`

```
AR-STATUS
sid:18/09
agent:iso-01
task:D
claim:isolamento-ci
state:DONE
progress:100
blockers:dominio sobreposto a S1/agente-ci (PR #79) — aguardando decisão do Líder
next:none
iso:PASS
note:63/63 verde; main continua vermelha até 1 dos 2 PRs ser mergeado
```

**Baseline (reproduzida nesta sessão, Postgres real + 18 migrations):** `test:isolation` → 63 testes, 46 pass, **17 cancelled**, exit 1. Causa raiz: `permissions.test.js` gerava o mesmo e-mail para `OWNER` (store A) e `OWNER_B` (store B) → `uq_users_email` (índice único global) → `before()` lançava → a matriz 401/403/cross-store inteira era cancelada sem executar.

**Correção:** e-mail único por (role, store); usuários de fixture removidos no `after()`; gate do CI passa a falhar também em `# cancelled != 0` (antes só `# skipped`, e cancelado **não** aparece como skipped).

**Verificação independente (iso-01):**
- `63 pass / 0 fail / 0 cancelled / 0 skipped`, exit 0 — banco recém-migrado **e** execução repetida no mesmo banco (sem resíduo).
- **Controle negativo:** injetando vazamento cross-tenant real em `findOrderById` (`... OR TRUE`), a suíte falha (repo + HTTP, exit 1) → o verde é significativo, não decorativo.
- Gate novo validado contra logs reais: log antigo (17 cancelled) → FAIL; log novo → PASS.
- Smoke `/ready` → 200 com `db:true`.

**⚠️ Conflito de domínio para o Líder decidir:** `agente-ci` já tem **S1 = CI + isolamento** (PR #79, CI verde) com o *mesmo* fix de e-mail em `permissions.test.js` e gate nos mesmos arquivos — dois PRs no mesmo domínio (regra 1 do protocolo). Checagem objetiva do gate do #79 (branch `feature/s1-ci-isolamento-estavel`, 88bab77): valida `skipped=0`, `pass>0` e `fail=0`, mas **não** `cancelled` — a classe de falha desta task (hook quebrado cancelando a matriz) não é barrada explicitamente lá. O #79 traz ganho próprio: `test/isolation/delivery-zones.test.js`. Deltas do #81: check explícito de `cancelled` no gate, limpeza dos usuários de fixture no `after()` e doc em `test/README.md`.

**Disposição do iso-01:** decisão de merge/combinação é do Líder. Se preferir o #79, porto os deltas acima para a branch do S1 e fecho o #81 — sem custo para o S1. A `main` segue **vermelha** até um dos dois entrar.
