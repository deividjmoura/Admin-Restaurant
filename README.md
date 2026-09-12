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

## Como rodar (em breve)

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

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
