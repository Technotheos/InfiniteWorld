package main

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Storage for roles, sessions (refresh tokens) and the audit log.
// Same two implementations as store.go: pgStore and the in-memory twin.
// ---------------------------------------------------------------------------

var (
	ErrSessionInvalid = errors.New("session is not valid")
	ErrSessionRace    = errors.New("session was just rotated, retry")
	ErrSessionReuse   = errors.New("refresh token reuse detected")
)

// rotationGrace: two tabs refreshing at once is not an attack. A var so tests can shrink it.
var rotationGrace = 10 * time.Second

const authCacheTTL = 5 * time.Second

// uuidRe guards values that are cast to uuid in SQL.
var uuidRe = regexp.MustCompile(`^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type AuthInfo struct {
	ID           string
	Username     string
	Role         Role
	Disabled     bool
	TokenVersion int
}

type AdminUser struct {
	Username       string    `json:"username"`
	Role           Role      `json:"role"`
	CreatedAt      time.Time `json:"created_at"`
	Disabled       bool      `json:"disabled"`
	DisabledReason string    `json:"disabled_reason,omitempty"`
	Sessions       int       `json:"sessions"`
}

type SessionInfo struct {
	ID        string    `json:"id"`
	StartedAt time.Time `json:"started_at"`
	LastUsed  time.Time `json:"last_used"`
	UserAgent string    `json:"user_agent"`
	IP        string    `json:"ip"`
	Current   bool      `json:"current"`
}

type NewSession struct {
	UserID, FamilyID string
	Hash             []byte
	Expires          time.Time
	FamilyExpires    time.Time
	UserAgent, IP    string
}

type RotateResult struct{ Username string }

// ===========================================================================
// PostgreSQL
// ===========================================================================

type authEntry struct {
	info  AuthInfo
	until time.Time
}

// invalidate forgets cached auth state so role/disable/revoke changes apply at once.
func (s *pgStore) invalidate(usernames ...string) {
	s.cacheMu.Lock()
	for _, u := range usernames {
		delete(s.cache, u)
		delete(s.authCache, u)
	}
	s.cacheMu.Unlock()
}

func (s *pgStore) AuthState(ctx context.Context, username string) (AuthInfo, bool, error) {
	now := time.Now()
	s.cacheMu.Lock()
	e, hit := s.authCache[username]
	s.cacheMu.Unlock()
	if hit && now.Before(e.until) {
		return e.info, true, nil
	}

	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	info := AuthInfo{Username: username}
	var role string
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, role, disabled_at IS NOT NULL, token_version FROM users WHERE username = $1`, username,
	).Scan(&info.ID, &role, &info.Disabled, &info.TokenVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return AuthInfo{}, false, nil
	}
	if err != nil {
		return AuthInfo{}, false, err
	}
	info.Role = Role(role).norm()

	s.cacheMu.Lock()
	if len(s.authCache) > 10000 {
		for k, v := range s.authCache {
			if now.After(v.until) {
				delete(s.authCache, k)
			}
		}
	}
	s.authCache[username] = authEntry{info: info, until: now.Add(authCacheTTL)}
	s.cacheMu.Unlock()
	return info, true, nil
}

