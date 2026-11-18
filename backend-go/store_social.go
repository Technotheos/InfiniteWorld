package main

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ---------------------------------------------------------------------------
// Social storage: follows, friends (= mutual follows), privacy choices and the
// numbers shown on a profile card.
//
// It is a separate interface from UserStore on purpose: pgStore implements it
// with SQL, and everything else (tests, ALLOW_MEMORY_STORE=1) gets the small
// in-memory version at the bottom of this file.
// ---------------------------------------------------------------------------

var ErrSelfFollow = errors.New("you cannot follow yourself")

const (
	policyEveryone = "everyone"
	policyFriends  = "friends"
	policyNobody   = "nobody"
)

func validPolicy(s string) bool {
	return s == policyEveryone || s == policyFriends || s == policyNobody
}

// Privacy is what a user chose in Settings.
type Privacy struct {
	HidePresence bool   `json:"hide_presence"`
	DM           string `json:"dm"`   // who can message me
	Find         string `json:"find"` // who can find me in search
}

// UserCard is the public side of a profile.
type UserCard struct {
	Username      string
	Bio           string
	CreatedAt     time.Time
	AvatarUpdated time.Time
	XP, Streak    int
	Badges        []string
	Followers     int
	Following     int
	Friends       int
	Privacy       Privacy
}

type SocialStore interface {
	Follow(ctx context.Context, follower, followee string) error
	Unfollow(ctx context.Context, follower, followee string) error
	// Relation reports whether viewer follows target, and whether target follows viewer.
	Relation(ctx context.Context, viewer, target string) (iFollow, followsMe bool, err error)
	Card(ctx context.Context, username string) (UserCard, error)
	Friends(ctx context.Context, username string) ([]string, error)
	GetPrivacy(ctx context.Context, username string) (Privacy, error)
	SetPrivacy(ctx context.Context, username string, p Privacy) error
	// Search finds users by name prefix, honouring each user's "who can find me".
	Search(ctx context.Context, viewer, prefix string, limit int) ([]string, error)
}

// socialStore returns PostgreSQL when it is the active store, else the in-memory one.
func socialStore() SocialStore {
	if s, ok := store.(*pgStore); ok {
		return s
	}
	return memorySocial
}

// ===========================================================================
// PostgreSQL
// ===========================================================================

func (s *pgStore) Follow(ctx context.Context, follower, followee string) error {
	if follower == followee {
		return ErrSelfFollow
	}
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO follows (follower_id, followee_id)
		 SELECT a.id, b.id FROM users a, users b
		  WHERE a.username = $1 AND b.username = $2 AND b.disabled_at IS NULL
		 ON CONFLICT DO NOTHING`, follower, followee)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Already following (fine), or the target does not exist.
		var ok bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM users WHERE username = $1 AND disabled_at IS NULL)`, followee).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrUserNotFound
		}
	}
	return nil
}

func (s *pgStore) Unfollow(ctx context.Context, follower, followee string) error {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	_, err := s.pool.Exec(ctx,
		`DELETE FROM follows
		  WHERE follower_id = (SELECT id FROM users WHERE username = $1)
		    AND followee_id = (SELECT id FROM users WHERE username = $2)`, follower, followee)
	return err
}

func (s *pgStore) Relation(ctx context.Context, viewer, target string) (bool, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var a, b bool
	err := s.pool.QueryRow(ctx,
		`SELECT
		   EXISTS (SELECT 1 FROM follows f JOIN users x ON x.id = f.follower_id JOIN users y ON y.id = f.followee_id
		            WHERE x.username = $1 AND y.username = $2),
		   EXISTS (SELECT 1 FROM follows f JOIN users x ON x.id = f.follower_id JOIN users y ON y.id = f.followee_id
		            WHERE x.username = $2 AND y.username = $1)`, viewer, target).Scan(&a, &b)
	return a, b, err
}

