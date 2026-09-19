-- 0017_crm_permissions.sql
INSERT INTO permissions (key, description) VALUES
  ('customers.read', 'Listar/ver clientes da loja'),
  ('customers.write', 'Criar/editar clientes e consentimentos')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'OWNER', p.id
FROM stores s
CROSS JOIN permissions p
WHERE p.key IN ('customers.read', 'customers.write')
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'MANAGER', p.id
FROM stores s
CROSS JOIN permissions p
WHERE p.key IN ('customers.read', 'customers.write')
ON CONFLICT (store_id, role, permission_id) DO NOTHING;
