# Decisões de Arquitetura

## 2026-09-12 — Stack e abordagem de bootstrap

**Decisão:** Começar o repositório limpo com multi-tenancy desde o dia 1.
Usar o projeto `lanchonete-qr-semi-final` apenas como **referência de domínio e UX**, não como código base a ser adaptado.

**Motivo:** A especificação proíbe explicitamente criar single-tenant e depois adaptar. Isolamento mal feito é o maior risco do projeto.

**Reaproveitamento permitido:**
- Padrões de UI/UX e fluxos operacionais
- Regras de negócio já validadas (status, sessões, setores, etc.)
- Ideias de SSE, rate-limit, seed

**Não reaproveitar:**
- Schema sem `store_id`
- Queries sem scoping de tenant
- Features legadas não utilizadas (ex.: ponto da carne)

## 2026-09-12 — Fastify em vez de HTTP nativo

**Decisão:** Usar Fastify.

**Motivo:** Schema validation, plugins maduros (cookie, helmet, rate-limit, cors), melhor base para crescer sem reescrever o servidor depois. Ainda mantém a simplicidade próxima do projeto de referência.

## 2026-09-16 — Onboarding self-service sem provider de e-mail ainda

**Decisão:** Implementar o fluxo de signup (issue #60) reaproveitando
`stores.status = 'pending'` (já existente desde a migration 0002) em vez de
criar um novo enum de estado. Store só vira `active` após verificação de
e-mail do owner.

**Motivo:** Evita estado duplicado (`pending` já cobria exatamente esse
caso) e mantém o middleware de tenant sem mudanças — uma store `pending`
já é tratada como indisponível por `resolveStoreFromRequest`.

**Pendência conhecida:** não há provider de e-mail transacional integrado.
O token de verificação é logado via `audit` e devolvido na resposta HTTP
fora de `production` (`verification.devToken`), para permitir testar o
fluxo sem inbox real. Trocar por provider real é follow-up necessário antes
de abrir cadastro público em produção — ver `TODO(#59-infra)` no código.

## 2026-09-12 — Documentação separada em GOLDEN_RULES

**Decisão:** Extrair o checklist e regras de ouro para `docs/GOLDEN_RULES.md`.

**Motivo:** Facilitar consulta rápida no dia a dia e nos PRs, sem misturar com a descrição de arquitetura.
