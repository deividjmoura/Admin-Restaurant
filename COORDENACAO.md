# COORDENACAO.md — Fonte única de verdade

> **Modo: ESTABILIZAÇÃO** · Líder ativo · GOLDEN_RULES sagradas  
> Designação oficial do Líder — 2026-09-18 07:40

---

## 🎯 Frentes — designação do Líder

| Agente | ID | Frente | Domínio | Status | Ordem do Líder |
|--------|-----|--------|---------|--------|----------------|
| **agente-ci** | S1 | CI + isolamento | `ci-isolamento-estavel` | PR #79 CI **vermelho** | **Corrigir** e-mail único em `permissions.test.js` (colisão OWNER A/B) e re-push |
| **agente-ci** | S2 | Frontend cliente | `frontend-cliente-polimento` | PR #80 aberto | Aguardando revisão do Líder |
| **agente-3** | S3 | Frontend operação | `frontend-operacao-polimento` | **DESIGNADO** | **Começar agora** — cozinha/bar/garçom/caixa estáveis |
| **agente-4** | S4 | Demo E2E | `demo-e2e-pagamentos` | **DESIGNADO** | **Começar agora** — docs/DEMO.md + validar e-mail+PIX sandbox |

### Critério de sucesso do dia
- [ ] `test/isolation` verde no CI (S1)
- [ ] Fluxo QR → pedido → cozinha/garçom/caixa apresentável (S2+S3)
- [ ] Demo documentada com onboarding + PIX (S4)

### Proibido
- Growth sem o Líder
- Quebrar isolamento
- Confiar em `store_id` do cliente
- Dois agentes no mesmo domínio

---

## 📋 Tarefas oficiais (copy para o agente)

### S1 — agente-ci (já em andamento)
**Fix urgente:** em `test/isolation/permissions.test.js`, o e-mail
`${role}-${suffix}@perm.test` colide quando OWNER é criado para store A e B.
Use e-mail único por store, ex.: `${role}-${store.slug}-${suffix}@perm.test`.
Re-push na branch `feature/s1-ci-isolamento-estavel`. Não abrir PR novo.

### S2 — agente-ci (PR #80)
Handoff recebido. Líder revisa após S1 verde (ou em paralelo se diff for só frontend).

### S3 — agente-3 (DESIGNADO pelo Líder)
**Objetivo:** cozinha / bar / garçom / caixa estáveis para demo.

Done means:
1. Login staff → `/kitchen` e `/bar` listam pedidos da estação
2. SSE ou poll: novos pedidos aparecem sem refresh manual
3. Preparar → Pronto nos itens
4. `/waiter`: itens READY → Entregar
5. `/cashier`: sessões abertas → detalhe → PIX/fechar mesa
6. Sem erros óbvios de console no fluxo operação

Branch: `feature/s3-frontend-operacao` a partir de `main`  
Arquivos: `frontend/src/pages/staff/*`  
Brief: `docs/AGENT_BRIEFS.md` (seção S3, no PR #79 se ainda não mergeado)

Ao entrar: registre abaixo com status `iniciando`. Ao terminar: PR + handoff.

### S4 — agente-4 (DESIGNADO pelo Líder)
**Objetivo:** documentar e validar caminho de demo com e-mail + PIX sandbox.

Done means:
1. Arquivo `docs/DEMO.md` com env mínimos e passos signup → verify → login → mesa → pedido → PIX
2. Confirmar PIX sandbox / estático e webhook idempotente
3. Confirmar signup não depende só de `devToken` em prod
4. Se achar bug de isolamento em payments/onboarding → teste em `test/isolation/`

Branch: `feature/s4-demo-e2e` a partir de `main`  
Não colocar credenciais reais no repo. Não ativar growth.

Ao entrar: registre abaixo com status `iniciando`. Ao terminar: PR + handoff.

---

## 👥 Registro de agentes

## [agente-lider] — 2026-09-18 07:40
**Papel:** Líder  
**Ação:** Designou S3 → agente-3 e S4 → agente-4.  
**S1:** bloqueado em CI (fix e-mail permissions).  
**S2:** PR #80 em fila de review.

## [agente-ci] — S1 · PR #79
**Status:** CI vermelho — fix e-mail `uq_users_email` em permissions.test.js  
**Branch:** `feature/s1-ci-isolamento-estavel`

## [agente-ci] — S2 · PR #80
**Status:** aguardando revisão  
**Branch:** `feature/s2-frontend-cliente`  
**Handoff:** badge carrinho, /api relativo, checkout Idempotency-Key

## [agente-3] — S3 · DESIGNADO
**Domínio:** `frontend-operacao-polimento`  
**Status:** deve anunciar `iniciando` e criar `feature/s3-frontend-operacao`

## [agente-4] — S4 · DESIGNADO
**Domínio:** `demo-e2e-pagamentos`  
**Status:** deve anunciar `iniciando` e criar `feature/s4-demo-e2e`
