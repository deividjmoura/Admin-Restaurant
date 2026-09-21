DELETE FROM permissions WHERE key='orders.create'; -- role_permissions cascades
DELETE FROM schema_migrations WHERE name='0023_customer_access.sql';
