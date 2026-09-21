# Hardening de segurança e integridade

Resumo executável das correções críticas (webhooks, CORS, totais financeiros,
atomicidade, sessões, realtime e auditoria). Cada item tem teste de regressão em
`test/isolation/`.

---

## 1. Webhooks de pagamento

- **Assinatura obrigatória.** `POST /api/payments/webhooks/:provider` exige
  HMAC-SHA256 do **corpo bruto** (parser de JSON encapsulado em
  `payments-routes.js` grava `request.rawBody`), comparado em tempo constante com
  `x-signature` / `x-hub-signature-256` / `x-webhook-signature` (com `sha256=`
  opcional). Sem segredo configurado para o provider → **404**; assinatura
  inválida → **401**.
- **Nada do body é confiável.** `storeId`, `paymentId` e `markPaid` enviados pelo
  cliente são ignorados (`storeId` é usado apenas como diagnóstico de
  divergência). O pagamento é resolvido por `(provider, provider_payment_id)` e a
  loja vem da linha do pagamento.
- **Transação + `FOR UPDATE`.** O evento só é gravado depois da assinatura
  válida; duplicidade é detectada por `INSERT ... ON CONFLICT DO NOTHING` e
  responde `{ duplicate: true }` (sem reler no meio de transação abortada).
- **Valor conferido.** Divergência acima de `0.005` grava o evento como
  `amount_mismatch` e **nunca** marca o pagamento como `PAID`.
- Segredos: `WEBHOOK_SECRET_<PROVIDER_EM_MAIÚSCULAS>`; rate limit dedicado de
  300 req/min.

## 2. Pagamentos públicos (PIX)

- `orderId`/`sessionId` são validados **na loja do tenant** (404/409 quando não
  existem, são de outra loja ou a sessão está fechada); ao menos um é obrigatório.
- Valor com mais de duas casas decimais é rejeitado; valor acima do devido
  (`SUM((unit_price + addons_total) * quantity)` dos itens não cancelados menos
  pagamentos já pagos) → **409** `AMOUNT_EXCEEDS_DUE`.
- Resposta pública é mínima: `{ id, status, method, amount, pixCopyPaste }`.
  `metadata`, `provider`, `providerPaymentId` e `idempotencyKey` nunca saem.
- Em produção a chave PIX da plataforma não é fallback: loja sem
  `settings.pix.key` responde **503** `PIX_NOT_CONFIGURED`
  (`PIX_ALLOW_PLATFORM_KEY=true` libera conscientemente).

## 3. CORS, cookies, login e seed

- **Fail-closed:** sem `CORS_ORIGIN`/`FRONTEND_ORIGIN` (ou sem `COOKIE_SECRET`) a
  aplicação **não sobe** em produção. Origens explícitas, `credentials: true`,
  métodos e headers allowlistados (`Content-Type`, `X-Tenant-Slug`,
  `Idempotency-Key`, `X-Signature`).
- Cookie de sessão `HttpOnly` + `SameSite=Lax` por padrão; `SameSite=None` força
  `Secure` e cookie inseguro é impossível em produção.
- Login: 5 req/min por IP (rota) + limite por identidade (`IP + sha256(email)`),
  verificação de senha com hash dummy para usuário inexistente (tempo de resposta
  indistinguível) e auditoria de sucesso/falha sem e-mail em claro nem senha.
- `TRUST_PROXY` define os hops confiáveis (rate limit por IP real).
- Seed: em produção exige `STAFF_SEED_PASSWORD` (≥12 caracteres, não pode ser
  valor de exemplo) **antes** de tocar no banco; nunca imprime senhas.

## 4. Erros

- Erros de cliente são preservados: `22P02` → 400 `INVALID_ID`, `AppError` → seu
  status, 404/413/415/429 → códigos estáveis (`NOT_FOUND`,
  `UNSUPPORTED_CONTENT_TYPE`, `RATE_LIMITED`). Códigos internos do runtime
  (`FST_ERR_*`) nunca chegam ao cliente.
- Apenas 5xx viram `500 INTERNAL_ERROR`, com log no servidor e **sem stack** na
  resposta. O handler global é registrado **antes** das rotas (o Fastify resolve
  o handler no contexto em que a rota é registrada).

## 5. Totais financeiros

- `order_items.addons_total` (migration 0020) é persistido na criação do pedido;
  os adicionais são resolvidos **por linha do pedido** (não por produto), então
  duas linhas do mesmo produto com adicionais diferentes não se sobrescrevem.
- Todo total usa
  `SUM((oi.unit_price + oi.addons_total) * oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED')`
  com `JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id`, e
  exclui pedidos cancelados: comanda, dashboard, top produtos, série diária,
  relatórios e cotação de delivery.
- No saldo de pagamento (`amountDue`), `orderId` de canal DELIVERY soma também
  o `delivery_orders.delivery_fee` do snapshot: o cliente consegue pagar
  itens + frete exatos; o ramo `sessionId` (mesa) nunca recebe frete.
- Cancelar pedido cancela os itens ativos, mas **nunca** itens `DELIVERED`.

## 6. Atomicidade

- `createOrder(storeId, input, { tx, afterInsert })`: validação dentro da
  transação, insert idempotente (`ON CONFLICT ... DO NOTHING RETURNING`), replay
  só quando a sessão é a mesma e o `afterInsert` (ex.: `delivery_orders`) participa
  da mesma transação — falha derruba o pedido inteiro.
- `checkoutCart()` roda em uma única transação: `FOR UPDATE` na sessão →
  idempotência → estado/`cart_version` → pedido → limpa carrinho → incrementa
  versão → commit → só então publica evento.
