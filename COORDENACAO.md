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
