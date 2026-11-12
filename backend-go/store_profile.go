package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// Profile storage: bio, avatar, username changes, password changes.
// ---------------------------------------------------------------------------

var ErrUserNotFound = errors.New("user not found")

// RenameTooSoonError is returned by Rename while the cooldown is running.
type RenameTooSoonError struct{ Until time.Time }

func (e *RenameTooSoonError) Error() string {
	return fmt.Sprintf("username can be changed again after %s", e.Until.UTC().Format(time.RFC3339))
}

// Profile is what GET /api/me returns about a user.
type Profile struct {
	Username          string
	Bio               string
	CreatedAt         time.Time
	AvatarUpdated     time.Time // zero when there is no avatar
	UsernameChangedAt time.Time // zero when never changed
}

// ---- in-memory ------------------------------------------------------------

func (memoryStore) Profile(_ context.Context, username string) (Profile, error) {
	mu.RLock()
	defer mu.RUnlock()
	u, ok := users[username]
	if !ok {
		return Profile{}, ErrUserNotFound
	}
	return Profile{
		Username: u.Username, Bio: u.Bio, CreatedAt: u.CreatedAt,
		AvatarUpdated: u.AvatarUpdated, UsernameChangedAt: u.UsernameChangedAt,
	}, nil
}

func (memoryStore) SetBio(_ context.Context, username, bio string) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Bio = bio
	users[username] = u
	return nil
}

func (memoryStore) SetAvatar(_ context.Context, username string, jpeg []byte) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Avatar = append([]byte(nil), jpeg...)
	u.AvatarUpdated = time.Now()
	users[username] = u
	return nil
}

func (memoryStore) RemoveAvatar(_ context.Context, username string) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Avatar, u.AvatarUpdated = nil, time.Time{}
	users[username] = u
	return nil
}

func (memoryStore) Avatar(_ context.Context, username string) ([]byte, time.Time, bool, error) {
	mu.RLock()
	defer mu.RUnlock()
	u, ok := users[username]
	if !ok || len(u.Avatar) == 0 {
		return nil, time.Time{}, false, nil
	}
	return u.Avatar, u.AvatarUpdated, true, nil
}

func (memoryStore) Rename(_ context.Context, oldName, newName string, cooldown time.Duration) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[oldName]
	if !ok {
		return ErrUserNotFound
	}
	if !u.UsernameChangedAt.IsZero() && time.Since(u.UsernameChangedAt) < cooldown {
		return &RenameTooSoonError{Until: u.UsernameChangedAt.Add(cooldown)}
	}
	if _, taken := users[newName]; taken {
		return ErrUsernameTaken
	}
	delete(users, oldName)
	u.Username = newName
	u.UsernameChangedAt = time.Now()
	users[newName] = u
	return nil
}

func (memoryStore) SetPassword(_ context.Context, username, hash string) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Password = hash
	users[username] = u
	return nil
}

// ---- PostgreSQL -----------------------------------------------------------

func (s *pgStore) Profile(ctx context.Context, username string) (Profile, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()

	var p Profile
	var avatarAt, changedAt *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT username, bio, created_at, avatar_updated_at, username_changed_at
		   FROM users WHERE username = $1`, username,
	).Scan(&p.Username, &p.Bio, &p.CreatedAt, &avatarAt, &changedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrUserNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	if avatarAt != nil {
		p.AvatarUpdated = *avatarAt
	}
	if changedAt != nil {
		p.UsernameChangedAt = *changedAt
	}
	return p, nil
}

// execOne runs an UPDATE that must touch exactly one user.
func (s *pgStore) execOne(ctx context.Context, sql string, args ...any) error {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, sql, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (s *pgStore) SetBio(ctx context.Context, username, bio string) error {
	return s.execOne(ctx, `UPDATE users SET bio = $2 WHERE username = $1`, username, bio)
}

func (s *pgStore) SetAvatar(ctx context.Context, username string, jpeg []byte) error {
	return s.execOne(ctx,
		`UPDATE users SET avatar = $2, avatar_updated_at = now() WHERE username = $1`, username, jpeg)
}

func (s *pgStore) RemoveAvatar(ctx context.Context, username string) error {
	return s.execOne(ctx,
		`UPDATE users SET avatar = NULL, avatar_updated_at = NULL WHERE username = $1`, username)
}

func (s *pgStore) Avatar(ctx context.Context, username string) ([]byte, time.Time, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()

	var data []byte
	var updated *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT avatar, avatar_updated_at FROM users WHERE username = $1 AND avatar IS NOT NULL`, username,
	).Scan(&data, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, false, nil
	}
	if err != nil {
		return nil, time.Time{}, false, err
	}
	at := time.Time{}
	if updated != nil {
		at = *updated
	}
	return data, at, true, nil
}

func (s *pgStore) Rename(ctx context.Context, oldName, newName string, cooldown time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()

	// One atomic statement: the cooldown is checked in the WHERE clause, so two
	// racing requests cannot both rename.
	tag, err := s.pool.Exec(ctx,
		`UPDATE users
		    SET username = $2, username_changed_at = now()
		  WHERE username = $1
		    AND (username_changed_at IS NULL OR username_changed_at < now() - make_interval(secs => $3))`,
		oldName, newName, cooldown.Seconds())
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrUsernameTaken
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either the user vanished or the cooldown is still running.
		var changedAt *time.Time
		qerr := s.pool.QueryRow(ctx, `SELECT username_changed_at FROM users WHERE username = $1`, oldName).Scan(&changedAt)
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		if qerr != nil {
			return qerr
		}
		if changedAt != nil {
			return &RenameTooSoonError{Until: changedAt.Add(cooldown)}
		}
		return ErrUserNotFound
	}

	// Forget the cached "old name exists" answer so old tokens stop working now.
	s.cacheMu.Lock()
	delete(s.cache, oldName)
	s.cacheMu.Unlock()
	return nil
}

func (s *pgStore) SetPassword(ctx context.Context, username, hash string) error {
	return s.execOne(ctx, `UPDATE users SET password_hash = $2 WHERE username = $1`, username, hash)
}
