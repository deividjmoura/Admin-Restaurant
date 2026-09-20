/**
 * Atomicidade de checkout e delivery.
 *
 * Cobre:
 *  - `createOrder` com `afterInsert` que falha → rollback total (sem pedido,
 *    sem itens);
 *  - checkout que falha no meio → carrinho e versão intactos, nenhum pedido;
 *  - dois checkouts concorrentes na mesma versão → exatamente um vencedor,
 *    perdedor recebe CART_VERSION_CONFLICT;
 *  - dois checkouts concorrentes com a MESMA Idempotency-Key → mesmo pedido,
 *    uma única linha em orders;
 *  - delivery grava pedido + delivery_orders juntos (mesma tx);
 *  - delivery sem adicionais válidos → nenhum pedido órfão.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';

describe('checkout e delivery atômicos (integration)', () => {
  let store = null;
  let product = null;
  let addon = null;
  let session = null;
  let table = null;

  before(async () => {
    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({
      price: 12.5,
      addons: [{ name: 'Extra', price: 2.5 }],
    });
    store = fx.store;
    product = fx.product;
    addon = fx.addons[0];
    const t = await makeTableSession(store.id, { number: 1 });
    session = t.session;
    table = t.table;
  });

  after(async () => {
    await dropStores(store?.id);
  });

  const repositories = async () => {
    const orders = await import('../../src/modules/orders/orders.repository.js');
    const cart = await import('../../src/modules/tables/cart.repository.js');
    const db = await import('../../src/infrastructure/db.js');
    return { orders, cart, ...db };
  };

  async function orderCount(storeId, predicate = '') {
    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE store_id = $1 ${predicate}`,
      [storeId]
    );
    return rows[0].n;
  }

  it('createOrder reverte pedido e itens se o afterInsert falhar', async (t) => {
    if (skipWithoutDb(t)) return;
    const { orders } = await repositories();
    const before = await orderCount(store.id);

    await assert.rejects(
      () =>
        orders.createOrder(
          store.id,
          {
            tableSessionId: session.id,
            channel: 'TABLE',
            items: [{ productId: product.id, quantity: 1, addonIds: [addon.id] }],
          },
          {
            afterInsert: async () => {
              throw new Error('falha proposital na tx');
            },
          }
        ),
      /falha proposital/
    );

    assert.equal(await orderCount(store.id), before, 'pedido não pode sobrar');

    const { query } = await import('../../src/infrastructure/db.js');
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
       WHERE oi.store_id = $1`,
      [store.id]
    );
    assert.equal(rows[0].n, 0, 'itens não podem sobrar após rollback');
  });

  it('checkout que falha mantém carrinho e cart_version intactos', async (t) => {
    if (skipWithoutDb(t)) return;
    const { cart, query } = await repositories();
    const { session: fresh } = await (
      await import('../helpers/fixtures.js')
    ).makeTableSession(store.id, { number: 42 });

    const current = await cart.getCart(store.id, fresh.id);
    await cart.addCartItem(store.id, fresh.id, {
      productId: product.id,
      quantity: 2,
      addonIds: [addon.id],
      expectedVersion: current.version,
    });
    const afterAdd = await cart.getCart(store.id, fresh.id);
    const versionBefore = afterAdd.version;
    const ordersBefore = await orderCount(store.id);

    // Adicional desativado DEPOIS de já estar no carrinho: o snapshot do
    // carrinho passa, mas o createOrder falha DENTRO da transação do checkout.
    await query(
      `UPDATE product_addons SET is_active = FALSE WHERE id = $1 AND store_id = $2`,
      [addon.id, store.id]
    );
    try {
      await assert.rejects(
        () =>
          cart.checkoutCart(store.id, fresh.id, {
            expectedVersion: versionBefore,
          }),
        (err) => err.code === 'ADDON_INVALID'
      );

      const cartAfter = await cart.getCart(store.id, fresh.id);
      assert.equal(cartAfter.items.length, 1, 'carrinho deve continuar intacto');
      assert.equal(cartAfter.version, versionBefore, 'versão não pode ter avançado');
      assert.equal(await orderCount(store.id), ordersBefore, 'nenhum pedido criado');
    } finally {
      await query(
        `UPDATE product_addons SET is_active = TRUE WHERE id = $1 AND store_id = $2`,
        [addon.id, store.id]
      );
    }
  });

  it('dois checkouts concorrentes na mesma versão → um vencedor, um 409', async (t) => {
    if (skipWithoutDb(t)) return;
    const { cart } = await repositories();
    const { session: fresh } = await (
      await import('../helpers/fixtures.js')
    ).makeTableSession(store.id, { number: 43 });

    const current = await cart.getCart(store.id, fresh.id);
    await cart.addCartItem(store.id, fresh.id, {
      productId: product.id,
      quantity: 1,
      addonIds: [],
      expectedVersion: current.version,
    });
    const { version } = await cart.getCart(store.id, fresh.id);
    const ordersBefore = await orderCount(store.id);

    const results = await Promise.allSettled([
      cart.checkoutCart(store.id, fresh.id, { expectedVersion: version }),
      cart.checkoutCart(store.id, fresh.id, { expectedVersion: version }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, 'exatamente um checkout deve vencer');
    assert.equal(failed.length, 1, 'o outro deve falhar');
    assert.equal(failed[0].reason.code, 'CART_VERSION_CONFLICT');
    assert.equal(typeof failed[0].reason.currentVersion, 'number');

    assert.equal(await orderCount(store.id), ordersBefore + 1, 'apenas um pedido');

    const cartAfter = await cart.getCart(store.id, fresh.id);
    assert.equal(cartAfter.items.length, 0, 'carrinho limpo exatamente uma vez');
  });

  it('checkouts concorrentes com a mesma Idempotency-Key → um único pedido', async (t) => {
    if (skipWithoutDb(t)) return;
    const { cart, query } = await repositories();
    const { session: fresh } = await (
      await import('../helpers/fixtures.js')
    ).makeTableSession(store.id, { number: 44 });

    const current = await cart.getCart(store.id, fresh.id);
    await cart.addCartItem(store.id, fresh.id, {
      productId: product.id,
      quantity: 1,
      addonIds: [],
      expectedVersion: current.version,
    });
    const { version } = await cart.getCart(store.id, fresh.id);
    const key = `checkout-race-${Date.now()}`;
    const ordersBefore = await orderCount(store.id);

    const [a, b] = await Promise.all([
      cart.checkoutCart(store.id, fresh.id, {
        expectedVersion: version,
        idempotencyKey: key,
      }),
      cart.checkoutCart(store.id, fresh.id, { idempotencyKey: key }),
    ]);

    assert.equal(a.order.id, b.order.id, 'retry devolve o MESMO pedido');
    assert.equal([a.replayed, b.replayed].filter(Boolean).length, 1);
    assert.equal(await orderCount(store.id), ordersBefore + 1);

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE store_id = $1 AND idempotency_key = $2`,
      [store.id, key]
    );
    assert.equal(rows[0].n, 1);
  });

  it('criação de delivery grava pedido e delivery_orders na mesma transação', async (t) => {
    if (skipWithoutDb(t)) return;
    const delivery = await import('../../src/modules/delivery/delivery.repository.js');
    const { query } = await import('../../src/infrastructure/db.js');

    const zone = await delivery.createZone(store.id, {
      name: 'Centro',
      fee: 5,
      minOrderAmount: 10,
    });

    const key = `delivery-${Date.now()}`;
    const created = await delivery.createDeliveryOrder(store.id, {
      zoneId: zone.id,
      customerName: 'Cliente Teste',
      address: { street: 'Rua A', number: '10', city: 'São Paulo' },
      idempotencyKey: key,
      items: [{ productId: product.id, quantity: 2, addonIds: [addon.id] }],
    });

    const { rows } = await query(
      `SELECT o.id, d.order_id, d.store_id, d.delivery_fee, d.city
       FROM orders o
       INNER JOIN delivery_orders d ON d.order_id = o.id AND d.store_id = o.store_id
       WHERE o.store_id = $1 AND o.id = $2`,
      [store.id, created.order.id]
    );
    assert.equal(rows.length, 1, 'pedido e entrega devem existir juntos');
    assert.equal(rows[0].order_id, created.order.id);
    assert.equal(rows[0].store_id, store.id);
    assert.equal(Number(rows[0].delivery_fee), 5);
    // subtotal = (12.5 + 2.5) * 2 = 30 + taxa 5 = 35
    assert.equal(created.quote.subtotal, 30);
    assert.equal(created.quote.total, 35);

    // retry com a mesma Idempotency-Key devolve o mesmo pedido + a mesma entrega
    const replay = await delivery.createDeliveryOrder(store.id, {
      zoneId: zone.id,
      customerName: 'Cliente Teste',
      address: { street: 'Rua A', number: '10', city: 'São Paulo' },
      idempotencyKey: key,
      items: [{ productId: product.id, quantity: 2, addonIds: [addon.id] }],
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.order.id, created.order.id);
    assert.equal(replay.delivery.orderId, created.delivery.orderId);

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS n FROM delivery_orders WHERE store_id = $1`,
      [store.id]
    );
    assert.equal(countRows[0].n, 1, 'retry não pode duplicar a entrega');
  });

  it('delivery com adicional inválido não deixa pedido órfão', async (t) => {
    if (skipWithoutDb(t)) return;
    const delivery = await import('../../src/modules/delivery/delivery.repository.js');
    const { query } = await import('../../src/infrastructure/db.js');
    const { makeStoreWithProduct } = await import('../helpers/fixtures.js');

    const other = await makeStoreWithProduct({
      price: 7,
      addons: [{ name: 'Adicional de outra loja', price: 1 }],
    });
    try {
      const zone = await delivery.createZone(store.id, {
        name: 'Zona X',
        fee: 3,
        minOrderAmount: 0,
      });
      const before = await orderCount(store.id);
      const deliveriesBefore = await query(
        `SELECT COUNT(*)::int AS n FROM delivery_orders WHERE store_id = $1`,
        [store.id]
      );

      await assert.rejects(
        () =>
          delivery.createDeliveryOrder(store.id, {
            zoneId: zone.id,
            customerName: 'Cliente Teste',
            address: { street: 'Rua B', city: 'São Paulo' },
            items: [
              // adicional de outra loja (não pertence a este produto/loja)
              { productId: product.id, quantity: 1, addonIds: [other.addons[0].id] },
            ],
          }),
        (err) => err.code === 'ADDON_INVALID'
      );

      assert.equal(await orderCount(store.id), before, 'nenhum pedido órfão');

      const { rows } = await query(
        `SELECT COUNT(*)::int AS n FROM delivery_orders WHERE store_id = $1`,
        [store.id]
      );
      assert.equal(
        rows[0].n,
        deliveriesBefore.rows[0].n,
        'falha de delivery não pode gravar entrega'
      );
    } finally {
      await dropStores(other.store.id);
    }
  });

  it('pedido de mesa sem sessão é rejeitado (ORDER_SESSION_REQUIRED)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { orders } = await repositories();
    await assert.rejects(
      () =>
        orders.createOrder(store.id, {
          channel: 'TABLE',
          items: [{ productId: product.id, quantity: 1, addonIds: [] }],
        }),
      (err) => err.code === 'ORDER_SESSION_REQUIRED'
    );
  });

  it('não aceita sessão de outra loja (SESSION_NOT_FOUND)', async (t) => {
    if (skipWithoutDb(t)) return;
    const { orders } = await repositories();
    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const other = await makeStoreWithProduct({ price: 5 });
    try {
      const { session: otherSession } = await makeTableSession(other.store.id, {
        number: 9,
      });
      await assert.rejects(
        () =>
          orders.createOrder(store.id, {
            tableSessionId: otherSession.id,
            channel: 'TABLE',
            items: [{ productId: product.id, quantity: 1, addonIds: [] }],
          }),
        (err) => err.code === 'SESSION_NOT_FOUND'
      );
    } finally {
      await dropStores(other.store.id);
    }
  });
});
