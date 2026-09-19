# Smoke operacional (5–10 min)

Validação rápida do sistema ponta a ponta + como ler o CI de isolamento.
Complemento de [docs/DEMO.md](./DEMO.md) (demo guiada com seed, tokens de mesa e PIX).

---

## 1. Comandos reais (`package.json`)

```bash
npm ci                # instala dependências
npm run db:migrate    # aplica migrations SQL versionadas
npm run db:seed       # lojas demo/loja2 + mesas + credenciais (imprime tokens no stdout)
npm run dev           # API (node --watch) — :3000
npm run web           # front Vite — em produção a API serve frontend/dist
npm test              # = test:isolation — suite completa test/isolation/*.test.js
npm run test:unit     # subconjunto que roda SEM banco (5 arquivos)
```

Sem `DATABASE_URL`, os testes de **integração pulam por design** (skip automático).
Por isso `skipped=0` só é exigido no **CI**, onde há Postgres 16 de serviço.

---

## 2. Checklist ponta a ponta (~5–10 min)

Detalhe de cada passo no [DEMO.md §4](./DEMO.md). Ordem:

| # | Ação | Esperado |
|---|------|----------|
| 1 | `curl -s localhost:3000/ready` | `{"db":true,...}` status 200 |
| 2 | `npm run db:seed` → anotar 1 `token=` de mesa | token não vazio |
| 3 | Abrir `/m/<token>` | sessão da mesa + botão cardápio |
| 4 | Cardápio → **+** item → carrinho | item no carrinho compartilhado da mesa |
| 5 | **Fazer pedido** | confirmação com nº do pedido (idempotente — retry não duplica) |
| 6 | `​/login` staff (`owner@demo.local`) → `/kitchen` ou `/bar` | pedido aparece (SSE ou poll ≤4s) |
| 7 | **Iniciar** → **Pronto** | item READY |
| 8 | `/waiter` → **Entregar** | item some da fila |
| 9 | `/cashier` → sessão → (PIX se configurado) → **Fechar** | mesa liberada |

Opcional: delivery (`/delivery` + `/delivery/track/:orderId`) e zonas/cupons no `/admin`.

---

## 3. CI — gates de isolamento (bloqueiam merge)

Workflow: [.github/workflows/ci-isolation.yml](../.github/workflows/ci-isolation.yml)
Eventos: `pull_request` + `push` na `main` · matrix **Node 20 e 22** · serviço **Postgres 16**.

1. `npm ci` → `db:migrate` → `npm run test:isolation`
2. Gate do resumo TAP: **`# skipped 0` · `# cancelled 0` · `# pass > 0` · `# fail 0`** — qualquer desvio falha o job
3. Smoke `/ready` com banco real (`db: true`)

### Como ler as conclusões

- **`cancelled` ≠ falha.** O workflow usa `cancel-in-progress`: em rajadas de pushes na main, o run mais antigo é cancelado e o mais novo valida o estado final. Antes de abrir incidente, confira se existe `success` posterior cobrindo o mesmo código.
- **`cancelled` *dentro* da suíte** (hook/setup quebrado) é diferente — o gate `# cancelled 0` pega isso.

### Verificação de 19/09 (agente-arena, A4)

- **Sem falha aberta.** Únicas falhas reais em 50 runs: 5 runs de 18/09 10:38–10:43 UTC (era S2 — "Roda testes de isolamento", ambos Nodes), já corrigidas no mesmo dia; suite verde desde então.
- Último run verde na main **incluindo os 13 casos IDOR do B1**: run `35459611007` — gates + smoke `/ready` ✓ em Node 20 e 22.
- Sanity local (sem banco): `npm run test:unit` → **16/16 pass, skipped 0**.

---

Dúvidas de arquitetura/isolamento → [GOLDEN_RULES.md](./GOLDEN_RULES.md) e [ARCHITECTURE.md](./ARCHITECTURE.md).
