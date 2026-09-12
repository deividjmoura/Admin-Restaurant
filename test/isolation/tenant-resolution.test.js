/**
 * Resolução de tenant — nunca confiar em store_id do cliente.
 * Issue #17
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHost,
  extractSubdomainSlug,
} from '../../src/modules/tenancy/tenant-host.js';

describe('tenant resolution helpers', () => {
  it('normalizeHost strips port and lowercases', () => {
    assert.equal(normalizeHost('Loja1.Example.COM:443'), 'loja1.example.com');
    assert.equal(normalizeHost(''), '');
    assert.equal(normalizeHost(null), '');
  });

  it('extractSubdomainSlug resolves against BASE_DOMAIN=localhost', () => {
    assert.equal(extractSubdomainSlug('demo.localhost'), 'demo');
    assert.equal(extractSubdomainSlug('loja-abc.localhost'), 'loja-abc');
    assert.equal(extractSubdomainSlug('localhost'), null);
    assert.equal(extractSubdomainSlug('www.localhost'), null);
  });

  it('rejects multi-level subdomains as tenant slug', () => {
    assert.equal(extractSubdomainSlug('a.b.localhost'), null);
  });
});
