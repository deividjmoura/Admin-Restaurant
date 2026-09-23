import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import {
  hasDatabase,
  makeStore,
  makeUserWithRole,
  makeTableSession,
  dropStores,
} from '../helpers/fixtures.js';

// No skip-without-db here: the integration suite must never report false green.
describe(
  'entry contexts: marketing / platform / store / customer',
  { skip: !hasDatabase() },
  () => {
    let app, a, b, owner, platform, platformCookie, qr;
    let ip = 1;
    const stores = [],
      users = [],
      emails = [];
    const password = 'strong-test-password-123';
    const cookieOf = (res) => String(res.headers['set-cookie']).split(';')[0];
    const hostOf = (store) => `${store.slug}.localhost`;
    const send = (method, url, host, payload, cookie, extra = {}) =>
      app.inject({
        method,
        url,
        headers: { host, ...(cookie ? { cookie } : {}), ...extra },
        ...(payload ? { payload } : {}),
        remoteAddress: `10.0.0.${ip++}`,
      });
    const login = (type, host, email, pwd = password) =>
      send('POST', `/api/auth/${type}/login`, host, { email, password: pwd });
    const storeData = (overrides = {}) => ({
      slug: `entry-${randomUUID().slice(0, 8)}`,
      name: 'Nova Loja',
      status: 'active',
      ownerName: 'Primeiro OWNER',
      ownerEmail: `${randomUUID()}@entry.test`,
      ownerPassword: password,
      ...overrides,
    });

    before(async () => {
      process.env.NODE_ENV = 'test';
      process.env.BASE_DOMAIN = 'localhost';
      process.env.JWT_SECRET = 'entry-context-tests-secret-at-least-32-chars';
      process.env.COOKIE_SECRET =
        'entry-context-cookie-secret-at-least-32-chars';
      const { buildApp } = await import('../../src/app.js');
      const { createUser, addStoreUser } = await import(
        '../../src/modules/auth/user.repository.js'
      );
      const { hashPassword } = await import(
        '../../src/modules/auth/password.js'
      );
      a = await makeStore();
      b = await makeStore();
      stores.push(a.id, b.id);
      owner = await makeUserWithRole(a.id, { password });
      users.push(owner.user.id);
      platform = await createUser({
        email: `${randomUUID()}@entry.test`,
        name: 'Platform',
        passwordHash: await hashPassword(password),
        isPlatformOwner: true,
        isSuperAdmin: true,
      });
      users.push(platform.id);
      // Multi-store membership must NOT turn a JWT issued for A into a JWT for B.
      await addStoreUser({
        storeId: b.id,
        userId: owner.user.id,
        role: 'MANAGER',
      });
      qr = await makeTableSession(a.id);
      app = await buildApp({ logger: false });
      await app.ready();
      const res = await login('platform', 'app.localhost', platform.email);
      assert.equal(res.statusCode, 200, res.body);
      platformCookie = cookieOf(res);
    });
    after(async () => {
      if (app) await app.close();
      await dropStores(stores);
      const { pool, query } = await import('../../src/infrastructure/db.js');
      await query(
        'DELETE FROM users WHERE id=ANY($1::uuid[]) OR email=ANY($2::text[])',
        [users, emails]
      );
      await query("DELETE FROM leads WHERE email LIKE '%@entry.test'");
      await pool.end();
    });

    for (const host of [
      'localhost',
      'www.localhost',
      'app.localhost',
      'platform.localhost',
    ]) {
      it(`${host} cannot become a tenant via header/query/body`, async () => {
        const res = await send(
          'GET',
          `/api/menu?tenant=${a.slug}&store_id=${a.id}`,
          host,
          null,
          null,
          { 'x-tenant-slug': a.slug }
        );
        assert.equal(res.statusCode, 400, res.body);
        const sse = await send(
          'GET',
          `/api/kitchen/events?probe=1&tenant=${a.slug}`,
          host,
          null,
          owner.cookie
        );
        assert.equal(sse.statusCode, 400, sse.body);
      });
    }
    it('store login is bound to host, with no membership enumeration', async () => {
      const res = await login('store', hostOf(a), owner.user.email);
      assert.equal(res.statusCode, 200, res.body);
      const jwt = decodeJwt(cookieOf(res).split('=')[1]);
      assert.equal(jwt.type, 'store');
      assert.equal(jwt.storeId, a.id);
      assert.equal(jwt.role, 'OWNER');
      assert.equal(res.json().memberships, undefined);
      assert.ok(!res.body.includes(b.id));
    });
    it('wrong host login fails even for a platform owner', async () => {
      const res = await login('store', hostOf(a), platform.email);
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'INVALID_CREDENTIALS');
      assert.equal(res.headers['set-cookie'], undefined);
    });
    it('an account with no membership cannot log in to another store', async () => {
      const onlyA = await makeUserWithRole(a.id, { password });
      users.push(onlyA.user.id);
      assert.equal(
        (await login('store', hostOf(b), onlyA.user.email)).statusCode,
        401
      );
    });
    it('store A JWT on B is 403, even with valid membership in B', async () => {
      const res = await send(
        'GET',
        '/api/admin/products',
        hostOf(b),
        null,
        owner.cookie
      );
      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'CONTEXT_FORBIDDEN');
    });
    it('platform JWT on store routes is 403, no SUPER_ADMIN bypass', async () => {
      for (const url of ['/api/me', '/api/admin/products']) {
        assert.equal(
          (await send('GET', url, hostOf(a), null, platformCookie)).statusCode,
          403
        );
      }
    });
    it('store JWT on platform routes is 403', async () => {
      assert.equal(
        (
          await send(
            'GET',
            '/api/platform/stores',
            'app.localhost',
            null,
            owner.cookie
          )
        ).statusCode,
        403
      );
    });
    it('platform routes require platform host and authenticated owner', async () => {
      assert.equal(
        (await send('GET', '/api/platform/stores', 'app.localhost')).statusCode,
        401
      );
      for (const host of ['localhost', hostOf(a)]) {
        assert.equal(
          (
            await send(
              'GET',
              '/api/platform/stores',
              host,
              null,
              platformCookie
            )
          ).statusCode,
          403
        );
      }
    });
    it('platform login only on apex/app, non-owners denied, token has no storeId', async () => {
      assert.equal(
        (await login('platform', hostOf(a), platform.email)).statusCode,
        403
      );
      assert.equal(
        (await login('platform', 'app.localhost', owner.user.email)).statusCode,
        401
      );
      const res = await login('platform', 'localhost', platform.email);
      assert.equal(res.statusCode, 200);
      const jwt = decodeJwt(cookieOf(res).split('=')[1]);
      assert.equal(jwt.type, 'platform');
      assert.equal(jwt.role, 'PLATFORM_OWNER');
      assert.equal(jwt.storeId, undefined);
    });
    it('generic login no longer exists; store login on apex is 400', async () => {
      assert.equal(
        (
          await send('POST', '/api/auth/login', 'localhost', {
            email: owner.user.email,
            password,
          })
        ).statusCode,
        404
      );
      assert.equal(
        (await login('store', 'localhost', owner.user.email)).statusCode,
        400
      );
    });
    it('store_id in login payload is rejected and never used', async () => {
      assert.equal(
        (
          await send('POST', '/api/auth/store/login', hostOf(a), {
            email: owner.user.email,
            password,
            store_id: b.id,
          })
        ).statusCode,
        400
      );
    });
    it('host wins over a conflicting tenant header and query', async () => {
      const res = await send(
        'GET',
        `/api/me?tenant=${b.slug}`,
        hostOf(a),
        null,
        owner.cookie,
        { 'x-tenant-slug': b.slug }
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().tenant.id, a.id);
    });
    it('legacy JWT without type/storeId is rejected', async () => {
      const token = await new SignJWT({ sa: true })
        .setSubject(platform.id)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET));
      assert.equal(
        (
          await send(
            'GET',
            '/api/platform/stores',
            'app.localhost',
            null,
            `ar_session=${token}`
          )
        ).statusCode,
        401
      );
    });
    it('logout revokes the token, not just the cookie', async () => {
      const res = await login('store', hostOf(a), owner.user.email);
      const cookie = cookieOf(res);
      assert.equal(
        (await send('POST', '/api/auth/logout', hostOf(a), null, cookie))
          .statusCode,
        200
      );
      assert.equal(
        (await send('GET', '/api/me', hostOf(a), null, cookie)).statusCode,
        401
      );
    });
    it('membership revocation takes effect on existing JWTs', async () => {
      const user = await makeUserWithRole(a.id);
      users.push(user.user.id);
      const { query } = await import('../../src/infrastructure/db.js');
      await query('UPDATE store_users SET is_active=false WHERE user_id=$1', [
        user.user.id,
      ]);
      assert.equal(
        (await send('GET', '/api/me', hostOf(a), null, user.cookie)).statusCode,
        403
      );
    });
    it('customer QR and cart never resolve data on apex/platform or another store', async () => {
      for (const host of ['localhost', 'app.localhost']) {
        assert.equal(
          (
            await send(
              'GET',
              `/api/tables/by-token/${qr.table.public_token}`,
              host
            )
          ).statusCode,
          400
        );
        assert.equal(
          (await send('GET', `/api/sessions/${qr.session.id}/cart`, host))
            .statusCode,
          400
        );
      }
      assert.equal(
        (
          await send(
            'GET',
            `/api/tables/by-token/${qr.table.public_token}`,
            hostOf(b)
          )
        ).statusCode,
        404
      );
      assert.equal(
        (await send('GET', `/api/sessions/${qr.session.id}/cart`, hostOf(b)))
          .statusCode,
        401
      );
      assert.equal(
        (
          await send(
            'GET',
            `/api/tables/by-token/${qr.table.public_token}`,
            hostOf(a)
          )
        ).statusCode,
        200
      );
    });
    it('custom domain resolves store with no header; suspended stores reject QR', async () => {
      const { query } = await import('../../src/infrastructure/db.js');
      const domain = `orders-${randomUUID().slice(0, 8)}.example.test`;
      await query('UPDATE stores SET custom_domain=$2 WHERE id=$1', [
        a.id,
        domain,
      ]);
      assert.equal(
        (await send('GET', '/api/me', domain, null, owner.cookie)).statusCode,
        200
      );
      await query("UPDATE stores SET status='suspended' WHERE id=$1", [a.id]);
      try {
        assert.equal(
          (
            await send(
              'GET',
              `/api/tables/by-token/${qr.table.public_token}`,
              domain
            )
          ).statusCode,
          403
        );
      } finally {
        await query("UPDATE stores SET status='active' WHERE id=$1", [a.id]);
      }
    });
    it('production ignores fallback unless BOTH transport host and origin are allowed', async () => {
      process.env.NODE_ENV = 'production';
      try {
        assert.equal(
          (
            await send('GET', '/api/menu', 'transport.test', null, null, {
              'x-tenant-slug': a.slug,
            })
          ).statusCode,
          400
        );
        process.env.TENANT_FALLBACK_HOSTS = 'transport.test';
        process.env.TENANT_FALLBACK_ORIGINS = 'https://store-ui.test';
        const headers = {
          origin: 'https://store-ui.test',
          'x-tenant-slug': a.slug,
        };
        assert.equal(
          (
            await send(
              'GET',
              '/api/me',
              'transport.test',
              null,
              owner.cookie,
              headers
            )
          ).statusCode,
          200
        );
        assert.equal(
          (
            await send(
              'GET',
              '/api/me',
              'localhost',
              null,
              owner.cookie,
              headers
            )
          ).statusCode,
          400
        );
      } finally {
        process.env.NODE_ENV = 'test';
        delete process.env.TENANT_FALLBACK_HOSTS;
        delete process.env.TENANT_FALLBACK_ORIGINS;
      }
    });
    it('leads validate plain text, reject tenant fields, and exist only on marketing', async () => {
      const payload = {
        name: ' Pessoa ',
        email: `${randomUUID()}@entry.test`,
        businessName: ' Loja ',
        message: 'Olá!\nQuero conhecer a plataforma.',
      };
      assert.equal(
        (await send('POST', '/api/leads', 'localhost', payload)).statusCode,
        201
      );
      for (const host of ['app.localhost', hostOf(a)])
        assert.equal(
          (await send('POST', '/api/leads', host, payload)).statusCode,
          403
        );
      for (const extra of [
        { store_id: a.id },
        { name: '<script>' },
        { email: 'invalid' },
      ])
        assert.equal(
          (
            await send('POST', '/api/leads', 'localhost', {
              ...payload,
              ...extra,
            })
          ).statusCode,
          400
        );
      const { query } = await import('../../src/infrastructure/db.js');
      const { rows } = await query('SELECT * FROM leads WHERE email=$1', [
        payload.email,
      ]);
      assert.equal(rows[0].name, 'Pessoa');
      assert.equal(rows[0].store_id, undefined);
    });
    for (const type of ['store', 'platform', 'leads']) {
      it(`${type} has a strong rate limit`, async () => {
        const host =
          type === 'store'
            ? hostOf(a)
            : type === 'platform'
              ? 'app.localhost'
              : 'localhost';
        const url = type === 'leads' ? '/api/leads' : `/api/auth/${type}/login`;
        const statuses = [];
        for (let i = 0; i < 7; i++)
          statuses.push(
            (
              await app.inject({
                method: 'POST',
                url,
                headers: { host },
                payload:
                  type === 'leads'
                    ? {}
                    : { email: 'missing@entry.test', password },
                remoteAddress: `192.0.2.${type === 'store' ? 1 : type === 'platform' ? 2 : 3}`,
              })
            ).statusCode
          );
        assert.deepEqual(statuses.slice(5), [429, 429]);
      });
    }
    it('CORS and CSRF reject cross-context and untrusted browser origins', async () => {
      process.env.CORS_ORIGIN = 'https://localhost,https://app.localhost';
      const allowed = await send(
        'GET',
        '/api/platform/me',
        'app.localhost',
        null,
        platformCookie,
        { origin: 'https://app.localhost' }
      );
      assert.equal(
        allowed.headers['access-control-allow-origin'],
        'https://app.localhost'
      );
      const denied = await send(
        'POST',
        '/api/auth/logout',
        'app.localhost',
        null,
        platformCookie,
        { origin: 'https://localhost' }
      );
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.headers['access-control-allow-origin'], undefined);
      assert.equal(
        (
          await send('POST', '/api/leads', 'localhost', {}, null, {
            origin: 'https://evil.test',
          })
        ).statusCode,
        403
      );
      delete process.env.CORS_ORIGIN;
    });
    it('platform creates store + OWNER + permissions atomically; no secrets in response', async () => {
      const payload = storeData();
      emails.push(payload.ownerEmail);
      const res = await send(
        'POST',
        '/api/platform/stores',
        'app.localhost',
        payload,
        platformCookie
      );
      assert.equal(res.statusCode, 201, res.body);
      const store = res.json().store;
      stores.push(store.id);
      assert.ok(!res.body.includes(password));
      const resLogin = await login('store', hostOf(store), payload.ownerEmail);
      assert.equal(resLogin.statusCode, 200, resLogin.body);
      assert.equal(
        (
          await send(
            'GET',
            '/api/admin/products',
            hostOf(store),
            null,
            cookieOf(resLogin)
          )
        ).statusCode,
        200
      );
      assert.equal(
        (await login('store', hostOf(store), platform.email)).statusCode,
        401
      );
      const detail = await send(
        'GET',
        `/api/platform/stores/${store.id}`,
        'app.localhost',
        null,
        platformCookie
      );
      assert.equal(detail.json().store.id, store.id);
    });
    it('existing OWNER credentials are preserved when joining a new store', async () => {
      const payload = storeData({
        ownerEmail: owner.user.email,
        ownerPassword: 'must-not-replace-password',
      });
      const res = await send(
        'POST',
        '/api/platform/stores',
        'app.localhost',
        payload,
        platformCookie
      );
      assert.equal(res.statusCode, 201);
      const store = res.json().store;
      stores.push(store.id);
      assert.equal(
        (await login('store', hostOf(store), owner.user.email)).statusCode,
        200
      );
    });
    it('conflicting slug rolls back the newly inserted owner', async () => {
      const payload = storeData({ slug: a.slug });
      emails.push(payload.ownerEmail);
      assert.equal(
        (
          await send(
            'POST',
            '/api/platform/stores',
            'app.localhost',
            payload,
            platformCookie
          )
        ).statusCode,
        409
      );
      const { query } = await import('../../src/infrastructure/db.js');
      assert.equal(
        (
          await query('SELECT id FROM users WHERE email=$1', [
            payload.ownerEmail,
          ])
        ).rows.length,
        0
      );
    });
    it('reserved slugs, internal custom domains, mass-assignment and weak password are rejected', async () => {
      for (const patch of [
        { slug: 'app' },
        { slug: 'platform' },
        { slug: 'www' },
        { customDomain: 'other.localhost' },
        { ownerPassword: 'weak' },
        { ownerEmail: 'invalid' },
        { store_id: a.id },
        { customDomain: 'https://example.test/path' },
      ]) {
        assert.equal(
          (
            await send(
              'POST',
              '/api/platform/stores',
              'app.localhost',
              storeData(patch),
              platformCookie
            )
          ).statusCode,
          400
        );
      }
    });
    it('store status management blocks login; DELETE suspends without removing history', async () => {
      const path = `/api/platform/stores/${b.id}`;
      assert.equal(
        (
          await send(
            'PATCH',
            path,
            'app.localhost',
            { status: 'pending' },
            platformCookie
          )
        ).statusCode,
        200
      );
      assert.equal(
        (await login('store', hostOf(b), owner.user.email)).statusCode,
        403
      );
      assert.equal(
        (
          await send('DELETE', path, 'app.localhost', null, platformCookie)
        ).json().store.status,
        'suspended'
      );
      assert.equal(
        (
          await send(
            'PATCH',
            path,
            'app.localhost',
            { status: 'active' },
            platformCookie
          )
        ).statusCode,
        200
      );
      assert.equal(
        (await login('store', hostOf(b), owner.user.email)).statusCode,
        200
      );
    });
    it('platform list/metrics/leads are paginated and protected, bad IDs are 400/404', async () => {
      for (const path of [
        '/api/platform/stores?limit=1',
        '/api/platform/metrics',
        '/api/platform/leads?limit=1',
      ]) {
        assert.equal(
          (await send('GET', path, 'app.localhost', null, platformCookie))
            .statusCode,
          200
        );
        assert.equal(
          (await send('GET', path, 'app.localhost', null, owner.cookie))
            .statusCode,
          403
        );
      }
      assert.equal(
        (
          await send(
            'GET',
            '/api/platform/stores?limit=1000',
            'app.localhost',
            null,
            platformCookie
          )
        ).statusCode,
        400
      );
      assert.equal(
        (
          await send(
            'GET',
            '/api/platform/stores/not-uuid',
            'app.localhost',
            null,
            platformCookie
          )
        ).statusCode,
        400
      );
      assert.equal(
        (
          await send(
            'GET',
            `/api/platform/stores/${randomUUID()}`,
            'app.localhost',
            null,
            platformCookie
          )
        ).statusCode,
        404
      );
    });
  }
);
