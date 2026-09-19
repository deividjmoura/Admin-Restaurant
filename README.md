# Admin-Restaurant

**SaaS multi-tenant para lanchonetes e restaurantes de serviço rápido.**

Cada loja opera em um ambiente isolado: cardápio, mesas, pedidos, equipe e caixa. O cliente pede pelo QR da mesa (ou delivery); a cozinha, o garçom e o caixa acompanham em tempo quase real. O dono gerencia tudo no painel.

> **Regra de ouro:** uma loja **nunca** vê dados de outra. Isolamento é imposto no servidor (`store_id` em toda query) e coberto por CI dedicada.

**Demo em ~5 minutos:** [docs/DEMO.md](docs/DEMO.md)

---

## Para quem é

- Dono de lanchonete / pub / restaurante que quer pedido por QR sem app do cliente
- Operação com cozinha e bar separados, garçom e caixa
- Quem precisa de **várias lojas** na mesma plataforma, com dados e permissões separados

Não é um monólito de uma única casa: o produto nasce multi-tenant.

---

## O que já existe

| Área | Status |
|------|--------|
| **Isolamento multi-tenant** | `store_id` server-side · testes de isolamento · workflow CI com Postgres |
| **Mesa + QR** | Sessão por token público · cardápio · carrinho **compartilhado** na mesa |
| **Pedido** | Checkout com **Idempotency-Key** · status por item |
| **Cozinha / Bar** | Fila por estação · SSE + fallback poll |
| **Garçom** | Itens READY → entregue |
| **Caixa** | Sessões abertas · totais · fechamento de mesa · PIX (configurável) |
| **Admin** | Cardápio, mesas/QR, configurações da loja |
| **Delivery** | Base de zonas/taxas e fluxo (fases) |
| **Auth / RBAC** | Papéis (owner, manager, kitchen, staff…) · autorização no servidor |
| **Ops** | Health/ready · fila de jobs · e-mail configurável via env |

**Congelado por ora:** growth agressivo (billing avançado, WhatsApp IA, onboarding self-service em escala).

---

## Fluxo do cliente (mesa)

1. Escaneia o QR → abre `/m/<token>`
2. Monta o pedido no cardápio (carrinho compartilhado com quem está na mesma mesa)
3. Envia o pedido (idempotente — retry não duplica)
4. Cozinha prepara → garçom entrega → caixa fecha a sessão

Staff: login → rotas `/kitchen`, `/bar`, `/waiter`, `/cashier`, `/admin`.

---

## Isolamento e qualidade

- Toda query de negócio filtra por **tenant / store** no backend
- Frontend **não** é fonte de verdade de autorização
- Suite **`npm run test:isolation`** com banco real
- CI **“Isolamento multi-tenant”** em PR/push na `main` (gate de skipped/cancelled/fail)

Detalhes: [docs/GOLDEN_RULES.md](docs/GOLDEN_RULES.md) · [docs/DEPLOY.md](docs/DEPLOY.md)

---

## Stack (resumo)

| Camada | Tecnologia |
|--------|------------|
| API | Node.js · Fastify · Zod · PostgreSQL |
| Auth | JWT + cookies httpOnly |
| Front | React · Vite · Tailwind (`frontend/`) |
| Realtime | SSE (+ poll de fallback) |
| Deploy | API pode servir o SPA em host único (paths relativos `/api/...`) |

---

## Documentação útil

| Doc | Conteúdo |
|-----|----------|
| [docs/DEMO.md](docs/DEMO.md) | Seed, tokens de mesa, checklist smoke 5 min |
| [docs/GOLDEN_RULES.md](docs/GOLDEN_RULES.md) | Isolamento, idempotência, testes |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Host único, env, SPA |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Visão de módulos (se presente) |

Código vivo: **só a branch `main`**. Issues e PRs legados não substituem o que está mergeado.

---

Feito para segurança de dados entre lojas, operação no chão e crescimento controlado.
