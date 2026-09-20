/**
 * Máquina de estados de pedido/item com guarda de concorrência.
 *
 * Cobre:
 *  - transições concorrentes no pedido → exatamente uma vence (409/INVALID na
 *    perdedora), nunca sobrescrita silenciosa;
 *  - transições inválidas rejeitadas (item e pedido);
 *  - status do pedido DERIVADO dos itens;
 *  - cancelamento derruba itens ativos mas preserva DELIVERED;
 *  - escopo por loja (item de outra loja não é acessível).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipWithoutDb } from '../helpers/env.js';
import { dropStores } from '../helpers/fixtures.js';
import {
  canTransition,
  canTransitionItem,
  deriveOrderStatus,
} from '../../src/modules/orders/status-machine.js';

describe('status-machine (unit)', () => {
  it('deriva o status do pedido a partir dos itens', () => {
    assert.equal(deriveOrderStatus([]), 'CANCELLED', 'sem itens ativos → cancelado');
    assert.equal(deriveOrderStatus(['CANCELLED', 'CANCELLED']), 'CANCELLED');
    assert.equal(deriveOrderStatus(['DELIVERED', 'DELIVERED']), 'DELIVERED');
    assert.equal(deriveOrderStatus(['DELIVERED', 'CANCELLED']), 'DELIVERED');
    assert.equal(deriveOrderStatus(['READY', 'DELIVERED']), 'READY');
    assert.equal(deriveOrderStatus(['READY', 'CANCELLED']), 'READY');
    assert.equal(deriveOrderStatus(['PREPARING', 'READY']), 'PREPARING');
    assert.equal(deriveOrderStatus(['PENDING', 'CANCELLED']), 'PENDING');
    assert.equal(deriveOrderStatus(['PENDING', 'PENDING']), 'PENDING');
  });

  it('transições de pedido respeitam a máquina de estados', () => {
    assert.equal(canTransition('PENDING', 'CONFIRMED'), true);
    assert.equal(canTransition('PENDING', 'PREPARING'), true);
    assert.equal(canTransition('PENDING', 'CANCELLED'), true);
    assert.equal(canTransition('PREPARING', 'READY'), true);
    assert.equal(canTransition('READY', 'DELIVERED'), true);
    assert.equal(canTransition('DELIVERED', 'CANCELLED'), false, 'terminal');
    assert.equal(canTransition('CANCELLED', 'PREPARING'), false, 'terminal');
    assert.equal(canTransition('CONFIRMED', 'DELIVERED'), false, 'não pula etapas');
  });

  it('transições de item respeitam a máquina de estados', () => {
    assert.equal(canTransitionItem('PENDING', 'PREPARING'), true);
    assert.equal(canTransitionItem('PENDING', 'READY'), false);
    assert.equal(canTransitionItem('PREPARING', 'READY'), true);
    assert.equal(canTransitionItem('READY', 'DELIVERED'), true);
    assert.equal(canTransitionItem('DELIVERED', 'CANCELLED'), false);
    assert.equal(canTransitionItem('CANCELLED', 'PENDING'), false);
  });

  it('nunca deriva a partir de um estado terminal', () => {
    const combos = [
      ['PENDING'],
      ['PREPARING'],
      ['READY'],
      ['DELIVERED'],
      ['CANCELLED'],
      ['PENDING', 'CANCELLED'],
      ['PREPARING', 'DELIVERED'],
      ['READY', 'CANCELLED'],
      ['DELIVERED', 'CANCELLED'],
    ];
    for (const combo of combos) {
      const derived = deriveOrderStatus(combo);
      assert.ok(
        ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'].includes(
          derived
        ),
        `derivado inválido: ${derived}`
      );
      for (const terminal of ['DELIVERED', 'CANCELLED']) {
        if (derived === terminal) continue;
        assert.equal(
          canTransition(terminal, derived),
          false,
          `${terminal} não pode virar ${derived}`
        );
      }
    }
  });
});

describe('transições guardadas por concorrência (integration)', () => {
  let store = null;
  let otherStore = null;
  let product = null;
  let otherProduct = null;
  let session = null;

  before(async () => {
    const { makeStoreWithProduct, makeTableSession } = await import(
      '../helpers/fixtures.js'
    );
    const fx = await makeStoreWithProduct({ price: 10 });
    store = fx.store;
    product = fx.product;
    const fxOther = await makeStoreWithProduct({ price: 11 });
    otherStore = fxOther.store;
    session = (await makeTableSession(store.id, { number: 1 })).session;
  });

  after(async () => {
    await dropStores(store?.id, otherStore?.id);
  });

  async function newOrder(items) {
    const { createOrder } = await import('../../src/modules/orders/orders.repository.js');
    const result = await createOrder(store.id, {
      tableSessionId: session.id,
      channel: 'TABLE',
      items,
    });
    return result;
  }

  it('duas transições concorrentes no pedido → uma vence, a outra não sobrescreve', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderStatus, findOrderById } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);

    const results = await Promise.allSettled([
      transitionOrderStatus(store.id, order.id, 'CONFIRMED'),
      transitionOrderStatus(store.id, order.id, 'CONFIRMED'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, 'apenas uma transição pode ser aplicada');
    assert.equal(failed.length, 1, 'a perdedora precisa falhar (409), não sobrescrever');
    assert.ok(
      ['STATUS_CONFLICT', 'INVALID_STATUS_TRANSITION'].includes(failed[0].reason.code),
      `código inesperado: ${failed[0].reason.code}`
    );

    const after = await findOrderById(store.id, order.id);
    assert.equal(after.status, 'CONFIRMED');
  });

  it('transições concorrentes para alvos diferentes → só uma é aplicada', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderStatus, findOrderById } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);

    const results = await Promise.allSettled([
      transitionOrderStatus(store.id, order.id, 'PREPARING'),
      transitionOrderStatus(store.id, order.id, 'CONFIRMED'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);

    const after = await findOrderById(store.id, order.id);
    assert.ok(['PREPARING', 'CONFIRMED'].includes(after.status));
  });

  it('transição inválida de pedido → INVALID_STATUS_TRANSITION', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderStatus } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);

    await assert.rejects(
      () => transitionOrderStatus(store.id, order.id, 'DELIVERED'),
      (err) => err.code === 'INVALID_STATUS_TRANSITION'
    );
  });

  it('transição de pedido de outra loja não encontra nada', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderStatus } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);

    const result = await transitionOrderStatus(otherStore.id, order.id, 'CONFIRMED');
    assert.equal(result, null, 'loja diferente não pode alterar o pedido');
  });

  it('itens avançam e o status do pedido é derivado deles', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderItemStatus, listOrderItems, findOrderById } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);

    const items = await listOrderItems(store.id, order.id);
    assert.equal(items.length, 2);
    const [a, b] = items;

    // PENDING → READY é inválido (precisa passar por PREPARING)
    await assert.rejects(
      () => transitionOrderItemStatus(store.id, a.id, 'READY'),
      (err) => err.code === 'INVALID_ITEM_STATUS_TRANSITION'
    );

    await transitionOrderItemStatus(store.id, a.id, 'PREPARING');
    let current = await findOrderById(store.id, order.id);
    assert.equal(current.status, 'PREPARING');

    // só o item A avançou: o pedido NÃO vira READY com um item em PENDING
    await transitionOrderItemStatus(store.id, a.id, 'READY');
    current = await findOrderById(store.id, order.id);
    assert.equal(current.status, 'PREPARING', 'derivado: ainda há item pendente');

    // com B também em READY, o pedido deriva para READY
    await transitionOrderItemStatus(store.id, b.id, 'PREPARING');
    await transitionOrderItemStatus(store.id, b.id, 'READY');
    current = await findOrderById(store.id, order.id);
    assert.equal(current.status, 'READY');

    // entregar todos os itens deriva DELIVERED
    await transitionOrderItemStatus(store.id, a.id, 'DELIVERED');
    await transitionOrderItemStatus(store.id, b.id, 'DELIVERED');
    current = await findOrderById(store.id, order.id);
    assert.equal(current.status, 'DELIVERED');
  });

  it('cancelar pedido derruba itens ativos mas preserva DELIVERED', async (t) => {
    if (skipWithoutDb(t)) return;
    const {
      transitionOrderItemStatus,
      transitionOrderStatus,
      listOrderItems,
      findOrderById,
    } = await import('../../src/modules/orders/orders.repository.js');
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);
    const items = await listOrderItems(store.id, order.id);
    const [a, b] = items;

    await transitionOrderItemStatus(store.id, a.id, 'PREPARING');
    await transitionOrderItemStatus(store.id, a.id, 'READY');
    await transitionOrderItemStatus(store.id, a.id, 'DELIVERED');
    await transitionOrderItemStatus(store.id, b.id, 'PREPARING');

    const cancelled = await transitionOrderStatus(store.id, order.id, 'CANCELLED');
    assert.equal(cancelled.status, 'CANCELLED');

    const after = await listOrderItems(store.id, order.id);
    const byId = new Map(after.map((i) => [i.id, i.status]));
    assert.equal(byId.get(a.id), 'DELIVERED', 'item entregue não pode ser cancelado');
    assert.equal(byId.get(b.id), 'CANCELLED', 'item ativo precisa ser cancelado');

    const orderAfter = await findOrderById(store.id, order.id);
    assert.equal(orderAfter.status, 'CANCELLED');
  });

  it('item de outra loja não é acessível', async (t) => {
    if (skipWithoutDb(t)) return;
    const { transitionOrderItemStatus, listOrderItems } = await import(
      '../../src/modules/orders/orders.repository.js'
    );
    const { order } = await newOrder([
      { productId: product.id, quantity: 1, addonIds: [] },
    ]);
    const items = await listOrderItems(store.id, order.id);

    const result = await transitionOrderItemStatus(otherStore.id, items[0].id, 'PREPARING');
    assert.equal(result, null);
  });
});
