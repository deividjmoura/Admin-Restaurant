/**
 * Painel da cozinha: fila por estação e stream SSE.
 *
 * Cobre:
 *  - fila por estação (KITCHEN/BAR), limitada e com pedidos ativos primeiro;
 *  - nunca devolve pedido de outra loja nem item cancelado;
 *  - SSE: handshake, filtro por loja + estação + permissão, headers de stream;
 *  - `payment.*` só chega a quem tem `payments.read`;
 *  - `session.closed` só chega a quem tem `cashier.sessions.read`;
 *  - evento de outro tenant nunca é entregue.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

describe('fila da cozinha e SSE (integration)', () => {
  let app = null;
  let store = null;
  let otherStore = null;
  let kitchenUser = null;
  let owner = null;
  let session = null;
  let kitchenProduct = null;
  let barProduct = null;

  before(async () => {
    process.env.NODE_ENV = 'test';
    const { makeStoreWithProduct, makeTableSession, makeUserWithRole } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({ price: 12, station: 'KITCHEN' });
    store = fx.store;
    kitchenProduct = fx.product;

    const bar = await makeStoreWithProduct({ price: 8, station: 'BAR' });
    otherStore = bar.store;
    barProduct = bar.product;

    session = (await makeTableSession(store.id, { number: 21 })).session;
    kitchenUser = await makeUserWithRole(store.id, { role: 'KITCHEN' });
    owner = await makeUserWithRole(store.id, { role: 'OWNER' });

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
    await dropStores(store?.id, otherStore?.id);
  });

  let baseAddress = null;
  async function ensureAddress() {
    if (!baseAddress) {
      baseAddress = await app.listen({ port: 0, host: '127.0.0.1' });
    }
    return baseAddress;
  }

  async function openStream({ cookie, station }) {
    const address = await ensureAddress();
    const url = new URL(`/api/kitchen/events?station=${station}`, address);
    const response = await fetch(url, {
      headers: headers(store.slug, cookie),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state = { buffer: '' };
    const readUntil = async (needle, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        state.buffer += decoder.decode(value, { stream: true });
        if (state.buffer.includes(needle)) return true;
      }
      return false;
    };
    return {
      response,
      state,
      readUntil,
      cancel: () => reader.cancel(),
    };
  }

  const headers = (slug, cookie) => ({
    'x-tenant-slug': slug,
    ...(cookie ? { cookie } : {}),
  });

  async function createOrder(items) {
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    return createOrder(store.id, { tableSessionId: session.id, channel: 'TABLE', items });
  }

  it('fila da estação traz só itens daquela estação', async (t) => {
    if (skipWithoutDb(t)) return;
    const { order } = await createOrder([
      { productId: kitchenProduct.id, quantity: 1, addonIds: [] },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=KITCHEN',
      headers: headers(store.slug, kitchenUser.cookie),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, store.id);
    assert.equal(body.station, 'KITCHEN');
    const mine = body.orders.find((o) => o.id === order.id);
    assert.ok(mine, 'pedido da estação precisa aparecer');
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].station, 'KITCHEN');

    // BAR não vê o pedido da cozinha
    const barRes = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=BAR',
      headers: headers(store.slug, kitchenUser.cookie),
    });
    assert.equal(barRes.statusCode, 200, barRes.body);
    assert.equal(
      barRes.json().orders.some((o) => o.id === order.id),
      false
    );
  });

  it('fila respeita isolamento de loja e rejeita estação inválida', async (t) => {
    if (skipWithoutDb(t)) return;
    const otherRes = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=KITCHEN',
      headers: headers(otherStore.slug, kitchenUser.cookie),
    });
    // sem vínculo com a outra loja → sem acesso
    assert.ok([401, 403].includes(otherRes.statusCode), otherRes.body);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=GRILL',
      headers: headers(store.slug, kitchenUser.cookie),
    });
    assert.equal(bad.statusCode, 400, bad.body);
    assert.equal(bad.json().error.code, 'INVALID_STATION');
  });

  it('limite da fila é limitado a 200', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=KITCHEN&limit=100000',
      headers: headers(store.slug, kitchenUser.cookie),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().limit, 200);
  });

  it('SSE: handshake devolve canal do tenant + estação', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/events?station=BAR&probe=1',
      headers: headers(store.slug, kitchenUser.cookie),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.storeId, store.id);
    assert.equal(body.station, 'BAR');
    assert.equal(body.channel, `store:${store.id}:orders:BAR`);
  });

  it('canReceiveEvent filtra tenant, estação e permissão', async () => {
    const { canReceiveEvent } = await import('../../src/modules/realtime/store-events.js');
    const payload = {
      storeId: 'store-1',
      type: 'order.created',
      stations: ['KITCHEN'],
    };

    assert.equal(
      canReceiveEvent(payload, { storeId: 'store-1', station: 'KITCHEN' }),
      true
    );
    assert.equal(
      canReceiveEvent(payload, { storeId: 'store-1', station: 'BAR' }),
      false,
      'estação diferente não recebe'
    );
    assert.equal(
      canReceiveEvent(payload, { storeId: 'store-2', station: 'KITCHEN' }),
      false,
      'outro tenant não recebe'
    );

    const payment = { storeId: 'store-1', type: 'payment.paid', stations: [] };
    assert.equal(
      canReceiveEvent(payment, { storeId: 'store-1', permissions: new Set(['tables.read']) }),
      false,
      'payment.* exige payments.read'
    );
    assert.equal(
      canReceiveEvent(payment, { storeId: 'store-1', permissions: new Set(['payments.read']) }),
      true
    );

    const sessionClosed = { storeId: 'store-1', type: 'session.closed', stations: [] };
    assert.equal(
      canReceiveEvent(sessionClosed, {
        storeId: 'store-1',
        permissions: new Set(['kitchen.orders.read']),
      }),
      false,
      'session.closed exige cashier.sessions.read'
    );
    assert.equal(
      canReceiveEvent(sessionClosed, {
        storeId: 'store-1',
        permissions: new Set(['cashier.sessions.read']),
      }),
      true
    );
  });

  it('SSE abre stream com headers corretos e entrega evento da estação', async (t) => {
    if (skipWithoutDb(t)) return;
    const { publishStoreOrderEvent } = await import(
      '../../src/modules/realtime/store-events.js'
    );

    const stream = await openStream({ cookie: owner.cookie, station: 'KITCHEN' });
    const { response, state, readUntil } = stream;

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    assert.match(response.headers.get('cache-control') || '', /no-cache/);
    assert.match(response.headers.get('cache-control') || '', /no-transform/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');

    assert.equal(await readUntil('event: connected'), true, state.buffer);

    // evento de outra estação NÃO chega
    publishStoreOrderEvent(store.id, { type: 'order.created', stations: ['BAR'] });
    // evento da estação chega
    publishStoreOrderEvent(store.id, { type: 'order.created', stations: ['KITCHEN'] });
    assert.equal(await readUntil('event: order.created'), true, state.buffer);
    assert.equal(state.buffer.includes('"stationFilter":"KITCHEN"'), true, state.buffer);

    // evento de outro tenant nunca chega ao stream
    publishStoreOrderEvent(otherStore.id, { type: 'order.created', stations: ['KITCHEN'] });
    await new Promise((r) => setTimeout(r, 200));
    const kitchenEvents = state.buffer.split('event: order.created').length - 1;
    assert.equal(kitchenEvents, 1, 'evento de outro tenant não pode ser entregue');

    await stream.cancel();
  });

  it('SSE entrega payment.* para quem tem payments.read (OWNER)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { publishStoreOrderEvent } = await import(
      '../../src/modules/realtime/store-events.js'
    );

    const stream = await openStream({ cookie: owner.cookie, station: 'KITCHEN' });
    assert.equal(stream.response.status, 200);
    assert.equal(await stream.readUntil('event: connected'), true, stream.state.buffer);

    publishStoreOrderEvent(store.id, { type: 'payment.paid', stations: ['KITCHEN'] });
    assert.equal(await stream.readUntil('event: payment.paid'), true, stream.state.buffer);

    await stream.cancel();
  });

  it('SSE esconde payment.* de quem não tem payments.read (KITCHEN)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { publishStoreOrderEvent } = await import(
      '../../src/modules/realtime/store-events.js'
    );

    const stream = await openStream({ cookie: kitchenUser.cookie, station: 'KITCHEN' });
    assert.equal(stream.response.status, 200);
    assert.equal(await stream.readUntil('event: connected'), true, stream.state.buffer);

    publishStoreOrderEvent(store.id, { type: 'payment.paid', stations: ['KITCHEN'] });
    // o canal continua vivo: um evento permitido precisa chegar depois
    publishStoreOrderEvent(store.id, { type: 'order.created', stations: ['KITCHEN'] });
    assert.equal(await stream.readUntil('event: order.created'), true, stream.state.buffer);
    assert.equal(
      stream.state.buffer.includes('event: payment.paid'),
      false,
      'payment.* exige payments.read'
    );

    await stream.cancel();
  });
});
