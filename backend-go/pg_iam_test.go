package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

// PostgreSQL-backed tests for roles, sessions and the audit log. They share
// the TEST_DATABASE_URL gate with store_test.go and need migrations 1-3 applied.

func pgUser(t *testing.T, s *pgStore) User {
	t.Helper()
	u, err := s.Create(context.Background(), uniqueName(), "", strings.Repeat("h", 60))
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func pgSession(t *testing.T, s *pgStore, u User, family string) []byte {
	t.Helper()
	_, hash, _ := newRefreshToken()
	now := time.Now()
	if err := s.CreateSession(context.Background(), NewSession{
		UserID: u.ID, FamilyID: family, Hash: hash, Expires: now.Add(refreshTTL), FamilyExpires: now.Add(familyMaxAge),
		UserAgent: "test-agent", IP: "192.0.2.1",
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	return hash
}

func TestPGAuthStateRoleAndDisable(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	u := pgUser(t, s)

	info, ok, err := s.AuthState(ctx, u.Username)
	if err != nil || !ok || info.Role != RoleUser || info.Disabled || info.ID != u.ID {
		t.Fatalf("fresh user: %+v ok=%v err=%v", info, ok, err)
	}
	if err := s.SetRole(ctx, u.Username, RoleModerator); err != nil {
		t.Fatal(err)
	}
	if info, _, _ = s.AuthState(ctx, u.Username); info.Role != RoleModerator { // cache was invalidated
		t.Fatalf("role change not visible immediately: %v", info.Role)
	}
	if err := s.SetRole(ctx, u.Username, Role("superuser")); err == nil {
		t.Fatal("the database must reject unknown roles (CHECK constraint)")
	}

	h := pgSession(t, s, u, mustID())
	if err := s.SetDisabled(ctx, u.Username, true, "testing"); err != nil {
		t.Fatal(err)
	}
	info, _, _ = s.AuthState(ctx, u.Username)
	if !info.Disabled || info.TokenVersion != 1 {
		t.Fatalf("disable must flag the user and bump token_version: %+v", info)
	}
	if _, err := s.RotateSession(ctx, h, h, time.Now().Add(time.Hour), "", ""); err == nil {
		t.Fatal("a disabled user's refresh token must not rotate")
	}
	if err := s.SetDisabled(ctx, u.Username, false, ""); err != nil {
		t.Fatal(err)
	}
	if info, _, _ = s.AuthState(ctx, u.Username); info.Disabled || info.TokenVersion != 1 {
		t.Fatalf("enable: %+v", info)
	}
	if err := s.SetDisabled(ctx, "itest_nobody", true, ""); err != ErrUserNotFound {
		t.Fatalf("missing user: %v", err)
	}
}

func TestPGRefreshRotationAndReuseDetection(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	old := rotationGrace
	rotationGrace = 0
	defer func() { rotationGrace = old }()

	u := pgUser(t, s)
	h1 := pgSession(t, s, u, mustID())
	_, h2, _ := newRefreshToken()
	_, h3, _ := newRefreshToken()

	res, err := s.RotateSession(ctx, h1, h2, time.Now().Add(refreshTTL), "ua", "192.0.2.2")
	if err != nil || res.Username != u.Username {
		t.Fatalf("rotate: %+v %v", res, err)
	}
	// replay of the old token: whole family dies, and the call reports reuse
	res, err = s.RotateSession(ctx, h1, h3, time.Now().Add(refreshTTL), "", "")
	if err != ErrSessionReuse || res.Username != u.Username {
		t.Fatalf("reuse: %+v %v", res, err)
	}
	// the revocation must have been COMMITTED (not rolled back with the error)
	if _, err := s.RotateSession(ctx, h2, h3, time.Now().Add(refreshTTL), "", ""); err != ErrSessionInvalid {
		t.Fatalf("newer token in a compromised family must be dead, got %v", err)
	}
	if _, err := s.RotateSession(ctx, []byte("not-a-real-hash-not-a-real-hash!"), h3, time.Now().Add(time.Hour), "", ""); err != ErrSessionInvalid {
		t.Fatalf("unknown token: %v", err)
	}
}

func TestPGRotationGraceWindowAndExpiry(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	u := pgUser(t, s)
	h1 := pgSession(t, s, u, mustID())
	_, h2, _ := newRefreshToken()
	_, h3, _ := newRefreshToken()

	if _, err := s.RotateSession(ctx, h1, h2, time.Now().Add(refreshTTL), "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RotateSession(ctx, h1, h3, time.Now().Add(refreshTTL), "", ""); err != ErrSessionRace {
		t.Fatalf("immediate replay should be a race, got %v", err)
	}
	if _, err := s.RotateSession(ctx, h2, h3, time.Now().Add(refreshTTL), "", ""); err != nil {
		t.Fatalf("family must survive a race: %v", err)
	}

	// an already-expired token is refused
	_, he, _ := newRefreshToken()
	now := time.Now()
	if err := s.CreateSession(ctx, NewSession{UserID: u.ID, FamilyID: mustID(), Hash: he,
		Expires: now.Add(2 * time.Millisecond), FamilyExpires: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	if _, err := s.RotateSession(ctx, he, h3, now.Add(refreshTTL), "", ""); err != ErrSessionInvalid {
		t.Fatalf("expired: %v", err)
	}
	// the absolute family cap bounds rotation even for a fresh token
	_, hc, _ := newRefreshToken()
	_, hc2, _ := newRefreshToken()
	if err := s.CreateSession(ctx, NewSession{UserID: u.ID, FamilyID: mustID(), Hash: hc,
		Expires: now.Add(time.Hour), FamilyExpires: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RotateSession(ctx, hc, hc2, now.Add(refreshTTL), "", ""); err != nil {
		t.Fatal(err)
	}
	var exp, famExp time.Time
	if err := s.pool.QueryRow(ctx, `SELECT expires_at, family_expires_at FROM refresh_tokens WHERE token_hash = $1`, hc2).Scan(&exp, &famExp); err != nil {
		t.Fatal(err)
	}
	if exp.After(famExp) {
		t.Fatalf("rotated token outlives its family cap: %v > %v", exp, famExp)
	}
}

func TestPGSessionsListRevokeAndLogoutAll(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	u, other := pgUser(t, s), pgUser(t, s)
	famA, famB := mustID(), mustID()
	hA := pgSession(t, s, u, famA)
	hB := pgSession(t, s, u, famB)

	list, err := s.ListSessions(ctx, u.Username, hA)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: %v %v", list, err)
	}
	cur := 0
	for _, si := range list {
		if si.Current {
			cur++
		}
		if si.UserAgent != "test-agent" || si.IP != "192.0.2.1" {
			t.Fatalf("metadata lost: %+v", si)
		}
	}
	if cur != 1 {
		t.Fatalf("exactly one current session expected, got %d", cur)
	}

	// another user cannot revoke u's session; u can
	if ok, _ := s.RevokeFamily(ctx, other.Username, famB); ok {
		t.Fatal("cross-user revoke succeeded")
	}
	if ok, _ := s.RevokeFamily(ctx, u.Username, "not-a-uuid'; DROP TABLE users;--"); ok {
		t.Fatal("garbage id accepted")
	}
	if ok, err := s.RevokeFamily(ctx, u.Username, famB); !ok || err != nil {
		t.Fatalf("own revoke: %v %v", ok, err)
	}
	if _, err := s.RotateSession(ctx, hB, hB, time.Now().Add(time.Hour), "", ""); err != ErrSessionInvalid {
		t.Fatalf("revoked family still rotates: %v", err)
	}

	if name, ok, err := s.RevokeSessionByHash(ctx, hA); !ok || err != nil || name != u.Username {
		t.Fatalf("revoke by hash: %q %v %v", name, ok, err)
	}
	hC := pgSession(t, s, u, mustID())
	if err := s.RevokeAllSessions(ctx, u.Username); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.ListSessions(ctx, u.Username, nil); len(list) != 0 {
		t.Fatalf("sessions remain after revoke-all: %v", list)
	}
	if _, err := s.RotateSession(ctx, hC, hC, time.Now().Add(time.Hour), "", ""); err != ErrSessionInvalid {
		t.Fatalf("token survived revoke-all: %v", err)
	}
	if info, _, _ := s.AuthState(ctx, u.Username); info.TokenVersion != 1 {
		t.Fatalf("token_version not bumped: %d", info.TokenVersion)
	}
}

func TestPGListUsersSearchAndPaging(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		pgUser(t, s)
	}
	all, err := s.ListUsers(ctx, "itest_", "", 2)
	if err != nil || len(all) != 2 {
		t.Fatalf("page 1: %v %v", all, err)
	}
	next, _ := s.ListUsers(ctx, "itest_", all[1].Username, 10)
	if len(next) == 0 || next[0].Username <= all[1].Username {
		t.Fatalf("paging broken: %v", next)
	}
	// LIKE wildcards must be treated literally
	for _, q := range []string{"%", "_", "it%", "'; DROP TABLE users;--"} {
		if rows, err := s.ListUsers(ctx, q, "", 10); err != nil || len(rows) != 0 {
			t.Fatalf("prefix %q matched %d rows (err %v)", q, len(rows), err)
		}
	}
}

func TestPGRenameInvalidatesAuthCache(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	u := pgUser(t, s)
	if _, ok, _ := s.AuthState(ctx, u.Username); !ok { // warm the cache
		t.Fatal("user missing")
	}
	newName := uniqueName()
	if err := s.Rename(ctx, u.Username, newName, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.AuthState(ctx, u.Username); ok {
		t.Fatal("old username still authenticates from cache after rename")
	}
	if info, ok, _ := s.AuthState(ctx, newName); !ok || info.ID != u.ID {
		t.Fatalf("new name: %+v %v", info, ok)
	}
}

func TestPGAuditTrailIsAppendOnly(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	marker := "itest_" + mustID()[:8]
	for i, action := range []string{"auth.login", "admin.role_set", "auth.logout"} {
		err := s.AuditWrite(ctx, AuditEvent{Actor: marker, Action: action, Target: "t" + string(rune('a'+i)), Success: i != 0,
			IP: "192.0.2.9", UserAgent: "ua", Detail: map[string]any{"n": i, "note": "it's \"quoted\""}})
		if err != nil {
			t.Fatal(err)
		}
	}
	evs, err := s.AuditList(ctx, AuditFilter{User: marker, Limit: 10})
	if err != nil || len(evs) != 3 {
		t.Fatalf("list: %v %v", evs, err)
	}
	if evs[0].Action != "auth.logout" || evs[2].Action != "auth.login" || evs[2].Success {
		t.Fatalf("order/fields wrong: %+v", evs)
	}
	if evs[2].Detail["note"] != `it's "quoted"` {
		t.Fatalf("detail round-trip: %v", evs[2].Detail)
	}
	if only, _ := s.AuditList(ctx, AuditFilter{User: marker, ActionPrefix: "admin.", Limit: 10}); len(only) != 1 {
		t.Fatalf("prefix filter: %v", only)
	}
	if page, _ := s.AuditList(ctx, AuditFilter{User: marker, Before: evs[0].ID, Limit: 10}); len(page) != 2 {
		t.Fatalf("keyset paging: %v", page)
	}
	// even the application's own database role cannot rewrite history
	if _, err := s.pool.Exec(ctx, `UPDATE audit_log SET action = 'x' WHERE actor_username = $1`, marker); err == nil {
		t.Fatal("UPDATE on audit_log must be blocked")
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM audit_log WHERE actor_username = $1`, marker); err == nil {
		t.Fatal("DELETE on audit_log must be blocked")
	}
}

func TestPGPurgeKeepsRecentSessions(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	u := pgUser(t, s)
	_, fresh, _ := newRefreshToken()
	_, stale, _ := newRefreshToken()
	now := time.Now()
	_ = s.CreateSession(ctx, NewSession{UserID: u.ID, FamilyID: mustID(), Hash: fresh, Expires: now.Add(time.Hour), FamilyExpires: now.Add(time.Hour)})
	_ = s.CreateSession(ctx, NewSession{UserID: u.ID, FamilyID: mustID(), Hash: stale, Expires: now.Add(time.Millisecond), FamilyExpires: now.Add(time.Hour)})
	_, _ = s.pool.Exec(ctx, `UPDATE refresh_tokens SET issued_at = now() - interval '40 days', expires_at = now() - interval '30 days' WHERE token_hash = $1`, stale)
	if err := s.PurgeSessions(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1::uuid`, u.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("purge should remove only the long-expired token, %d rows remain", n)
	}
}
