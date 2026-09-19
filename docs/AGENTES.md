# Guia dos Agentes — como trabalhar no Admin-Restaurant

> **Leia antes de abrir branch.** Este documento é a fonte operacional; decisões de
> arquitetura ficam em [`DECISIONS.md`](./DECISIONS.md) e regras inegociáveis em
> [`GOLDEN_RULES.md`](./GOLDEN_RULES.md).

**Canal vivo:** `main`. Toda entrega entra por PR pequeno contra `main`.

---

## 1. Papéis

| Papel | Responsabilidade |
|-------|------------------|
| **Líder** | prioriza, revisa, faz merge em `main`, resolve conflito de domínio e de arquitetura |
| **Agente** | reivindica **uma** Issue, entrega **um** PR pequeno, testa, reporta |

Nenhum agente decide arquitetura, prioridade ou contrato de API sozinho → **escala ao Líder**.

---

## 2. Fluxo de uma tarefa

1. **Escolha uma Issue** com label de área (`SEC`, `POS`, `KDS`, …) e `roadmap`.
   Comece pelas de `priority:high` (Onda 1 — Fundação).
2. **Reivindique**: como o token dos agentes **não consegue editar/comentar Issue**, o claim é
   feito **no PR** e na branch:
   - branch `feat/<area>-<resumo>` (ex.: `feat/sec-rbac-permissions`)
   - primeiro commit: `wip(<area>): claim #<número> — <resumo>`
   - abra **PR em draft** com `Closes #<número>` no corpo → todos veem que está em andamento
3. **Implemente** em commits pequenos: `tipo(área): o que foi feito`.
4. **Teste** (seção 5) e atualize `docs/SMOKE.md` se o fluxo mudar.
5. **Tire do draft**, preencha o template de PR (seção 4) e peça revisão.
6. **Líder faz o merge** e apaga a branch. Não faça merge do próprio PR.

**Uma Issue = uma branch = um PR.** Mudança de banco e mudança de comportamento podem (e devem)
ser separadas quando isso reduzir risco: *migration compatível → código → ativação*.

---

## 3. Branches e commits

```bash
git checkout main && git pull
git switch -c feat/sec-rbac-permissions
git commit -m "feat(auth): tabela de permissões + decorator requirePermission"
git push -u origin feat/sec-rbac-permissions
```

- Prefixos: `feat/`, `fix/`, `test/`, `docs/`, `chore/`, `refactor/`
- **Nunca** trabalhar direto na `main`
- Branch de outro agente é território dele: sobreposição → escala ao Líder

---

## 4. Template obrigatório de PR

```markdown
## Resumo
O que este PR implementa.

## Issue
Closes #<numero>

## Alterações
- ...

## Banco de dados
- [ ] Sem alteração
- [ ] Migration reversível
- [ ] Backfill necessário
- [ ] Índice/constraint

## API
- [ ] Sem alteração de contrato
- [ ] Novo endpoint
- [ ] Alteração compatível
- [ ] Breaking change documentada

## Segurança
- [ ] Autorização validada no backend
- [ ] Isolamento tenant/store testado
- [ ] Dados sensíveis protegidos

## Testes
- [ ] Unit
- [ ] Integration
- [ ] E2E/HTTP
- [ ] Regressão (docs/SMOKE.md)

## Verificação manual
Como validar a funcionalidade (comandos/rotas).

## Riscos / rollback
Como reverter com segurança.
```

---

## 5. Como rodar os testes (leia antes de dizer “está verde”)

```bash
npm ci
cp .env.example .env            # preencha DATABASE_URL, JWT_SECRET, COOKIE_SECRET
npm run db:migrate
npm run db:seed
npm run dev                     # API em :3000

npm run test:unit               # sem banco
export DATABASE_URL=postgres://user:pass@localhost:5432/admin_restaurant
npm run test:suite              # migrations + suíte completa + guarda de contagem
```

> **Armadilha conhecida:** `node --test` **não** lê `.env`. Sem `DATABASE_URL` exportada no
> *shell*, `npm test` termina com `exit 0`, `pass 16` e **`skipped 13`** — verde falso.
> Critério de aceite: **`fail 0` E `skipped 0`**.
>
> `npm run test:suite` cuida disso por você: aborta com exit 2 sem `DATABASE_URL`, aplica as
> migrations, roda a suíte com reporter TAP e **recusa** o resultado se houver falha, teste
> ignorado ou menos testes que `MIN_TESTS` (baseline **29**). Use-o em vez de `npm test`.

Baseline na `main` (`668434b`): **29 testes · 8 suítes · 0 fail · 0 skipped** (~31 s).
Checklist manual de API em 5–10 min: [`SMOKE.md`](./SMOKE.md).

> **CI ativo:** `.github/workflows/ci.yml` roda em todo PR contra `main` — job *backend*
> (Postgres 18 de serviço → `db:seed` → `npm run test:suite`) e job *frontend* (`npm run build`).
> PR com check vermelho não entra. Adicionou teste novo? Suba o `MIN_TESTS` do workflow junto.

