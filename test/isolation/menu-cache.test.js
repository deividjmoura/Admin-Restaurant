/**
 * Isolamento do cache de cardápio por store_id.
 * Issue #17 — Cache de menu de uma loja não serve outra.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedMenu,
  setCachedMenu,
  invalidateMenuCache,
  clearAllMenuCache,
} from '../../src/modules/menu/menu-cache.js';

describe('menu-cache isolation', () => {
  beforeEach(() => {
    clearAllMenuCache();
  });

  it('stores payloads under distinct keys per store', () => {
    const storeA = '11111111-1111-1111-1111-111111111111';
    const storeB = '22222222-2222-2222-2222-222222222222';

    setCachedMenu(storeA, { categories: [{ name: 'A-only' }] });
    setCachedMenu(storeB, { categories: [{ name: 'B-only' }] });

    assert.equal(getCachedMenu(storeA).categories[0].name, 'A-only');
    assert.equal(getCachedMenu(storeB).categories[0].name, 'B-only');
  });

  it('invalidating store A does not clear store B', () => {
    const storeA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const storeB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    setCachedMenu(storeA, { categories: [{ name: 'A' }] });
    setCachedMenu(storeB, { categories: [{ name: 'B' }] });

    invalidateMenuCache(storeA);

    assert.equal(getCachedMenu(storeA), null);
    assert.equal(getCachedMenu(storeB).categories[0].name, 'B');
  });

  it('never returns another store payload for a different id', () => {
    const storeA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    setCachedMenu(storeA, { secret: 'tenant-a-data' });

    assert.equal(getCachedMenu('cccccccc-cccc-cccc-cccc-cccccccccccc'), null);
    assert.equal(getCachedMenu(storeA).secret, 'tenant-a-data');
  });
});
