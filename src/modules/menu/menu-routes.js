import fp from 'fastify-plugin';
import { getMenuForStore } from './menu.repository.js';
import { getCachedMenu, setCachedMenu } from './menu-cache.js';

async function menuRoutes(app) {
  app.get(
    '/api/menu',
    { preHandler: [app.requireTenant] },
    async (request) => {
      const storeId = request.storeId;

      const cached = getCachedMenu(storeId);
      if (cached) {
        return {
          store: {
            id: request.store.id,
            slug: request.store.slug,
            name: request.store.name,
          },
          cache: 'HIT',
          ...cached,
        };
      }

      const menu = await getMenuForStore(storeId);
      setCachedMenu(storeId, menu);

      return {
        store: {
          id: request.store.id,
          slug: request.store.slug,
          name: request.store.name,
        },
        cache: 'MISS',
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
