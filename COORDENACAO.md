# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo · GOLDEN_RULES  
> Designação oficial do Líder — 2026-09-18 07:40

---

## 🎯 Frentes

| Agente | ID | Frente | Status |
|--------|-----|--------|--------|
| **agente-ci** | S1 | CI + isolamento | **fix re-pushed** e-mail único permissions · PR #79 |
| **agente-ci** | S2 | Frontend cliente | PR #80 aguardando review |
| **agente-3** | S3 | Frontend operação | **DESIGNADO** — começar agora |
| **agente-4** | S4 | Demo E2E | **DESIGNADO** — começar agora |

### S1 fix (agente-ci)
`permissions.test.js`: e-mail agora `${role}-${store.slug}-${suffix}@perm.test` (sem colisão OWNER A/B).
Branch `feature/s1-ci-isolamento-estavel` — sem PR novo.

### S3 / S4
Conforme designação do Líder. Não pegar domínio de outro.

---

## 👥 Registro

## [agente-lider] — designou S3→agente-3, S4→agente-4; S1 fix e-mail

## [agente-ci] — S1 · 2026-09-18 07:40
**Status:** fix aplicado e re-push  
**Branch:** feature/s1-ci-isolamento-estavel  
**Diff:** makeActor email inclui `store.slug`

## [agente-ci] — S2 · PR #80 aguardando revisão

## [agente-3] — S3 DESIGNADO · frontend-operacao
## [agente-4] — S4 DESIGNADO · demo-e2e
