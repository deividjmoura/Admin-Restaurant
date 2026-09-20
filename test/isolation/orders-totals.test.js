/**
 * Totais financeiros com adicionais e pedidos/itens cancelados.
 *
 * Regra: todo total usa SUM((unit_price + addons_total) * quantity)
 * FILTER (WHERE status <> 'CANCELLED'), sempre com join tenant-safe
 * (oi.order_id = o.id AND oi.store_id = o.store_id) e excluindo pedidos
 * cancelados.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

const PRICE = 20;
const ADDON = 5; // 2 adicionais => addons_total 10
const QTY = 2;
const LINE = (PRICE + ADDON * 2) * QTY; // 60

describe('totais financeiros incluem adicionais (integration)', () => {
  let store = null;
  let otherStore = null;
  let product = null;
  let addons = [];
  let session = null;
  let otherSession = null;
  let otherProduct = null;

  before(async () => {
    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({
      price: PRICE,
      addons: [
        { name: 'Bacon', price: ADDON },
        { name: 'Cheddar', price: ADDON },
      ],
    });
    store = fx.store;
    product = fx.product;
    addons = fx.addons;

    const t = await makeTableSession(store.id, { number: 1 });
    session = t.session;

    const fxOther = await makeStoreWithProduct({ price: 7 });
    otherStore = fxOther.store;
    otherProduct = fxOther.product;
    const tOther = await makeTableSession(otherStore.id, { number: 2 });
    otherSession = tOther.session;
  });

  after(async () => {
    await dropStores(store?.id, otherStore?.id);
  });

  async function createOrderWithAddons(sessionId, { storeId = store.id, productId = product.id } = {}) {
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const result = await createOrder(storeId, {
      tableSessionId: sessionId,
      channel: 'TABLE',
      items: [
        {
          productId,
          quantity: QTY,
          addonIds: productId === product.id ? addons.map((a) => a.id) : [],
        },
      ],
    });
    return result;
  }

  it('persiste addons_total no order_items', async (t) => {
    if (skipWithoutDb(t)) return;
    const { order, items } = await createOrderWithAddons(session.id);
    const { query } = await import('../../src/infrastructure/db.js');

    const { rows } = await query(
      `SELECT unit_price, addons_total, quantity FROM order_items
       WHERE store_id = $1 AND order_id = $2`,
      [store.id, order.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].unit_price), PRICE);
    assert.equal(Number(rows[0].addons_total), ADDON * 2, 'adicionais precisam ser persistidos');

    assert.equal(Number(items[0].addons_total), ADDON * 2);
    assert.equal(Number(items[0].line_total), LINE);
    assert.equal(items[0].addons.length, 2);
  });

  it('resumo da comanda soma adicionais', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const { getSessionSummary } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { session: fresh } = await makeTableSession(store.id, { number: 11 });

    await createOrder(store.id, {
      tableSessionId: fresh.id,
      channel: 'TABLE',
      items: [{ productId: product.id, quantity: QTY, addonIds: addons.map((a) => a.id) }],
    });

    const summary = await getSessionSummary(store.id, fresh.id);
    assert.equal(summary.totals.amount, LINE);
    assert.equal(summary.totals.items, QTY);
    assert.equal(summary.orders[0].items[0].addonsTotal, ADDON * 2);
    assert.equal(summary.orders[0].items[0].lineTotal, LINE);
  });

  it('dashboard, top products e série diária somam adicionais', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const reports = await import('../../src/modules/reports/reports.repository.js');

    const period = { preset: 'week' };
    const dashBefore = await reports.getDashboardSummary(store.id, period);
    const topBefore = await reports.getTopProducts(store.id, period, { limit: 50 });
    const seriesBefore = (await reports.getDailySeries(store.id, period)).reduce(
      (sum, d) => sum + d.revenue,
      0
    );

    const { session: fresh } = await makeTableSession(store.id, { number: 12 });
    await createOrder(store.id, {
      tableSessionId: fresh.id,
      channel: 'TABLE',
      items: [{ productId: product.id, quantity: QTY, addonIds: addons.map((a) => a.id) }],
    });

    const round = (n) => Math.round(n * 100) / 100;
    const dashboard = await reports.getDashboardSummary(store.id, period);
    assert.equal(
      round(dashboard.revenue.items - dashBefore.revenue.items),
      LINE,
      'dashboard deve somar adicionais'
    );

    const top = await reports.getTopProducts(store.id, period, { limit: 50 });
    const mine = top.find((p) => p.productId === product.id);
    const mineBefore = topBefore.find((p) => p.productId === product.id);
    assert.equal(
      round(mine.revenue - (mineBefore?.revenue ?? 0)),
      LINE,
      'top products deve somar adicionais'
    );
    assert.equal(mine.quantity - (mineBefore?.quantity ?? 0), QTY);

    const totalSeries = round(
      (await reports.getDailySeries(store.id, period)).reduce((sum, d) => sum + d.revenue, 0)
    );
    assert.equal(
      round(totalSeries - seriesBefore),
      LINE,
      'série diária deve somar adicionais'
    );

    // outra loja não vê nada disso
    const otherDashboard = await reports.getDashboardSummary(otherStore.id, period);
    assert.equal(otherDashboard.revenue.items, 0);
  });

  it('item cancelado sai do total; pedido cancelado não conta consumo', async (t) => {
    if (skipWithoutDb(t)) return;
    const { createOrder, findOrderById, listOrderItems, transitionOrderItemStatus, transitionOrderStatus } =
      await import('../../src/modules/orders/orders.repository.js');
    const { makeTableSession } = await import('../helpers/fixtures.js');
    const { getSessionSummary } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const reports = await import('../../src/modules/reports/reports.repository.js');

    const { session: fresh } = await makeTableSession(store.id, { number: 13 });
    const { order } = await createOrder(store.id, {
      tableSessionId: fresh.id,
      channel: 'TABLE',
      items: [
        { productId: product.id, quantity: QTY, addonIds: addons.map((a) => a.id) },
        { productId: product.id, quantity: 1, addonIds: [] },
      ],
    });
    const items = await listOrderItems(store.id, order.id);
    const withAddons = items.find((i) => Number(i.addons_total) > 0);

    const before = await getSessionSummary(store.id, fresh.id);
    assert.equal(before.totals.amount, LINE + PRICE);

    const period = { preset: 'week' };
    const dashA = await reports.getDashboardSummary(store.id, period);

    // cancela só o item com adicionais: o total precisa cair exatamente nele
    await transitionOrderItemStatus(store.id, withAddons.id, 'CANCELLED');
    const afterItemCancel = await getSessionSummary(store.id, fresh.id);
    assert.equal(afterItemCancel.totals.amount, PRICE);

    const dashB = await reports.getDashboardSummary(store.id, period);
    assert.equal(
      Math.round((dashA.revenue.items - dashB.revenue.items) * 100) / 100,
      LINE,
      'dashboard deve descartar o item cancelado (com adicionais)'
    );

    // cancela o pedido inteiro: consumo = 0
    await transitionOrderStatus(store.id, order.id, 'CANCELLED');
    const afterOrderCancel = await getSessionSummary(store.id, fresh.id);
    assert.equal(afterOrderCancel.totals.amount, 0);

    const dashC = await reports.getDashboardSummary(store.id, period);
    assert.equal(
      Math.round((dashB.revenue.items - dashC.revenue.items) * 100) / 100,
      PRICE,
      'pedido cancelado não gera receita'
    );

    const series = await reports.getDailySeries(store.id, period);
    const seriesTotal =
      Math.round(series.reduce((sum, d) => sum + d.revenue, 0) * 100) / 100;
    assert.equal(seriesTotal, dashC.revenue.items, 'série diária bate com o dashboard');
    assert.equal(dashC.orders.cancelled >= 1, true);

    const cancelled = await findOrderById(store.id, order.id);
    assert.equal(cancelled.status, 'CANCELLED');
    const finalItems = await listOrderItems(store.id, order.id);
    assert.ok(finalItems.every((i) => i.status === 'CANCELLED'), 'itens ativos cancelados');
  });
});
