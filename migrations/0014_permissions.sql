-- 0014_permissions.sql
-- RBAC granular permissions por ação+recurso, por loja e papel.
-- Reversível: DROP TABLE role_permissions, permissions (ver comentário DOWN ao final).
-- Compatível: mantém fallback por papel quando role_permissions está vazio.

CREATE TABLE IF NOT EXISTS permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_permissions_key UNIQUE (key)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'KITCHEN', 'STAFF')),
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_role_permissions_store_role_permission UNIQUE (store_id, role, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_store_role ON role_permissions (store_id, role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions (permission_id);

-- Catálogo de permissões (mantido em sync com src/modules/permissions/catalog.js)
INSERT INTO permissions (key, description) VALUES
  ('menu.categories.read', 'Listar categorias do cardápio'),
  ('menu.categories.write', 'Criar/editar/remover categorias'),
  ('menu.products.read', 'Listar produtos'),
  ('menu.products.write', 'Criar/editar/remover produtos'),
  ('menu.addons.read', 'Listar adicionais'),
  ('menu.addons.write', 'Criar/editar/remover adicionais'),
  ('tables.read', 'Listar mesas'),
  ('tables.write', 'Criar/editar/remover/regenerar token de mesas'),
  ('orders.read', 'Ver pedidos'),
  ('orders.status.write', 'Alterar status do pedido'),
  ('orders.items.status.write', 'Alterar status de item do pedido'),
  ('kitchen.orders.read', 'Ver pedidos por estação (cozinha/bar)'),
  ('waiter.ready.read', 'Ver itens prontos para entrega'),
  ('waiter.items.deliver', 'Marcar item como entregue'),
  ('cashier.sessions.read', 'Ver sessões/comandas do caixa'),
  ('cashier.sessions.close', 'Fechar sessão/comanda'),
  ('reports.read', 'Ver relatórios/dashboard'),
  ('delivery.zones.read', 'Listar zonas de entrega'),
  ('delivery.zones.write', 'Criar/editar zonas de entrega'),
  ('payments.read', 'Listar/ver pagamentos'),
  ('payments.create', 'Criar pagamento'),
  ('payments.confirm', 'Confirmar pagamento'),
  ('store.settings.read', 'Ver configurações da loja'),
  ('store.settings.write', 'Editar configurações da loja'),
  ('permissions.manage', 'Gerenciar permissões por papel'),
  ('audit.read', 'Consultar logs de auditoria')
ON CONFLICT (key) DO NOTHING;

-- Backfill: para cada loja existente, semear permissões por papel
-- OWNER: todas
INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'OWNER', p.id FROM stores s CROSS JOIN permissions p
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

-- MANAGER: todas exceto permissions.manage
INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'MANAGER', p.id FROM stores s CROSS JOIN permissions p WHERE p.key <> 'permissions.manage'
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

-- KITCHEN: apenas cozinha + itens
INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'KITCHEN', p.id FROM stores s CROSS JOIN permissions p WHERE p.key IN (
  'kitchen.orders.read',
  'orders.items.status.write',
  'orders.read',
  'waiter.ready.read'
)
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

-- STAFF: garçom/caixa + leitura limitada
INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'STAFF', p.id FROM stores s CROSS JOIN permissions p WHERE p.key IN (
  'kitchen.orders.read',
  'orders.items.status.write',
  'orders.read',
  'waiter.ready.read',
  'waiter.items.deliver',
  'cashier.sessions.read',
  'cashier.sessions.close',
  'tables.read',
  'payments.read',
  'payments.create',
  'payments.confirm',
  'delivery.zones.read'
)
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

COMMENT ON TABLE permissions IS 'Catálogo de permissões granulares por ação+recurso';
COMMENT ON TABLE role_permissions IS 'Permissões por loja e papel. Fallback em código quando vazio.';
COMMENT ON COLUMN permissions.key IS 'Ex: menu.products.write, orders.items.status.write';

-- DOWN (reversível): para rollback manual, executar:
-- DROP TABLE IF EXISTS role_permissions;
-- DROP TABLE IF EXISTS permissions;
