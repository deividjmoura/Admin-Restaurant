/**
 * Isolamento de pedidos e status machine.
 * Issue #17 — transições validadas no backend.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  canTransitionItem,
} from '../../src/modules/orders/status-machine.js';

describe('order / item status machines', () => {
  it('rejects invalid order transitions', () => {
    assert.equal(canTransition('PENDING', 'DELIVERED'), false);
    assert.equal(canTransition('DELIVERED', 'PREPARING'), false);
    assert.equal(canTransition('CANCELLED', 'CONFIRMED'), false);
  });

  it('allows valid order transitions', () => {
    assert.equal(canTransition('PENDING', 'CONFIRMED'), true);
    assert.equal(canTransition('CONFIRMED', 'PREPARING'), true);
    assert.equal(canTransition('PREPARING', 'READY'), true);
    assert.equal(canTransition('READY', 'DELIVERED'), true);
  });

  it('rejects invalid item transitions', () => {
    assert.equal(canTransitionItem('PENDING', 'DELIVERED'), false);
    assert.equal(canTransitionItem('DELIVERED', 'READY'), false);
  });

  it('allows valid item transitions for kitchen/waiter flow', () => {
    assert.equal(canTransitionItem('PENDING', 'PREPARING'), true);
    assert.equal(canTransitionItem('PREPARING', 'READY'), true);
    assert.equal(canTransitionItem('READY', 'DELIVERED'), true);
  });
});
