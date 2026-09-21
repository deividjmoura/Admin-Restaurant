-- Separate platform identity from store membership. Old JWTs must log in again.
ALTER TABLE users ADD COLUMN is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET is_platform_owner = TRUE WHERE is_super_admin = TRUE;

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

-- Platform data: deliberately no store_id / customer linkage.
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  business_name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_at ON leads(created_at DESC);

-- Preflight existing collisions before rollout. NOT VALID avoids destructive
-- renames; new/updated rows must obey the reserved namespace immediately.
ALTER TABLE stores ADD CONSTRAINT stores_reserved_slug
  CHECK (lower(slug) NOT IN ('www','app','platform')) NOT VALID;
