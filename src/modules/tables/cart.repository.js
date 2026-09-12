/**
 * Carrinho compartilhado da sessão de mesa.
 * Concorrência: optimistic locking via table_sessions.cart_version.
 */
import { query, withTransaction } from '../../infrastructure/db.js';

import { CartConflictError, CartError } from './cart-errors.js';
export { CartConflictError, CartError };

async function getOpenSessionForStore(storeId, sessionId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT id, store_id, table_id, status, cart_version, opened_at
     FROM table_sessions
     WHERE id = $1 AND store_id = $2`,
    [sessionId, storeId]
  );
  const session = rows[0];
  if (!session) return null;
  if (session.status !== 'open') {
    throw new CartError('SESSION_CLOSED', 'Sessão fechada.');
  }
  return session;
}

/**
 * Lê carrinho completo + versão atual.
 */
export async function getCart(storeId, sessionId) {
  const session = await getOpenSessionForStore(storeId, sessionId);
  if (!session) return null;

  const { rows: items } = await query(
    `SELECT ci.id, ci.product_id, ci.quantity, ci.notes, ci.created_at, ci.updated_at,
            p.name AS product_name, p.price AS unit_price, p.is_available, p.is_active
     FROM cart_items ci
     INNER JOIN products p ON p.id = ci.product_id AND p.store_id = ci.store_id
     WHERE ci.session_id = $1 AND ci.store_id = $2
     ORDER BY ci.created_at`,
    [sessionId, storeId]
  );

  if (!items.length) {
    return {
      sessionId,
      version: session.cart_version,
      items: [],
      totals: { items: 0, amount: 0 },
    };
  }

  const itemIds = items.map((i) => i.id);
  const { rows: addons } = await query(
    `SELECT cia.cart_item_id, cia.addon_id, pa.name, pa.price
     FROM cart_item_addons cia
     INNER JOIN product_addons pa ON pa.id = cia.addon_id AND pa.store_id = cia.store_id
     WHERE cia.cart_item_id = ANY($1::uuid[]) AND cia.store_id = $2`,
    [itemIds, storeId]
  );

  const addonsByItem = new Map();
  for (const a of addons) {
    if (!addonsByItem.has(a.cart_item_id)) addonsByItem.set(a.cart_item_id, []);
    addonsByItem.get(a.cart_item_id).push({
      id: a.addon_id,
      name: a.name,
      price: Number(a.price),
    });
  }

  let amount = 0;
  let qty = 0;
  const mapped = items.map((it) => {
    const itemAddons = addonsByItem.get(it.id) || [];
    const addonsTotal = itemAddons.reduce((s, a) => s + a.price, 0);
    const line = (Number(it.unit_price) + addonsTotal) * it.quantity;
    amount += line;
    qty += it.quantity;
    return {
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      unitPrice: Number(it.unit_price),
      quantity: it.quantity,
      notes: it.notes,
      isAvailable: it.is_available && it.is_active,
      addons: itemAddons,
      lineTotal: Math.round(line * 100) / 100,
    };
  });

  return {
    sessionId,
    version: session.cart_version,
    items: mapped,
    totals: {
      items: qty,
      amount: Math.round(amount * 100) / 100,
    },
  };
}

/**
 * Incrementa cart_version se expectedVersion bater; senão conflito.
 * @returns {number} nova versão
 */
async function bumpVersion(client, storeId, sessionId, expectedVersion) {
  const { rows } = await client.query(
    `UPDATE table_sessions
     SET cart_version = cart_version + 1,
         updated_at = now()
     WHERE id = $1
       AND store_id = $2
       AND status = 'open'
       AND cart_version = $3
     RETURNING cart_version`,
    [sessionId, storeId, expectedVersion]
  );
  if (!rows[0]) {
    const { rows: cur } = await client.query(
      `SELECT cart_version FROM table_sessions WHERE id = $1 AND store_id = $2`,
      [sessionId, storeId]
    );
    throw new CartConflictError(cur[0]?.cart_version ?? null);
  }
  return rows[0].cart_version;
}

/**
 * Adiciona item ao carrinho (ou soma quantity se mesmo produto+addons+notes).
 */
export async function addCartItem(
  storeId,
  sessionId,
  { productId, quantity, notes = null, addonIds = [], expectedVersion }
) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new CartError('VERSION_REQUIRED', 'expectedVersion é obrigatório.');
  }
  if (!quantity || quantity < 1) {
    throw new CartError('INVALID_QUANTITY', 'Quantidade inválida.');
  }

  return withTransaction(async (client) => {
    const session = await getOpenSessionForStore(storeId, sessionId, client);
    if (!session) throw new CartError('SESSION_NOT_FOUND', 'Sessão não encontrada.');

    const { rows: products } = await client.query(
      `SELECT id, name, price, is_available, is_active
       FROM products
       WHERE id = $1 AND store_id = $2`,
      [productId, storeId]
    );
    const product = products[0];
    if (!product || !product.is_active) {
      throw new CartError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.');
    }
    if (!product.is_available) {
      throw new CartError('PRODUCT_UNAVAILABLE', 'Produto indisponível.');
    }

    const uniqueAddonIds = [...new Set(addonIds || [])];
    if (uniqueAddonIds.length) {
      const { rows: addons } = await client.query(
        `SELECT id FROM product_addons
         WHERE store_id = $1 AND product_id = $2 AND id = ANY($3::uuid[]) AND is_active = TRUE`,
        [storeId, productId, uniqueAddonIds]
      );
      if (addons.length !== uniqueAddonIds.length) {
        throw new CartError('ADDON_INVALID', 'Adicional inválido para este produto.');
      }
    }

    // Sempre insere linha nova (concorrência mais simples e previsível).
    // Cliente pode ajustar quantity via PATCH se quiser consolidar.
    const { rows: inserted } = await client.query(
      `INSERT INTO cart_items (store_id, session_id, product_id, quantity, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [storeId, sessionId, productId, quantity, notes]
    );
    const cartItemId = inserted[0].id;
    for (const addonId of uniqueAddonIds) {
      await client.query(
        `INSERT INTO cart_item_addons (store_id, cart_item_id, addon_id)
         VALUES ($1, $2, $3)`,
        [storeId, cartItemId, addonId]
      );
    }

    const newVersion = await bumpVersion(client, storeId, sessionId, expectedVersion);
    return { cartItemId, version: newVersion };
  });
}

