# Credencial de checkout de delivery — contrato customer

Implementado em 2026-09-21, espelho da autorização de mesa/QR. **Mudança
incompatível** para consumidores que liam tracking por ID anônimo. Migration:
`0024_delivery_checkout_access.sql`. Entrega de backend: nenhuma tela nova.

## Entrada e identidade

1. Cliente monta carrinho no menu público da loja e envia
   `POST /api/delivery/orders` (payload validado: zona da loja, endereço,
   itens). A criação continua pública no host da loja, com rate limit por IP
   (60/min) — credencial **nasce da criação**, não de um ID descoberto.
2. A resposta inclui a credencial do checkout:

```json
{
  "order": { "id": "UUID", "status": "PENDING", "channel": "DELIVERY" },
  "customerSession": {
    "token": "JWT_ASSINADO",
    "expiresAt": "2026-09-22T15:00:00.000Z"
  }
}
```

3. Em tracking, cancelamento e pagamentos: `Authorization: Bearer <token>`,
   no host da loja, sem cookie staff. O ID do pedido sozinho não autoriza
   nada; body/path são alvos, não provas de acesso.

Claims: `type=customer`, `kind=delivery`, `iss=restaurant:delivery`,
`aud=restaurant:delivery-customer`, `storeId`, `orderId`, `checkoutHash`
(SHA-256 do segredo em `delivery_orders.checkout_token`), `iat`, `exp`. Sem
`sub`, sem role. O segredo cru nunca sai da API e nunca entra em log. O plano
mesa/QR usa `iss=restaurant:qr`/`aud=restaurant:table-customer` — assinados
com o mesmo segredo da API, **nenhum JWT atravessa de plano**: verificação
exige algoritmo + issuer + audience + claims próprios. `requireCustomerOrPermission`
tenta um contexto por vez e marca `request.customer.kind`.

## Superfície autorizada

| Endpoint | Customer (checkout) | Staff |
|---|---|---|
| `POST /api/delivery/orders` | Público (sem bearer) | idem |
| `GET /api/delivery/orders/:orderId` | Somente o próprio checkout | `orders.read` |
| `POST /api/delivery/orders/:orderId/cancel` | Próprio, janela/status | `orders.status.write` |
| `POST /api/delivery/orders/:orderId/credential/revoke` | 403 | `delivery.checkout.revoke` (OWNER/MANAGER) |
| `POST /api/payments` | Só `orderId` do próprio checkout | `payments.create` |
| `GET /api/payments/:id` | Só pagamento do próprio checkout | `payments.read` |

Customer cria pagamento **PENDING** e lê o shape público; nunca confirma,
estorna ou acessa rota staff (bearer em rota staff é recusado com 403).
Zonas/quote continuam públicos no host da loja (insumo pré-checkout).

## Isolamento entre contextos

- **Loja↔loja:** token emitido na loja A vale 403 no host B (checado antes de
  tocar pedido); ID de pedido da loja B sob token válido da loja A vale 404
  (ocultação, sem confirmação de existência).
- **Checkout↔checkout:** alvo diferente do `orderId` do token (tracking,
  cancelamento, pagamento) é 404, inclusive na mesma loja.
- **Mesa/QR↔delivery:** credencial de mesa em rota de checkout → 403
  `CONTEXT_FORBIDDEN` (gate `assertDeliveryPlane`), e credencial de checkout
  em mesa/carrinho/`/api/orders` → 403 (`assertTablePlane` + dispatcher em
  `assertSessionScope`). O dispatcher vive em `customer-session.js`: os
  asserts de sessão/pedido/pagamento roteiam por `kind`, então nenhuma rota
  compartilhada (ex.: `POST /api/payments`) autoriza um plano com o escopo do outro.
- **Staff/customer:** bearer explícito seleciona o plano customer; bearer +
  cookie simultâneos são recusados. Sem bearer, vale o cookie + RBAC
  (`requirePermission`) — inclusive nas rotas novas.
- **Plataforma:** `requirePlatform`/`requireStoreAccess` recusam qualquer
  `Authorization` customer; hosts apex/platform não resolvem tenant.

## Validade, replay e revogação

- Credencial vale até `orders.created_at + DELIVERY_CHECKOUT_TTL_HOURS`
  (padrão 24h) e nunca além do `exp` assinado. Expiração → 401
  `CUSTOMER_SESSION_EXPIRED`.
- Status terminal (`CANCELLED`, `DELIVERED`) fecha o checkout: toda operação
  customer vale 409 `DELIVERY_CHECKOUT_CLOSED`. O caixa/staff segue operando.
