-- Roles, account disabling, revocable sessions and an append-only audit log.

ALTER TABLE users
    ADD COLUMN role            text        NOT NULL DEFAULT 'user',
    ADD COLUMN disabled_at     timestamptz,
    ADD COLUMN disabled_reason text        NOT NULL DEFAULT '',
    -- Bumped to invalidate every access token issued before ("log out everywhere").
    ADD COLUMN token_version   integer     NOT NULL DEFAULT 0,
    ADD CONSTRAINT users_role_valid     CHECK (role IN ('user', 'moderator', 'admin')),
    ADD CONSTRAINT users_reason_length  CHECK (char_length(disabled_reason) <= 200);

CREATE INDEX users_role_idx ON users (role) WHERE role <> 'user';

-- refresh_tokens (created in 000001) gains what rotation + the device list need.
ALTER TABLE refresh_tokens
    ADD COLUMN family_started_at timestamptz NOT NULL DEFAULT now(),
    -- Absolute cap: a rotation chain can never outlive this, however often it is used.
    ADD COLUMN family_expires_at timestamptz NOT NULL DEFAULT now() + interval '60 days',
    ADD COLUMN last_used_at      timestamptz,
    ADD COLUMN replaced_by       uuid,
    ADD COLUMN user_agent        text        NOT NULL DEFAULT '',
    ADD COLUMN ip                text        NOT NULL DEFAULT '',
    ADD CONSTRAINT refresh_tokens_ua_length CHECK (char_length(user_agent) <= 300),
    ADD CONSTRAINT refresh_tokens_ip_length CHECK (char_length(ip) <= 64);

-- Append-only record of security-relevant events. Names are copied as text so
-- the history survives renames and account deletion.
CREATE TABLE audit_log (
    id              bigserial   PRIMARY KEY,
    at              timestamptz NOT NULL DEFAULT now(),
    actor_username  text        NOT NULL DEFAULT '',
    action          text        NOT NULL,
    target_username text        NOT NULL DEFAULT '',
    success         boolean     NOT NULL DEFAULT true,
    ip              text        NOT NULL DEFAULT '',
    user_agent      text        NOT NULL DEFAULT '',
    detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT audit_action_length CHECK (char_length(action) BETWEEN 1 AND 64),
    CONSTRAINT audit_detail_size   CHECK (octet_length(detail::text) <= 4096)
);

CREATE INDEX audit_log_actor_idx  ON audit_log (actor_username, id DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_username, id DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_no_change   BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW       EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
