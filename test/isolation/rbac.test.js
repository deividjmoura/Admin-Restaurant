import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb, hasDatabase } from '../helpers/env.js';
import { PERMISSIONS, PERMISSION_KEYS, FALLBACK_MATRIX } from '../../src/modules/permissions/catalog.js';

describe('RBAC catalog (unit)', () => {
  it('has at least 20 permissions', () => {
    assert.ok(PERMISSIONS.length >= 20, `expected >=20, got ${PERMISSIONS.length}`);
  });

  it('keys are unique and dot-separated', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    const uniq = new Set(keys);
    assert.equal(uniq.size, keys.length, 'duplicate keys');
    for (const k of keys) {
      assert.ok(k.includes('.'), `key ${k} should contain dot`);
      assert.ok(PERMISSION_KEYS.has(k));
    }
  });

  it('fallback matrix OWNER has all permissions', () => {
    const all = PERMISSIONS.map((p) => p.key);
    for (const k of all) {
      assert.ok(FALLBACK_MATRIX.OWNER.includes(k), `OWNER missing ${k}`);
    }
  });

  it('fallback matrix MANAGER missing only permissions.manage', () => {
    assert.ok(!FALLBACK_MATRIX.MANAGER.includes('permissions.manage'), 'MANAGER should not have permissions.manage');
    assert.ok(FALLBACK_MATRIX.MANAGER.includes('menu.products.write'), 'MANAGER should have menu.products.write');
  });

  it('fallback matrix KITCHEN limited to kitchen/read', () => {
    assert.ok(FALLBACK_MATRIX.KITCHEN.includes('kitchen.orders.read'));
    assert.ok(FALLBACK_MATRIX.KITCHEN.includes('orders.items.status.write'));
    assert.ok(!FALLBACK_MATRIX.KITCHEN.includes('menu.products.write'), 'KITCHEN should not have menu write');
    assert.ok(!FALLBACK_MATRIX.KITCHEN.includes('permissions.manage'));
  });

  it('fallback matrix STAFF has waiter and cashier but not menu write', () => {
    assert.ok(FALLBACK_MATRIX.STAFF.includes('waiter.items.deliver'));
    assert.ok(FALLBACK_MATRIX.STAFF.includes('cashier.sessions.close'));
    assert.ok(!FALLBACK_MATRIX.STAFF.includes('menu.categories.write'));
  });

  it('known critical permissions exist', () => {
    const required = [
      'menu.products.read',
      'menu.products.write',
      'tables.read',
      'tables.write',
      'orders.status.write',
      'orders.items.status.write',
      'kitchen.orders.read',
      'cashier.sessions.read',
      'reports.read',
      'payments.confirm',
      'store.settings.write',
      'permissions.manage',
    ];
    for (const k of required) {
      assert.ok(PERMISSION_KEYS.has(k), `missing required permission ${k}`);
    }
  });
});

