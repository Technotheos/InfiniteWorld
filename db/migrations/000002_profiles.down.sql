ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_avatar_size,
    DROP CONSTRAINT IF EXISTS users_bio_length,
    DROP COLUMN IF EXISTS username_changed_at,
    DROP COLUMN IF EXISTS avatar_updated_at,
    DROP COLUMN IF EXISTS avatar,
    DROP COLUMN IF EXISTS bio;
