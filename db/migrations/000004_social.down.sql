ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_badges_size,
    DROP CONSTRAINT IF EXISTS users_streak_range,
    DROP CONSTRAINT IF EXISTS users_xp_range,
    DROP CONSTRAINT IF EXISTS users_find_policy_valid,
    DROP CONSTRAINT IF EXISTS users_dm_policy_valid,
    DROP COLUMN IF EXISTS badges,
    DROP COLUMN IF EXISTS streak,
    DROP COLUMN IF EXISTS xp,
    DROP COLUMN IF EXISTS find_policy,
    DROP COLUMN IF EXISTS dm_policy,
    DROP COLUMN IF EXISTS hide_presence;

DROP INDEX IF EXISTS follows_followee_idx;
DROP TABLE IF EXISTS follows;
