# Admin-Restaurant

**Plataforma SaaS Multi-Tenant para Lanchonetes / Restaurantes**

Sistema completo de pedidos por QR Code (mesa), delivery, cozinha, caixa e painel do dono — construído desde o primeiro commit com **isolamento rigoroso de dados entre lojas**.

> Base de domínio e UX inspirada em [lanchonete-qr-semi-final](https://github.com/deividjmoura/lanchonete-qr-semi-final), reescrita com arquitetura multi-tenant conforme a Especificação Técnica.

---

## Visão

Cada lanchonete (tenant) possui ambiente logicamente isolado:

- Cardápio, mesas, pedidos, clientes, usuários, configurações e relatórios
- Cliente final acessa via QR Code da mesa ou link de delivery (sem instalar app) —
  cada fluxo com **credencial customer própria** (mesa/QR e checkout de delivery
  são planos distintos, ver docs `CUSTOMER-SESSIONS.md` e `DELIVERY-CHECKOUT.md`)
- Cozinha, garçom e caixa operam em tempo real
- Dono tem dashboard e configurações

**Regra de ouro:** uma loja **nunca** acessa dados de outra.

---

## Stack

| Camada        | Tecnologia                          |
|---------------|-------------------------------------|
| Runtime       | Node.js                             |
| API           | Fastify                             |
| Banco         | PostgreSQL                          |
| Validação     | Zod                                 |
| Auth          | JWT + cookies httpOnly + scrypt     |
| Frontend      | React + Vite + Tailwind             |
| Realtime      | SSE (inicial)                       |
| Migrations    | SQL versionado                      |

---

## Estrutura

```text
src/
├── modules/
│   ├── auth/
│   ├── tenancy/
│   ├── menu/
│   ├── tables/
│   ├── orders/
│   ├── delivery/
│   ├── payments/
│   ├── kitchen/
│   ├── reports/
│   └── ...
├── shared/
├── infrastructure/
└── workers/
migrations/
docs/
scripts/
```

---

## Guia dos agentes

Quem vai contribuir (humano ou agente) começa por **[docs/AGENTES.md](docs/AGENTES.md)**:
claim de Issue, branch, template de PR, como rodar os testes e Definition of Done.

---

## Validação rápida (sem frontend)

```bash
npm ci && npm run db:migrate && npm run db:seed && npm run dev
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm run test:suite   # migrations + suíte + guarda: pass 223 · fail 0 · skipped 0
```

Checklist de API em 5–10 min (login → mesa → pedido → cozinha → caixa):
**[docs/SMOKE.md](docs/SMOKE.md)**.

Hardening de segurança (webhooks assinados, CORS fail-closed, totais com
adicionais, atomicidade de checkout/delivery, sessões de QR e auditoria):
**[docs/SECURITY.md](docs/SECURITY.md)**.
Verificação dos riscos residuais (script + playbook manual):
**[docs/VERIFY-RESIDUAL-RISKS.md](docs/VERIFY-RESIDUAL-RISKS.md)**.

---

## Roadmap & Fases

Veja o plano de longo prazo, status atual (`main` vs PR #152) e triagem de issues
em **[docs/ROADMAP.md](docs/ROADMAP.md)**. Resumo das 10 fases:

1. Fundação + Multi-tenancy (isolamento) — ✅ estável
2. Cardápio + Cache — ✅ estável
3. Mesas + QR + Sessões — ✅ estável
4. Pedidos + Idempotência — ✅ estável
5. Cozinha + Realtime — 🟡 cliente (Parte B) / realtime pendente
6. Delivery — 🟡 contrato pronto
7. Pagamentos — 🔴 em andamento (PR #152, fora da Parte B)
8. Dashboard — 🟢 Parte B (cliente)
9. Operação (filas, impressão, observabilidade, backup) — 🟡 parcial
10. Growth (CRM, cupons, fidelidade, IA/WhatsApp) — ⚪ planejado

Epics e issues abertas: [Issues](https://github.com/deividjmoura/Admin-Restaurant/issues).

## Demo pública (Vercel)

A SPA é um único build com 3 contextos de entrada resolvidos pelo **hostname**
(ver [`docs/ENTRY-CONTEXTS.md`](docs/ENTRY-CONTEXTS.md)):

| Host (BASE_DOMAIN=localhost) | Contexto | Entrada |
|------------------------------|----------|---------|
| `localhost:5173` / `www.` | marketing | Landing + lead + orientação de acesso |
| `app.localhost:5173` | platform | Administração do SaaS (`/platform/login`) |
| `demo.localhost:5173` | store | Staff da loja demo + cliente via QR |

**Rodar localmente (precisa do backend + Postgres):**

```bash
cp .env.example .env            # defina DATABASE_URL, JWT_SECRET, COOKIE_SECRET, STAFF_SEED_PASSWORD
npm ci && npm run db:migrate && npm run db:seed
npm run dev                     # API :3000
npm ci --prefix frontend && npm run web   # SPA :5173 (proxy /api → :3000)
# Acesse http://demo.localhost:5173/login  (staff) ou http://localhost:5173 (landing)
```

Credenciais de seed (troque em produção): `owner@demo.local` / `demo-senha-local`.
O token de mesa (customer QR) é impresso pelo `db:seed` (`token=...`) e abre
`/m/<token>` no host da loja. Smoke de ponta a ponta (API): [`docs/SMOKE.md`](docs/SMOKE.md).

**Deploy Vercel:** SPA estático; `frontend/vercel.json` já faz o **fallback SPA**
(`/(.*)` → `/index.html`). Mantenha `VITE_BASE_DOMAIN` igual ao domínio da API e
`VITE_API_URL` vazio (mesma origem via proxy de borda). Não reutilize
`VITE_TENANT_SLUG` fixo.

---

## Princípios

- Multi-tenancy desde o dia 1
- Segurança server-side (nunca confiar no frontend)
- Isolamento em banco, cache, eventos, filas e realtime
- Operações críticas idempotentes
- Falhas secundárias não derrubam o fluxo principal
- Migrations versionadas
- Testes de isolamento multi-tenant obrigatórios

---

Feito com foco em segurança, integridade e crescimento.


## Contextos de entrada

A partir da migration 0022: marketing no apex/www, plataforma em app/platform e
loja em subdomínio/custom domain. Login genérico e seleção de tenant pelo browser
foram removidos. Consulte [contratos e implantação](docs/ENTRY-CONTEXTS.md) antes
de atualizar um deploy existente. Bootstrap sem demo: `npm run platform:bootstrap`.
