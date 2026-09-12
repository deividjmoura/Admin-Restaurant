import { query } from '../../infrastructure/db.js';
import { invalidateMenuCache } from './menu-cache.js';

/** All queries are scoped by store_id. */

export async function listCategories(storeId) {
  const { rows } = await query(
    `SELECT id, store_id, name, sort_order, is_active, created_at, updated_at
     FROM categories
     WHERE store_id = $1 AND is_active = TRUE
     ORDER BY sort_order, name`,
    [storeId]
  );
  return rows;
}

export async function listProducts(storeId, { includeUnavailable = true } = {}) {
  const availability = includeUnavailable ? '' : 'AND p.is_available = TRUE';
  const { rows } = await query(
    `SELECT p.id, p.store_id, p.category_id, p.name, p.description, p.price,
            p.image_url, p.is_available, p.is_active, p.sort_order, p.station,
            p.created_at, p.updated_at
     FROM products p
     WHERE p.store_id = $1 AND p.is_active = TRUE ${availability}
     ORDER BY p.sort_order, p.name`,
    [storeId]
  );
  return rows;
}

export async function listAddonsForProducts(storeId, productIds) {
  if (!productIds?.length) return [];
  const { rows } = await query(
    `SELECT id, store_id, product_id, name, price, is_active, sort_order
     FROM product_addons
     WHERE store_id = $1
       AND product_id = ANY($2::uuid[])
       AND is_active = TRUE
     ORDER BY sort_order, name`,
    [storeId, productIds]
  );
  return rows;
}

export async function getMenuForStore(storeId) {
  const categories = await listCategories(storeId);
  const products = await listProducts(storeId, { includeUnavailable: true });
  const addons = await listAddonsForProducts(
    storeId,
    products.map((p) => p.id)
  );

  const addonsByProduct = new Map();
  for (const a of addons) {
    if (!addonsByProduct.has(a.product_id)) addonsByProduct.set(a.product_id, []);
    addonsByProduct.get(a.product_id).push({
      id: a.id,
      name: a.name,
      price: Number(a.price),
    });
  }

  const productsByCategory = new Map();
  for (const p of products) {
    if (!productsByCategory.has(p.category_id)) productsByCategory.set(p.category_id, []);
    productsByCategory.get(p.category_id).push({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      imageUrl: p.image_url,
      isAvailable: p.is_available,
      sortOrder: p.sort_order,
      station: p.station,
      addons: addonsByProduct.get(p.id) || [],
    });
  }

  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sort_order,
      products: productsByCategory.get(c.id) || [],
    })),
  };
}

export async function createCategory(storeId, { name, sortOrder = 0 }) {
  const { rows } = await query(
    `INSERT INTO categories (store_id, name, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, store_id, name, sort_order, is_active, created_at, updated_at`,
    [storeId, name, sortOrder]
  );
  invalidateMenuCache(storeId);
  return rows[0];
}

export async function createProduct(storeId, {
  categoryId,
  name,
  description = null,
  price,
  imageUrl = null,
  sortOrder = 0,
  station = 'KITCHEN',
}) {
  const { rows: cats } = await query(
    `SELECT id FROM categories WHERE id = $1 AND store_id = $2`,
    [categoryId, storeId]
  );
  if (!cats[0]) {
    const err = new Error('CATEGORY_NOT_FOUND');
    err.code = 'CATEGORY_NOT_FOUND';
    throw err;
  }

  const safeStation = station === 'BAR' ? 'BAR' : 'KITCHEN';

  const { rows } = await query(
    `INSERT INTO products
      (store_id, category_id, name, description, price, image_url, sort_order, station)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, store_id, category_id, name, description, price, image_url,
               is_available, is_active, sort_order, station, created_at, updated_at`,
    [storeId, categoryId, name, description, price, imageUrl, sortOrder, safeStation]
  );
  invalidateMenuCache(storeId);
  return rows[0];
}
