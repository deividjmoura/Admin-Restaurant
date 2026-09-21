# Decisões de Arquitetura

## 2026-09-12 — Stack e abordagem de bootstrap

**Decisão:** Começar o repositório limpo com multi-tenancy desde o dia 1.
Usar o projeto `lanchonete-qr-semi-final` apenas como **referência de domínio e UX**, não como código base a ser adaptado.

**Motivo:** A especificação proíbe explicitamente criar single-tenant e depois adaptar. Isolamento mal feito é o maior risco do projeto.

**Reaproveitamento permitido:**
- Padrões de UI/UX e fluxos operacionais
- Regras de negócio já validadas (status, sessões, setores, etc.)
- Ideias de SSE, rate-limit, seed

**Não reaproveitar:**
- Schema sem `store_id`
- Queries sem scoping de tenant
- Features legadas não utilizadas (ex.: ponto da carne)

## 2026-09-12 — Fastify em vez de HTTP nativo

**Decisão:** Usar Fastify.

**Motivo:** Schema validation, plugins maduros (cookie, helmet, rate-limit, cors), melhor base para crescer sem reescrever o servidor depois. Ainda mantém a simplicidade próxima do projeto de referência.

## 2026-09-12 — Documentação separada em GOLDEN_RULES

**Decisão:** Extrair o checklist e regras de ouro para `docs/GOLDEN_RULES.md`.

**Motivo:** Facilitar consulta rápida no dia a dia e nos PRs, sem misturar com a descrição de arquitetura.

## 2026-09-20 — Hardening de segurança e integridade (webhooks, CORS, totais, atomicidade)

**Contexto:** auditoria apontou 7 falhas críticas e 6 altas (webhooks sem
assinatura, CORS permissivo em produção, credenciais default, totais sem
adicionais, checkout/delivery não atômicos, corrida no QR, transições de status
sem guarda, erros 4xx como 500 e auditoria incompleta).

**Decisões:**

- **Webhook** exige HMAC-SHA256 do corpo bruto (`WEBHOOK_SECRET_<PROVIDER>`);
  sem segredo → 404, assinatura inválida → 401. `storeId`/`paymentId`/`markPaid`
  do body são ignorados; o pagamento é resolvido por
  `(provider, provider_payment_id)` e a loja vem da linha do pagamento.
  Divergência de valor (> 0.005) grava `amount_mismatch` e nunca marca `PAID`.
- **CORS fail-closed:** sem `CORS_ORIGIN`/`FRONTEND_ORIGIN` (ou `COOKIE_SECRET`)
  a API não sobe em produção; cookie padrão `SameSite=Lax` (seguro para SPA na
  mesma origem) e `Secure` obrigatório quando cross-site.
- **Login** com rate limit por IP e por identidade, hash dummy para usuário
  inexistente (resposta indistinguível) e auditoria sem senha/e-mail em claro.
- **Totais** passam a usar `order_items.addons_total` (migration 0020) e
  `SUM((unit_price + addons_total) * quantity) FILTER (WHERE status <> 'CANCELLED')`,
  excluindo pedidos cancelados; adicionais são resolvidos **por linha** do
  pedido, não por produto.
- **Checkout** e **delivery** acontecem em uma única transação; `createOrder`
  aceita `{ tx, afterInsert }` e a idempotência é checada **antes** das validações
  de estado/versão (retry após limpar carrinho devolve o mesmo pedido).
- **Sessões de mesa** usam índice único parcial + `ON CONFLICT DO NOTHING`
  (migration 0021); sessão expirada com consumo aberto **não** é fechada
  automaticamente.
- **Transições de status** usam `UPDATE ... WHERE status = $esperado RETURNING`
  dentro de transação; sem linha → 409. O status do pedido é derivado dos itens.
- **Erros:** handler global registrado **antes** das rotas; 4xx preservados com
  códigos estáveis, 5xx genérico sem stack.
- **Auditoria** centralizada em `auditRequest`/`auditSafe` (best effort),
  cobrindo login, pedidos, pagamentos, mesas, cardápio, permissões, settings e
  delivery, com metadados sanitizados e leitura restrita ao OWNER.


## 2026-09-21 — Contextos por host e dois planos de autenticação

