# Cash — Caixa / Gaveta (Issues #107–#110)

Dinheiro físico do restaurante: sessão de caixa (abertura/fechamento), ledger
append-only de movimentações, pagamento parcial/combinado e relatório de
fechamento reconciliável.

## Princípios

- **Uma gaveta aberta por operador/loja** (índice único parcial). Abrir a segunda
  → `409 CASH_SESSION_ALREADY_OPEN` com a sessão existente no corpo.
- **Ledger é append-only**: `cash_movements` não aceita UPDATE/DELETE (trigger no
  banco). Correção se faz com movimento de compensação (AJUSTMENT), nunca editando
  o histórico — sem isso o fechamento não é auditável.
- **Dinheiro só entra na gaveta aberta**: todo efeito de caixa acontece *dentro*
  da transação do pagamento/estorno, com `SELECT ... FOR UPDATE` na sessão.
- **Troco é derivado no servidor** (`recebido − valor`). O cliente informa quanto
  recebeu; quem calcula o troco é a API.
- **Idempotência em tudo**: `Idempotency-Key` na abertura, em cada movimentação e
  no grupo de pagamento combinado; estorno é idempotente por `(payment_id, type)`.
- **Isolamento**: toda query leva `store_id`; recurso de outra loja → **404**
  (nunca 403). STAFF opera só a própria gaveta; OWNER/MANAGER operam qualquer
  gaveta da loja.

## Tabelas (migrations 0022/0023)

- `cash_sessions` — `open` → `closed`; `opening_amount`, `expected_amount`,
  `counted_amount`, `difference_amount`, `closed_by`, warnings em `metadata`.
- `cash_movements` — tipos `OPENING`, `SUPPLY`, `WITHDRAWAL`, `ADJUSTMENT`,
  `SALE`, `REFUND`; `direction` `IN|OUT`; vínculos opcionais com `payment_id`,
  `order_id`, `table_session_id`; único por `(store_id, idempotency_key)` e por
  `(payment_id, type)`.

`expected_amount` = Σ(IN) − Σ(OUT) da sessão — abertura + vendas em dinheiro −
estornos em dinheiro + suprimentos − sangrias ± ajustes.

## Rotas

| Method | Path | Permissão |
|--------|------|-----------|
| POST | `/api/cash/sessions` | `cashier.cash.open` |
| GET | `/api/cash/sessions?status=&operatorId=` | `cashier.cash.read` |
| GET | `/api/cash/sessions/active` | `cashier.cash.read` |
| GET | `/api/cash/checkout-summary?orderId=\|sessionId=` | `payments.read` |
| GET | `/api/cash/sessions/:id` | `cashier.cash.read` (+ gaveta própria p/ STAFF) |
| GET | `/api/cash/sessions/:id/movements` | `cashier.cash.read` (+ gaveta própria) |
| POST | `/api/cash/sessions/:id/movements` | `cashier.movements.write` (+ gaveta própria) |
| POST | `/api/cash/sessions/:id/payments` | `payments.confirm` (+ gaveta própria) |
| POST | `/api/cash/sessions/:id/refunds` | `payments.refund` (+ gaveta própria) |
| POST | `/api/cash/sessions/:id/close` | `cashier.cash.close` (OWNER/MANAGER) |
| GET | `/api/cash/sessions/:id/report` | `cashier.cash.read` (+ gaveta própria) |
| GET | `/api/cash/report?from=&to=` | `reports.read` |

Papéis padrão (migration 0023 + `FALLBACK_MATRIX`): OWNER/MANAGER têm as quatro
permissões de caixa; STAFF tem `cashier.cash.open`, `cashier.cash.read` e
`cashier.movements.write` — **não** fecha gaveta; KITCHEN não tem nada.

## Exemplos

Abertura com fundo de troco:

```http
POST /api/cash/sessions
Idempotency-Key: 3f9c1d0e-...

{ "openingAmount": 150.00, "notes": "Turno da noite" }
```

→ `201` `{ session: { id, status: "open", totals: { expected: 150, ... } }, openingMovement }`
Retry com a mesma chave → `200` `{ replayed: true }` (mesma sessão).