func (s *pgStore) ListUsers(ctx context.Context, prefix, after string, limit int) ([]AdminUser, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT u.username, u.role, u.created_at, u.disabled_at IS NOT NULL, u.disabled_reason,
		       (SELECT count(DISTINCT rt.family_id) FROM refresh_tokens rt
		         WHERE rt.user_id = u.id AND rt.revoked_at IS NULL
		           AND rt.expires_at > now() AND rt.family_expires_at > now())
		  FROM users u
		 WHERE ($1 = '' OR starts_with(u.username, $1)) AND u.username > $2
		 ORDER BY u.username
		 LIMIT $3`, prefix, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		var role string
		if err := rows.Scan(&u.Username, &role, &u.CreatedAt, &u.Disabled, &u.DisabledReason, &u.Sessions); err != nil {
			return nil, err
		}
		u.Role = Role(role).norm()
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *pgStore) SetRole(ctx context.Context, username string, role Role) error {
	defer s.invalidate(username)
	return s.execOne(ctx, `UPDATE users SET role = $2 WHERE username = $1`, username, string(role))
}

func (s *pgStore) SetDisabled(ctx context.Context, username string, disabled bool, reason string) error {
	defer s.invalidate(username)
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var id string
	err = tx.QueryRow(ctx, `
		UPDATE users
		   SET disabled_at     = CASE WHEN $2 THEN now() ELSE NULL END,
		       disabled_reason = CASE WHEN $2 THEN $3 ELSE '' END,
		       token_version   = token_version + CASE WHEN $2 THEN 1 ELSE 0 END
		 WHERE username = $1
		 RETURNING id::text`, username, disabled, reason).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return err
	}
	if disabled {
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL`, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *pgStore) CountAdmins(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL`).Scan(&n)
	return n, err
}

func (s *pgStore) RevokeAllSessions(ctx context.Context, username string) error {
	defer s.invalidate(username)
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var id string
	err = tx.QueryRow(ctx,
		`UPDATE users SET token_version = token_version + 1 WHERE username = $1 RETURNING id::text`, username).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1::uuid AND revoked_at IS NULL`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *pgStore) CreateSession(ctx context.Context, n NewSession) error {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO refresh_tokens
		  (user_id, family_id, token_hash, expires_at, family_started_at, family_expires_at, user_agent, ip)
		VALUES ($1::uuid, $2::uuid, $3, $4, now(), $5, $6, $7)`,
		n.UserID, n.FamilyID, n.Hash, n.Expires, n.FamilyExpires, clip(n.UserAgent, 300), clip(n.IP, 64))
	return err
}

func (s *pgStore) RotateSession(ctx context.Context, oldHash, newHash []byte, newExpires time.Time, ua, ip string) (RotateResult, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RotateResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		id, userID, familyID, username  string
		expires, famExpires, famStarted time.Time
		revokedAt                       *time.Time
		replacedBy                      *string
		disabled                        bool
	)
	// FOR UPDATE serialises two requests presenting the same token.
	err = tx.QueryRow(ctx, `
		SELECT rt.id::text, rt.user_id::text, rt.family_id::text, rt.expires_at, rt.family_expires_at,
		       rt.family_started_at, rt.revoked_at, rt.replaced_by::text, u.username, u.disabled_at IS NOT NULL
		  FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
		 WHERE rt.token_hash = $1
		   FOR UPDATE OF rt`, oldHash,
	).Scan(&id, &userID, &familyID, &expires, &famExpires, &famStarted, &revokedAt, &replacedBy, &username, &disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return RotateResult{}, ErrSessionInvalid
	}
	if err != nil {
		return RotateResult{}, err
	}

	now := time.Now()
	if revokedAt != nil {
		if replacedBy == nil { // logged out or revoked by an admin: just refuse
			return RotateResult{}, ErrSessionInvalid
		}
		if now.Sub(*revokedAt) < rotationGrace { // concurrent refresh from the same browser
			return RotateResult{}, ErrSessionRace
		}
		// An already-rotated token came back later: assume it was stolen and
		// kill the whole chain. Commit this, it is the point of the call.
		if _, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1::uuid AND revoked_at IS NULL`, familyID); err != nil {
			return RotateResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return RotateResult{}, err
		}
		return RotateResult{Username: username}, ErrSessionReuse
	}
	if disabled || now.After(expires) || now.After(famExpires) {
		return RotateResult{}, ErrSessionInvalid
	}
	if newExpires.After(famExpires) {
		newExpires = famExpires
	}

	var newID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO refresh_tokens
		  (user_id, family_id, token_hash, expires_at, family_started_at, family_expires_at, last_used_at, user_agent, ip)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, now(), $7, $8)
		RETURNING id::text`,
		userID, familyID, newHash, newExpires, famStarted, famExpires, clip(ua, 300), clip(ip, 64),
	).Scan(&newID); err != nil {
		return RotateResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now(), last_used_at = now(), replaced_by = $2::uuid WHERE id = $1::uuid`,
		id, newID); err != nil {
		return RotateResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RotateResult{}, err
	}
	return RotateResult{Username: username}, nil
}