**Decisão:** marketing (apex/www), plataforma (app/platform) e loja (subdomínio ou
custom domain) são entradas distintas. Customer continua sendo capacidade de
mesa/sessão, nunca usuário staff. O frontend não escolhe tenant.

- Hosts reservados encerram resolução sem loja, antes de header/query.
- JWTs de staff têm `type=store`, `storeId` e role. Platform tem `type=platform`,
  `PLATFORM_OWNER`, sem storeId. Nenhum fallback para JWTs antigos sem contexto.
- `is_platform_owner` substitui o bypass `is_super_admin`: backfill da flag,
  **sem** criar memberships. Usuário pode pertencer a N lojas, mas token vale
  para uma só; autorização revalida vínculo/papel ativo por request.
- Mesmo cookie `ar_session`, separado pelo host (sem Domain), com claims claros.
  Registro `auth_sessions` permite logout com revogação de jti em todas as
  instâncias, em vez de apenas apagar cookie. Usar caminhos separados de login.
- Leads pertencem à plataforma, sem store_id ou vínculo ao CRM de clientes.
- Provisionamento inicial por criação de OWNER (ou vínculo de usuário existente),
  em transação com loja e RBAC. Não sobrescrever senha de conta existente.
  Convite SMTP fica para próxima entrega. Senhas nunca retornam em respostas/logs.
- DELETE de tenant é suspensão lógica, preservando registros financeiros/auditoria.
- CORS contextual com allowlist e verificação de Origin nas mutações para CSRF.
  Host original deve ser preservado pelo proxy; X-Forwarded-Host não é autoridade.
- Frontend é um build com árvores distintas por hostname; `/dev` DEV-only.
  `/platform/*` no host de loja/apex não cria contexto platform.
- QR/carrinho passam a exigir host da loja ativa; capacidades de outra loja são
  ocultadas com 404. Estado do browser é separado por QR. Os contratos públicos
  legados de pedidos/pagamentos não foram redesenhados nesta entrega; sua
  vinculação completa a sessão customer é limite explícito, não acesso staff.

**Impacto incompatível:** `/api/auth/login` removido, JWTs anteriores invalidados,
QR sem host de loja deixa de funcionar, seleção de tenant no login/localStorage
removida. Migrar consumidores e proxy junto com API/frontend.

**Validação:** suíte PostgreSQL com 175 testes (zero fail/skip); CI exige contagem
mínima atualizada e inclui hosts apex, platform, store, custom domain, fallbacks,
JWT cross-context, memberships, logout revogado, leads e transação do OWNER.

**Operação/rollback:** ver [`ENTRY-CONTEXTS.md`](./ENTRY-CONTEXTS.md).


## 2026-09-21 — Customer QR com credencial assinada e escopo de sessão

**Contexto:** conhecer IDs opacos permitia ler/cancelar pedidos e criar/ler
pagamentos de outra mesa da mesma loja. Idempotência de pagamentos retornava o
registro anterior sem comparar seu alvo. Customer não pode herdar auth staff.

**Decisões:**
- QR é a credencial de entrada; emite JWT customer de até 1h com audience/issuer
  próprios, storeId/tableId/sessionId e hash do QR atual. SessionId deixa de ser
  segredo/autorização. O token nunca serve como cookie staff ou token platform.
- Authorization Bearer seleciona exclusivamente o plano customer; não há fallback
  para cookie se inválido. Credenciais mistas são recusadas. Browser usa omit.
- Leitura/criação/cancelamento de pedidos, criação/leitura de pagamentos e todas
  as rotas de carrinho exigem customer ou permissão staff específica. Nova
  permissão `orders.create`, OWNER/MANAGER/STAFF (migration 0023).
- Toda referência (inclusive AMBOS os alvos de pagamento) deve pertencer à sessão
  autenticada. Recurso de outra sessão é 404, mesmo na mesma loja.
- Escritas validam estado/expiração/hash do QR sob lock da sessão e da mesa na
  transação que grava/reproduz. Fechamento e rotação não atravessam esse lock.
- Replay de pagamento compara orderId, sessionId, method e amount; conflito → 409
  sem pagamento. Comparação de sessão de pedidos também compara null (delivery),
  fechando replay de pedido de mesa através do endpoint delivery.
- Validade termina com sessão encerrada/expirada, QR regenerado ou mesa inativa.
  O caixa continua autorizado a operar sessão expirada com consumo aberto.