- Entrega (delivery) grava pedido + endereço juntos; nunca existe pedido órfão.

## 7. Sessões de mesa / QR

- `openOrGetSession` usa índice único parcial
  (`uq_table_sessions_open_per_table`) + `ON CONFLICT DO NOTHING`, com releitura
  da sessão vencedora: scans simultâneos do mesmo QR nunca retornam 500.
- Sessão expirada **sem** consumo fecha sozinha; **com** consumo continua aberta e
  é marcada com `expired_at` para o caixa decidir.
- `GET /api/tables/by-token/:token` devolve a loja da própria mesa
  (`storeId`, `storeSlug`, `storeName`, `table`, `session`); header de tenant
  divergente responde 404 e nunca expõe dados de outra loja.

## 8. Máquina de estados

- Transições usam `UPDATE ... WHERE id AND store_id AND status = $esperado
  RETURNING`; sem linha → 409 (`STATUS_CONFLICT`). O status do pedido é
  **derivado** dos itens (`deriveOrderStatus`), sempre em transação com o pedido
  pai bloqueado.

## 9. Painéis e SSE

- `usePolling` nunca engole erro: 401 → logout + login, 403 → banner, 429 →
  banner + backoff, 5xx/rede → banner mantendo os últimos dados, e o polling
  pausa com `document.hidden`.
- O stream SSE preserva os headers já calculados (`reply.getHeaders()`) e envia
  `text/event-stream`, `no-cache, no-transform`, `keep-alive` e
  `X-Accel-Buffering: no`.
- Filtro de evento é sempre do servidor: tenant + estação + permissão
  (`payment.*` exige `payments.read`, `session.closed` exige
  `cashier.sessions.read`).

## 10. Auditoria

- Helper único best-effort (`auditRequest` / `auditSafe`): falha de auditoria
  **nunca** derruba a operação.
- Cobre login (sucesso/falha), pedidos (criação, cancelamento, status de pedido e
  de item), pagamentos (criação, confirmação, estorno, webhook), sessões de caixa,
  CRUD de cardápio/mesas/adicionais, permissões, settings da loja e delivery.
- Metadados passam por `sanitizeAuditMetadata`: senha, token, chave PIX, cartão,
  payload bruto de webhook, cookies e assinaturas viram `[redacted]`.
- Leitura apenas para o **OWNER** da loja, paginada e filtrável; a trilha é
  append-only (DELETE bloqueado por trigger no banco).

---

## Rodando os testes

```bash
npm ci
npm run db:migrate && npm run db:seed
npm run test:suite   # suíte completa + guarda de contagem
npm run test:guard
npm run web:build
```

Sem `DATABASE_URL` os testes de integração são marcados como *skipped* — o CI
exige a contagem mínima com o Postgres disponível.

Verificação dos riscos residuais (script automatizado + passos manuais):
**[VERIFY-RESIDUAL-RISKS.md](VERIFY-RESIDUAL-RISKS.md)**.


## 11. Contextos de entrada (2026-09-21)

Ver [ENTRY-CONTEXTS.md](./ENTRY-CONTEXTS.md) para os contratos atuais. O QR exige
host da loja ativa; apex/platform não resolvem loja pelo token. Staff JWT precisa
conter type=store e storeId igual ao host. Plataforma tem JWT próprio, flag e
host próprios; nenhum bypass is_super_admin permanece. Logout revoga jti no banco.
Leads não têm store_id. Provisionamento de OWNER e loja é transacional.

**Atualização customer (migration 0023):** IDs de pedido/pagamento/sessão não
concedem mais acesso ao fluxo mesa. JWT customer com audience própria, host e
sessão ativa são obrigatórios; staff continua com cookie e RBAC. Revalidação em
transação impede escrita/replay depois de fechamento. Tokens são revogados por
expiração, encerramento, troca do QR ou desativação da mesa. Detalhes e fronteira
com delivery em [CUSTOMER-SESSIONS.md](./CUSTOMER-SESSIONS.md).

## 12. Credencial de checkout de delivery (migration 0024)

Tracking e cancelamento de delivery exigem a credencial emitida na criação do
pedido (ou staff via RBAC); o ID do pedido sozinho não autoriza leitura
nenhuma — antes, `GET /api/delivery/orders/:id` expunha endereço e telefone de
qualquer pedido da loja a qualquer visitante do host. O JWT customer de
delivery tem `iss`/`aud` próprios e **nenhum** token de mesa/QR (ou do plano
inverso) verifica no outro contexto; mix de bearer com cookie staff é 403.

- Segredo do checkout (`delivery_orders.checkout_token`) nasce com o pedido,
  na mesma transação; o JWT só referencia o SHA-256 dele. Girar o segredo
  revoga na hora todas as credenciais emitidas (análogo à troca do QR).
- Revalidação viva (`assertDeliveryCheckout`) com `FOR UPDATE` no pedido antes
  de escrita/replay: checkout terminal (cancelado/entregue) ou TTL vencido
  derruba 409/401 mesmo com JWT ainda não expirado.
- Replay com a `Idempotency-Key` original devolve o MESMO pedido e reemite
  credencial — e nunca vaza pedido de outro contexto (chave de checkout no
  endpoint de mesa e vice-versa = 409, sessão nula incluída).
- `delivery.checkout.revoke`: OWNER/MANAGER por default; STAFF não recebe.
  Criação pública continua, porém rate-limited por IP (60/min) e sem aceitar
  bearer como atalho.

Contrato, erros e deploy em [DELIVERY-CHECKOUT.md](./DELIVERY-CHECKOUT.md).
