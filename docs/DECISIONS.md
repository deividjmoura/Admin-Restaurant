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
