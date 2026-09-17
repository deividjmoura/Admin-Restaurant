import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerJobHandler } from '../../src/infrastructure/jobs.js';
import { log } from '../../src/infrastructure/logger.js';

describe('jobs module', () => {
  it('registerJobHandler aceita handler', () => {
    let called = false;
    registerJobHandler('test-type-unit', async () => {
      called = true;
    });
    assert.equal(typeof registerJobHandler, 'function');
    assert.equal(called, false);
  });
});

describe('logger', () => {
  it('expõe níveis', () => {
    assert.equal(typeof log.info, 'function');
    assert.equal(typeof log.error, 'function');
    assert.equal(typeof log.child, 'function');
  });
});
