# Verificação dos riscos residuais (PR #151)

Playbook para **outro agente** (ou pessoa) confirmar, com evidência, o que ficou
fora do escopo do hardening e como cada risco se comporta hoje.

Pré-requisitos:

```bash
git checkout main && git pull --ff-only origin main
npm ci && npm ci --prefix frontend
export DATABASE_URL=postgres://user:pass@host:5432/admin_restaurant   # NUNCA produção
npm run db:migrate && npm run db:seed
```

> ⚠️ `scripts/verify-hardening.mjs` cria/apaga lojas de teste e, em uma das
> checagens, cria um trigger temporário em `audit_logs` (removido no `finally`).
> Ele **aborta** se `NODE_ENV=production`.

---

## 0. Verificador automático (7 checagens, ~2s)

```bash
NODE_ENV=test DATABASE_URL="$DATABASE_URL" node scripts/verify-hardening.mjs
# esperado: 7/7 checagens OK  (exit code 0)
```

Checagens cobertas: migrações 0019–0021 + guarda `MIN_TESTS=171`,
`webhook-referencia-externa`, `referencia-global-unica`, `pix-chave-plataforma`,
`auditoria-best-effort`, `rate-limit-em-memoria`, `paineis-403`.

Rodar uma checagem isolada:

```bash
node scripts/verify-hardening.mjs --only=webhook-referencia-externa
node scripts/verify-hardening.mjs --only=auditoria-best-effort,pix-chave-plataforma
```

---

## R1 — Webhook só casa pagamento que tenha `(provider, provider_payment_id)`

**O que verificar:** não existe integração de provider criando pagamentos; o
webhook confirma apenas pagamentos já registrados com a referência externa.
Pagamento `static_pix`/`CASH` continua sendo confirmado no caixa.

```bash
# 1) sonda automatizada
node scripts/verify-hardening.mjs --only=webhook-referencia-externa
# esperado: PASS — fluxo feliz vai para PAID; referência desconhecida NÃO cria
#           pagamento e o evento fica com store_id NULL (ignora storeId do body)

# 2) inventário do estado real do banco
psql "$DATABASE_URL" -c "
  SELECT provider,
         COUNT(*) AS pagamentos,
         COUNT(provider_payment_id) AS com_referencia,
         COUNT(*) FILTER (WHERE status='PAID') AS pagos
  FROM payments GROUP BY provider ORDER BY 2 DESC;"

# 3) eventos que não casaram nenhum pagamento (alerta operacional)
psql "$DATABASE_URL" -c "
  SELECT provider, event_type, COUNT(*)
  FROM payment_events WHERE payment_id IS NULL
  GROUP BY 1,2 ORDER BY 3 DESC;"
```

Interpretação: linhas em (3) com volume alto = provider enviando referência que
o sistema não conhece. Ação recomendada: registrar `providerPaymentId` no
momento da cobrança (integração real do provider) antes de ligar webhooks em
produção.

---

## R2 — Rate limit por instância (single node)

**O que verificar:** os contadores vivem em memória (LRU do
`@fastify/rate-limit`), então N réplicas = N orçamentos independentes.

```bash
node scripts/verify-hardening.mjs --only=rate-limit-em-memoria
# esperado: PASS — instância A chega em 429; instância NOVA (mesmo processo,
#           mesmo banco) responde 401, provando contador por instância
```

Checagem em cluster real (documentada, exige ambiente com 2 réplicas):

```bash
# com 2 réplicas atrás do mesmo balanceador, disparar 6 logins errados
# alternando entre elas e conferir que passa de 5 sem 429.
for i in $(seq 1 8); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST \
    -H 'content-type: application/json' -H 'x-tenant-slug: demo' \
    -d '{"email":"nao@existe.local","password":"senha-errada-123"}' \
    http://127.0.0.1:3000/api/auth/login
done; echo
```

