/**
 * Matriz de permissões (issue #47 / T2).
 * - 401 sem autenticação
 * - 403 sem membership na loja ou com papel insuficiente
 * - 403 cross-store (usuário da store A não acessa store B)
 * - OWNER/MANAGER passam em rotas admin; KITCHEN/STAFF são bloqueados
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';

describe('permissions matrix (integration)', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null;
  let storeA = null;
  let storeB = null;

  /** @type {Record<string, { user: object, cookie: string }>} */
  const actors = {};

  before(async () => {
    if (!hasDatabase()) return;

    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET =
      process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { create: createStore } = await import(
      '../../src/modules/tenancy/store.repository.js'
    );
    const { createUser, addStoreUser } = await import(
      '../../src/modules/auth/user.repository.js'
    );
    const { hashPassword } = await import('../../src/modules/auth/password.js');
    const { signSessionToken, COOKIE_NAME } = await import(
      '../../src/modules/auth/session.js'
    );

    const suffix = Date.now().toString(36);
    storeA = await createStore({ slug: `perm-a-${suffix}`, name: 'Perm Store A' });
    storeB = await createStore({ slug: `perm-b-${suffix}`, name: 'Perm Store B' });

    const passwordHash = await hashPassword('test-password-123');

    async function makeActor(role, store) {
      const email = `${role.toLowerCase()}-${suffix}@perm.test`;
      const user = await createUser({
        email,
        passwordHash,
        name: `Test ${role}`,
        isSuperAdmin: false,
      });
      await addStoreUser({ storeId: store.id, userId: user.id, role });
      const token = await signSessionToken(user);
      return {
        user,
        cookie: `${COOKIE_NAME}=${token}`,
      };
    }

    actors.OWNER = await makeActor('OWNER', storeA);
    actors.MANAGER = await makeActor('MANAGER', storeA);
    actors.KITCHEN = await makeActor('KITCHEN', storeA);
    actors.STAFF = await makeActor('STAFF', storeA);
    // Usuário só da store B — para testar cross-store
    actors.OWNER_B = await makeActor('OWNER', storeB);
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      [storeA.id, storeB.id],
    ]);
  });

  function inject(method, url, { role, slug, body } = {}) {
    const headers = {};
    if (slug) headers['x-tenant-slug'] = slug;
    if (role && actors[role]) headers.cookie = actors[role].cookie;
    return app.inject({
      method,
      url,
      headers,
      payload: body,
    });
  }

  // ——— 401 sem auth ———

  it('admin menu returns 401 without auth', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error?.code, 'UNAUTHORIZED');
  });

  it('kitchen board returns 401 without auth', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/kitchen/orders?station=KITCHEN', {
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 401);
  });

  it('reports returns 401 without auth', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/reports/dashboard', {
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 401);
  });

  // ——— 403 cross-store ———

  it('OWNER of store B cannot access admin of store A (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'OWNER_B',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error?.code, 'FORBIDDEN');
  });

  it('OWNER of store A cannot access admin of store B (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'OWNER',
      slug: storeB.slug,
    });
    assert.equal(res.statusCode, 403);
  });

  // ——— Admin menu: OWNER/MANAGER ok, KITCHEN/STAFF 403 ———

  it('OWNER can access admin categories', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'OWNER',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('MANAGER can access admin categories', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'MANAGER',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('KITCHEN cannot access admin categories (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'KITCHEN',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error?.code, 'FORBIDDEN');
  });

  it('STAFF cannot access admin categories (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/categories', {
      role: 'STAFF',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403);
  });

  // ——— Admin tables ———

  it('KITCHEN cannot create admin table (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('POST', '/api/admin/tables', {
      role: 'KITCHEN',
      slug: storeA.slug,
      body: { number: 99 },
    });
    assert.equal(res.statusCode, 403);
  });

  it('OWNER can list admin tables', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/admin/tables', {
      role: 'OWNER',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  // ——— Reports ———

  it('STAFF cannot access reports dashboard (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/reports/dashboard', {
      role: 'STAFF',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403);
  });

  it('OWNER can access reports dashboard', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/reports/dashboard', {
      role: 'OWNER',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  // ——— Kitchen: todos os papéis da loja ———

  it('KITCHEN can access kitchen board', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/kitchen/orders?station=KITCHEN', {
      role: 'KITCHEN',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('STAFF can access kitchen board', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/kitchen/orders?station=KITCHEN', {
      role: 'STAFF',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('OWNER_B cannot access kitchen of store A (403)', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/kitchen/orders?station=KITCHEN', {
      role: 'OWNER_B',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 403);
  });

  // ——— Tables list (qualquer papel da loja) ———

  it('STAFF can list tables', async (t) => {
    if (skipWithoutDb(t)) return;
    const res = await inject('GET', '/api/tables', {
      role: 'STAFF',
      slug: storeA.slug,
    });
    assert.equal(res.statusCode, 200, res.body);
  });
});
