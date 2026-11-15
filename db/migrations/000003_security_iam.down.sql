DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
DROP FUNCTION IF EXISTS audit_log_immutable();
DROP TABLE IF EXISTS audit_log;

ALTER TABLE refresh_tokens
    DROP CONSTRAINT IF EXISTS refresh_tokens_ip_length,
    DROP CONSTRAINT IF EXISTS refresh_tokens_ua_length,
    DROP COLUMN IF EXISTS ip,
    DROP COLUMN IF EXISTS user_agent,
    DROP COLUMN IF EXISTS replaced_by,
    DROP COLUMN IF EXISTS last_used_at,
    DROP COLUMN IF EXISTS family_expires_at,
    DROP COLUMN IF EXISTS family_started_at;

DROP INDEX IF EXISTS users_role_idx;
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_reason_length,
    DROP CONSTRAINT IF EXISTS users_role_valid,
    DROP COLUMN IF EXISTS token_version,
    DROP COLUMN IF EXISTS disabled_reason,
    DROP COLUMN IF EXISTS disabled_at,
    DROP COLUMN IF EXISTS role;