- Respostas sensíveis no-store; URL QR redigida nos logs; referrer-policy
  no-referrer; tokens só em cabeçalho, nunca query. Frontend isola credencial por
  QR/aba e não faz retry automático de mutação depois de perda de autorização.

**Compatibilidade:** consumidores que só enviavam IDs recebem 401. Precisam
realizar a troca QR e enviar o bearer, ou autenticar staff com RBAC. Deploy de API
+ SPA coordenado; não manter instância antiga com endpoints anônimos.

**Limite:** o domínio de checkout/tracking delivery não é uma sessão de mesa.
O contrato dedicado permanece separado e não autoriza acesso a recursos TABLE;
esta decisão não implementa identidade/autorização customer de delivery.

**Validação:** testes de isolamento de mesas/lojas, revogação, replay/concorrência,
RBAC, credenciais mistas, logs e transporte/renovação frontend. Ver
[CUSTOMER-SESSIONS.md](./CUSTOMER-SESSIONS.md).


## 2026-09-21 — Credencial própria por checkout de delivery

**Contexto:** a entrega mesa/QR deixou o delivery como fronteira explícita:
`POST /api/delivery/orders` criava pedidos sem credencial e o tracking por ID
era público no host — qualquer pessoa na loja lia endereço, telefone e status
de qualquer pedido delivery, e o saldo de pagamento ignorava o frete (o
cliente não conseguia pagar o total). Evoluir a autenticação de delivery
exigia identidade por checkout, não uma sessão de mesa improvisada.

**Decisões:**
- Cada `delivery_orders` nasce com um **segredo** (`checkout_token`,
  randomBytes, gerado na mesma transação do pedido). A criação emite JWT
  customer `iss=restaurant:delivery`/`aud=restaurant:delivery-customer` com
  `orderId` e `checkoutHash` (SHA-256 do segredo) — o JWT nunca carrega o
  segredo cru e o segredo nunca sai na API. Mesa (`restaurant:qr`) e checkout
  são planos distintos: nenhum verifica no outro, e `assertTablePlane`/
  `assertDeliveryPlane` recusam o plano errado em cada rota (403).
- Tracking, cancelamento e pagamentos do checkout exigem a credencial do
  próprio checkout ou staff via RBAC (`orders.read`/`orders.status.write`).
  Alvo divergente é 404 — inclusive entre lojas (403 só quando o host destoa
  da loja do token). Bearer+cookie mistos continuam recusados.
- **Validade/revogação espelham a mesa:** credencial vale até
  `created_at + DELIVERY_CHECKOUT_TTL_HOURS` (24h) e morre com status terminal
  (`CANCELLED`/`DELIVERED` → 409 `DELIVERY_CHECKOUT_CLOSED`). Revogar = girar
  o segredo (`POST .../credential/revoke`, permissão nova
  `delivery.checkout.revoke`, OWNER/MANAGER na migration 0024); toda cópia
  antiga cai na hora.
- **Replay seguro:** mesma `Idempotency-Key` na mesma loja devolve o mesmo
  pedido e reemite a credencial válida (é o caminho de recuperação do
  cliente); chave de checkout nunca replaya pelo endpoint de mesa nem o
  contrário; pagamento mantém igualdade estrita de alvo. Escritas revalidam
  credencial+estado com `FOR UPDATE` no pedido dentro da transação.
- **Frete no saldo:** `amountDue` soma `delivery_orders.delivery_fee` quando o
  alvo é o pedido do checkout (pedido cancelado fora; comanda de mesa
  inalterada). Pagamento máximo = itens + frete; PENDING segue sem descontar.
- Backend apenas: nenhuma tela nova de delivery nesta entrega; a SPA pública
  existente não consome tracking anônimo (só admin usa zonas, via staff).

**Compatibilidade:** `GET /api/delivery/orders/:orderId` deixa de ser público
(sem credencial → 401). Consumidores anônimos legados migram para o fluxo com
credencial ou para staff. Pedidos anteriores à 0024 não têm segredo: sem
credencial própria até o cliente refazer o pedido (documentado no deploy).
O teste de fronteira em `customer-session.test.js` passa a esperar 401
anônimo — a autenticação precede qualquer enumeração de canal.

