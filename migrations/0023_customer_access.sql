-- Staff writes that were previously anonymous now require an explicit permission.
INSERT INTO permissions(key,description) VALUES ('orders.create','Criar pedidos e operar carrinhos')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions(store_id,role,permission_id)
SELECT s.id,r.role,p.id FROM stores s
CROSS JOIN (VALUES ('OWNER'),('MANAGER'),('STAFF')) AS r(role)
JOIN permissions p ON p.key='orders.create'
ON CONFLICT DO NOTHING;
