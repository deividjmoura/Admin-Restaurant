/**
 * Credencial própria por checkout de delivery (migration 0024).
 *
 * Cobre: emissão por checkout (não por loja/ID), tracking/cancelamento/
 * pagamentos protegidos, isolamento loja↔loja, checkout↔checkout, mesa/QR↔
 * delivery, staff↔customer, replay seguro (idempotência e re-emissão pós-
 * rotação), revogação/validação viva em transação e frete no saldo de pagamento.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { buildApp } from '../../src/app.js';
import { pool, query } from '../../src/infrastructure/db.js';
import { getSecret } from '../../src/modules/auth/session.js';
import { createZone } from '../../src/modules/delivery/delivery.repository.js';
import { verifyCustomerSession } from '../../src/modules/customer/customer-session.js';
import { verifyDeliveryCheckout } from '../../src/modules/delivery/delivery-checkout.js';
import {
  hasDatabase,
  makeStoreWithProduct,
  makeTableSession,
  makeUserWithRole,
  customerHeaders,
  dropStores,
} from '../helpers/fixtures.js';

const digest = (value) =>
  createHash('sha256').update(value).digest('hex');

describe(
  'delivery checkout authorization',
  { skip: !hasDatabase() },
  () => {
    let app;
    let A; // store A: produto a 20, zona com frete 5
    let B; // store B: isolamento entre lojas
    let zoneA;
    let zoneB;
    const allUsers = [];
    let tableNumber = 40;

    const host = (fx) => `${fx.store.slug}.localhost`;
    const zoneFor = (fx) => (fx === A ? zoneA : zoneB);

    const createCheckout = async (
      fx,
      {
        key = randomUUID(),
        zone = null,
        items = null,
        customerName = 'Cliente Teste',
        address = null,
      } = {}
    ) =>
      app.inject({
        method: 'POST',
        url: '/api/delivery/orders',
        headers: { host: host(fx) },
        payload: {
          zoneId: (zone ?? zoneFor(fx)).id,
          customerName,
          address: address ?? { street: 'Rua das Oliveiras', city: 'Itajaí' },
          items: items ?? [{ productId: fx.product.id, quantity: 1 }],
          idempotencyKey: key,
        },
      });

    /** Checkout completo: ordem criada + credencial utilizável. */
    const newCheckout = async (fx, opts = {}) => {
      const key = opts.key ?? randomUUID();
      const res = await createCheckout(fx, { ...opts, key });
      if (res.statusCode !== 201)
        throw new Error(`checkout failed: ${res.statusCode} ${res.body}`);
      const body = res.json();
      return {
        key,
        orderId: body.order.id,
        token: body.customerSession.token,
        body,
      };
    };

    const api = (method, url, token, headers = {}, payload) =>
      app.inject({
        method,
        url,
        headers: {
          host: host(A),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(payload === undefined ? {} : { payload }),
      });

    before(async () => {
      app = await buildApp({ logger: false });
      A = await makeStoreWithProduct({ price: 20 });
      B = await makeStoreWithProduct({ price: 20 });
      zoneA = await createZone(A.store.id, {
        name: 'Centro',
        fee: 5,
        minOrderAmount: 0,
      });
      zoneB = await createZone(B.store.id, { name: 'Centro B', fee: 0 });
    });

    after(async () => {
      await app?.close();
      await dropStores(A?.store.id, B?.store.id);
      await query('DELETE FROM users WHERE id=ANY($1::uuid[])', [allUsers]);
      await pool.end();
    });

    it('creation issues a per-checkout credential; resource IDs alone authorize nothing', async () => {
      const checkout = await newCheckout(A);
      const claims = decodeJwt(checkout.token);
      assert.equal(claims.type, 'customer');
      assert.equal(claims.kind, 'delivery');
      assert.equal(claims.storeId, A.store.id);
      assert.equal(claims.orderId, checkout.orderId);
      assert.equal(claims.role, undefined);
      assert.equal(claims.sub, undefined);
      const created = new Date(checkout.body.order.createdAt).getTime();
      assert.ok(claims.exp * 1000 > created);
      assert.ok(claims.exp * 1000 <= created + 24 * 3600 * 1000 + 1500);

      const tracking = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        checkout.token
      );
      assert.equal(tracking.statusCode, 200, tracking.body);
      assert.equal(tracking.headers['cache-control'], 'no-store');
      assert.equal(tracking.json().order.id, checkout.orderId);

      for (const [method, url] of [
        ['GET', `/api/delivery/orders/${checkout.orderId}`],
        ['POST', `/api/delivery/orders/${checkout.orderId}/cancel`],
      ]) {
        const anon = await api(method, url, null);
        assert.equal(anon.statusCode, 401, `${method} ${url}: ${anon.body}`);
        const uuidAsBearer = await api(method, url, null, {
          authorization: `Bearer ${checkout.orderId}`,
        });
        assert.equal(uuidAsBearer.statusCode, 401);
      }
      const anonPay = await api(
        'POST',
        '/api/payments',
        null,
        {},
        { orderId: checkout.orderId, amount: 5, method: 'CASH' }
      );
      assert.equal(anonPay.statusCode, 401);
    });

    it('table and delivery credentials are distinct planes: neither verifies in the other', async () => {
      const checkout = await newCheckout(A);
      const fx = await makeTableSession(A.store.id, { number: tableNumber++ });
      const qr = await customerHeaders(app, A.store, fx.table);
      const tableToken = qr.authorization.slice(7);

      // Assinados com o mesmo segredo, mas issuer/audience/claims próprios.
      await assert.rejects(
        verifyDeliveryCheckout(tableToken),
        (err) => err.code === 'CUSTOMER_UNAUTHORIZED'
      );
      await assert.rejects(
        verifyCustomerSession(checkout.token),
        (err) => err.code === 'CUSTOMER_UNAUTHORIZED'
      );
      const deliveryClaims = await verifyDeliveryCheckout(checkout.token);
      assert.equal(deliveryClaims.orderId, checkout.orderId);
      assert.equal(deliveryClaims.sessionId, undefined);
    });

    it('other checkout in the same store stays hidden on tracking, cancel and payment', async () => {
      const mine = await newCheckout(A);
      const theirs = await newCheckout(A);
      const { createPayment } = await import(
        '../../src/modules/payments/payments.repository.js'
      );
      const theirPay = (
        await createPayment(A.store.id, {
          orderId: theirs.orderId,
          amount: 5,
          method: 'CASH',
        })
      ).payment;

      const attempts = [
        ['GET', `/api/delivery/orders/${theirs.orderId}`],
        ['POST', `/api/delivery/orders/${theirs.orderId}/cancel`],
        [
          'POST',
          '/api/payments',
          { orderId: theirs.orderId, amount: 5, method: 'CASH' },
        ],
        ['GET', `/api/payments/${theirPay.id}`],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await api(method, url, mine.token, {}, payload);
        assert.equal(res.statusCode, 404, `${method} ${url}: ${res.body}`);
        assert.equal(res.json().payment, undefined);
      }
    });

    it('table credential cannot operate the delivery checkout plane', async () => {
      const fx = await makeTableSession(A.store.id, { number: tableNumber++ });
      const qr = await customerHeaders(app, A.store, fx.table);
      const tableOrder = (
        await app.inject({
          method: 'POST',
          url: '/api/orders',
          headers: { host: host(A), authorization: qr.authorization },
          payload: { items: [{ productId: A.product.id, quantity: 1 }] },
        })
      ).json().order;

      for (const [method, url] of [
        ['GET', `/api/delivery/orders/${tableOrder.id}`],
        ['POST', `/api/delivery/orders/${tableOrder.id}/cancel`],
      ]) {
        const res = await api(method, url, qr.authorization.slice(7));
        assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
        assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');
      }
    });

    it('delivery credential cannot reach table/cart surfaces, not even for its own order', async () => {
      const checkout = await newCheckout(A);
      const fx = await makeTableSession(A.store.id, { number: tableNumber++ });

      const attempts = [
        ['GET', `/api/orders/${checkout.orderId}`],
        ['POST', `/api/orders/${checkout.orderId}/cancel`],
        ['GET', `/api/sessions/${fx.session.id}/cart`],
        [
          'POST',
          `/api/sessions/${fx.session.id}/cart/items`,
          { productId: A.product.id, quantity: 1, expectedVersion: 0 },
        ],
        [
          'POST',
          '/api/orders',
          {
            channel: 'TABLE',
            items: [{ productId: A.product.id, quantity: 1 }],
          },
        ],
        [
          'POST',
          '/api/payments',
          { sessionId: fx.session.id, amount: 1, method: 'CASH' },
        ],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await api(method, url, checkout.token, {}, payload);
        assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
        assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');
      }
      // O saldo do PRÓPRIO checkout continua acessível pelo canal do delivery.
      const own = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        checkout.token
      );
      assert.equal(own.statusCode, 200);
    });

    it('a store-B host rejects store-A checkout credentials before touching any order', async () => {
      const checkout = await newCheckout(A);
      const res = await app.inject({
        method: 'GET',
        url: `/api/delivery/orders/${checkout.orderId}`,
        headers: { host: host(B), authorization: `Bearer ${checkout.token}` },
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');

      const checkoutB = await createCheckout(B);
      assert.equal(checkoutB.statusCode, 201);
      // Token válido no host dele, alvo de outra loja: ocultação por 404 —
      // igual à política das demais superfícies customer (nada de 403 que
      // confirma existência do ID).
      const crossOrder = await app.inject({
        method: 'GET',
        url: `/api/delivery/orders/${checkoutB.json().order.id}`,
        headers: { host: host(A), authorization: `Bearer ${checkout.token}` },
      });
      assert.equal(crossOrder.statusCode, 404);
    });

    it('mixing a checkout bearer with a staff cookie is refused on every delivery surface', async () => {
      const checkout = await newCheckout(A);
      const owner = await makeUserWithRole(A.store.id, { role: 'OWNER' });
      allUsers.push(owner.user.id);
      const attempts = [
        ['GET', `/api/delivery/orders/${checkout.orderId}`],
        ['POST', `/api/delivery/orders/${checkout.orderId}/cancel`],
        ['POST', `/api/delivery/orders/${checkout.orderId}/credential/revoke`],
      ];
      for (const [method, url] of attempts) {
        const res = await api(method, url, checkout.token, {
          cookie: owner.cookie,
        });
        assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
        assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');
      }
    });

    it('staff tracks with permission only and role gates decide who cancels', async () => {
      const checkout = await newCheckout(A);
      const owner = await makeUserWithRole(A.store.id, { role: 'OWNER' });
      const kitchen = await makeUserWithRole(A.store.id, { role: 'KITCHEN' });
      allUsers.push(owner.user.id, kitchen.user.id);

      const tracked = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        null,
        { cookie: owner.cookie }
      );
      assert.equal(tracked.statusCode, 200, tracked.body);
      assert.equal(tracked.json().delivery.address.street, 'Rua das Oliveiras');

      const kitchenCancel = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/cancel`,
        null,
        { cookie: kitchen.cookie }
      );
      assert.equal(kitchenCancel.statusCode, 403);

      const ownerCancel = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/cancel`,
        null,
        { cookie: owner.cookie }
      );
      assert.equal(ownerCancel.statusCode, 200, ownerCancel.body);
      assert.equal(ownerCancel.json().order.status, 'CANCELLED');
    });

    it('staff-only payment operations stay closed to the checkout credential', async () => {
      const checkout = await newCheckout(A);
      const { createPayment } = await import(
        '../../src/modules/payments/payments.repository.js'
      );
      const pay = (
        await createPayment(A.store.id, {
          orderId: checkout.orderId,
          amount: 5,
          method: 'CASH',
        })
      ).payment;
      for (const suffix of ['confirm', 'refund']) {
        const res = await api(
          'POST',
          `/api/payments/${pay.id}/${suffix}`,
          checkout.token
        );
        assert.equal(res.statusCode, 403);
        assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');
      }
      const revoke = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/credential/revoke`,
        checkout.token
      );
      assert.equal(revoke.statusCode, 403);
    });

    it('same-key replay returns the same order with a fresh working credential; a different key is a different order', async () => {
      const key = randomUUID();
      const first = await createCheckout(A, { key });
      assert.equal(first.statusCode, 201);
      const replay = await createCheckout(A, { key });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.json().replayed, true);
      assert.equal(replay.json().order.id, first.json().order.id);
      const replayToken = replay.json().customerSession.token;
      assert.ok(replayToken);
      const ok = await api(
        'GET',
        `/api/delivery/orders/${first.json().order.id}`,
        replayToken
      );
      assert.equal(ok.statusCode, 200, ok.body);
      const second = await createCheckout(A, {});
      assert.equal(second.statusCode, 201);
      assert.notEqual(second.json().order.id, first.json().order.id);
    });

    it('an idempotency key born in a checkout never replays through the table endpoint', async () => {
      const key = randomUUID();
      const checkout = await createCheckout(A, { key });
      assert.equal(checkout.statusCode, 201);
      const fx = await makeTableSession(A.store.id, { number: tableNumber++ });
      const qr = await customerHeaders(app, A.store, fx.table);
      const hijack = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { host: host(A), authorization: qr.authorization },
        payload: {
          tableSessionId: fx.session.id,
          items: [{ productId: A.product.id, quantity: 1 }],
          idempotencyKey: key,
        },
      });
      assert.equal(hijack.statusCode, 409, hijack.body);
      assert.equal(hijack.json().order, undefined);
      assert.equal(hijack.json().replayed, undefined);
    });

    it('payment replay keeps strict target equality across checkouts', async () => {
      const mine = await newCheckout(A);
      const theirs = await newCheckout(A);
      const key = randomUUID();
      const p1 = await api(
        'POST',
        '/api/payments',
        mine.token,
        { 'idempotency-key': key },
        { orderId: mine.orderId, amount: 10, method: 'CASH', idempotencyKey: key }
      );
      assert.equal(p1.statusCode, 201, p1.body);
      const replay = await api(
        'POST',
        '/api/payments',
        mine.token,
        { 'idempotency-key': key },
        { orderId: mine.orderId, amount: 10, method: 'CASH', idempotencyKey: key }
      );
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.json().replayed, true);
      assert.equal(replay.json().payment.id, p1.json().payment.id);

      const otherAmount = await api(
        'POST',
        '/api/payments',
        mine.token,
        { 'idempotency-key': key },
        { orderId: mine.orderId, amount: 11, method: 'CASH', idempotencyKey: key }
      );
      assert.equal(otherAmount.statusCode, 409);
      assert.equal(otherAmount.json().payment, undefined);

      // A chave do checkout alheio também não atravessa para o checkout próprio.
      const crossOrder = await api(
        'POST',
        '/api/payments',
        theirs.token,
        { 'idempotency-key': key },
        { orderId: theirs.orderId, amount: 10, method: 'CASH', idempotencyKey: key }
      );
      assert.equal(crossOrder.statusCode, 409, crossOrder.body);
      assert.equal(crossOrder.json().payment, undefined);
    });

    it('freight joins the payable balance and only confirmed payments shrink it', async () => {
      const checkout = await newCheckout(A); // 20 itens + 5 de frete
      const over = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 25.01, method: 'CASH' }
      );
      assert.equal(over.statusCode, 409, over.body);
      assert.match(over.json().error.message, /25\.00/);

      const partial = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 10, method: 'CASH' }
      );
      assert.equal(partial.statusCode, 201, partial.body);

      // PENDING não reduz saldo (anti-DoS): ainda não dá para "reservar" o valor.
      const stillFull = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 25.01, method: 'CASH' }
      );
      assert.equal(stillFull.statusCode, 409);

      const owner = await makeUserWithRole(A.store.id, { role: 'OWNER' });
      allUsers.push(owner.user.id);
      const confirmed = await api(
        'POST',
        `/api/payments/${partial.json().payment.id}/confirm`,
        null,
        { cookie: owner.cookie }
      );
      assert.equal(confirmed.statusCode, 200, confirmed.body);

      const overNewDue = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 15.01, method: 'CASH' }
      );
      assert.equal(overNewDue.statusCode, 409);
      const settle = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 15, method: 'CASH' }
      );
      assert.equal(settle.statusCode, 201, settle.body);

      const { amountDue } = await import(
        '../../src/modules/payments/payments.repository.js'
      );
      const due = await amountDue(A.store.id, { orderId: checkout.orderId });
      assert.equal(due.itemsTotal, 20);
      assert.equal(due.deliveryFee, 5);
      assert.equal(due.paidTotal, 10);
      assert.equal(due.due, 15);

      // Sessão de mesa continua com saldo só de itens: frete não vaza para lá.
      const fx = await makeTableSession(A.store.id, { number: tableNumber++ });
      const tableDue = await amountDue(A.store.id, {
        sessionId: fx.session.id,
      });
      assert.equal(tableDue.itemsTotal, 0);
      assert.equal(tableDue.deliveryFee, 0);
      assert.equal(tableDue.due, 0);
    });

    it('the customer can pay and read its own payment in the public shape only', async () => {
      const mine = await newCheckout(A);
      const created = await api(
        'POST',
        '/api/payments',
        mine.token,
        {},
        { orderId: mine.orderId, amount: 25, method: 'CASH' }
      );
      assert.equal(created.statusCode, 201, created.body);
      const paymentId = created.json().payment.id;
      const read = await api('GET', `/api/payments/${paymentId}`, mine.token);
      assert.equal(read.statusCode, 200);
      assert.deepEqual(
        Object.keys(read.json().payment).sort(),
        ['amount', 'id', 'method', 'pixCopyPaste', 'status']
      );
      const other = await newCheckout(A);
      const peek = await api('GET', `/api/payments/${paymentId}`, other.token);
      assert.equal(peek.statusCode, 404);
    });

    it('cancellation follows the table window rules and a terminal checkout stops authorizing', async () => {
      const fresh = await newCheckout(A);
      const cancelled = await api(
        'POST',
        `/api/delivery/orders/${fresh.orderId}/cancel`,
        fresh.token
      );
      assert.equal(cancelled.statusCode, 200, cancelled.body);

      // Checkout terminal: a credencial não lê, não cancela e não paga mais.
      const tracking = await api(
        'GET',
        `/api/delivery/orders/${fresh.orderId}`,
        fresh.token
      );
      assert.equal(tracking.statusCode, 409);
      assert.equal(tracking.json().error.code, 'DELIVERY_CHECKOUT_CLOSED');
      const pay = await api(
        'POST',
        '/api/payments',
        fresh.token,
        {},
        { orderId: fresh.orderId, amount: 25, method: 'CASH' }
      );
      assert.equal(pay.statusCode, 409);

      const late = await newCheckout(A);
      await query(
        "UPDATE orders SET created_at = now() - interval '1 hour' WHERE id=$1",
        [late.orderId]
      );
      const windowClosed = await api(
        'POST',
        `/api/delivery/orders/${late.orderId}/cancel`,
        late.token
      );
      assert.equal(windowClosed.statusCode, 409, windowClosed.body);
      assert.equal(windowClosed.json().error.code, 'CANCEL_WINDOW_EXPIRED');
    });

    it('rotation revokes every outstanding credential and the original key reissues access', async () => {
      const key = randomUUID();
      const checkout = await newCheckout(A, { key });
      const owner = await makeUserWithRole(A.store.id, { role: 'OWNER' });
      allUsers.push(owner.user.id);

      const revoked = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/credential/revoke`,
        null,
        { cookie: owner.cookie }
      );
      assert.equal(revoked.statusCode, 200, revoked.body);
      const dead = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        checkout.token
      );
      assert.equal(dead.statusCode, 401);
      assert.match(dead.json().error.message, /revogada/i);
      const deadPay = await api(
        'POST',
        '/api/payments',
        checkout.token,
        {},
        { orderId: checkout.orderId, amount: 1, method: 'CASH' }
      );
      assert.equal(deadPay.statusCode, 401);

      const recovery = await createCheckout(A, { key });
      assert.equal(recovery.statusCode, 200);
      const newToken = recovery.json().customerSession.token;
      assert.ok(newToken);
      const alive = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        newToken
      );
      assert.equal(alive.statusCode, 200, alive.body);

      // Pedido legado (sem segredo) não ganha credencial por mágica: o replay
      // devolve o recibo com customerSession nulo.
      await query(
        'UPDATE delivery_orders SET checkout_token = NULL WHERE order_id=$1',
        [checkout.orderId]
      );
      const legacy = await createCheckout(A, { key });
      assert.equal(legacy.statusCode, 200);
      assert.equal(legacy.json().customerSession, null);
    });

    it('a live credential dies at created_at + TTL even while the JWT itself is valid', async () => {
      const checkout = await newCheckout(A);
      await query(
        "UPDATE orders SET created_at = now() - interval '25 hours' WHERE id=$1",
        [checkout.orderId]
      );
      const { rows } = await query(
        'SELECT checkout_token FROM delivery_orders WHERE order_id=$1',
        [checkout.orderId]
      );
      const forged = await new SignJWT({
        type: 'customer',
        kind: 'delivery',
        storeId: A.store.id,
        orderId: checkout.orderId,
        checkoutHash: digest(rows[0].checkout_token),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('restaurant:delivery')
        .setAudience('restaurant:delivery-customer')
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
        .sign(getSecret());
      const res = await api(
        'GET',
        `/api/delivery/orders/${checkout.orderId}`,
        forged
      );
      assert.equal(res.statusCode, 401, res.body);
      assert.equal(res.json().error.code, 'CUSTOMER_SESSION_EXPIRED');

      // Recibo continua disponível por replay — mas sem credencial nova.
      const receipt = await createCheckout(A, { key: checkout.key });
      assert.equal(receipt.statusCode, 200);
      assert.equal(receipt.json().customerSession, null);
    });

    it('failed checkouts are atomic and the response never carries the credential secret', async () => {
      const bogusKey = randomUUID();
      const bogus = await createCheckout(A, {
        key: bogusKey,
        items: [{ productId: randomUUID(), quantity: 1 }],
      });
      // 400: política atual do mapa de erros de criação delivery (DeliveryError
      // de produto não vira 404 enumerável em rota anônima de criação).
      assert.equal(bogus.statusCode, 400, bogus.body);
      assert.equal(bogus.json().error.code, 'PRODUCT_NOT_FOUND');

      const minKey = randomUUID();
      const farZone = await createZone(A.store.id, {
        name: 'Distante',
        fee: 12,
        minOrderAmount: 60,
      });
      const belowMin = await createCheckout(A, { key: minKey, zone: farZone });
      assert.equal(belowMin.statusCode, 409, belowMin.body);
      assert.match(belowMin.json().error.message, /m[ií]nimo/);

      const { rows: orphans } = await query(
        `SELECT o.id FROM orders o
         WHERE o.store_id=$1 AND o.idempotency_key = ANY($2::text[])`,
        [A.store.id, [bogusKey, minKey]]
      );
      assert.equal(orphans.length, 0, 'nenhum pedido órfão sobrevive ao rollback');

      const ok = await newCheckout(A);
      const { rows: tokenRows } = await query(
        'SELECT checkout_token FROM delivery_orders WHERE order_id=$1',
        [ok.orderId]
      );
      const secret = tokenRows[0].checkout_token;
      assert.match(secret, /^[a-f0-9]{32}$/);
      assert.equal(JSON.stringify(ok.body).includes(secret), false);
      const tracked = await api(
        'GET',
        `/api/delivery/orders/${ok.orderId}`,
        ok.token
      );
      assert.equal(JSON.stringify(tracked.json()).includes(secret), false);
    });

    it('audit trail records creation, revocation and cancellation without leaking the secret', async () => {
      const key = randomUUID();
      const checkout = await newCheckout(A, { key });
      const owner = await makeUserWithRole(A.store.id, { role: 'OWNER' });
      allUsers.push(owner.user.id);
      const { rows: tokenRows } = await query(
        'SELECT checkout_token FROM delivery_orders WHERE order_id=$1',
        [checkout.orderId]
      );
      const revoked = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/credential/revoke`,
        null,
        { cookie: owner.cookie }
      );
      assert.equal(revoked.statusCode, 200);
      const replay = await createCheckout(A, { key });
      assert.equal(replay.statusCode, 200);
      const cancelled = await api(
        'POST',
        `/api/delivery/orders/${checkout.orderId}/cancel`,
        replay.json().customerSession.token
      );
      assert.equal(cancelled.statusCode, 200, cancelled.body);

      const { rows } = await query(
        `SELECT action, metadata::text AS meta FROM audit_logs
         WHERE store_id=$1 AND resource_id=$2
           AND action = ANY($3::text[])`,
        [
          A.store.id,
          checkout.orderId,
          [
            'delivery.order_created',
            'delivery.checkout_revoked',
            'delivery.order_cancelled',
          ],
        ]
      );
      const actions = new Set(rows.map((r) => r.action));
      assert.ok(actions.has('delivery.order_created'), 'criação auditada');
      assert.ok(actions.has('delivery.checkout_revoked'), 'revogação auditada');
      assert.ok(
        actions.has('delivery.order_cancelled'),
        'cancelamento auditado'
      );
      assert.ok(rows.length > 0);
      for (const row of rows) {
        assert.equal(row.meta.includes(tokenRows[0].checkout_token), false);
        assert.equal(row.meta.includes('Bearer'), false);
      }
    });
  }
);