Pagamento combinado (uma transação, uma chave):

```http
POST /api/cash/sessions/:id/payments
Idempotency-Key: 8a2c...

{
  "orderId": "...",
  "items": [
    { "method": "CASH", "amount": 40.00, "tenderedAmount": 50.00 },
    { "method": "PIX",  "amount": 60.00 }
  ]
}
```

→ `201` com `payments[]` (CASH já `PAID`, troco 10.00, PIX `PENDING` com
`pixCopyPaste`), `splitGroup`, `totals.charged/due` e `session.totals.expected`.
Soma acima do devido → `409 AMOUNT_EXCEEDS_DUE`; retry da chave → `200 replayed`.

Movimentação manual:

```http
POST /api/cash/sessions/:id/movements

{ "type": "WITHDRAWAL", "amount": 30.00, "reason": "Sangria para depósito" }
```

Tipos manuais: `SUPPLY` (IN), `WITHDRAWAL` (OUT), `ADJUSTMENT` (exige
`direction`). `reason` é obrigatório (mín. 3 caracteres) e vai para a auditoria.

Estorno (dinheiro volta para a gaveta, uma vez só):

```http
POST /api/cash/sessions/:id/refunds

{ "paymentId": "...", "reason": "Cliente desistiu" }
```

→ `200` `{ payment: { status: "REFUNDED" }, cashMovement: { type: "REFUND",
direction: "OUT" } }`; segunda chamada → `alreadyRefunded: true`, `cashMovement:
null`, ledger inalterado.

Fechamento:

```http
POST /api/cash/sessions/:id/close

{ "countedAmount": 192.50, "notes": "Conferido com o gerente" }
```

→ `200` `{ session: { status: "closed", expectedAmount, countedAmount,
differenceAmount, reconciled, warnings } }`. Warnings possíveis:
`PENDING_PAYMENTS`, `CASH_SHORT`, `CASH_OVER`. Sem `countedAmount` →
`400 CASH_COUNT_REQUIRED`; gaveta já fechada → `200 alreadyClosed` (idempotente).

Relatório de fechamento: `GET /api/cash/sessions/:id/report` devolve sessão,
totais por tipo/direção, ledger completo e `reconciliation`
(opening, cashSales, supplies, adjustments, withdrawals, refunds, expected,
counted, difference, reconciled).

## Integração com pagamentos

`confirmPayment`/`refundPayment` (`payments.repository`) lançam o efeito de caixa
na mesma transação: pagamento `CASH` confirmado entra como `SALE`; estorno sai
como `REFUND`. A gaveta é a informada (`cashSessionId`) ou a sessão aberta do
operador; sem gaveta aberta nada é lançado e a resposta traz
`cashMovement: null` + warning `CASH_WITHOUT_SESSION` (venda não é bloqueada).
Com `CASH_REQUIRE_OPEN_SESSION=1` o dinheiro sem gaveta vira
`409 CASH_SESSION_REQUIRED`.

Erros de caixa são mapeados por `mapCashError` para 404/409/400 — inclusive nas
rotas de pagamento, para nunca virarem 500.

## Observabilidade

Cada efeito de caixa incrementa `cashMovementsTotal{store_id,type,direction}` e
`paymentsTotal{store_id,method,outcome}` (Prometheus em `/metrics`), além de
`audit_logs` (`cash.session_opened`, `cash.movement_recorded`,
`cash.session_closed`). Ver [`docs/OBSERVABILITY.md`](../../../docs/OBSERVABILITY.md).

## Testes

- `test/isolation/cash-session.test.js` — #107/#108: abertura, idempotência,
  duplicidade, RBAC, gaveta própria, composição do esperado, validações,
  fechamento/reconciliação, isolamento cross-tenant, ledger append-only, auditoria.
- `test/isolation/cash-payments.test.js` — #109/#110: pagamento combinado com
  troco, excedente do devido, pagamento parcial, estorno idempotente, confirmação
  genérica anexando à gaveta, corrida de duas cobranças, validações, isolamento e
  relatório de fechamento.
