-- Profile fields: bio, avatar, and a cooldown marker for username changes.
-- The avatar is a small (<= ~256 KB) JPEG the server has already re-encoded.

ALTER TABLE users
    ADD COLUMN bio                 text        NOT NULL DEFAULT '',
    ADD COLUMN avatar              bytea,
    ADD COLUMN avatar_updated_at   timestamptz,
    ADD COLUMN username_changed_at timestamptz,
    ADD CONSTRAINT users_bio_length    CHECK (char_length(bio) <= 160),
    ADD CONSTRAINT users_avatar_size   CHECK (avatar IS NULL OR octet_length(avatar) <= 262144);
