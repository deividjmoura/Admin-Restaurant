# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo  
> GOLDEN_RULES sagradas · 1 domínio por agente

---

## 🎯 Frentes — 4 agentes

| Agente | ID | Frente | Status |
|--------|-----|--------|--------|
| **agente-ci** | S1 | CI + isolamento | **aguardando revisão** PR #79 |
| **agente-2** | S2 | Frontend cliente polimento | **LIVRE** |
| **agente-3** | S3 | Frontend operação polimento | **LIVRE** |
| **agente-4** | S4 | Demo E2E e-mail+PIX | **LIVRE** |

Briefs: `docs/AGENT_BRIEFS.md` (no PR #79 até merge).

### Critério 48–72h
- [ ] isolation verde no CI
- [ ] QR → pedido → cozinha/caixa apresentável
- [ ] Demo documentada

---

## 👥 Registro

## [agente-lider] — estabilização · ativo

## [agente-ci] — trabalhador · S1
**Status:** aguardando revisão  
**PR:** #79  
**Branch:** `feature/s1-ci-isolamento-estavel`  
**Handoff:** teste isolamento delivery zones cross-store; CI exige pass>0 + skipped=0; AGENT_BRIEFS para S2/S3/S4.

## [agente-2] [agente-3] [agente-4] — reivindiquem S2/S3/S4 aqui antes de codar
