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

/** ——— Admin (inclui inativos) ——— */

export async function listCategoriesAdmin(storeId) {
  const { rows } = await query(
    `SELECT id, store_id, name, sort_order, is_active, created_at, updated_at
     FROM categories
     WHERE store_id = $1
     ORDER BY sort_order, name`,
    [storeId]
  );
  return rows;
}

export async function findCategoryById(storeId, categoryId) {
  const { rows } = await query(
    `SELECT id, store_id, name, sort_order, is_active, created_at, updated_at
     FROM categories WHERE id = $1 AND store_id = $2`,
    [categoryId, storeId]
  );
  return rows[0] ?? null;
}

export async function updateCategory(storeId, categoryId, patch) {
  const current = await findCategoryById(storeId, categoryId);
  if (!current) return null;

  const name = patch.name ?? current.name;
  const sortOrder = patch.sortOrder ?? current.sort_order;
  const isActive = patch.isActive ?? current.is_active;

  const { rows } = await query(
    `UPDATE categories
     SET name = $3, sort_order = $4, is_active = $5, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, name, sort_order, is_active, created_at, updated_at`,
    [categoryId, storeId, name, sortOrder, isActive]
  );
  invalidateMenuCache(storeId);
  return rows[0] ?? null;
}

export async function listProductsAdmin(storeId, { categoryId = null } = {}) {
  const params = [storeId];
  let filter = '';
  if (categoryId) {
    params.push(categoryId);
    filter = ` AND p.category_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT p.id, p.store_id, p.category_id, p.name, p.description, p.price,
            p.image_url, p.is_available, p.is_active, p.sort_order, p.station,
            p.created_at, p.updated_at
     FROM products p
     WHERE p.store_id = $1${filter}
     ORDER BY p.sort_order, p.name`,
    params
  );
  return rows;
}

export async function findProductById(storeId, productId) {
  const { rows } = await query(
    `SELECT id, store_id, category_id, name, description, price, image_url,
            is_available, is_active, sort_order, station, created_at, updated_at
     FROM products WHERE id = $1 AND store_id = $2`,
    [productId, storeId]
  );
  return rows[0] ?? null;
}

export async function updateProduct(storeId, productId, patch) {
  const current = await findProductById(storeId, productId);
  if (!current) return null;

  if (patch.categoryId) {
    const { rows: cats } = await query(
      `SELECT id FROM categories WHERE id = $1 AND store_id = $2`,
      [patch.categoryId, storeId]
    );
    if (!cats[0]) {
      const err = new Error('CATEGORY_NOT_FOUND');
      err.code = 'CATEGORY_NOT_FOUND';
      throw err;
    }
  }

  const categoryId = patch.categoryId ?? current.category_id;
  const name = patch.name ?? current.name;
  const description =
    patch.description !== undefined ? patch.description : current.description;
  const price = patch.price ?? current.price;
  const imageUrl =
    patch.imageUrl !== undefined ? patch.imageUrl : current.image_url;
  const sortOrder = patch.sortOrder ?? current.sort_order;
  const isAvailable =
    patch.isAvailable !== undefined ? patch.isAvailable : current.is_available;
  const isActive =
    patch.isActive !== undefined ? patch.isActive : current.is_active;
  let station = current.station;
  if (patch.station !== undefined) {
    station = patch.station === 'BAR' ? 'BAR' : 'KITCHEN';
  }

  const { rows } = await query(
    `UPDATE products
     SET category_id = $3,
         name = $4,
         description = $5,
         price = $6,
         image_url = $7,
         sort_order = $8,
         is_available = $9,
         is_active = $10,
         station = $11,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, category_id, name, description, price, image_url,
               is_available, is_active, sort_order, station, created_at, updated_at`,
    [
      productId,
      storeId,
      categoryId,
      name,
      description,
      price,
      imageUrl,
      sortOrder,
      isAvailable,
      isActive,
      station,
    ]
  );
  invalidateMenuCache(storeId);
  return rows[0] ?? null;
}

export async function createAddon(
  storeId,
  { productId, name, price = 0, sortOrder = 0 }
) {
  const product = await findProductById(storeId, productId);
  if (!product) {
    const err = new Error('PRODUCT_NOT_FOUND');
    err.code = 'PRODUCT_NOT_FOUND';
    throw err;
  }

  const { rows } = await query(
    `INSERT INTO product_addons (store_id, product_id, name, price, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, store_id, product_id, name, price, is_active, sort_order,
               created_at, updated_at`,
    [storeId, productId, name, price, sortOrder]
  );
  invalidateMenuCache(storeId);
  return rows[0];
}

export async function listAddonsAdmin(storeId, productId) {
  const { rows } = await query(
    `SELECT id, store_id, product_id, name, price, is_active, sort_order,
            created_at, updated_at
     FROM product_addons
     WHERE store_id = $1 AND product_id = $2
     ORDER BY sort_order, name`,
    [storeId, productId]
  );
  return rows;
}

export async function findAddonById(storeId, addonId) {
  const { rows } = await query(
    `SELECT id, store_id, product_id, name, price, is_active, sort_order,
            created_at, updated_at
     FROM product_addons WHERE id = $1 AND store_id = $2`,
    [addonId, storeId]
  );
  return rows[0] ?? null;
}

export async function updateAddon(storeId, addonId, patch) {
  const current = await findAddonById(storeId, addonId);
  if (!current) return null;

  const name = patch.name ?? current.name;
  const price = patch.price ?? current.price;
  const sortOrder = patch.sortOrder ?? current.sort_order;
  const isActive =
    patch.isActive !== undefined ? patch.isActive : current.is_active;

  const { rows } = await query(
    `UPDATE product_addons
     SET name = $3, price = $4, sort_order = $5, is_active = $6, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING id, store_id, product_id, name, price, is_active, sort_order,
               created_at, updated_at`,
    [addonId, storeId, name, price, sortOrder, isActive]
  );
  invalidateMenuCache(storeId);
  return rows[0] ?? null;
}