- **Revogação ativa:** girar o segredo
  (`POST .../credential/revoke`, auditado como `delivery.checkout_revoked`)
  derruba imediatamente toda credencial emitida (o `checkoutHash` do JWT para
  de bater) — 401. É o análogo da regeneração do QR na mesa.
- **Replay seguro:** mesma `Idempotency-Key` + mesma loja devolve o MESMO
  pedido (`replayed:true`) e reemite credencial válida — inclusive para
  recuperar acesso após revogação/expiração de cópias antigas. Chave nascida
  em checkout nunca replaysa pelo endpoint de mesa (sessão nula ≠ sessão
  aberta → 409 `IDEMPOTENCY_KEY_REUSED`), e vice-versa. Pagamento exige
  igualdade de `orderId`+método+centavos.
- Pedidos anteriores à migration (segredo `NULL`) não ganham credencial:
  gestão apenas por staff; o replay do recibo devolve `customerSession: null`.

## Validação transacional

Escritas (cancelamento, pagamento) revalidam dentro da própria transação, com
`FOR UPDATE` no pedido: `assertDeliveryCheckout` confere segredo atual, canal
`DELIVERY`, status e TTL **antes** de gravar ou devolver replay. Cancelamento
concorrente, rotação de credencial e pagamento não atravessam esse lock —
o mesmo padrão `assertCustomerSession` da mesa.

## Frete no saldo

`amountDue` soma `delivery_orders.delivery_fee` (snapshot gravado com o
pedido) quando o alvo é `orderId` de checkout; pedido cancelado não conta; o
ramo `sessionId` (comanda de mesa) permanece só itens — frete não vaza para
mesa. Com isso o cliente consegue pagar `itens + frete` exatos: antes o teto
do pagamento cortava a taxa (`AMOUNT_EXCEEDS_DUE`). PENDING continua sem
descontar (anti-DoS financeiro), igual à mesa.

### Erros

| Situação | Status |
|---|---|
| Sem bearer, JWT inválido/expirado, segredo girado, pedido legado sem credencial | 401 |
| Checkout terminal (cancelado/entregue) em qualquer operação customer | 409 `DELIVERY_CHECKOUT_CLOSED` |
| TTL do checkout vencido (revalidação viva) | 401 `CUSTOMER_SESSION_EXPIRED` |
| Token de outra loja no host, credenciais mistas, plano trocado, customer em rota staff | 403 |
| Pedido/checkout/pagamento de outro cliente ou loja sob token local válido | 404 |
| Idempotency-Key reutilizada em outro alvo/payload | 409, sem dados |
| Cancelamento fora da janela/status | 409 `CANCEL_WINDOW_EXPIRED` / `CANCEL_NOT_ALLOWED` |
| Valor acima de itens + frete | 409 `AMOUNT_EXCEEDS_DUE` |

## Deploy e rollback

1. `npm run db:migrate` (inclui 0024) primeiro em homologação. A migration só
   adiciona coluna + permissão; nada é destrutivo.
2. Subir API e SPA juntas; retirar instâncias antigas que expunham tracking
   anônimo por ID. O tracking passa a exigir credencial (ou staff):
   links de acompanhamento baseados só em UUID deixam de funcionar — quem
   precisa recuperar acesso usa a `Idempotency-Key` do próprio checkout
   (replay) ou fala com a loja.
3. Consumidores legados de `/api/delivery/orders/:id` sem credencial migram
   para staff/`orders.read` ou para o fluxo com credencial.
4. Validar com a suíte: `npm run test:suite` (guarda mínima **223**; zero
   falhas/ignorados) e `npm run web:build`.

```sh
export DATABASE_URL=postgres://... # banco descartável
npm run test:suite
npm run web:build
```

`test/isolation/delivery-checkout.test.js`: 19 casos — emissão por checkout,
planos criptograficamente separados, ocultação 404 entre checkouts/lojas,
matriz mesa↔delivery↔staff, mix de credenciais, RBAC nas rotas novas, replay
com reemissão, revogação com recuperação, TTL vivo, atomicidade (sem pedido
órfão; segredo nunca exposto), frete no saldo com pagamento parcial e trilha
de auditoria sem vazamento do segredo.

Rollback: `migrations/rollback/0024_delivery_checkout_access.sql` em
transação, junto da versão de código correspondente. Retirar a proteção
reabre o tracking anônimo; não usar rollback de auth como mitigação de
incidente.