describe('RBAC HTTP isolation (integration)', () => {
  let app = null;
  let storeA = null;
  let storeB = null;
  let ownerUser = null;
  let kitchenUser = null;
  let staffUser = null;
  let managerUser = null;

  const suffix = Date.now().toString(36).slice(-6);

  async function createUserWithRole({ email, role, storeId, password = 'test1234' }) {
    const { hashPassword } = await import('../../src/modules/auth/password.js');
    const { createUser, addStoreUser, findUserByEmail } = await import('../../src/modules/auth/user.repository.js');
    let user = await findUserByEmail(email);
    if (!user) {
      const hash = await hashPassword(password);
      user = await createUser({ email, passwordHash: hash, name: email.split('@')[0], isSuperAdmin: false });
    }
    // ensure membership
    const { getStoreRole } = await import('../../src/modules/auth/user.repository.js');
    const existing = await getStoreRole(user.id, storeId);
    if (!existing) {
      await addStoreUser({ storeId, userId: user.id, role });
    }
    return user;
  }

  async function loginViaApp(appInstance, email, password = 'test1234') {
    const res = await appInstance.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email, password },
    });
    assert.equal(res.statusCode, 200, `login failed for ${email}: ${res.body}`);
    const cookies = res.headers['set-cookie'];
    // fastify inject returns set-cookie as string or array
    let cookieHeader = '';
    if (Array.isArray(cookies)) {
      cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
    } else if (typeof cookies === 'string') {
      cookieHeader = cookies.split(';')[0];
    }
    return cookieHeader;
  }

  before(async () => {
    if (!hasDatabase()) return;
    process.env.NODE_ENV = 'development';
    process.env.BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
    process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'test-cookie-secret-change-me';

    const { buildApp } = await import('../../src/app.js');
    app = await buildApp({ logger: false });
    await app.ready();

    const { create: createStore } = await import('../../src/modules/tenancy/store.repository.js');
    storeA = await createStore({ slug: `rbac-a-${suffix}`, name: 'RBAC Store A' });
    storeB = await createStore({ slug: `rbac-b-${suffix}`, name: 'RBAC Store B' });

    // create users per role in storeA
    ownerUser = await createUserWithRole({ email: `owner-${suffix}@test.local`, role: 'OWNER', storeId: storeA.id });
    managerUser = await createUserWithRole({ email: `manager-${suffix}@test.local`, role: 'MANAGER', storeId: storeA.id });
    kitchenUser = await createUserWithRole({ email: `kitchen-${suffix}@test.local`, role: 'KITCHEN', storeId: storeA.id });
    staffUser = await createUserWithRole({ email: `staff-${suffix}@test.local`, role: 'STAFF', storeId: storeA.id });

    // also create a kitchen user in storeB to test cross-tenant
    // but we reuse kitchenUser only in storeA, so B will have no membership for that user

    // ensure permissions seeded (if migration not yet run, this will seed via repository fallback)
    try {
      const { ensureDefaultRolePermissions } = await import('../../src/modules/permissions/permissions.repository.js');
      await ensureDefaultRolePermissions(storeA.id);
      await ensureDefaultRolePermissions(storeB.id);
    } catch (e) {
      // ignore if table missing — fallback will be used
      console.warn('ensureDefault failed in rbac test', e.message);
    }
  });

  after(async () => {
    if (app) await app.close();
    if (!hasDatabase() || !storeA) return;
    const { query } = await import('../../src/infrastructure/db.js');
    // cleanup stores will cascade users? No, users are global, need manual cleanup via delete
    // delete stores first, then users
    await query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [[storeA.id, storeB.id]]);
    // cleanup users
    const emails = [ownerUser?.email, managerUser?.email, kitchenUser?.email, staffUser?.email].filter(Boolean);
    if (emails.length) {
      await query(`DELETE FROM users WHERE lower(email) = ANY($1::text[])`, [emails.map((e) => e.toLowerCase())]);
    }
  });

  it('OWNER can read menu admin, KITCHEN gets 403', async (t) => {
    if (skipWithoutDb(t)) return;
    const ownerCookie = await loginViaApp(app, ownerUser.email);
    const kitchenCookie = await loginViaApp(app, kitchenUser.email);

    const resOwner = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookie },
    });
    // OWNER should have menu.products.read
    assert.equal(resOwner.statusCode, 200, `OWNER menu read failed: ${resOwner.body}`);

    const resKitchen = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: { 'x-tenant-slug': storeA.slug, cookie: kitchenCookie },
    });
    // KITCHEN fallback does NOT have menu.products.read → 403
    assert.equal(resKitchen.statusCode, 403, `KITCHEN should be forbidden on menu: ${resKitchen.body}`);
    const body = resKitchen.json();
    assert.ok(body.error?.code === 'FORBIDDEN');
  });

  it('STAFF can access waiter ready but not reports', async (t) => {
    if (skipWithoutDb(t)) return;
    const staffCookie = await loginViaApp(app, staffUser.email);
    const kitchenCookie = await loginViaApp(app, kitchenUser.email);

    const resStaffWaiter = await app.inject({
      method: 'GET',
      url: '/api/waiter/ready-items',
      headers: { 'x-tenant-slug': storeA.slug, cookie: staffCookie },
    });
    // STAFF should have waiter.ready.read
    assert.equal(resStaffWaiter.statusCode, 200, `STAFF waiter should be allowed: ${resStaffWaiter.body}`);

    const resStaffReports = await app.inject({
      method: 'GET',
      url: '/api/reports/dashboard',
      headers: { 'x-tenant-slug': storeA.slug, cookie: staffCookie },
    });
    // STAFF should NOT have reports.read → 403
    assert.equal(resStaffReports.statusCode, 403, `STAFF should be forbidden on reports: ${resStaffReports.body}`);

    const resKitchenReports = await app.inject({
      method: 'GET',
      url: '/api/reports/dashboard',
      headers: { 'x-tenant-slug': storeA.slug, cookie: kitchenCookie },
    });
    assert.equal(resKitchenReports.statusCode, 403);
  });

  it('permissions.manage only for OWNER, MANAGER gets 403', async (t) => {
    if (skipWithoutDb(t)) return;
    const ownerCookie = await loginViaApp(app, ownerUser.email);
    const managerCookie = await loginViaApp(app, managerUser.email);
    const staffCookie = await loginViaApp(app, staffUser.email);

    const resOwner = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookie },
    });
    assert.equal(resOwner.statusCode, 200, `OWNER should list permissions: ${resOwner.body}`);
    const bodyOwner = resOwner.json();
    assert.ok(Array.isArray(bodyOwner.permissions));
    assert.ok(bodyOwner.permissions.length >= 20);

    const resManager = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: managerCookie },
    });
    // MANAGER does NOT have permissions.manage (fallback)
    assert.equal(resManager.statusCode, 403, `MANAGER should be forbidden on permissions.manage: ${resManager.body}`);

    const resStaff = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: staffCookie },
    });
    assert.equal(resStaff.statusCode, 403);
  });

  it('PUT role permissions is tenant isolated (store A change does not affect store B)', async (t) => {
    if (skipWithoutDb(t)) return;
    const ownerCookieA = await loginViaApp(app, ownerUser.email);
    // create owner for storeB
    const ownerB = await createUserWithRole({ email: `ownerB-${suffix}@test.local`, role: 'OWNER', storeId: storeB.id });
    const ownerCookieB = await loginViaApp(app, ownerB.email);

    // initially, STAFF in storeA should not have reports.read
    // we will grant reports.read to STAFF in storeA only
    const beforeA = await app.inject({
      method: 'GET',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookieA },
    });
    assert.equal(beforeA.statusCode, 200);
    const permsA_before = beforeA.json().permissions;
    const hasReportBefore = permsA_before.includes('reports.read');

    // grant reports.read to STAFF in storeA
    const newPermsA = [...new Set([...permsA_before, 'reports.read'])];
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookieA, 'content-type': 'application/json' },
      payload: { permissions: newPermsA },
    });
    assert.equal(putRes.statusCode, 200, `PUT should succeed: ${putRes.body}`);

    // verify STAFF in storeA now has it via GET
    const afterA = await app.inject({
      method: 'GET',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookieA },
    });
    assert.equal(afterA.statusCode, 200);
    assert.ok(afterA.json().permissions.includes('reports.read'));

    // verify STAFF in storeB still does NOT have it (isolated)
    const afterB = await app.inject({
      method: 'GET',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'x-tenant-slug': storeB.slug, cookie: ownerCookieB },
    });
    assert.equal(afterB.statusCode, 200);
    // storeB STAFF should not have reports.read unless we also set it
    // we didn't set for B, so should be missing (unless fallback, but now B has DB entries, fallback not used)
    // In fallback, STAFF does not have reports.read, so B should not have it
    assert.equal(afterB.json().permissions.includes('reports.read'), false, 'cross-store isolation failed: B should not have reports.read');

    // cleanup: remove the added permission to restore
    const restore = permsA_before;
    await app.inject({
      method: 'PUT',
      url: '/api/admin/roles/STAFF/permissions',
      headers: { 'x-tenant-slug': storeA.slug, cookie: ownerCookieA, 'content-type': 'application/json' },
      payload: { permissions: restore },
    });

    // cleanup ownerB
    const { query } = await import('../../src/infrastructure/db.js');
    await query(`DELETE FROM users WHERE lower(email)=lower($1)`, [ownerB.email]);
  });

  it('cross-tenant user without membership gets 403, not 200', async (t) => {
    if (skipWithoutDb(t)) return;
    // kitchenUser is only member of storeA, try to access storeB kitchen orders
    const kitchenCookie = await loginViaApp(app, kitchenUser.email);
    const res = await app.inject({
      method: 'GET',
      url: '/api/kitchen/orders?station=KITCHEN',
      headers: { 'x-tenant-slug': storeB.slug, cookie: kitchenCookie },
    });
    // should be 403 FORBIDDEN (no access to store B) not 200
    assert.equal(res.statusCode, 403, `cross-tenant should be forbidden: ${res.body}`);
  });

  it('without auth, permission routes return 401, without tenant 400', async (t) => {
    if (skipWithoutDb(t)) return;
    const resNoAuth = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: { 'x-tenant-slug': storeA.slug },
    });
    assert.equal(resNoAuth.statusCode, 401);

    const ownerCookie = await loginViaApp(app, ownerUser.email);
    const resNoTenant = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
      headers: { cookie: ownerCookie },
    });
    assert.equal(resNoTenant.statusCode, 400);
    assert.equal(resNoTenant.json().error?.code, 'TENANT_REQUIRED');
  });
});
