import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerClient } from '../../frontend/src/api/customer-session.js';

function fixture() {
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  let now = 1000,
    session = 'session-1',
    failure = null;
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/api/tables/by-token/')) {
      const qr = path.split('/').at(-1);
      return {
        session: { id: `${qr}:${session}`, cartVersion: 3 },
        customerSession: {
          token: `${qr}:secret`,
          expiresAt: new Date(now + 5000).toISOString(),
        },
      };
    }
    if (failure) throw failure;
    return { ok: true };
  };
  return {
    storage,
    calls,
    client: createCustomerClient({ api, storage, now: () => now }),
    advance: () => {
      now += 6000;
    },
    reopen: () => {
      session = 'session-2';
    },
    fail: (err) => {
      failure = err;
    },
  };
}

describe('customer browser credential transport', () => {
  it('QR exchange and resource requests omit staff cookies; bearer is only in the header', async () => {
    const f = fixture();
    await f.client.request('qr-a', '/api/orders/order-1', {
      method: 'GET',
      credentials: 'include',
    });
    assert.equal(f.calls[0].options.credentials, 'omit');
    assert.equal(f.calls[0].options.headers, undefined);
    assert.equal(f.calls[1].options.credentials, 'omit');
    assert.equal(
      f.calls[1].options.headers.Authorization,
      'Bearer qr-a:secret'
    );
    assert.ok(!f.calls[1].path.includes('secret'));
  });
  it('two QR codes in one tab never share credentials/session IDs', async () => {
    const f = fixture();
    await f.client.request('qr-a', '/api/orders/1');
    await f.client.request('qr-b', '/api/orders/2');
    await f.client.request('qr-a', '/api/orders/3');
    assert.equal(
      f.calls.at(-1).options.headers.Authorization,
      'Bearer qr-a:secret'
    );
    assert.equal(f.storage.getItem('table:qr-a:sessionId'), 'qr-a:session-1');
    assert.equal(f.storage.getItem('table:qr-b:sessionId'), 'qr-b:session-1');
    assert.equal(f.storage.getItem('sessionId'), null);
  });
  it('an expired token is renewed for the SAME session before the next request', async () => {
    const f = fixture();
    await f.client.ensure('qr');
    f.advance();
    await f.client.request('qr', '/api/orders/1');
    assert.equal(f.calls.filter((c) => c.path.includes('by-token')).length, 2);
    assert.equal(f.calls.filter((c) => c.path === '/api/orders/1').length, 1);
  });
  it('automatic renewal cannot silently send an old cart to a reopened session', async () => {
    const f = fixture();
    await f.client.ensure('qr');
    f.advance();
    f.reopen();
    await assert.rejects(
      f.client.request('qr', '/api/orders', { method: 'POST' }),
      /nova sessão/
    );
    assert.equal(f.calls.filter((c) => c.path === '/api/orders').length, 0);
    assert.equal(f.storage.getItem('table:qr:sessionId'), null);
    await assert.rejects(f.client.ensure('qr'), /Sessão encerrada/);
    await f.client.exchange('qr'); // deliberate new QR entry only
    assert.equal((await f.client.ensure('qr')).id, 'qr:session-2');
  });
  it('closed/revoked credentials are cleared; mutations are never automatically retried', async () => {
    for (const code of [
      'SESSION_CLOSED',
      'CUSTOMER_SESSION_EXPIRED',
      'CUSTOMER_UNAUTHORIZED',
    ]) {
      const f = fixture();
      f.fail(Object.assign(new Error('Revoked'), { code }));
      await assert.rejects(
        f.client.request('qr', '/api/orders', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'same-key' },
        })
      );
      assert.equal(f.calls.filter((c) => c.path === '/api/orders').length, 1);
      assert.equal(f.storage.getItem('table:qr:sessionId'), null);
      await assert.rejects(f.client.ensure('qr'), /Sessão encerrada/);
    }
  });
  it('network failure preserves credentials and caller idempotency key for a deliberate retry', async () => {
    const f = fixture();
    f.fail(Object.assign(new Error('offline'), { status: 0 }));
    const options = {
      method: 'POST',
      headers: { 'Idempotency-Key': 'retry-key' },
    };
    await assert.rejects(f.client.request('qr', '/api/orders', options));
    f.fail(null);
    await f.client.request('qr', '/api/orders', options);
    assert.equal(
      f.calls.at(-1).options.headers['Idempotency-Key'],
      'retry-key'
    );
    assert.equal(f.calls.filter((c) => c.path.includes('by-token')).length, 1);
  });
});