**Validação:** suíte PostgreSQL com **223 testes** (zero fail/skip),
`test/isolation/delivery-checkout.test.js` com 19 casos de autorização,
isolamento, replay, revogação, TTL vivo, atomicidade e saldo com frete;
migration/rollback 0024 aplicados em banco limpo; build do frontend sem
alterações. Ver [DELIVERY-CHECKOUT.md](./DELIVERY-CHECKOUT.md).

## 2026-09-20 — Observabilidade: logs estruturados, métricas e health/ready (#106)

**Contexto:** sem logs estruturados não dá para saber qual loja falhou; sem métricas não há alerta; sem health/ready o orquestrador não sabe quando tirar a instância de rotação. Cozinha SSE caía em silêncio.

**Decisões:**
- Logger JSON único (pino) com `requestId`, `storeId`, `userId`, `operation`, `durationMs`; redação de segredos/PII por `src/shared/redact.js` (mesma regra da auditoria).
- `/health` (liveness rasa) e `/ready` (checks registráveis: database, migrations, pool) → 503 quando crítico falha; `ready/checks` lista checks.
- `/metrics` Prometheus: `http_requests_total`, `http_request_duration_seconds`, `orders_created_total`, `payments_total`, `cash_movements_total`, `realtime_subscribers`, fila de jobs. Cardinalidade limitada por rota (pattern) e por loja (teto + __other__). Acesso restrito a `METRICS_TOKEN` ou super admin (404 caso contrário).
- Contexto de requisição (`request-context.js`) com `x-request-id` validado (anti log injection) e access log único por requisição.
- Instrumentação: HTTP, erros por código estável, queries SQL e pool, SSE (assinantes/eventos), pedidos criados, transições e pagamentos.
- `server.js`: shutdown gracioso (SIGTERM drena SSE) + handlers de processo.
- Docs: `docs/OBSERVABILITY.md`; testes em `test/isolation/observability.test.js`.

**Validação:** suíte 171 testes na entrega original, depois 199 com caixa; `LOG_LEVEL`, `METRICS_TOKEN`, `SHUTDOWN_TIMEOUT_MS` opcionais.

## 2026-09-20 — Caixa físico: gaveta, ledger append-only e pagamento combinado (#107–#110)

**Contexto:** o restaurante recebia dinheiro sem registro de gaveta: não havia como saber quanto deveria estar no caixa no fim do turno, suprimentos/sangrias sumiam, estorno de pagamento em dinheiro não devolvia o valor ao caixa e não era possível pagar um pedido com duas formas (parte em dinheiro, parte no PIX). O pagamento também tinha corrida: o "valor devido" era lido fora da transação, o que permitia cobrar o mesmo pedido duas vezes em requisições simultâneas.