func (s *pgStore) Card(ctx context.Context, username string) (UserCard, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var c UserCard
	var avatarAt *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT u.username, u.bio, u.created_at, u.avatar_updated_at, u.xp, u.streak, u.badges,
		        (SELECT count(*) FROM follows WHERE followee_id = u.id),
		        (SELECT count(*) FROM follows WHERE follower_id = u.id),
		        (SELECT count(*) FROM follows f1
		           JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
		          WHERE f1.follower_id = u.id),
		        u.hide_presence, u.dm_policy, u.find_policy
		   FROM users u WHERE u.username = $1 AND u.disabled_at IS NULL`, username,
	).Scan(&c.Username, &c.Bio, &c.CreatedAt, &avatarAt, &c.XP, &c.Streak, &c.Badges,
		&c.Followers, &c.Following, &c.Friends,
		&c.Privacy.HidePresence, &c.Privacy.DM, &c.Privacy.Find)
	if err != nil {
		if isNoRows(err) {
			return UserCard{}, ErrUserNotFound
		}
		return UserCard{}, err
	}
	if avatarAt != nil {
		c.AvatarUpdated = *avatarAt
	}
	if c.Badges == nil {
		c.Badges = []string{}
	}
	return c, nil
}

func (s *pgStore) Friends(ctx context.Context, username string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	rows, err := s.pool.Query(ctx,
		`SELECT x.username
		   FROM users u
		   JOIN follows f1 ON f1.follower_id = u.id
		   JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = u.id
		   JOIN users x ON x.id = f1.followee_id
		  WHERE u.username = $1 AND x.disabled_at IS NULL
		  ORDER BY x.username LIMIT 500`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *pgStore) GetPrivacy(ctx context.Context, username string) (Privacy, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var p Privacy
	err := s.pool.QueryRow(ctx,
		`SELECT hide_presence, dm_policy, find_policy FROM users WHERE username = $1`, username,
	).Scan(&p.HidePresence, &p.DM, &p.Find)
	if isNoRows(err) {
		return Privacy{}, ErrUserNotFound
	}
	return p, err
}

func (s *pgStore) SetPrivacy(ctx context.Context, username string, p Privacy) error {
	return s.execOne(ctx,
		`UPDATE users SET hide_presence = $2, dm_policy = $3, find_policy = $4 WHERE username = $1`,
		username, p.HidePresence, p.DM, p.Find)
}

func (s *pgStore) Search(ctx context.Context, viewer, prefix string, limit int) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	// starts_with() instead of LIKE, so "_" and "%" in the query are plain characters.
	rows, err := s.pool.Query(ctx,
		`SELECT u.username FROM users u
		  WHERE starts_with(u.username, $2) AND u.username <> $1 AND u.disabled_at IS NULL
		    AND (u.find_policy = 'everyone'
		         OR (u.find_policy = 'friends' AND EXISTS (
		               SELECT 1 FROM follows f1
		                 JOIN users v ON v.id = f1.follower_id AND v.username = $1
		                 JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
		                WHERE f1.followee_id = u.id)))
		  ORDER BY u.username LIMIT $3`, viewer, prefix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ===========================================================================
// In-memory (tests and ALLOW_MEMORY_STORE=1). Follows are keyed by username,
// so unlike PostgreSQL a rename drops them: acceptable for throwaway data.
// ===========================================================================

type memSocial struct {
	mu      sync.Mutex
	follows map[string]map[string]bool // follower -> followee set
	privacy map[string]Privacy
}

var memorySocial = &memSocial{follows: map[string]map[string]bool{}, privacy: map[string]Privacy{}}

func (m *memSocial) Follow(ctx context.Context, follower, followee string) error {
	if follower == followee {
		return ErrSelfFollow
	}
	if ok, _ := (memoryStore{}).Exists(ctx, followee); !ok {
		return ErrUserNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.follows[follower] == nil {
		m.follows[follower] = map[string]bool{}
	}
	m.follows[follower][followee] = true
	return nil
}

func (m *memSocial) Unfollow(_ context.Context, follower, followee string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.follows[follower], followee)
	return nil
}

func (m *memSocial) Relation(_ context.Context, viewer, target string) (bool, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.follows[viewer][target], m.follows[target][viewer], nil
}

func (m *memSocial) Card(ctx context.Context, username string) (UserCard, error) {
	p, err := (memoryStore{}).Profile(ctx, username)
	if err != nil {
		return UserCard{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	c := UserCard{Username: p.Username, Bio: p.Bio, CreatedAt: p.CreatedAt, AvatarUpdated: p.AvatarUpdated,
		Badges: []string{}, Privacy: m.privacyLocked(username)}
	for f, set := range m.follows {
		if set[username] {
			c.Followers++
		}
		if f == username {
			for to := range set {
				c.Following++
				if m.follows[to][username] {
					c.Friends++
				}
			}
		}
	}
	return c, nil
}

func (m *memSocial) Friends(_ context.Context, username string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []string{}
	for to := range m.follows[username] {
		if m.follows[to][username] {
			out = append(out, to)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (m *memSocial) privacyLocked(u string) Privacy {
	if p, ok := m.privacy[u]; ok {
		return p
	}
	return Privacy{DM: policyEveryone, Find: policyEveryone}
}

func (m *memSocial) GetPrivacy(ctx context.Context, username string) (Privacy, error) {
	if ok, _ := (memoryStore{}).Exists(ctx, username); !ok {
		return Privacy{}, ErrUserNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.privacyLocked(username), nil
}

func (m *memSocial) SetPrivacy(_ context.Context, username string, p Privacy) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.privacy[username] = p
	return nil
}

func (m *memSocial) Search(_ context.Context, viewer, prefix string, limit int) ([]string, error) {
	mu.RLock()
	names := make([]string, 0, len(users))
	for n := range users {
		names = append(names, n)
	}
	mu.RUnlock()
	sort.Strings(names)

	m.mu.Lock()
	defer m.mu.Unlock()
	out := []string{}
	for _, n := range names {
		if n == viewer || !strings.HasPrefix(n, prefix) {
			continue
		}
		switch m.privacyLocked(n).Find {
		case policyNobody:
			continue
		case policyFriends:
			if !(m.follows[viewer][n] && m.follows[n][viewer]) {
				continue
			}
		}
		if out = append(out, n); len(out) >= limit {
			break
		}
	}
	return out, nil
}