Correção estrutural (fora do escopo deste PR): usar `store` Redis no
`@fastify/rate-limit` e no throttle de identidade do login antes de escalar
horizontalmente.

---

## R3 — `PIX_ALLOW_PLATFORM_KEY=true` em produção

**O que verificar:** o fallback da chave da plataforma é bloqueado por padrão em
produção e liberado só com a flag explícita.

```bash
node scripts/verify-hardening.mjs --only=pix-chave-plataforma
# esperado: PASS — NODE_ENV=production sem flag → 503 PIX_NOT_CONFIGURED;
#           com PIX_ALLOW_PLATFORM_KEY=true → 201 e o copia-e-cola usa a chave
#           da plataforma

# auditoria de quem está com a flag ligada (infra):
grep -R "PIX_ALLOW_PLATFORM_KEY" .env* docker-compose*.yml 2>/dev/null
```

Critério de aceite: a flag deve estar **ausente** (ou `false`) em produção;
se estiver `true`, toda loja sem `settings.pix.key` recebe dinheiro na conta da
plataforma.

---

## R4 — Auditoria best-effort

**O que verificar:** se `audit_logs` estiver indisponível, a operação de negócio
continua e o evento é perdido (com `log.warn`).

```bash
node scripts/verify-hardening.mjs --only=auditoria-best-effort
# esperado: PASS — com trigger que faz todo INSERT em audit_logs falhar, o
#           POST /api/admin/tables continua 201, a mesa existe e nenhuma linha
#           parcial de auditoria é gravada; o trigger é removido no finally

# garantir que o trigger temporário não ficou para trás:
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger
  WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal;"
# esperado: apenas audit_logs_immutable
```

Risco aceito: perda de evento em indisponibilidade do banco. Se auditoria
passar a ser requisito regulatório, trocar por outbox transacional
(`audit_outbox` na mesma transação, worker publicando depois).

---

## R5 — Painel com 403 mostra banner mas continua no ritmo normal

O lado servidor é verificável; o lado visual é manual.

```bash
node scripts/verify-hardening.mjs --only=paineis-403
# esperado: PASS — usuário da loja A recebe 401/403 ao pedir a fila da loja B e
#           200 na própria loja; o hook usa setError(err) para 403

# servidor: suba a API e o frontend
npm run dev                     # API em :3000
npm run web                     # SPA (proxy /api)
```

Verificação manual no navegador (5 passos):

1. Faça login com `owner@demo.local` e abra `/kitchen` — a fila carrega.
2. Em `role_permissions` da loja `demo`, remova `kitchen.orders.read` do papel:
   ```sql
   DELETE FROM role_permissions
   WHERE store_id = (SELECT id FROM stores WHERE slug='demo')
     AND role='OWNER' AND permission_key='kitchen.orders.read';
   ```
3. Recarregue `/kitchen`: aparece **banner de acesso negado** (nada silencioso).
   O polling continua a cada ~4s (comportamento atual e aceito).
4. Restaure a permissão (`PUT /api/admin/roles/OWNER/permissions`) e recarregue:
   a fila volta sem precisar re-login.
5. Com a aba em background (troque de aba por 30s), confira no DevTools →
   Network que **não há novas requisições** enquanto `document.hidden` for true,
   e que ao voltar há um fetch imediato.

---

## Checagem final pós-merge (bloqueante)

```bash
git log --oneline -10                    # deve conter os 8 commits do PR
npm run db:migrate                       # esperado: "Nenhuma migration pendente"
npm run test:suite                       # esperado: 171/171 + check-tap mínimo 171
npm run test:guard -- .tap/suite.tap     # esperado: OK
npm run web:build                        # esperado: build sem erro
gh pr checks 151                         # Backend/Frontend/Vercel = pass
```

Critério de aceite: **171 testes, 0 falhas, 0 skipped** e guard verde com mínimo
171. Qualquer número menor indica que a suíte sumiu/não rodou — investigar antes
de considerar o merge bom.
