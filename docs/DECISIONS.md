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

## 2026-09-20 — Caixa físico: gaveta, ledger append-only e pagamento combinado (#107–#110)

**Contexto:** o restaurante recebia dinheiro sem registro de gaveta: não havia
como saber quanto deveria estar no caixa no fim do turno, suprimentos/sangrias
sumiam, estorno de pagamento em dinheiro não devolvia o valor ao caixa e não era
possível pagar um pedido com duas formas (parte em dinheiro, parte no PIX). O
pagamento também tinha corrida: o "valor devido" era lido fora da transação, o
que permitia cobrar o mesmo pedido duas vezes em requisições simultâneas.

**Decisões:**

- **Uma gaveta aberta por operador/loja**, garantida por índice único parcial
  (`cash_sessions WHERE status = 'open'`), não por checagem em código. Abrir a
  segunda devolve `409 CASH_SESSION_ALREADY_OPEN` **com a sessão existente** —
  o caixa recupera o contexto em vez de ficar travado.
- **`cash_movements` é append-only no banco** (trigger rejeita UPDATE/DELETE).
  Histórico de dinheiro editável não é histórico: correção se faz com movimento
  de `ADJUSTMENT` (com `direction` e motivo obrigatório), nunca reescrevendo o
  passado.
- **Todo efeito de caixa acontece na transação do pagamento.** A gaveta é
  travada com `SELECT ... FOR UPDATE` e o pagamento é criado/confirmado dentro da
  mesma transação — venda em dinheiro e lançamento no ledger não podem divergir,
  nem sob concorrência.
- **Pagamento combinado é um grupo atômico** (`split_group`): vários métodos no
  mesmo alvo, uma `Idempotency-Key`, tudo ou nada. A soma é validada contra o
  devido **depois** de travar o alvo (`lockPaymentTarget`), então
  `409 AMOUNT_EXCEEDS_DUE` substitui o sobrepagamento por corrida.
- **Troco é derivado no servidor** (`recebido − valor`). Aceitar troco do cliente
  permitiria fechar gaveta com número inventado.
- **Estorno é idempotente por `(payment_id, type)`** e nunca apaga o pagamento:
  vira `REFUNDED` + movimento `REFUND` de saída. Retry devolve
  `alreadyRefunded: true` sem duplicar dinheiro.
- **Dinheiro sem gaveta aberta não bloqueia a venda**, mas volta como
  `cashMovement: null` + warning `CASH_WITHOUT_SESSION`. Estabelecimento que
  exige gaveta ligada usa `CASH_REQUIRE_OPEN_SESSION=1` (vira `409`).
- **Fechamento exige contagem** (`CASH_COUNT_REQUIRED`) e é idempotente; o
  relatório devolve `reconciliation` derivada do ledger (opening, cashSales,
  supplies, adjustments, withdrawals, refunds, expected, counted, difference),
  então "esperado" nunca é um número guardado que pode dessincronizar.
- **STAFF não fecha gaveta** (`cashier.cash.close` é de OWNER/MANAGER) e só opera
  a própria gaveta; gerente opera qualquer gaveta da loja. Recurso de outra loja
  continua sendo **404**, nunca 403.
- **Permissões novas entram em três lugares coerentes**: catálogo
  (`FALLBACK_MATRIX`), migration de backfill e seed de loja nova — o seed passou
  a ser **derivado do catálogo** (antes duplicava a lista em SQL e permissão nova
  valia só para OWNER).
