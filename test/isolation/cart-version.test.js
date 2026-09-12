import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CartConflictError, CartError } from '../../src/modules/tables/cart-errors.js';

describe('cart concurrency errors', () => {
  it('CartConflictError exposes currentVersion', () => {
    const err = new CartConflictError(7);
    assert.equal(err.code, 'CART_VERSION_CONFLICT');
    assert.equal(err.currentVersion, 7);
  });

  it('CartError carries code', () => {
    const err = new CartError('CART_EMPTY', 'Carrinho vazio.');
    assert.equal(err.code, 'CART_EMPTY');
  });
});
