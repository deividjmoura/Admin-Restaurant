/**
 * Issues #109 (pagamento parcial/combinado + estorno) e #110 (relatório e
 * fechamento de caixa), integradas a #107/#108.
 *
 * Regras que este arquivo trava:
 *  1. vários métodos no mesmo alvo, numa transação só, com UMA Idempotency-Key;
 *  2. a soma não passa do total devido (pagamento parcial sim, sobrepagamento não);
 *  3. dinheiro confirmado entra no ledger da gaveta; estorno sai — uma vez só;
 *  4. troco é derivado no servidor (recebido − valor), nunca informado;
 *  5. concorrência: duas cobranças simultâneas não pagam o mesmo pedido duas vezes;
 *  6. relatório de fechamento reconciliável e relatório consolidado por loja;
 *  7. isolamento: pedido/sessão de outra loja → 404.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('Caixa — pagamento combinado, estorno e relatórios (issues #109/#110)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;
  let ownerA = null;
  let ownerB = null;
  let product60 = null;
  let product40 = null;
  let cashSessionId = null;

  const hdr = (cookie, extra = {}) => ({
    cookie,
    'content-type': 'application/json',
    'x-tenant-slug': storeA.slug,
    ...extra,
  });

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { makeStore, makeUserWithRole } = await import('../helpers/fixtures.js');
    const { createCategory, createProduct } = await import(
      '../../src/modules/menu/menu.repository.js'
    );
    const { createTable, openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );

    storeA = await makeStore({
      name: 'Caixa Pagamentos A',
      settings: { pix: { key: 'caixa-a@test.local', name: 'CAIXA A', city: 'CURITIBA' } },
    });
    storeB = await makeStore({ name: 'Caixa Pagamentos B' });
    ownerA = await makeUserWithRole(storeA.id, { role: 'OWNER' });
    ownerB = await makeUserWithRole(storeB.id, { role: 'OWNER' });

    const category = await createCategory(storeA.id, { name: 'Combos', sortOrder: 1 });
    product60 = await createProduct(storeA.id, {
      categoryId: category.id,
      name: 'Combo 60',
      price: 60,
      sortOrder: 1,
      station: 'KITCHEN',
    });
    product40 = await createProduct(storeA.id, {
      categoryId: category.id,
      name: 'Porção 40',
      price: 40,
      sortOrder: 2,
      station: 'KITCHEN',
    });

    const table = await createTable(storeA.id, { number: 501 });
    await openOrGetSession(storeA.id, table.id);

    // Gaveta do dono com fundo de troco de R$ 100.
    const open = await app.inject({
      method: 'POST',
      url: '/api/cash/sessions',
      headers: hdr(ownerA.cookie),
      payload: { openingAmount: 100, notes: 'Gaveta dos testes de pagamento' },
    });
    assert.equal(open.statusCode, 201, open.body);
    cashSessionId = open.json().session.id;
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { dropStores } = await import('../helpers/fixtures.js');
    await dropStores(storeA.id, storeB.id);
  });

  /** Cria pedido de mesa com os dois produtos (R$ 100) em sessão nova. */
  async function makeOrder({ products = [{ p: product60, q: 1 }, { p: product40, q: 1 }] } = {}) {
    const { createTable, openOrGetSession } = await import(
      '../../src/modules/tables/tables.repository.js'
    );
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const table = await createTable(storeA.id, {
      number: Math.floor(Math.random() * 9000) + 1000,
    });
    const session = await openOrGetSession(storeA.id, table.id);
    const result = await createOrder(storeA.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items: products.map(({ p, q }) => ({ productId: p.id, quantity: q, addonIds: [] })),
    });
    return { order: result.order, tableSession: session };
  }

  async function summaryOf({ orderId = null, sessionId = null } = {}) {
    const qs = orderId ? `orderId=${orderId}` : `sessionId=${sessionId}`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/cash/checkout-summary?${qs}`,
      headers: hdr(ownerA.cookie),
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  }

  async function sessionDetail() {
    const res = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${cashSessionId}`,
      headers: hdr(ownerA.cookie),
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().session;
  }

  it('resumo do checkout mostra devido, pago e pendente por método', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder();
    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.itemsTotal, 100);
    assert.equal(summary.paidTotal, 0);
    assert.equal(summary.due, 100);
    assert.deepEqual(summary.byMethod, []);
    assert.equal(summary.storeId, storeA.id);
  });

  it('pagamento combinado: dinheiro (com troco) + PIX numa única operação', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder();
    const key = 'cash-split-combined-0001';

    const res = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie, { 'idempotency-key': key }),
      payload: {
        orderId: order.id,
        items: [
          { method: 'CASH', amount: 40, tenderedAmount: 50 },
          { method: 'PIX', amount: 60 },
        ],
      },
    });
    assert.equal(res.statusCode, 201, res.body);

    const body = res.json();
    assert.equal(body.replayed, false);
    assert.equal(body.payments.length, 2);
    assert.ok(body.splitGroup, 'pagamento combinado precisa de grupo');
    assert.equal(new Set(body.payments.map((p) => p.splitGroup)).size, 1);

    const cash = body.payments.find((p) => p.method === 'CASH');
    const pix = body.payments.find((p) => p.method === 'PIX');
    assert.equal(cash.status, 'PAID', 'dinheiro presencial já entra pago');
    assert.equal(cash.amount, 40);
    assert.equal(cash.tenderedAmount, 50);
    assert.equal(cash.changeAmount, 10, 'troco derivado no servidor');
    assert.equal(cash.cashSessionId, cashSessionId);
    assert.equal(pix.status, 'PENDING', 'PIX fica pendente até confirmar');
    assert.match(pix.pixCopyPaste, /^000201/, 'PIX estático deveria gerar copia-e-cola');

    assert.equal(body.totals.charged, 100);
    assert.equal(body.totals.due, 60, 'PIX pendente não abate o devido');
    assert.equal(body.session.totals.expected, 140, 'gaveta: 100 de abertura + 40 em dinheiro');

    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.paidTotal, 40);
    assert.equal(summary.pendingTotal, 60);
    assert.equal(summary.due, 60);
    assert.equal(summary.byMethod.find((m) => m.method === 'CASH').paid, 40);
    assert.equal(summary.byMethod.find((m) => m.method === 'PIX').pending, 60);

    // ledger: uma entrada SALE de R$ 40 vinculada ao pagamento
    const ledger = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${cashSessionId}/movements`,
      headers: hdr(ownerA.cookie),
    });
    const sale = ledger.json().movements.find((m) => m.paymentId === cash.id);
    assert.ok(sale, 'venda em dinheiro precisa entrar no ledger');
    assert.equal(sale.type, 'SALE');
    assert.equal(sale.direction, 'IN');
    assert.equal(sale.amount, 40);

    // confirma o PIX e zera o devido
    const confirm = await app.inject({
      method: 'POST',
      url: `/api/payments/${pix.id}/confirm`,
      headers: hdr(ownerA.cookie),
      payload: {},
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    const after = await summaryOf({ orderId: order.id });
    assert.equal(after.due, 0);
    assert.equal(after.paidTotal, 100);

    const session = await sessionDetail();
    assert.equal(session.totals.expected, 140, 'PIX confirmado não mexe na gaveta');

    // retry com a MESMA chave: replay do grupo inteiro, sem duplicar nada
    const replay = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie, { 'idempotency-key': key }),
      payload: {
        orderId: order.id,
        items: [
          { method: 'CASH', amount: 40, tenderedAmount: 50 },
          { method: 'PIX', amount: 60 },
        ],
      },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().replayed, true);
    assert.deepEqual(
      replay.json().payments.map((p) => p.id).sort(),
      body.payments.map((p) => p.id).sort()
    );

    const sessionAfterReplay = await sessionDetail();
    assert.equal(sessionAfterReplay.totals.expected, 140, 'retry não duplica dinheiro');
    const ledgerAfterReplay = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${cashSessionId}/movements`,
      headers: hdr(ownerA.cookie),
    });
    assert.equal(
      ledgerAfterReplay.json().movements.filter((m) => m.type === 'SALE').length,
      1
    );
  });

  it('soma acima do devido → 409 AMOUNT_EXCEEDS_DUE (nada é gravado)', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product40, q: 1 }] }); // R$ 40
    const expectedBefore = (await sessionDetail()).totals.expected;

    const res = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: {
        orderId: order.id,
        items: [
          { method: 'CASH', amount: 30 },
          { method: 'CARD', amount: 20 },
        ],
      },
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'AMOUNT_EXCEEDS_DUE');
    assert.equal(res.json().error.details.due, 40);
    assert.equal(res.json().error.details.requested, 50);

    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.paidTotal, 0, 'nada pode ter sido gravado');
    assert.equal((await sessionDetail()).totals.expected, expectedBefore);
  });

  it('pagamento parcial deixa saldo e aceita o complemento depois', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder(); // R$ 100
    const partial = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, items: [{ method: 'CASH', amount: 30 }] },
    });
    assert.equal(partial.statusCode, 201, partial.body);
    assert.equal(partial.json().totals.due, 70);

    const rest = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: {
        orderId: order.id,
        items: [
          { method: 'CARD', amount: 50 },
          { method: 'CASH', amount: 20 },
        ],
      },
    });
    assert.equal(rest.statusCode, 201, rest.body);
    assert.equal(rest.json().totals.due, 0, 'pedido quitado');
    assert.equal(rest.json().payments.length, 2);

    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.paidTotal, 100);
    assert.equal(summary.byMethod.find((m) => m.method === 'CASH').paid, 50);
    assert.equal(summary.byMethod.find((m) => m.method === 'CARD').paid, 50);

    // gaveta recebeu 30 + 20 em dinheiro (cartão não é dinheiro físico)
    const session = await sessionDetail();
    const sales = session.totals.byType.find((row) => row.type === 'SALE');
    assert.equal(sales.total, 90, '40 do teste combinado + 30 + 20');
    assert.equal(session.totals.expected, 190);
  });

  it('estorno devolve o dinheiro à gaveta uma única vez (idempotente)', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product60, q: 1 }] }); // R$ 60
    const pay = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, items: [{ method: 'CASH', amount: 60 }] },
    });
    assert.equal(pay.statusCode, 201, pay.body);
    const paymentId = pay.json().payments[0].id;
    const expectedAfterSale = (await sessionDetail()).totals.expected; // 250

    const refund = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/refunds`,
      headers: hdr(ownerA.cookie),
      payload: { paymentId, reason: 'Cliente desistiu do pedido' },
    });
    assert.equal(refund.statusCode, 200, refund.body);
    assert.equal(refund.json().alreadyRefunded, false);
    assert.equal(refund.json().payment.status, 'REFUNDED');
    assert.equal(refund.json().cashMovement.type, 'REFUND');
    assert.equal(refund.json().cashMovement.direction, 'OUT');
    assert.equal(refund.json().cashMovement.amount, 60);
    assert.equal(refund.json().session.totals.expected, expectedAfterSale - 60);

    // retry: não estorna duas vezes nem duplica a saída do ledger
    const again = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/refunds`,
      headers: hdr(ownerA.cookie),
      payload: { paymentId, reason: 'Cliente desistiu do pedido' },
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().alreadyRefunded, true);
    assert.equal(again.json().cashMovement, null);
    assert.equal(again.json().session.totals.expected, expectedAfterSale - 60);

    const ledger = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${cashSessionId}/movements`,
      headers: hdr(ownerA.cookie),
    });
    const refunds = ledger.json().movements.filter(
      (m) => m.type === 'REFUND' && m.paymentId === paymentId
    );
    assert.equal(refunds.length, 1, 'estorno duplicado no ledger');

    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.paidTotal, 0, 'estorno devolve o devido ao pedido');
    assert.equal(summary.due, 60);
  });

  it('dinheiro confirmado na rota genérica entra na gaveta aberta do operador', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product40, q: 1 }] }); // R$ 40
    const create = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, amount: 25, method: 'CASH' },
    });
    assert.equal(create.statusCode, 201, create.body);
    const paymentId = create.json().payment.id;

    const expectedBefore = (await sessionDetail()).totals.expected;

    const confirm = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/confirm`,
      headers: hdr(ownerA.cookie),
      payload: { tenderedAmount: 30 },
    });
    assert.equal(confirm.statusCode, 200, confirm.body);
    assert.equal(confirm.json().payment.cashSessionId, cashSessionId);
    assert.equal(confirm.json().payment.tenderedAmount, 30);
    assert.equal(confirm.json().payment.changeAmount, 5);
    assert.equal(confirm.json().cashMovement.amount, 25);
    assert.equal(confirm.json().warnings.length, 0);
    assert.equal((await sessionDetail()).totals.expected, expectedBefore + 25);
  });

  it('troco maior que o recebido é rejeitado (400)', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product60, q: 1 }] });
    const create = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, amount: 60, method: 'CASH' },
    });
    const paymentId = create.json().payment.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/confirm`,
      headers: hdr(ownerA.cookie),
      payload: { tenderedAmount: 10 },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'INVALID_AMOUNT');

    const stillPending = await summaryOf({ orderId: order.id });
    assert.equal(stillPending.paidTotal, 0);
  });

  it('duas cobranças simultâneas não sobrepagam o mesmo pedido', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product40, q: 1 }] }); // R$ 40

    const results = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/cash/sessions/${cashSessionId}/payments`,
        headers: hdr(ownerA.cookie, { 'idempotency-key': 'race-split-key-0001' }),
        payload: { orderId: order.id, items: [{ method: 'CASH', amount: 40 }] },
      }),
      app.inject({
        method: 'POST',
        url: `/api/cash/sessions/${cashSessionId}/payments`,
        headers: hdr(ownerA.cookie, { 'idempotency-key': 'race-split-key-0002' }),
        payload: { orderId: order.id, items: [{ method: 'CASH', amount: 40 }] },
      }),
    ]);

    const codes = results.map((res) => res.statusCode).sort();
    assert.deepEqual(codes, [201, 409], `esperava 1 sucesso e 1 conflito: ${codes}`);

    const summary = await summaryOf({ orderId: order.id });
    assert.equal(summary.paidTotal, 40, 'pedido não pode ser pago duas vezes');
    assert.equal(summary.due, 0);
  });

  it('valida payload: itens vazios, método inválido, mais de 2 casas, alvo ausente', async (t) => {
    if (skipWithoutDb(t)) return;

    const { order } = await makeOrder({ products: [{ p: product40, q: 1 }] });

    const empty = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, items: [] },
    });
    assert.equal(empty.statusCode, 400, empty.body);

    const badMethod = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, items: [{ method: 'BITCOIN', amount: 10 }] },
    });
    assert.equal(badMethod.statusCode, 400, badMethod.body);

    const cents = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { orderId: order.id, items: [{ method: 'CASH', amount: 10.001 }] },
    });
    assert.equal(cents.statusCode, 400, cents.body);

    const noTarget = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: { items: [{ method: 'CASH', amount: 10 }] },
    });
    assert.equal(noTarget.statusCode, 400, noTarget.body);

    const changeOnCard = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: {
        orderId: order.id,
        items: [{ method: 'CARD', amount: 10, tenderedAmount: 20 }],
      },
    });
    assert.equal(changeOnCard.statusCode, 400, changeOnCard.body);
    assert.equal(changeOnCard.json().error.code, 'VALIDATION_ERROR');
  });

  it('isolamento: pedido de outra loja → 404; relatório não mistura lojas', async (t) => {
    if (skipWithoutDb(t)) return;

    // dono da loja B tenta cobrar um pedido da loja A usando a gaveta de B
    const openB = await app.inject({
      method: 'POST',
      url: '/api/cash/sessions',
      headers: {
        cookie: ownerB.cookie,
        'content-type': 'application/json',
        'x-tenant-slug': storeB.slug,
      },
      payload: { openingAmount: 10 },
    });
    assert.equal(openB.statusCode, 201, openB.body);
    const sessionB = openB.json().session.id;

    const { order } = await makeOrder({ products: [{ p: product40, q: 1 }] });
    const cross = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionB}/payments`,
      headers: {
        cookie: ownerB.cookie,
        'content-type': 'application/json',
        'x-tenant-slug': storeB.slug,
      },
      payload: { orderId: order.id, items: [{ method: 'CASH', amount: 40 }] },
    });
    assert.equal(cross.statusCode, 404, cross.body);
    assert.equal(cross.json().error.code, 'ORDER_NOT_FOUND');

    // gaveta da loja B não recebeu nada
    const detailB = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${sessionB}`,
      headers: { cookie: ownerB.cookie, 'x-tenant-slug': storeB.slug },
    });
    assert.equal(detailB.json().session.totals.expected, 10);

    // relatório diário: cada loja vê só o seu
    const [reportA, reportB] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/cash/report', headers: hdr(ownerA.cookie) }),
      app.inject({
        method: 'GET',
        url: '/api/cash/report',
        headers: { cookie: ownerB.cookie, 'x-tenant-slug': storeB.slug },
      }),
    ]);
    assert.equal(reportA.statusCode, 200, reportA.body);
    assert.equal(reportB.statusCode, 200, reportB.body);
    assert.equal(reportA.json().storeId, storeA.id);
    assert.equal(reportB.json().storeId, storeB.id);
    assert.ok(reportA.json().sessions.total >= 1);
    assert.equal(reportB.json().sessions.total, 1);
    assert.ok(
      reportA.json().sessions.items.every((s) => s.storeId === storeA.id),
      'relatório vazou sessão de outra loja'
    );
    assert.equal(reportB.json().cash.net, 10, 'loja B só tem o próprio fundo de troco');
    assert.equal(reportB.json().sales.orders, 0, 'vendas da loja A não podem aparecer');

    await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${sessionB}/close`,
      headers: {
        cookie: ownerB.cookie,
        'content-type': 'application/json',
        'x-tenant-slug': storeB.slug,
      },
      payload: { countedAmount: 10 },
    });
  });

  it('relatório de fechamento reconcilia e fecha o ciclo (#110)', async (t) => {
    if (skipWithoutDb(t)) return;

    const before = await sessionDetail();
    const expected = before.totals.expected;

    const close = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/close`,
      headers: hdr(ownerA.cookie),
      payload: { countedAmount: expected - 7.5, notes: 'Fechamento do dia' },
    });
    assert.equal(close.statusCode, 200, close.body);
    assert.equal(close.json().session.status, 'closed');
    assert.equal(close.json().session.differenceAmount, -7.5);

    const report = await app.inject({
      method: 'GET',
      url: `/api/cash/sessions/${cashSessionId}/report`,
      headers: hdr(ownerA.cookie),
    });
    assert.equal(report.statusCode, 200, report.body);

    const body = report.json().report;
    assert.equal(body.session.status, 'closed');
    assert.equal(body.session.operator.id, ownerA.user.id);
    assert.equal(body.reconciliation.opening, 100);
    assert.equal(body.reconciliation.expected, expected);
    assert.equal(body.reconciliation.counted, expected - 7.5);
    assert.equal(body.reconciliation.difference, -7.5);
    assert.equal(body.reconciliation.reconciled, false);
    assert.ok(body.movements.length >= 6, 'ledger completo no relatório');

    // Invariantes (não números mágicos): o relatório tem que fechar com o ledger.
    const sum = (type, direction = null) =>
      body.movements
        .filter((m) => m.type === type && (!direction || m.direction === direction))
        .reduce((acc, m) => acc + m.amount, 0);

    assert.equal(body.reconciliation.cashSales, sum('SALE'));
    assert.equal(body.reconciliation.refunds, sum('REFUND'));
    assert.equal(body.reconciliation.supplies, sum('SUPPLY'));
    assert.equal(body.reconciliation.withdrawals, sum('WITHDRAWAL'));
    assert.equal(
      body.reconciliation.expected,
      body.reconciliation.opening +
        body.reconciliation.cashSales +
        body.reconciliation.supplies +
        body.reconciliation.adjustments -
        body.reconciliation.withdrawals -
        body.reconciliation.refunds,
      'esperado precisa bater com o ledger'
    );
    assert.equal(body.totals.expected, body.reconciliation.expected);
    assert.equal(body.session.countedAmount, body.reconciliation.counted);

    // gaveta fechada: nada mais entra
    const afterClose = await app.inject({
      method: 'POST',
      url: `/api/cash/sessions/${cashSessionId}/payments`,
      headers: hdr(ownerA.cookie),
      payload: {
        orderId: (await makeOrder({ products: [{ p: product40, q: 1 }] })).order.id,
        items: [{ method: 'CASH', amount: 10 }],
      },
    });
    assert.equal(afterClose.statusCode, 409, afterClose.body);
    assert.equal(afterClose.json().error.code, 'CASH_SESSION_CLOSED');
  });
});
