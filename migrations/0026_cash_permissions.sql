-- 0023_cash_permissions.sql
-- Permissões do caixa operacional (issues #107–#110).
--
-- Nomenclatura: `cashier.sessions.*` já existia para COMANDAS (sessão de mesa).
-- Sessão de CAIXA usa `cashier.cash.*` para não misturar os dois domínios.
--
-- Papel por padrão (o dono pode ajustar em /api/permissions):
--   OWNER/MANAGER → tudo
--   STAFF         → opera o caixa (abre, vê, movimenta); NÃO fecha sessão
--   KITCHEN       → nada de caixa
-- Mantido em sync com src/modules/permissions/catalog.js.

INSERT INTO permissions (key, description) VALUES
  ('cashier.cash.open', 'Abrir sessão de caixa (fundo de troco)'),
  ('cashier.cash.close', 'Fechar sessão de caixa com reconciliação'),
  ('cashier.cash.read', 'Ver sessões, ledger e relatórios de caixa'),
  ('cashier.movements.write', 'Registrar movimentações (suprimento, sangria, ajuste)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'OWNER', p.id
FROM stores s
CROSS JOIN permissions p
WHERE p.key IN (
  'cashier.cash.open', 'cashier.cash.close', 'cashier.cash.read', 'cashier.movements.write'
)
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'MANAGER', p.id
FROM stores s
CROSS JOIN permissions p
WHERE p.key IN (
  'cashier.cash.open', 'cashier.cash.close', 'cashier.cash.read', 'cashier.movements.write'
)
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

INSERT INTO role_permissions (store_id, role, permission_id)
SELECT s.id, 'STAFF', p.id
FROM stores s
CROSS JOIN permissions p
WHERE p.key IN (
  'cashier.cash.open', 'cashier.cash.read', 'cashier.movements.write'
)
ON CONFLICT (store_id, role, permission_id) DO NOTHING;

-- DOWN (reversível):
--   DELETE FROM role_permissions WHERE permission_id IN
--     (SELECT id FROM permissions WHERE key LIKE 'cashier.cash.%' OR key = 'cashier.movements.write');
--   DELETE FROM permissions WHERE key LIKE 'cashier.cash.%' OR key = 'cashier.movements.write';