**Decisões:**
- **Uma gaveta aberta por operador/loja**, garantida por índice único parcial (`cash_sessions WHERE status = 'open'`), não por checagem em código. Abrir a segunda devolve `409 CASH_SESSION_ALREADY_OPEN` com a sessão existente.
- **`cash_movements` é append-only no banco** (trigger rejeita UPDATE/DELETE). Correção se faz com movimento de `ADJUSTMENT` (com `direction` e motivo obrigatório), nunca reescrevendo o passado.
- **Todo efeito de caixa acontece na transação do pagamento.** A gaveta é travada com `SELECT ... FOR UPDATE` e o pagamento é criado/confirmado dentro da mesma transação.
- **Pagamento combinado é um grupo atômico** (`split_group`): vários métodos no mesmo alvo, uma `Idempotency-Key`, tudo ou nada. A soma é validada contra o devido **depois** de travar o alvo (`lockPaymentTarget`), então `409 AMOUNT_EXCEEDS_DUE` substitui o sobrepagamento por corrida.
- **Troco é derivado no servidor** (`recebido − valor`). Aceitar troco do cliente permitiria fechar gaveta com número inventado.
- **Estorno é idempotente por `(payment_id, type)`** e nunca apaga o pagamento: vira `REFUNDED` + movimento `REFUND` de saída. Retry devolve `alreadyRefunded: true` sem duplicar dinheiro.
- **Dinheiro sem gaveta aberta não bloqueia a venda**, mas volta como `cashMovement: null` + warning `CASH_WITHOUT_SESSION`. Estabelecimento que exige gaveta ligada usa `CASH_REQUIRE_OPEN_SESSION=1` (vira `409`).
- **Fechamento exige contagem** (`CASH_COUNT_REQUIRED`) e é idempotente; o relatório devolve `reconciliation` derivada do ledger (opening, cashSales, supplies, adjustments, withdrawals, refunds, expected, counted, difference).
- **STAFF não fecha gaveta** (`cashier.cash.close` é de OWNER/MANAGER) e só opera a própria gaveta; gerente opera qualquer gaveta da loja. Recurso de outra loja continua sendo **404**, nunca 403.
- **Permissões novas entram em três lugares coerentes**: catálogo (`FALLBACK_MATRIX`), migration de backfill e seed de loja nova — o seed passou a ser **derivado do catálogo** (antes duplicava a lista em SQL e permissão nova valia só para OWNER).
- **Migrations 0025/0026** (renumeradas de 0022/0023 da PR #152 porque 0022-0024 já ocupadas por entry-contexts e delivery checkout). Rollbacks em `migrations/rollback/`.

**Validação:** `test/isolation/cash-session.test.js` (17) e `cash-payments.test.js` (11) — idempotência, RBAC, isolamento cross-tenant, corrida de cobrança dupla, ledger imutável, reconciliação. Suíte após rebase: 223 + 58 = 281+.

## 2026-09-21 — Rebase PR #152 sobre main + Redis + Cozinha realtime estável

**Contexto:** PR #152 (observabilidade + caixa) foi criada antes dos contextos por host e delivery checkout. Ao mesmo tempo, precisávamos fechar fases críticas: cozinha realtime estável, dashboard mais robusto, pagamentos com frete e caixa, e camada Redis para cache e pub/sub multi-instância.

**Decisões:**
- Rebase: renumerar `0022_cash_sessions` → `0025_cash_sessions` e `0023_cash_permissions` → `0026_cash_permissions`, mantendo DOWN em comentários + rollback separado. Resolver conflitos em `payments.repository` (frete no `amountDue` + split payments + customer checks), `catalog.js` (delivery.checkout.revoke + cashier.cash.*), `app.js` (entry-contexts + observabilidade), `db.js` (métricas), `tenant-plugin` (bindRequestLog + SKIP /metrics).
- **Redis opcional:** `src/infrastructure/redis.js` com `REDIS_URL` — quando ausente, fallback in-memory. Usado para: cache de cardápio (`menu-cache.js` com L1 local + L2 Redis), pub/sub realtime (`store-events.js` publica no Redis e assina para multi-instância), futuro rate-limit distribuído. `REDIS_ENABLED=0` desliga mesmo com URL. Sem dependência dura: tenta `redis` ou `ioredis` via import dinâmico, senão memory.
- **Cozinha realtime estável:** `store-events.js` agora tem `publishStoreOrderEvent` que publica no Redis quando disponível e despacha localmente; `subscribeStoreOrders` garante assinatura Redis por loja + métricas `realtime_subscribers` por estação; `kitchen-routes.js` marca `request.isStream = true` para não poluir histograma HTTP, heartbeat 25s, cleanup idempotente e log de `sse.stream_error`.
- **Dashboard:** `reports-routes.js` já tinha summary, top-products, live. Mantido; frontend será polido em outra frente para mostrar série diária, prep time e live ops com estados de loading/error/vazio.
- **Pagamentos robustos:** merge de frete (`delivery_fee` no `amountDue`) + split payments atômico + cash ledger na mesma transação + troco derivado server-side + idempotência por `(store_id, idempotency_key)` e por `(payment_id, type)`.
- **Suíte:** após rebase, `MIN_TESTS` sobe de 223 para 281+ (223 + 28 cash + 30 observability). `npm run test:suite` deve continuar `fail 0, skipped 0`.

**Operação:** `npm ci && npm run db:migrate && npm run db:seed && npm run test:suite`. Opcional: `REDIS_URL=redis://localhost:6379 npm run dev`. Rollback de 0025/0026 remove tabelas de caixa e colunas de pagamento, sem tocar delivery checkout.

**Docs:** `docs/OBSERVABILITY.md`, `src/modules/cash/README.md`, `src/modules/payments/README.md`, `docs/ROADMAP.md` (a criar na frente B).