/**
 * Atualiza quantidade / notes de um item.
 */
export async function updateCartItem(
  storeId,
  sessionId,
  itemId,
  { quantity, notes, expectedVersion }
) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new CartError('VERSION_REQUIRED', 'expectedVersion é obrigatório.');
  }

  return withTransaction(async (client) => {
    const session = await getOpenSessionForStore(storeId, sessionId, client);
    if (!session) throw new CartError('SESSION_NOT_FOUND', 'Sessão não encontrada.');

    const { rows: items } = await client.query(
      `SELECT id FROM cart_items
       WHERE id = $1 AND session_id = $2 AND store_id = $3`,
      [itemId, sessionId, storeId]
    );
    if (!items[0]) throw new CartError('CART_ITEM_NOT_FOUND', 'Item não está no carrinho.');

    if (quantity !== undefined) {
      if (quantity < 1 || quantity > 99) {
        throw new CartError('INVALID_QUANTITY', 'Quantidade inválida.');
      }
      await client.query(
        `UPDATE cart_items SET quantity = $2, updated_at = now()
         WHERE id = $1 AND store_id = $3`,
        [itemId, quantity, storeId]
      );
    }
    if (notes !== undefined) {
      await client.query(
        `UPDATE cart_items SET notes = $2, updated_at = now()
         WHERE id = $1 AND store_id = $3`,
        [itemId, notes, storeId]
      );
    }

    const newVersion = await bumpVersion(client, storeId, sessionId, expectedVersion);
    return { version: newVersion };
  });
}

/**
 * Remove item do carrinho.
 */
export async function removeCartItem(storeId, sessionId, itemId, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new CartError('VERSION_REQUIRED', 'expectedVersion é obrigatório.');
  }

  return withTransaction(async (client) => {
    const session = await getOpenSessionForStore(storeId, sessionId, client);
    if (!session) throw new CartError('SESSION_NOT_FOUND', 'Sessão não encontrada.');

    const { rowCount } = await client.query(
      `DELETE FROM cart_items
       WHERE id = $1 AND session_id = $2 AND store_id = $3`,
      [itemId, sessionId, storeId]
    );
    if (!rowCount) throw new CartError('CART_ITEM_NOT_FOUND', 'Item não está no carrinho.');

    const newVersion = await bumpVersion(client, storeId, sessionId, expectedVersion);
    return { version: newVersion };
  });
}

/**
 * Esvazia o carrinho (após checkout ou cancelamento do carrinho).
 */
export async function clearCart(storeId, sessionId, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) {
    throw new CartError('VERSION_REQUIRED', 'expectedVersion é obrigatório.');
  }

  return withTransaction(async (client) => {
    const session = await getOpenSessionForStore(storeId, sessionId, client);
    if (!session) throw new CartError('SESSION_NOT_FOUND', 'Sessão não encontrada.');

    await client.query(
      `DELETE FROM cart_items WHERE session_id = $1 AND store_id = $2`,
      [sessionId, storeId]
    );
    const newVersion = await bumpVersion(client, storeId, sessionId, expectedVersion);
    return { version: newVersion };
  });
}

/**
 * Snapshot dos itens do carrinho no formato do createOrder.
 */
export async function getCartItemsForCheckout(storeId, sessionId) {
  const cart = await getCart(storeId, sessionId);
  if (!cart) return null;
  if (!cart.items.length) {
    throw new CartError('CART_EMPTY', 'Carrinho vazio.');
  }
  const unavailable = cart.items.filter((i) => !i.isAvailable);
  if (unavailable.length) {
    throw new CartError('PRODUCT_UNAVAILABLE', 'Há produtos indisponíveis no carrinho.');
  }
  return {
    version: cart.version,
    items: cart.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      notes: i.notes,
      addonIds: i.addons.map((a) => a.id),
    })),
  };
}
