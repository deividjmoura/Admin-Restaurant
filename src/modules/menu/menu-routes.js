import fp from 'fastify-plugin';
import { getMenuForStore } from './menu.repository.js';

async function menuRoutes(app) {
  /**
   * Public menu for the current tenant.
   * Requires resolved store (subdomain / custom domain / X-Tenant-Slug in dev).
   */
  app.get(
    '/api/menu',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const menu = await getMenuForStore(request.storeId);
      return {
        store: {
          id: request.store.id,
          slug: request.store.slug,
          name: request.store.name,
        },
        ...menu,
      };
    }
  );
}

export default fp(menuRoutes, {
  name: 'menu-routes',
  fastify: '5.x',
  dependencies: ['tenant-plugin'],
});
