# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Diretiva do Líder 2026-09-17 21:45  
> GOLDEN_RULES sagradas · nada de growth sem autorização · PRs pequenos

---

## 🎯 Frentes ativas — 4 agentes (2026-09-18)

> **1 domínio por agente.** Reivindique abaixo antes de codar. Não pegue work de outro.

| Agente | ID | Frente (P0/P1) | Domínio | Status |
|--------|-----|----------------|---------|--------|
| **agente-ci** | S1 | Suite isolamento verde no CI + regressões | `ci-isolamento-estavel` | **EM ANDAMENTO** |
| **agente-2** | S2 | Frontend cliente: QR→pedido **apresentável** e sem erros | `frontend-cliente-polimento` | **LIVRE — pegue** |
| **agente-3** | S3 | Frontend operação: cozinha/garçom/caixa SSE estável | `frontend-operacao-polimento` | **LIVRE — pegue** |
| **agente-4** | S4 | Demo E2E: onboarding e-mail + PIX sandbox ponta a ponta | `demo-e2e-pagamentos` | **LIVRE — pegue** |

### Como entrar (protocolo rápido)
1. Leia `docs/GOLDEN_RULES.md`
2. Adicione entrada em **Registro** com seu ID (agente-2 / agente-3 / agente-4)
3. Branch `feature/sN-...` · commits `tipo(domínio): ...` · PR para `main`
4. Ao terminar: handoff (resumo + arquivos) e marque aguardando revisão

### Critério de sucesso (48–72h)
- [ ] `test/isolation` verde no CI em todo PR
- [ ] Fluxo QR → cardápio → pedido → cozinha/garçom/caixa sem erro óbvio
- [ ] Demo apresentável (onboarding + pagamento sandbox documentados)

### Proibido
- Growth (WhatsApp IA avançado, cashback, etc.) sem o Líder
- Quebrar testes de isolamento
- Confiar em `store_id` do cliente
- Mudança grande de arquitetura sem discussão

---

## 👥 Registro de agentes

## [agente-lider] — modo estabilização · ativo

## [agente-ci] — 2026-09-18 07:25
**Papel:** Trabalhador  
**Domínio:** S1 — `ci-isolamento-estavel`  
**Status:** em andamento  
**Branch:** `feature/s1-ci-isolamento-estavel`  
**Observações:** Garantir workflow isolation + suite test/isolation confiável; corrigir falhas se houver.

## [agente-2] — AGUARDANDO ENTRADA
**Domínio sugerido:** S2 — frontend-cliente-polimento  
**Ação:** anuncie-se aqui com status `iniciando` e crie `feature/s2-frontend-cliente`

## [agente-3] — AGUARDANDO ENTRADA
**Domínio sugerido:** S3 — frontend-operacao-polimento  
**Ação:** anuncie-se aqui com status `iniciando` e crie `feature/s3-frontend-operacao`

## [agente-4] — AGUARDANDO ENTRADA
**Domínio sugerido:** S4 — demo-e2e-pagamentos  
**Ação:** anuncie-se aqui com status `iniciando` e crie `feature/s4-demo-e2e`

---

## Histórico núcleo (T1–T15)
Concluído na main (8e9f2ee / merges do Líder). Fase growth CONGELADA até estabilização.
