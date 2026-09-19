/**
 * Isolamento de pagamentos/webhooks entre lojas.
 * Issue #105: o store_id do cliente nunca pode autorizar acesso a dados de outra loja.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('payment tenant isolation (integration)', () => {
  let storeA = null;
  let storeB = null;
  let orderAId = null;
  let sessionAId = null;
  let paymentAId = null;

  before(async () => {
    if (!hasDatabase()) return;

    const { create: createStore } = await import('../../src/modules/tenancy/store.repository.js');
    const { createCategory, createProduct } = await import('../../src/modules/menu/menu.repository.js');
    const { createTable, openSession } = await import('../../src/modules/tables/tables.repository.js');
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { createPayment } = await import('../../src/modules/payments/payments.repository.js');

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `pay-a-${suffix}`, name: 'Payment Store A' });
    storeB = await createStore({ slug: `pay-b-${suffix}`, name: 'Payment Store B' });

    const category = await createCategory(storeA.id, { name: 'Payments', sortOrder: 1 });
    const product = await createProduct(storeA.id, {
      categoryId: category.id,
      name: 'Payment Item',
      price: 10,
      sortOrder: 1,
      station: 'KITCHEN',
    });

    const table = await createTable(storeA.id, { number: 1, label: 'A1' });
    const session = await openSession(storeA.id, table.id);
    sessionAId = session.id;

    const created = await createOrder(storeA.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      idempotencyKey: `pay-iso-order-${suffix}`,
      items: [{ productId: product.id, quantity: 1, addonIds: [] }],
    });
    orderAId = created.order.id;

    const payment = await createPayment(storeA.id, {
      amount: 10,
      method: 'CASH',
      orderId: orderAId,
      sessionId: session.id,
      idempotencyKey: `pay-iso-${suffix}`,
    });
    paymentAId = payment.payment.id;
  });

  after(async () => {
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query('DELETE FROM stores WHERE id = ANY($1::uuid[])', [
      [storeA.id, storeB.id].filter(Boolean),
    ]);
  });

  it('rejects creating a payment for another store order', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createPayment, PaymentError } = await import('../../src/modules/payments/payments.repository.js');

    await assert.rejects(
      () =>
        createPayment(storeB.id, {
          amount: 10,
          method: 'CASH',
          orderId: orderAId,
          idempotencyKey: `cross-store-create-${Date.now()}`,
        }),
      (err) => err instanceof PaymentError && err.code === 'ORDER_NOT_FOUND'
    );
  });

  it('rejects creating a payment for another store session', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createPayment, PaymentError } = await import('../../src/modules/payments/payments.repository.js');

    await assert.rejects(
      () =>
        createPayment(storeB.id, {
          amount: 10,
          method: 'CASH',
          sessionId: sessionAId,
          idempotencyKey: `cross-store-session-${Date.now()}`,
        }),
      (err) => err instanceof PaymentError && err.code === 'SESSION_NOT_FOUND'
    );
  });

  it('webhook cannot use a foreign paymentId with a client-supplied storeId', async (t) => {
    if (skipWithoutDb(t)) return;
    const app = await import('../../src/app.js').then(({ buildApp }) => buildApp({ logger: false }));
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/payments/webhooks/test-provider',
        payload: {
          externalEventId: `cross-store-webhook-${Date.now()}`,
          eventType: 'payment.paid',
          paymentId: paymentAId,
          storeId: storeB.id,
          markPaid: true,
        },
      });

      assert.equal(res.statusCode, 404, res.body);
      assert.equal(res.json().error?.code, 'PAYMENT_NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
