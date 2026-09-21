import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isApexHost,
  isPlatformHost,
  extractSubdomainSlug,
} from '../../src/modules/tenancy/tenant-host.js';
import { resolveEntryContext } from '../../frontend/src/context/entry-context.js';

describe('entry host classification (backend + frontend)', () => {
  it('reserved hosts never become slugs', () => {
    for (const h of [
      'localhost',
      'www.localhost',
      'app.localhost',
      'platform.localhost',
    ])
      assert.equal(extractSubdomainSlug(h), null);
    assert.equal(isApexHost('WWW.localhost:443'), true);
    assert.equal(isPlatformHost('APP.localhost.:443'), true);
    assert.equal(isPlatformHost('app.localhost.evil.test'), false);
  });
  it('UI context uses hostname, including custom domain (no client tenant selector)', () => {
    for (const h of ['example.test', 'www.example.test'])
      assert.equal(resolveEntryContext(h, 'example.test').type, 'marketing');
    for (const h of ['app.example.test', 'platform.example.test'])
      assert.equal(resolveEntryContext(h, 'example.test').type, 'platform');
    assert.deepEqual(
      resolveEntryContext('burger.example.test', 'example.test'),
      { type: 'store', slug: 'burger' }
    );
    assert.deepEqual(
      resolveEntryContext('orders.custom.test', 'example.test'),
      { type: 'store', slug: null }
    );
  });
});
