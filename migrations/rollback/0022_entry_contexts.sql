-- Export leads first. Roll back application together; all sessions are lost.
ALTER TABLE stores DROP CONSTRAINT stores_reserved_slug;
DROP TABLE leads;
DROP TABLE auth_sessions;
ALTER TABLE users DROP COLUMN is_platform_owner;
DELETE FROM schema_migrations WHERE name = '0022_entry_contexts.sql';