Frontend: `npm ci --prefix frontend && npm run build --prefix frontend` precisa passar.

---

## 6. Regras inegociáveis

1. **Isolamento multi-tenant** — `store_id` em toda query, cache tenant-aware, canal realtime
   por loja, `404` (nunca `403`) para recurso de outra loja. Quebrou teste de isolamento = PR inválido.
2. **Autorização no backend** — o frontend só reflete; nunca decide.
3. **Idempotência** — criar pedido, pagar, webhook e estorno aceitam `Idempotency-Key`
   e **não duplicam** em retry.
4. **Falha secundária não derruba o fluxo principal** — impressão/notificação/auditoria vão
   para fila; o pedido responde antes.
5. **Migrations versionadas e reversíveis**; nunca alterar produção manualmente.
6. **Segredos fora do código** (`.env`, nunca commitado).
7. **Dinheiro em `numeric`/centavos**, nunca float.
8. **Erros padronizados** (`AppError`) sem stack trace para o cliente.

---

## 7. Backlog — por onde começar

As Issues seguem o “Roadmap Técnico para Evolução do Produto” e usam o template
`Objetivo / Contexto / Escopo / Fora do escopo / Regras / Critérios de aceite / Testes /
Dependências / Riscos`.

| Onda | Foco | Issues |
|------|------|--------|
| **1 · Fundação** | permissões, auditoria, hardening de isolamento, observabilidade | `SEC` ×2, `OPS` ×1 — **comece aqui** |
| **2 · Operação** | caixa (sessão, ledger, pagamento combinado, relatório), pedidos, mesas | `POS` ×4, `ORDERS` ×1, `TABLES` ×1 |
| **3 · Produção** | estações, estados por item, SLA, métricas | `KDS` ×4 |
| **4 · Delivery** | providers/adapters, idempotência e reconciliação | `DELIVERY` ×2 |
| **5 · Estoque** | insumos, ficha técnica, movimentações, CMV, compras | `INVENTORY` ×4, `PURCHASING` ×1 |
| **6 · Financeiro** | contas, fluxo de caixa, conciliação, DRE | `FINANCE` ×4 |
| **7 · Fiscal** | abstração, documentos/XML, contingência | `FISCAL` ×3 |
| **8 · Multiunidade** | hierarquia e dashboard consolidado | `MULTIUNIT` ×2 |
| **9 · Offline/Devices** | fila local, adapters de hardware | `OFFLINE` ×1, `DEVICES` ×1 |
| **10 · CRM/Marketing** | clientes, promoções, fidelidade, automações | `CRM`/`MARKETING`/`LOYALTY`/`AUTOMATION` |

Regra de ouro do roadmap: **não é adicionar o máximo de features** — é manter a plataforma
confiável, isolada, auditável e extensível.

---

## 8. Armadilhas conhecidas da base atual

| Situação | O que acontece hoje |
|----------|---------------------|
| SSE `/api/kitchen/events` | exige tenant; `EventSource` não manda header e `?tenant=` **não** é aceito → `400`. Por isso `KitchenPage` usa poll de 4 s. Só funciona por subdomínio |
| `POST /api/orders` com `Idempotency-Key` já usada em **outra** sessão | devolve `200 replayed:true` com o pedido da sessão original; `cart/checkout` responde `409 IDEMPOTENCY_KEY_REUSED` (inconsistência a corrigir) |
| `npm test` sem `DATABASE_URL` no shell | verde falso com `skipped 13` → use `npm run test:suite` (recusa) |
| `npm run db:seed` | imprime `[db] …` entre os `token=` — é log, não erro |
| Comentários de rota em `payments-routes.js` | o confirm está documentado como `PATCH`; a rota é `POST` |

---

## 9. Definition of Done

- [ ] Critérios de aceite da Issue atendidos
- [ ] Testes adicionados/atualizados; nenhum teste existente quebrado sem justificativa
- [ ] `npm run test:suite`: `fail 0` **e** `skipped 0` (e o check **CI** verde no PR)
- [ ] Autorização e isolamento tenant/store revisados
- [ ] Migration (se houver) reversível e documentada
- [ ] Logs e erros relevantes observáveis
- [ ] API documentada quando houve mudança de contrato
- [ ] Frontend com estados de loading, erro, vazio e sucesso (quando aplicável)
- [ ] Idempotência/concorrência avaliadas
- [ ] PR com descrição completa, Issue vinculada e instruções de validação
- [ ] `docs/` atualizado quando arquitetura ou operação mudou

---

## 10. O que **não** fazer

- Merge na `main` sem revisão do Líder
- PR gigante de módulo inteiro
- Mexer em domínio reivindicado por outro agente sem comunicar
- Confiar em `store_id`/`tenant` enviado pelo cliente
- Commitar segredo, `.env`, `node_modules` ou build
- Reescrever histórico (migration destrutiva, `UPDATE` em auditoria/ledger)
- Dizer que está testado sem ter rodado a suíte com `DATABASE_URL`
