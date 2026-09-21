import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { buildApp } from '../../src/app.js';
import { pool, query } from '../../src/infrastructure/db.js';
import { createOrder } from '../../src/modules/orders/orders.repository.js';
import { createPayment } from '../../src/modules/payments/payments.repository.js';
import {
  closeSession,
  regenerateTableToken,
  SESSION_TTL_MS,
} from '../../src/modules/tables/tables.repository.js';
import { verifyCustomerSession } from '../../src/modules/customer/customer-session.js';
import { getSecret } from '../../src/modules/auth/session.js';
import {
  hasDatabase,
  makeStoreWithProduct,
  makeTableSession,
  makeUserWithRole,
  customerHeaders,
  dropStores,
} from '../helpers/fixtures.js';

// Every fixture credential comes from a real QR exchange on the owning host.
describe('customer session authorization', { skip: !hasDatabase() }, () => {
  let app,
    a,
    b,
    first,
    second,
    other,
    staff,
    kitchen,
    order1,
    order2,
    pay1,
    pay2;
  const allUsers = [];
  let tableNumber = 10;
  const makeCustomer = async (store) => {
    const fixture = await makeTableSession(store.id, { number: tableNumber++ });
    fixture.headers = await customerHeaders(app, store, fixture.table);
    fixture.customer = await verifyCustomerSession(
      fixture.headers.authorization.slice(7)
    );
    return fixture;
  };
  const send = (method, url, customer, payload, headers = {}) =>
    app.inject({
      method,
      url,
      headers: {
        ...(customer?.headers || { host: `${a.store.slug}.localhost` }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const orderInput = (sessionId) => ({
    tableSessionId: sessionId,
    items: [{ productId: a.product.id, quantity: 1 }],
  });
  before(async () => {
    app = await buildApp({ logger: false });
    a = await makeStoreWithProduct({ price: 20 });
    b = await makeStoreWithProduct({ price: 10 });
    first = await makeCustomer(a.store);
    second = await makeCustomer(a.store);
    other = await makeCustomer(b.store);
    staff = await makeUserWithRole(a.store.id, { role: 'STAFF' });
    kitchen = await makeUserWithRole(a.store.id, { role: 'KITCHEN' });
    allUsers.push(staff.user.id, kitchen.user.id);
    order1 = (await createOrder(a.store.id, orderInput(first.session.id)))
      .order;
    order2 = (await createOrder(a.store.id, orderInput(second.session.id)))
      .order;
    pay1 = (
      await createPayment(a.store.id, {
        orderId: order1.id,
        amount: 5,
        method: 'CASH',
      })
    ).payment;
    pay2 = (
      await createPayment(a.store.id, {
        sessionId: second.session.id,
        amount: 5,
        method: 'CASH',
      })
    ).payment;
  });
  after(async () => {
    await app?.close();
    await dropStores(a?.store.id, b?.store.id);
    await query('DELETE FROM users WHERE id=ANY($1::uuid[])', [allUsers]);
    await pool.end();
  });
  it('QR returns short-lived, typed credentials and no-store; session UUID alone is not a credential', async () => {
    const res = await send(
      'GET',
      `/api/tables/by-token/${first.table.public_token}`,
      null
    );
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['cache-control'], 'no-store');
    const claims = decodeJwt(res.json().customerSession.token);
    assert.equal(claims.type, 'customer');
    assert.equal(claims.storeId, a.store.id);
    assert.equal(claims.sessionId, first.session.id);
    assert.equal(claims.role, undefined);
    assert.equal(claims.sub, undefined);
    assert.ok(claims.exp - claims.iat <= 3600);
    const denied = await send(
      'GET',
      `/api/sessions/${first.session.id}/cart`,
      null,
      undefined,
      { authorization: `Bearer ${first.session.id}` }
    );
    assert.equal(denied.statusCode, 401);
  });
  it('knowing resource IDs without credentials never authorizes read or mutation', async () => {
    const attempts = [
      ['GET', `/api/orders/${order1.id}`],
      ['POST', `/api/orders/${order1.id}/cancel`],
      ['POST', '/api/orders', orderInput(first.session.id)],
      ['GET', `/api/payments/${pay1.id}`],
      [
        'POST',
        '/api/payments',
        { orderId: order1.id, amount: 5, method: 'CASH' },
      ],
      ['GET', `/api/sessions/${first.session.id}/cart`],
      [
        'POST',
        `/api/sessions/${first.session.id}/cart/items`,
        { productId: a.product.id, quantity: 1, expectedVersion: 0 },
      ],
      [
        'POST',
        `/api/sessions/${first.session.id}/cart/checkout`,
        { expectedVersion: 0 },
      ],
      [
        'PATCH',
        `/api/sessions/${first.session.id}/cart/items/${randomUUID()}`,
        { quantity: 1, expectedVersion: 0 },
      ],
      [
        'DELETE',
        `/api/sessions/${first.session.id}/cart/items/${randomUUID()}`,
        { expectedVersion: 0 },
      ],
    ];
    for (const [method, url, body] of attempts)
      assert.equal(
        (await send(method, url, null, body)).statusCode,
        401,
        `${method} ${url}`
      );
  });
  it('same-store, other-table IDs are hidden on reads, cancellation, writes and cart mutations', async () => {
    const attempts = [
      ['GET', `/api/orders/${order2.id}`],
      ['POST', `/api/orders/${order2.id}/cancel`],
      ['POST', '/api/orders', orderInput(second.session.id)],
      ['GET', `/api/payments/${pay2.id}`],
      [
        'POST',
        '/api/payments',
        { orderId: order2.id, amount: 5, method: 'CASH' },
      ],
      [
        'POST',
        '/api/payments',
        { sessionId: second.session.id, amount: 5, method: 'CASH' },
      ],
      ['GET', `/api/sessions/${second.session.id}/cart`],
      [
        'POST',
        `/api/sessions/${second.session.id}/cart/items`,
        { productId: a.product.id, quantity: 1, expectedVersion: 0 },
      ],
      [
        'POST',
        `/api/sessions/${second.session.id}/cart/checkout`,
        { expectedVersion: 0 },
      ],
      [
        'PATCH',
        `/api/sessions/${second.session.id}/cart/items/${randomUUID()}`,
        { quantity: 1, expectedVersion: 0 },
      ],
      [
        'DELETE',
        `/api/sessions/${second.session.id}/cart/items/${randomUUID()}`,
        { expectedVersion: 0 },
      ],
    ];
    for (const [method, url, body] of attempts) {
      const res = await send(method, url, first, body);
      assert.equal(res.statusCode, 404, res.body);
      assert.ok(!res.body.includes(order2.id));
      assert.ok(!res.body.includes(pay2.id));
    }
    assert.equal(
      (await query('SELECT status FROM orders WHERE id=$1', [order2.id]))
        .rows[0].status,
      'PENDING'
    );
  });
  it('token/host mismatch is 403; resource from other store with valid local token is 404', async () => {
    assert.equal(
      (
        await send('GET', `/api/orders/${order1.id}`, first, undefined, {
          host: `${b.store.slug}.localhost`,
        })
      ).statusCode,
      403
    );
    assert.equal(
      (await send('GET', `/api/orders/${order1.id}`, other)).statusCode,
      404
    );
    assert.equal(
      (await send('GET', `/api/payments/${pay1.id}`, other)).statusCode,
      404
    );
  });
  it('customer token never authorizes staff/platform actions or payment confirmation/refund', async () => {
    for (const [method, url] of [
      ['GET', '/api/me'],
      ['GET', '/api/admin/products'],
      ['GET', '/api/payments'],
      ['POST', `/api/payments/${pay1.id}/confirm`],
      ['POST', `/api/payments/${pay1.id}/refund`],
      ['PATCH', `/api/orders/${order1.id}/status`],
    ]) {
      assert.equal(
        (
          await send(
            method,
            url,
            first,
            method === 'PATCH' ? { status: 'CONFIRMED' } : undefined
          )
        ).statusCode,
        403,
        url
      );
    }
    assert.equal(
      (
        await send('GET', '/api/platform/stores', first, undefined, {
          host: 'app.localhost',
        })
      ).statusCode,
      403
    );
    const stolenCookie = await send('GET', '/api/me', null, undefined, {
      cookie: `ar_session=${first.headers.authorization.slice(7)}`,
    });
    assert.equal(stolenCookie.statusCode, 401);
  });
  it('invalid, tampered, staff and expired JWTs cannot be used as customer bearer', async () => {
    const claims = decodeJwt(first.headers.authorization.slice(7));
    const expired = await new SignJWT({
      ...claims,
      exp: Math.floor(Date.now() / 1000) - 1,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(getSecret());
    const badSignature = first.headers.authorization.slice(7).split('.');
    badSignature[2] =
      (badSignature[2][0] === 'a' ? 'b' : 'a') + badSignature[2].slice(1);
    for (const token of [
      'not-a-token',
      badSignature.join('.'),
      staff.cookie.split('=')[1],
      expired,
    ])
      assert.equal(
        (
          await send('GET', `/api/orders/${order1.id}`, first, undefined, {
            authorization: `Bearer ${token}`,
          })
        ).statusCode,
        401
      );
  });
  it('mixed credentials or invalid bearer never fall back to ambient staff cookies', async () => {
    for (const authorization of [
      first.headers.authorization,
      'Bearer invalid',
    ]) {
      assert.equal(
        (
          await send('GET', `/api/orders/${order1.id}`, null, undefined, {
            authorization,
            cookie: staff.cookie,
          })
        ).statusCode,
        403
      );
      assert.equal(
        (
          await send('GET', '/api/payments', null, undefined, {
            authorization,
            cookie: staff.cookie,
          })
        ).statusCode,
        403
      );
    }
  });
  it('staff uses live permissions rather than public resource-ID access', async () => {
    const res = await send(
      'POST',
      '/api/orders',
      null,
      orderInput(first.session.id),
      { cookie: staff.cookie }
    );
    assert.equal(res.statusCode, 201, res.body);
    const denied = await send(
      'POST',
      '/api/orders',
      null,
      orderInput(first.session.id),
      { cookie: kitchen.cookie }
    );
    assert.equal(denied.statusCode, 403);
    assert.equal(
      (
        await send('GET', `/api/orders/${order2.id}`, null, undefined, {
          cookie: staff.cookie,
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await send(
          'POST',
          '/api/payments',
          null,
          { amount: 1, method: 'CASH', orderId: order1.id },
          { cookie: kitchen.cookie }
        )
      ).statusCode,
      403
    );
  });
  it('own session can create/read orders and create/read only pending public payments', async () => {
    const res = await send('POST', '/api/orders', first, {
      items: [{ productId: a.product.id, quantity: 1 }],
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().order.tableSessionId, first.session.id);
    const id = res.json().order.id;
    assert.equal(
      (await send('GET', `/api/orders/${id}`, first)).statusCode,
      200
    );
    const payment = await send('POST', '/api/payments', first, {
      orderId: id,
      amount: 5,
      method: 'CASH',
    });
    assert.equal(payment.statusCode, 201, payment.body);
    assert.equal(payment.json().payment.status, 'PENDING');
    const detail = await send(
      'GET',
      `/api/payments/${payment.json().payment.id}`,
      first
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.headers['cache-control'], 'no-store');
    assert.equal(detail.json().payment.metadata, undefined);
  });
  it('cancellation is restricted to the own order and original time/status window', async () => {
    const res = await send(
      'POST',
      '/api/orders',
      first,
      orderInput(first.session.id)
    );
    const id = res.json().order.id;
    assert.equal(
      (await send('POST', `/api/orders/${id}/cancel`, first)).statusCode,
      200
    );
    const late = (await createOrder(a.store.id, orderInput(first.session.id)))
      .order;
    await query(
      "UPDATE orders SET created_at=now()-interval '1 hour' WHERE id=$1",
      [late.id]
    );
    assert.equal(
      (await send('POST', `/api/orders/${late.id}/cancel`, first)).statusCode,
      409
    );
  });
  it('full cart flow with two credentials for the same table preserves version/idempotency semantics', async () => {
    const fx = await makeCustomer(a.store);
    const secondBrowser = {
      headers: await customerHeaders(app, a.store, fx.table),
    };
    let res = await send(
      'POST',
      `/api/sessions/${fx.session.id}/cart/items`,
      fx,
      { productId: a.product.id, quantity: 1, expectedVersion: 0 }
    );
    assert.equal(res.statusCode, 201, res.body);
    const itemId = res.json().addedItemId;
    const stale = await send(
      'POST',
      `/api/sessions/${fx.session.id}/cart/items`,
      secondBrowser,
      { productId: a.product.id, quantity: 1, expectedVersion: 0 }
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'CART_VERSION_CONFLICT');
    res = await send(
      'PATCH',
      `/api/sessions/${fx.session.id}/cart/items/${itemId}`,
      secondBrowser,
      { quantity: 2, expectedVersion: 1 }
    );
    assert.equal(res.statusCode, 200, res.body);
    const body = { expectedVersion: 2, idempotencyKey: randomUUID() };
    const paid = await send(
      'POST',
      `/api/sessions/${fx.session.id}/cart/checkout`,
      fx,
      body
    );
    assert.equal(paid.statusCode, 201, paid.body);
    const retry = await send(
      'POST',
      `/api/sessions/${fx.session.id}/cart/checkout`,
      secondBrowser,
      body
    );
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().order.id, paid.json().order.id);
  });
  it('cart item IDs cannot cross sessions even when the path is the authorized session', async () => {
    const fx = await makeCustomer(a.store);
    const res = await send(
      'POST',
      `/api/sessions/${fx.session.id}/cart/items`,
      fx,
      { productId: a.product.id, quantity: 1, expectedVersion: 0 }
    );
    const itemId = res.json().addedItemId;
    for (const method of ['PATCH', 'DELETE'])
      assert.equal(
        (
          await send(
            method,
            `/api/sessions/${first.session.id}/cart/items/${itemId}`,
            first,
            { expectedVersion: 0, quantity: 1 }
          )
        ).statusCode,
        404
      );
    assert.equal(
      (
        await send(
          'DELETE',
          `/api/sessions/${fx.session.id}/cart/items/${itemId}`,
          fx,
          { expectedVersion: 1 }
        )
      ).statusCode,
      200
    );
  });
  it('payment replay is bound to targets, method and amount, never another table', async () => {
    const key = randomUUID();
    const body = {
      orderId: order1.id,
      amount: 2,
      method: 'CASH',
      idempotencyKey: key,
    };
    const one = await send('POST', '/api/payments', first, body);
    assert.equal(one.statusCode, 201, one.body);
    const again = await send('POST', '/api/payments', first, body);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().payment.id, one.json().payment.id);
    const cross = await send('POST', '/api/payments', second, {
      ...body,
      orderId: order2.id,
    });
    assert.equal(cross.statusCode, 409, cross.body);
    assert.equal(cross.json().payment, undefined);
    for (const patch of [
      { amount: 3 },
      { method: 'PIX' },
      { sessionId: first.session.id },
    ])
      assert.equal(
        (await send('POST', '/api/payments', first, { ...body, ...patch }))
          .statusCode,
        409
      );
  });
  it('simultaneous cross-session payment keys cannot leak either payment on conflict', async () => {
    const key = randomUUID();
    const one = {
      orderId: order1.id,
      amount: 1,
      method: 'CASH',
      idempotencyKey: key,
    };
    const results = await Promise.all([
      send('POST', '/api/payments', first, one),
      send('POST', '/api/payments', second, { ...one, orderId: order2.id }),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal(
      results.find((r) => r.statusCode === 409).json().payment,
      undefined
    );
  });
  it('both payment targets must belong to the same authorized table; malformed legacy rows stay hidden', async () => {
    for (const body of [
      { orderId: order1.id, sessionId: second.session.id },
      { orderId: order2.id, sessionId: first.session.id },
    ])
      assert.equal(
        (
          await send('POST', '/api/payments', first, {
            ...body,
            amount: 1,
            method: 'CASH',
          })
        ).statusCode,
        404
      );
    const mixed = (
      await query(
        `INSERT INTO payments(store_id,order_id,session_id,amount,method,status)
      VALUES($1,$2,$3,1,'CASH','PENDING') RETURNING id`,
        [a.store.id, order2.id, first.session.id]
      )
    ).rows[0];
    assert.equal(
      (await send('GET', `/api/payments/${mixed.id}`, first)).statusCode,
      404
    );
    assert.equal(
      (await send('GET', `/api/payments/${mixed.id}`, second)).statusCode,
      404
    );
  });
  it('table token cannot create delivery or read a delivery order through generic endpoints', async () => {
    assert.equal(
      (
        await send('POST', '/api/orders', first, {
          ...orderInput(first.session.id),
          channel: 'DELIVERY',
        })
      ).statusCode,
      403
    );
    const delivery = (
      await createOrder(a.store.id, {
        ...orderInput(null),
        channel: 'DELIVERY',
      })
    ).order;
    assert.equal(
      (await send('GET', `/api/orders/${delivery.id}`, first)).statusCode,
      404
    );
    assert.equal(
      (
        await send('POST', '/api/payments', first, {
          orderId: delivery.id,
          amount: 1,
          method: 'CASH',
        })
      ).statusCode,
      404
    );
  });
  it('delivery null-session replay cannot return a table order (or the reverse)', async () => {
    const key = randomUUID();
    await createOrder(a.store.id, {
      ...orderInput(first.session.id),
      idempotencyKey: key,
    });
    await assert.rejects(
      createOrder(a.store.id, {
        ...orderInput(null),
        channel: 'DELIVERY',
        idempotencyKey: key,
      }),
      (e) => e.code === 'IDEMPOTENCY_KEY_REUSED'
    );
    // Public delivery checkout must not be an alternate table-order replay path.
    const { createZone } = await import(
      '../../src/modules/delivery/delivery.repository.js'
    );
    const zone = await createZone(a.store.id, {
      name: 'Customer scope zone',
      fee: 0,
    });
    const deliveryAttempt = await send('POST', '/api/delivery/orders', null, {
      zoneId: zone.id,
      customerName: 'Delivery',
      address: { street: 'Rua', city: 'Itajaí' },
      items: [{ productId: a.product.id, quantity: 1 }],
      idempotencyKey: key,
    });
    assert.equal(deliveryAttempt.statusCode, 409, deliveryAttempt.body);
    assert.equal(deliveryAttempt.json().order, undefined);
    assert.equal(
      (await send('GET', `/api/delivery/orders/${order1.id}`, null)).statusCode,
      404
    );
    const otherKey = randomUUID();
    await createOrder(a.store.id, {
      ...orderInput(null),
      channel: 'DELIVERY',
      idempotencyKey: otherKey,
    });
    const denied = await send('POST', '/api/orders', first, {
      ...orderInput(first.session.id),
      idempotencyKey: otherKey,
    });
    assert.equal(denied.statusCode, 409);
    assert.equal(denied.json().order, undefined);
  });
  it('closing a session revokes read/write/replay; reopening the same table does not revive the old token', async () => {
    const fx = await makeCustomer(a.store);
    const key = randomUUID();
    const created = await send('POST', '/api/orders', fx, {
      ...orderInput(fx.session.id),
      idempotencyKey: key,
    });
    assert.equal(created.statusCode, 201);
    await closeSession(a.store.id, fx.session.id);
    for (const [method, url, body] of [
      ['GET', `/api/orders/${created.json().order.id}`],
      ['GET', `/api/sessions/${fx.session.id}/cart`],
      [
        'POST',
        '/api/orders',
        { ...orderInput(fx.session.id), idempotencyKey: key },
      ],
      [
        'POST',
        '/api/payments',
        { orderId: created.json().order.id, amount: 1, method: 'CASH' },
      ],
    ])
      assert.equal((await send(method, url, fx, body)).statusCode, 409, url);
    const newHeaders = await customerHeaders(app, a.store, fx.table);
    const newSession = decodeJwt(newHeaders.authorization.slice(7));
    assert.notEqual(newSession.sessionId, fx.session.id);
    assert.equal(
      (
        await send('GET', `/api/orders/${created.json().order.id}`, {
          headers: newHeaders,
        })
      ).statusCode,
      404
    );
    assert.equal(
      (await send('GET', `/api/sessions/${newSession.sessionId}/cart`, fx))
        .statusCode,
      409
    );
  });
  it('expired/marked-expired sessions revoke credentials while remaining open for the cashier', async () => {
    for (const mode of ['age', 'marker']) {
      const fx = await makeCustomer(a.store);
      if (mode === 'age')
        await query(
          "UPDATE table_sessions SET opened_at=now()-($2::bigint * interval '1 millisecond') WHERE id=$1",
          [fx.session.id, SESSION_TTL_MS + 1000]
        );
      else
        await query('UPDATE table_sessions SET expired_at=now() WHERE id=$1', [
          fx.session.id,
        ]);
      const res = await send('GET', `/api/sessions/${fx.session.id}/cart`, fx);
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'CUSTOMER_SESSION_EXPIRED');
    }
  });
  it('QR rotation/table deactivation revokes all issued customer credentials', async () => {
    const fx = await makeCustomer(a.store);
    await regenerateTableToken(a.store.id, fx.table.id);
    assert.equal(
      (await send('GET', `/api/sessions/${fx.session.id}/cart`, fx)).statusCode,
      401
    );
    const secondFx = await makeCustomer(a.store);
    await query('UPDATE tables SET is_active=false WHERE id=$1', [
      secondFx.table.id,
    ]);
    assert.equal(
      (
        await send(
          'POST',
          '/api/orders',
          secondFx,
          orderInput(secondFx.session.id)
        )
      ).statusCode,
      401
    );
  });
  it('writes revalidate session state inside their transaction after a concurrent close', async () => {
    const fx = await makeCustomer(a.store);
    // Simulate a request that already passed the HTTP guard before closing.
    const claims = fx.customer;
    await closeSession(a.store.id, fx.session.id);
    const { addCartItem, checkoutCart } = await import(
      '../../src/modules/tables/cart.repository.js'
    );
    const { cancelOrderAsCustomer } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const writes = [
      () =>
        createOrder(a.store.id, orderInput(fx.session.id), {
          customer: claims,
        }),
      () =>
        createPayment(
          a.store.id,
          { sessionId: fx.session.id, amount: 1, method: 'CASH' },
          { customer: claims }
        ),
      () =>
        addCartItem(
          a.store.id,
          fx.session.id,
          { productId: a.product.id, quantity: 1, expectedVersion: 0 },
          { customer: claims }
        ),
      () =>
        checkoutCart(a.store.id, fx.session.id, {
          expectedVersion: 0,
          customer: claims,
        }),
      () => cancelOrderAsCustomer(a.store.id, order1.id, { customer: claims }),
    ];
    for (const write of writes)
      await assert.rejects(write, (e) => e.code === 'SESSION_CLOSED');
  });
  it('customer payment waiting on a closing transaction must fail, with no inserted payment', async () => {
    const fx = await makeCustomer(a.store);
    const client = await pool.connect();
    const key = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE table_sessions SET status='closed' WHERE id=$1",
        [fx.session.id]
      );
      const write = createPayment(
        a.store.id,
        {
          sessionId: fx.session.id,
          amount: 1,
          method: 'CASH',
          idempotencyKey: key,
        },
        { customer: fx.customer }
      );
      const rejected = assert.rejects(
        write,
        (e) => e.code === 'SESSION_CLOSED'
      );
      await client.query('COMMIT');
      await rejected;
      assert.equal(
        (await query('SELECT id FROM payments WHERE idempotency_key=$1', [key]))
          .rows.length,
        0
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('log serializers never expose QR or bearer credentials', async () => {
    const logs = [];
    const loggingApp = await buildApp({
      logger: { level: 'info', stream: { write: (chunk) => logs.push(chunk) } },
    });
    try {
      const res = await loggingApp.inject({
        method: 'GET',
        url: `/api/tables/by-token/${first.table.public_token}`,
        headers: { host: `${a.store.slug}.localhost` },
      });
      assert.equal(res.statusCode, 200);
      await loggingApp.inject({
        method: 'GET',
        url: `/api/orders/${order1.id}`,
        headers: first.headers,
      });
      const log = logs.join('');
      assert.ok(log.includes('[redacted]'));
      assert.ok(!log.includes(first.table.public_token));
      assert.ok(!log.includes(first.headers.authorization.slice(7)));
    } finally {
      await loggingApp.close();
    }
  });
});
