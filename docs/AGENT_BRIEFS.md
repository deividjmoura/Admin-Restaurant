# Briefs dos agentes — modo estabilização

Leia `COORDENACAO.md` + `docs/GOLDEN_RULES.md` antes de codar.  
API serve a SPA: caminhos relativos `/api/...`. SSE: `?tenant=slug`.

---

## S1 — agente-ci (CI isolamento) — EM ANDAMENTO

**Objetivo:** suite `test/isolation` 100% verde no CI, zero skips.

- Workflow: `.github/workflows/ci-isolation.yml`
- Script: `npm run test:isolation`
- Critério: `# skipped 0` + `/ready` com `db: true`

---

## S2 — agente-2 (Frontend cliente) — LIVRE

**Objetivo:** fluxo QR → cardápio → carrinho → checkout **apresentável** e sem erros de console.

### Checklist
1. Abrir `/m/:token` (mesa seed) e validar sessão
2. Menu carrega categorias/produtos da API pública
3. Carrinho compartilhado: add / qty / remove
4. Checkout envia `Idempotency-Key` (header ou body)
5. Tela de confirmação com número do pedido
6. Loading / empty / error states legíveis
7. Mobile-first (Tailwind)

### Arquivos
- `frontend/src/pages/customer/*`
- `frontend/src/api/client.js` (paths relativos)
- `frontend/src/lib/session.js`

### Branch
`feature/s2-frontend-cliente` → PR para `main`

### Não fazer
- Não mexer em staff/admin
- Não alterar backend sem necessidade

---

## S3 — agente-3 (Frontend operação) — LIVRE

**Objetivo:** cozinha / bar / garçom / caixa estáveis para demo.

### Checklist
1. Login staff → `/kitchen` e `/bar` listam pedidos da estação
2. SSE ou poll: novos pedidos aparecem sem refresh manual
3. Preparar → Pronto nos itens
4. `/waiter`: itens READY → Entregar
5. `/cashier`: sessões abertas → detalhe → PIX/fechar mesa
6. Nav unificada entre as 4 telas
7. Indicador “ao vivo” vs “atualizando”

### Arquivos
- `frontend/src/pages/staff/*`

### Branch
`feature/s3-frontend-operacao` → PR para `main`

### Não fazer
- Não reescrever rotas de kitchen no backend sem isolamento testado

---

## S4 — agente-4 (Demo E2E pagamentos + onboarding) — LIVRE

**Objetivo:** documentar e validar caminho de demo com e-mail + PIX sandbox.

### Checklist
1. Documentar em `docs/DEMO.md`:
   - env mínimos (`DATABASE_URL`, `JWT_SECRET`, `MP_ACCESS_TOKEN` teste, `EMAIL_PROVIDER=console` ou Resend)
   - passos: signup → verify → login → abrir mesa → pedido → PIX
2. Confirmar `POST /api/payments` com PIX (estático ou MP se token setado)
3. Confirmar webhook path `/api/payments/webhooks/mercadopago` (idempotente)
4. Confirmar signup não depende só de `devToken` em prod
5. Se achar bug de isolamento em payments/onboarding → teste em `test/isolation/`

### Branch
`feature/s4-demo-e2e` → PR para `main`

### Não fazer
- Não colocar credenciais reais no repo
- Não ativar billing/growth

---

## Mensagem pronta para o 4º agente

```
Você é o agente-4 do Admin-Restaurant.
1. Leia COORDENACAO.md e docs/AGENT_BRIEFS.md (seção S4)
2. Leia docs/GOLDEN_RULES.md
3. Anuncie-se no COORDENACAO.md: domínio S4 demo-e2e-pagamentos, status iniciando
4. Branch feature/s4-demo-e2e a partir da main
5. Entregue docs/DEMO.md + qualquer fix mínimo de onboarding/payments
6. PR para main com handoff claro
Não pegue S1/S2/S3. Isolamento multi-tenant é sagrado.
```