func (s *pgStore) RevokeSessionByHash(ctx context.Context, hash []byte) (string, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var username string
	err := s.pool.QueryRow(ctx, `
		WITH fam AS (
		  SELECT rt.family_id, u.username FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
		   WHERE rt.token_hash = $1)
		UPDATE refresh_tokens r SET revoked_at = now()
		  FROM fam WHERE r.family_id = fam.family_id AND r.revoked_at IS NULL
		RETURNING fam.username`, hash).Scan(&username)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return username, err == nil, err
}

func (s *pgStore) RevokeFamily(ctx context.Context, username, familyID string) (bool, error) {
	if !uuidRe.MatchString(familyID) {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	tag, err := s.pool.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = now()
		 WHERE family_id = $2::uuid AND revoked_at IS NULL
		   AND user_id = (SELECT id FROM users WHERE username = $1)`, username, familyID)
	return tag.RowsAffected() > 0, err
}

func (s *pgStore) ListSessions(ctx context.Context, username string, currentHash []byte) ([]SessionInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT rt.family_id::text, rt.family_started_at, COALESCE(rt.last_used_at, rt.issued_at),
		       rt.user_agent, rt.ip, rt.token_hash
		  FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
		 WHERE u.username = $1 AND rt.revoked_at IS NULL
		   AND rt.expires_at > now() AND rt.family_expires_at > now()
		 ORDER BY COALESCE(rt.last_used_at, rt.issued_at) DESC
		 LIMIT 50`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionInfo{}
	for rows.Next() {
		var si SessionInfo
		var hash []byte
		if err := rows.Scan(&si.ID, &si.StartedAt, &si.LastUsed, &si.UserAgent, &si.IP, &hash); err != nil {
			return nil, err
		}
		si.Current = len(currentHash) > 0 && subtle.ConstantTimeCompare(hash, currentHash) == 1
		out = append(out, si)
	}
	return out, rows.Err()
}

func (s *pgStore) PurgeSessions(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := s.pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`)
	return err
}

func (s *pgStore) AuditWrite(ctx context.Context, e AuditEvent) error {
	detail := []byte("{}")
	if len(e.Detail) > 0 {
		if b, err := json.Marshal(e.Detail); err == nil && len(b) <= 4000 {
			detail = b
		}
	}
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_log (actor_username, action, target_username, success, ip, user_agent, detail)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
		clip(e.Actor, 64), clip(e.Action, 64), clip(e.Target, 64), e.Success, clip(e.IP, 64), clip(e.UserAgent, 300), string(detail))
	return err
}

func (s *pgStore) AuditList(ctx context.Context, f AuditFilter) ([]AuditEvent, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	rows, err := s.pool.Query(ctx, `
		SELECT id, at, actor_username, action, target_username, success, ip, user_agent, detail
		  FROM audit_log
		 WHERE ($1::bigint = 0 OR id < $1)
		   AND ($2 = '' OR starts_with(action, $2))
		   AND ($3 = '' OR actor_username = $3 OR target_username = $3)
		 ORDER BY id DESC
		 LIMIT $4`, f.Before, f.ActionPrefix, f.User, f.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEvent{}
	for rows.Next() {
		var e AuditEvent
		var detail []byte
		if err := rows.Scan(&e.ID, &e.At, &e.Actor, &e.Action, &e.Target, &e.Success, &e.IP, &e.UserAgent, &detail); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(detail, &e.Detail)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ===========================================================================
// In-memory twin (tests and ALLOW_MEMORY_STORE=1). Shares `users` and `mu`.
// ===========================================================================

type memSession struct {
	id, userID, username, family string
	hash                         string // hex
	issued, expires, famExpires  time.Time
	famStarted, lastUsed         time.Time
	revokedAt                    time.Time
	replacedBy                   string
	ua, ip                       string
}

var (
	memSessions []*memSession
	memAudit    []AuditEvent
	memAuditSeq int64
)

func normRole(r Role) Role { return r.norm() }

func (memoryStore) AuthState(_ context.Context, username string) (AuthInfo, bool, error) {
	mu.RLock()
	defer mu.RUnlock()
	u, ok := users[username]
	if !ok {
		return AuthInfo{}, false, nil
	}
	return AuthInfo{ID: u.ID, Username: u.Username, Role: normRole(u.Role),
		Disabled: !u.DisabledAt.IsZero(), TokenVersion: u.TokenVersion}, true, nil
}

func (memoryStore) ListUsers(_ context.Context, prefix, after string, limit int) ([]AdminUser, error) {
	mu.RLock()
	defer mu.RUnlock()
	names := make([]string, 0, len(users))
	for n := range users {
		if n > after && (prefix == "" || strings.HasPrefix(n, prefix)) {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	if len(names) > limit {
		names = names[:limit]
	}
	out := []AdminUser{}
	for _, n := range names {
		u := users[n]
		cnt := map[string]bool{}
		for _, s := range memSessions {
			if s.userID == u.ID && s.revokedAt.IsZero() && time.Now().Before(s.expires) {
				cnt[s.family] = true
			}
		}
		out = append(out, AdminUser{Username: u.Username, Role: normRole(u.Role), CreatedAt: u.CreatedAt,
			Disabled: !u.DisabledAt.IsZero(), DisabledReason: u.DisabledReason, Sessions: len(cnt)})
	}
	return out, nil
}

func (memoryStore) SetRole(_ context.Context, username string, role Role) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Role = role
	users[username] = u
	return nil
}

func revokeUserSessionsLocked(userID string) {
	now := time.Now()
	for _, s := range memSessions {
		if s.userID == userID && s.revokedAt.IsZero() {
			s.revokedAt = now
		}
	}
}

func (memoryStore) SetDisabled(_ context.Context, username string, disabled bool, reason string) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	if disabled {
		u.DisabledAt, u.DisabledReason = time.Now(), reason
		u.TokenVersion++
		revokeUserSessionsLocked(u.ID)
	} else {
		u.DisabledAt, u.DisabledReason = time.Time{}, ""
	}
	users[username] = u
	return nil
}

func (memoryStore) CountAdmins(_ context.Context) (int, error) {
	mu.RLock()
	defer mu.RUnlock()
	n := 0
	for _, u := range users {
		if normRole(u.Role) == RoleAdmin && u.DisabledAt.IsZero() {
			n++
		}
	}
	return n, nil
}

func (memoryStore) RevokeAllSessions(_ context.Context, username string) error {
	mu.Lock()
	defer mu.Unlock()
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.TokenVersion++
	users[username] = u
	revokeUserSessionsLocked(u.ID)
	return nil
}

func (memoryStore) CreateSession(_ context.Context, n NewSession) error {
	mu.Lock()
	defer mu.Unlock()
	var name string
	for _, u := range users {
		if u.ID == n.UserID {
			name = u.Username
		}
	}
	now := time.Now()
	memSessions = append(memSessions, &memSession{
		id: mustID(), userID: n.UserID, username: name, family: n.FamilyID, hash: hex.EncodeToString(n.Hash),
		issued: now, expires: n.Expires, famExpires: n.FamilyExpires, famStarted: now, ua: n.UserAgent, ip: n.IP,
	})
	return nil
}

func mustID() string {
	id, err := newID()
	if err != nil {
		panic(err)
	}
	return id
}

func findSessionLocked(hash []byte) *memSession {
	h := hex.EncodeToString(hash)
	for _, s := range memSessions {
		if s.hash == h {
			return s
		}
	}
	return nil
}

func (memoryStore) RotateSession(_ context.Context, oldHash, newHash []byte, newExpires time.Time, ua, ip string) (RotateResult, error) {
	mu.Lock()
	defer mu.Unlock()
	s := findSessionLocked(oldHash)
	if s == nil {
		return RotateResult{}, ErrSessionInvalid
	}
	now := time.Now()
	if !s.revokedAt.IsZero() {
		if s.replacedBy == "" {
			return RotateResult{}, ErrSessionInvalid
		}
		if now.Sub(s.revokedAt) < rotationGrace {
			return RotateResult{}, ErrSessionRace
		}
		for _, o := range memSessions {
			if o.family == s.family && o.revokedAt.IsZero() {
				o.revokedAt = now
			}
		}
		return RotateResult{Username: s.username}, ErrSessionReuse
	}
	u := users[s.username]
	if !u.DisabledAt.IsZero() || now.After(s.expires) || now.After(s.famExpires) {
		return RotateResult{}, ErrSessionInvalid
	}
	if newExpires.After(s.famExpires) {
		newExpires = s.famExpires
	}
	ns := &memSession{
		id: mustID(), userID: s.userID, username: s.username, family: s.family, hash: hex.EncodeToString(newHash),
		issued: now, expires: newExpires, famExpires: s.famExpires, famStarted: s.famStarted, lastUsed: now, ua: ua, ip: ip,
	}
	s.revokedAt, s.lastUsed, s.replacedBy = now, now, ns.id
	memSessions = append(memSessions, ns)
	return RotateResult{Username: s.username}, nil
}

func (memoryStore) RevokeSessionByHash(_ context.Context, hash []byte) (string, bool, error) {
	mu.Lock()
	defer mu.Unlock()
	s := findSessionLocked(hash)
	if s == nil {
		return "", false, nil
	}
	now := time.Now()
	for _, o := range memSessions {
		if o.family == s.family && o.revokedAt.IsZero() {
			o.revokedAt = now
		}
	}
	return s.username, true, nil
}

func (memoryStore) RevokeFamily(_ context.Context, username, familyID string) (bool, error) {
	mu.Lock()
	defer mu.Unlock()
	done := false
	for _, o := range memSessions {
		if o.username == username && o.family == familyID && o.revokedAt.IsZero() {
			o.revokedAt, done = time.Now(), true
		}
	}
	return done, nil
}

func (memoryStore) ListSessions(_ context.Context, username string, currentHash []byte) ([]SessionInfo, error) {
	mu.RLock()
	defer mu.RUnlock()
	cur := hex.EncodeToString(currentHash)
	out := []SessionInfo{}
	for _, s := range memSessions {
		if s.username != username || !s.revokedAt.IsZero() || time.Now().After(s.expires) {
			continue
		}
		last := s.lastUsed
		if last.IsZero() {
			last = s.issued
		}
		out = append(out, SessionInfo{ID: s.family, StartedAt: s.famStarted, LastUsed: last, UserAgent: s.ua, IP: s.ip,
			Current: len(currentHash) > 0 && s.hash == cur})
	}
	return out, nil
}

func (memoryStore) PurgeSessions(_ context.Context) error {
	mu.Lock()
	defer mu.Unlock()
	keep := memSessions[:0]
	for _, s := range memSessions {
		if s.expires.After(time.Now().Add(-7 * 24 * time.Hour)) {
			keep = append(keep, s)
		}
	}
	memSessions = keep
	return nil
}

func (memoryStore) AuditWrite(_ context.Context, e AuditEvent) error {
	mu.Lock()
	defer mu.Unlock()
	memAuditSeq++
	e.ID = memAuditSeq
	memAudit = append(memAudit, e)
	if len(memAudit) > 5000 {
		memAudit = memAudit[len(memAudit)-5000:]
	}
	return nil
}

func (memoryStore) AuditList(_ context.Context, f AuditFilter) ([]AuditEvent, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	mu.RLock()
	defer mu.RUnlock()
	out := []AuditEvent{}
	for i := len(memAudit) - 1; i >= 0 && len(out) < f.Limit; i-- {
		e := memAudit[i]
		if (f.Before != 0 && e.ID >= f.Before) ||
			(f.ActionPrefix != "" && !strings.HasPrefix(e.Action, f.ActionPrefix)) ||
			(f.User != "" && e.Actor != f.User && e.Target != f.User) {
			continue
		}
		out = append(out, e)
	}
	return out, nil
}
