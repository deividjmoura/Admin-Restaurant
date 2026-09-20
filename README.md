# Admin-Restaurant

**Plataforma SaaS Multi-Tenant para Lanchonetes / Restaurantes**

Sistema completo de pedidos por QR Code (mesa), delivery, cozinha, caixa e painel do dono — construído desde o primeiro commit com **isolamento rigoroso de dados entre lojas**.

> Base de domínio e UX inspirada em [lanchonete-qr-semi-final](https://github.com/deividjmoura/lanchonete-qr-semi-final), reescrita com arquitetura multi-tenant conforme a Especificação Técnica.

---

## Visão

Cada lanchonete (tenant) possui ambiente logicamente isolado:

- Cardápio, mesas, pedidos, clientes, usuários, configurações e relatórios
- Cliente final acessa via QR Code da mesa ou link de delivery (sem instalar app)
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
npm run test:suite   # migrations + suíte + guarda: pass 171 · fail 0 · skipped 0
```

Checklist de API em 5–10 min (login → mesa → pedido → cozinha → caixa):
**[docs/SMOKE.md](docs/SMOKE.md)**.

Hardening de segurança (webhooks assinados, CORS fail-closed, totais com
adicionais, atomicidade de checkout/delivery, sessões de QR e auditoria):
**[docs/SECURITY.md](docs/SECURITY.md)**.
Operação em produção (logs JSON com `requestId`/`storeId`/`userId`, métricas
Prometheus em `/metrics`, `/health` e `/ready` com checks registráveis):
**[docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)**.
Verificação dos riscos residuais (script + playbook manual):
**[docs/VERIFY-RESIDUAL-RISKS.md](docs/VERIFY-RESIDUAL-RISKS.md)**.

---

## Fases de implementação

Veja as [Issues](https://github.com/deividjmoura/Admin-Restaurant/issues) e os Epics:

1. Fundação + Multi-tenancy (isolamento)
2. Cardápio + Cache
3. Mesas + QR + Sessões
4. Pedidos + Idempotência
5. Cozinha + Realtime
6. Delivery
7. Pagamentos
8. Dashboard
9. Operação (filas, impressão, observabilidade, backup)

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
