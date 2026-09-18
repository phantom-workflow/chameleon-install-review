-- Chameleon Operations Access Control V1.
-- The existing users table is retained as the single durable user store. The
-- legacy role tables remain available to older fixtures; V1 authorization uses
-- the columns below and never trusts browser-supplied identity headers.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT 'HUMAN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

UPDATE users
SET name = COALESCE(name, display_name, username),
    updated_at = COALESCE(updated_at, created_at),
    user_type = COALESCE(user_type, 'HUMAN')
WHERE name IS NULL OR updated_at IS NULL OR user_type IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users ADD CONSTRAINT users_user_type_check CHECK (user_type IN ('HUMAN', 'AGENT'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IS NULL OR role IN ('ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_users_auth_lookup
  ON users (lower(username), active);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions (user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions (expires_at);
