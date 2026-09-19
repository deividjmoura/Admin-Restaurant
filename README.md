# Admin-Restaurant

**SaaS multi-tenant para lanchonetes e restaurantes** — pedidos por QR Code na mesa, delivery, cozinha em tempo real, caixa e painel do dono. Várias lojas na mesma plataforma, cada uma com dados **100% isolados**.

> **Demo ponta a ponta em ~5 minutos:** [docs/DEMO.md](docs/DEMO.md)

---

## O que é

Uma plataforma de operação completa para food service, do pedido ao pagamento. Cada loja é um *tenant* independente: cardápio, mesas, pedidos, equipe, configurações e relatórios próprios, servidos sob o seu subdomínio. O cliente final não instala nada — aponta a câmera para o QR da mesa ou abre o link de delivery.

**Regra de ouro:** uma loja **nunca** acessa dados de outra. O isolamento é garantido no servidor (banco, cache, eventos, filas e realtime) — o frontend nunca é camada de segurança.

---

## Para quem

| Público | O que faz na plataforma |
|---|---|
| **Cliente na mesa** | QR → cardápio → carrinho compartilhado da mesa → pedido |
| **Cliente delivery** | Link da loja → monta o pedido → acompanha o status |
| **Cozinha / Bar** | Fila por estação em tempo real · Iniciar → Pronto |
| **Garçom** | Entrega do que está pronto |
| **Caixa** | Totais da sessão · PIX · fechamento de mesa |
| **Dono / Gerente** | Cardápio, mesas/QR, zonas de delivery, cupons, dashboard |
| **Nova loja** | Onboarding self-service com verificação de e-mail |

---

## O que já existe

- **Mesa com QR** — sessão compartilhada com carrinho colaborativo (controle de versão) e checkout **idempotente** (`Idempotency-Key`).
- **Cozinha por estações** — `/kitchen` e `/bar` atualizados em tempo real via SSE, com máquina de status de pedido/item.
- **Garçom** — fila do que está pronto e confirmação de entrega.
- **Caixa** — sessão da mesa com totais, PIX (QR estático da loja ou Mercado Pago, webhooks idempotentes) e fechamento.
- **Delivery** — zonas e taxas por loja, pedido pelo link público e acompanhamento do pedido pelo cliente.
- **Admin** — dashboard de vendas, gestão de cardápio (categorias, produtos, adicionais, ordenação), mesas e QR, zonas de delivery, cupons.
- **Onboarding** — cadastro self-service de loja nova, com verificação por e-mail.
- **Operação robusta** — fila de jobs interna (impressão/notificações): falha secundária **não derruba o pedido**; health `/ready` com métricas.

---

## Por que confiar

- **CI de isolamento multi-tenant** que **bloqueia merge**: a suíte obrigatória exige zero testes pulados ou falhos (`skipped=0`, `cancelled=0`, `fail=0`) e ainda sobe o app com Postgres 16 de verdade para um smoke de `/ready`, em Node 20 e 22.
- Cobertura dos pontos sensíveis: cache por loja, resolução de tenant, escopo de queries, 404 cross-store, permissões por papel, onboarding e workers.
- Operações críticas **idempotentes** (pedidos, pagamentos/webhooks); senhas com scrypt; sessão em cookie httpOnly + JWT.
- Migrations SQL versionadas e log de auditoria de eventos.

---

## Status

Plataforma em **estabilização**: as fases de fundação → operação estão entregues e o crescimento de funcionalidades está **congelado** neste ciclo — o foco é higiene, UX e confiabilidade (ver fila em [`COORDENACAO.md`](COORDENACAO.md)).

**Stack:** Node.js + Fastify + PostgreSQL (Zod, JWT/cookie httpOnly, scrypt) · React + Vite + Tailwind · SSE · migrations SQL versionadas.

---

## Documentação

| Doc | Conteúdo |
|---|---|
| [docs/DEMO.md](docs/DEMO.md) | Demo de 5 min do pedido ao pagamento (seed, tokens de mesa, PIX) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura multi-tenant, isolamento em camadas, papéis |
| [docs/GOLDEN_RULES.md](docs/GOLDEN_RULES.md) | Regras de ouro antes de qualquer mudança |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisões arquiteturais (ADR leve) |
| [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/BACKUP.md](docs/BACKUP.md) | Operação em produção |
| [PROTOCOLO-AGENTES.md](PROTOCOLO-AGENTES.md) | Como agentes/colaboradores entram no projeto |

---

Feito com foco em segurança, integridade e confiabilidade.
