import fp from 'fastify-plugin';
import { z } from 'zod';
import {
  listCategoriesAdmin,
  createCategory,
  updateCategory,
  findCategoryById,
  listProductsAdmin,
  createProduct,
  updateProduct,
  findProductById,
  listAddonsAdmin,
  createAddon,
  updateAddon,
  findAddonById,
} from './menu.repository.js';
import { AppError, errorResponse } from '../../shared/errors.js';

const categorySchema = z.object({
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional(),
});

const categoryPatchSchema = categorySchema.partial();

const productSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().min(0).max(999999),
  imageUrl: z.string().url().max(1000).optional().nullable().or(z.literal('')),
  sortOrder: z.number().int().optional().default(0),
  station: z.enum(['KITCHEN', 'BAR']).optional().default('KITCHEN'),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const productPatchSchema = productSchema.partial();

const addonSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.number().min(0).max(99999).optional().default(0),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional(),
});

const addonPatchSchema = addonSchema.partial();

function mapCategory(c) {
  return {
    id: c.id,
    name: c.name,
    sortOrder: c.sort_order,
    isActive: c.is_active,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function mapProduct(p) {
  return {
    id: p.id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    price: Number(p.price),
    imageUrl: p.image_url,
    isAvailable: p.is_available,
    isActive: p.is_active,
    sortOrder: p.sort_order,
    station: p.station,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapAddon(a) {
  return {
    id: a.id,
    productId: a.product_id,
    name: a.name,
    price: Number(a.price),
    isActive: a.is_active,
    sortOrder: a.sort_order,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function mapRepoError(err) {
  if (err?.code === 'CATEGORY_NOT_FOUND') {
    return new AppError('CATEGORY_NOT_FOUND', 'Categoria não encontrada nesta loja.', 404);
  }
  if (err?.code === 'PRODUCT_NOT_FOUND') {
    return new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado nesta loja.', 404);
  }
  return null;
}

async function menuAdminRoutes(app) {
  const readCategories = { preHandler: [app.requireTenant, app.requirePermission('menu.categories.read')] };
  const writeCategories = { preHandler: [app.requireTenant, app.requirePermission('menu.categories.write')] };
  const readProducts = { preHandler: [app.requireTenant, app.requirePermission('menu.products.read')] };
  const writeProducts = { preHandler: [app.requireTenant, app.requirePermission('menu.products.write')] };
  const readAddons = { preHandler: [app.requireTenant, app.requirePermission('menu.addons.read')] };
  const writeAddons = { preHandler: [app.requireTenant, app.requirePermission('menu.addons.write')] };

  // ——— Categories ———

  app.get('/api/admin/categories', readCategories, async (request) => {
    const rows = await listCategoriesAdmin(request.storeId);
    return { storeId: request.storeId, categories: rows.map(mapCategory) };
  });

  app.post('/api/admin/categories', writeCategories, async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
        issues: parsed.error.issues,
      });
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await createCategory(request.storeId, {
      name: parsed.data.name,
      sortOrder: parsed.data.sortOrder,
    });
    if (parsed.data.isActive === false) {
      const updated = await updateCategory(request.storeId, row.id, {
        isActive: false,
      });
      return reply.code(201).send({ category: mapCategory(updated) });
    }
    return reply.code(201).send({ category: mapCategory(row) });
  });

  app.patch('/api/admin/categories/:id', writeCategories, async (request, reply) => {
    const parsed = categoryPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await updateCategory(request.storeId, request.params.id, parsed.data);
    if (!row) {
      const err = new AppError('CATEGORY_NOT_FOUND', 'Categoria não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    return { category: mapCategory(row) };
  });

  // soft-delete = is_active false
  app.delete('/api/admin/categories/:id', writeCategories, async (request, reply) => {
    const existing = await findCategoryById(request.storeId, request.params.id);
    if (!existing) {
      const err = new AppError('CATEGORY_NOT_FOUND', 'Categoria não encontrada.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await updateCategory(request.storeId, request.params.id, {
      isActive: false,
    });
    return { category: mapCategory(row) };
  });

  // ——— Products ———

  app.get('/api/admin/products', readProducts, async (request) => {
    const categoryId = request.query?.categoryId || null;
    const rows = await listProductsAdmin(request.storeId, { categoryId });
    return { storeId: request.storeId, products: rows.map(mapProduct) };
  });

  app.get('/api/admin/products/:id', readProducts, async (request, reply) => {
    const row = await findProductById(request.storeId, request.params.id);
    if (!row) {
      const err = new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const addons = await listAddonsAdmin(request.storeId, row.id);
    return {
      product: mapProduct(row),
      addons: addons.map(mapAddon),
    };
  });

  app.post('/api/admin/products', writeProducts, async (request, reply) => {
    const body = { ...(request.body || {}) };
    if (body.imageUrl === '') body.imageUrl = null;
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
        issues: parsed.error.issues,
      });
      const { statusCode, body: b } = errorResponse(err);
      return reply.code(statusCode).send(b);
    }
    try {
      const row = await createProduct(request.storeId, {
        categoryId: parsed.data.categoryId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        price: parsed.data.price,
        imageUrl: parsed.data.imageUrl || null,
        sortOrder: parsed.data.sortOrder,
        station: parsed.data.station,
      });
      let result = row;
      if (parsed.data.isAvailable === false || parsed.data.isActive === false) {
        result = await updateProduct(request.storeId, row.id, {
          isAvailable: parsed.data.isAvailable,
          isActive: parsed.data.isActive,
        });
      }
      return reply.code(201).send({ product: mapProduct(result) });
    } catch (err) {
      const mapped = mapRepoError(err);
      if (mapped) {
        const { statusCode, body: b } = errorResponse(mapped);
        return reply.code(statusCode).send(b);
      }
      throw err;
    }
  });

  app.patch('/api/admin/products/:id', writeProducts, async (request, reply) => {
    const body = { ...(request.body || {}) };
    if (body.imageUrl === '') body.imageUrl = null;
    const parsed = productPatchSchema.safeParse(body);
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400, {
        issues: parsed.error.issues,
      });
      const { statusCode, body: b } = errorResponse(err);
      return reply.code(statusCode).send(b);
    }
    try {
      const row = await updateProduct(
        request.storeId,
        request.params.id,
        parsed.data
      );
      if (!row) {
        const err = new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado.', 404);
        const { statusCode, body: b } = errorResponse(err);
        return reply.code(statusCode).send(b);
      }
      return { product: mapProduct(row) };
    } catch (err) {
      const mapped = mapRepoError(err);
      if (mapped) {
        const { statusCode, body: b } = errorResponse(mapped);
        return reply.code(statusCode).send(b);
      }
      throw err;
    }
  });

  app.delete('/api/admin/products/:id', writeProducts, async (request, reply) => {
    const existing = await findProductById(request.storeId, request.params.id);
    if (!existing) {
      const err = new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await updateProduct(request.storeId, request.params.id, {
      isActive: false,
      isAvailable: false,
    });
    return { product: mapProduct(row) };
  });

  // ——— Addons ———

  app.get('/api/admin/products/:productId/addons', readAddons, async (request, reply) => {
    const product = await findProductById(
      request.storeId,
      request.params.productId
    );
    if (!product) {
      const err = new AppError('PRODUCT_NOT_FOUND', 'Produto não encontrado.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const rows = await listAddonsAdmin(request.storeId, product.id);
    return { productId: product.id, addons: rows.map(mapAddon) };
  });

  app.post('/api/admin/products/:productId/addons', writeAddons, async (request, reply) => {
    const parsed = addonSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    try {
      const row = await createAddon(request.storeId, {
        productId: request.params.productId,
        name: parsed.data.name,
        price: parsed.data.price,
        sortOrder: parsed.data.sortOrder,
      });
      let result = row;
      if (parsed.data.isActive === false) {
        result = await updateAddon(request.storeId, row.id, { isActive: false });
      }
      return reply.code(201).send({ addon: mapAddon(result) });
    } catch (err) {
      const mapped = mapRepoError(err);
      if (mapped) {
        const { statusCode, body } = errorResponse(mapped);
        return reply.code(statusCode).send(body);
      }
      throw err;
    }
  });

  app.patch('/api/admin/addons/:id', writeAddons, async (request, reply) => {
    const parsed = addonPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const err = new AppError('VALIDATION_ERROR', 'Payload inválido.', 400);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await updateAddon(
      request.storeId,
      request.params.id,
      parsed.data
    );
    if (!row) {
      const err = new AppError('ADDON_NOT_FOUND', 'Adicional não encontrado.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    return { addon: mapAddon(row) };
  });

  app.delete('/api/admin/addons/:id', writeAddons, async (request, reply) => {
    const existing = await findAddonById(request.storeId, request.params.id);
    if (!existing) {
      const err = new AppError('ADDON_NOT_FOUND', 'Adicional não encontrado.', 404);
      const { statusCode, body } = errorResponse(err);
      return reply.code(statusCode).send(body);
    }
    const row = await updateAddon(request.storeId, request.params.id, {
      isActive: false,
    });
    return { addon: mapAddon(row) };
  });
}

export default fp(menuAdminRoutes, {
  name: 'menu-admin-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin', 'auth-plugin'],
});
