-- Social layer: one-way follows (mutual follows = friends), privacy choices,
-- and the profile-card stats that Phase 3 (daily challenge) will fill in.
--
-- Follows point at users.id, not the username, so a rename never breaks them.

CREATE TABLE follows (
    follower_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    followee_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_id, followee_id),
    CONSTRAINT follows_not_self CHECK (follower_id <> followee_id)
);

-- "Who follows me?" and the friends join both read by followee.
CREATE INDEX follows_followee_idx ON follows (followee_id);

ALTER TABLE users
    ADD COLUMN hide_presence boolean NOT NULL DEFAULT false,
    ADD COLUMN dm_policy     text    NOT NULL DEFAULT 'everyone',
    ADD COLUMN find_policy   text    NOT NULL DEFAULT 'everyone',
    ADD COLUMN xp            integer NOT NULL DEFAULT 0,
    ADD COLUMN streak        integer NOT NULL DEFAULT 0,
    ADD COLUMN badges        text[]  NOT NULL DEFAULT '{}',
    ADD CONSTRAINT users_dm_policy_valid   CHECK (dm_policy   IN ('everyone', 'friends', 'nobody')),
    ADD CONSTRAINT users_find_policy_valid CHECK (find_policy IN ('everyone', 'friends', 'nobody')),
    ADD CONSTRAINT users_xp_range          CHECK (xp >= 0),
    ADD CONSTRAINT users_streak_range      CHECK (streak >= 0),
    ADD CONSTRAINT users_badges_size       CHECK (cardinality(badges) <= 32);
