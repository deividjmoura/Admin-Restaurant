-- Audit logs are append-only. The application has no update/delete path,
-- and the database also rejects accidental mutation by privileged app code.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
-- The foreign keys in 0004 use ON DELETE SET NULL for referential cleanup.
-- Guarding UPDATE here would reject that cleanup and make deleting a store/user
-- fail; the application has no audit UPDATE path, so deletion is the mutation
-- that must be blocked at the database boundary.
CREATE TRIGGER audit_logs_immutable
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

COMMENT ON FUNCTION prevent_audit_log_mutation() IS 'Audit records cannot be removed through the application database role.';
