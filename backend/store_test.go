package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// These tests need a real PostgreSQL with the migrations applied. They are
// skipped unless TEST_DATABASE_URL is set, e.g.
//
//	TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/dbname?sslmode=disable go test ./...
//
// Every user they create has an "itest_" prefix and is deleted afterwards.

func pgForTest(t *testing.T) (*pgStore, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run the PostgreSQL tests")
	}
	s, err := newPGStore(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `DELETE FROM users WHERE username LIKE 'itest\_%'`)
		s.Close()
	})
	return s, dsn
}

func uniqueName() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "itest_" + hex.EncodeToString(b)
}

func TestPGStoreCreateAndLookup(t *testing.T) {
	s, _ := pgForTest(t)
	ctx := context.Background()
	name := uniqueName()
	email := name + "@example.com"
	hash := strings.Repeat("h", 60)

	u, err := s.Create(ctx, name, email, hash)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if u.ID == "" || u.CreatedAt.IsZero() {
		t.Fatalf("store must assign ID and CreatedAt, got %+v", u)
	}

	got, ok, err := s.ByUsername(ctx, name)
	if err != nil || !ok {
		t.Fatalf("lookup: ok=%v err=%v", ok, err)
	}
	if got.ID != u.ID || got.Email != email || got.Password != hash {
		t.Fatalf("round trip mismatch: %+v vs %+v", got, u)
	}
	if _, ok, _ := s.ByUsername(ctx, "itest_missing"); ok {
		t.Fatal("unknown user must not be found")
	}
	if ex, err := s.Exists(ctx, name); err != nil || !ex {
		t.Fatalf("Exists: %v %v", ex, err)
	}

	if _, err := s.Create(ctx, name, "", hash); err != ErrUsernameTaken {
		t.Fatalf("duplicate username: want ErrUsernameTaken, got %v", err)
	}
	if _, err := s.Create(ctx, uniqueName(), email, hash); err != ErrEmailTaken {
		t.Fatalf("duplicate email: want ErrEmailTaken, got %v", err)
	}
	// Users without an email must not collide with each other.
	for i := 0; i < 2; i++ {
		if _, err := s.Create(ctx, uniqueName(), "", hash); err != nil {
			t.Fatalf("empty email must be allowed twice: %v", err)
		}
	}
}

func TestSignupLoginPersistAcrossRestart(t *testing.T) {
	setupAuth(t)
	s, dsn := pgForTest(t)
	prev := store
	store = s
	t.Cleanup(func() { store = prev })

	name := uniqueName()
	pw := "correct horse battery"
	post := func(h http.HandlerFunc, form url.Values) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.RemoteAddr = "203.0.113.7:5555" // its own rate-limit bucket
		rec := httptest.NewRecorder()
		h(rec, req)
		return rec
	}
	creds := url.Values{"username": {name}, "password": {pw}, "email": {name + "@example.com"}}

	if rec := post(RegisterHandler, creds); rec.Code != http.StatusCreated {
		t.Fatalf("signup: %d %s", rec.Code, rec.Body)
	}
	if rec := post(RegisterHandler, creds); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate signup: want 409, got %d", rec.Code)
	}
	if rec := post(LoginHandler, url.Values{"username": {name}, "password": {"wrong password!!"}}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad password: want 401, got %d", rec.Code)
	}

	// "Restart the server": brand-new pool, empty cache, nothing in memory.
	s2, err := newPGStore(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	store = s2
	mu.Lock()
	delete(users, name)
	mu.Unlock()

	rec := post(LoginHandler, url.Values{"username": {name}, "password": {pw}})
	if rec.Code != http.StatusOK {
		t.Fatalf("login after restart: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		Token    string `json:"token"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out.Token == "" || out.Username != name {
		t.Fatalf("bad login payload: %s", rec.Body)
	}

	// The token works on protected routes because the user exists in the database.
	protected := AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if UsernameFrom(r) != name {
			t.Errorf("wrong user in context: %q", UsernameFrom(r))
		}
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+out.Token)
	req.RemoteAddr = "203.0.113.8:5555"
	prec := httptest.NewRecorder()
	protected(prec, req)
	if prec.Code != http.StatusNoContent {
		t.Fatalf("protected route: %d", prec.Code)
	}

	// A valid token for a user that is not in the database is rejected.
	ghost, _ := GenerateJWT(User{ID: "ghost", Username: "itest_ghost_" + hex.EncodeToString([]byte{1, 2})})
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+ghost)
	req.RemoteAddr = "203.0.113.9:5555"
	prec = httptest.NewRecorder()
	protected(prec, req)
	if prec.Code != http.StatusUnauthorized {
		t.Fatalf("unknown user's token: want 401, got %d", prec.Code)
	}
}

func TestDatabaseURLFromPostgresVars(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("POSTGRES_USER", "iw user")
	t.Setenv("POSTGRES_PASSWORD", "p@ss/word:1")
	t.Setenv("POSTGRES_DB", "iw")
	t.Setenv("POSTGRES_HOST", "")
	got := databaseURL()
	want := "postgres://iw%20user:p%40ss%2Fword%3A1@127.0.0.1:5432/iw?sslmode=disable"
	if got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
	t.Setenv("DATABASE_URL", "postgres://x@h/db")
	if databaseURL() != "postgres://x@h/db" {
		t.Fatal("DATABASE_URL must take priority")
	}
}

func TestInitStoreRefusesToRunWithoutDatabase(t *testing.T) {
	for _, k := range []string{"DATABASE_URL", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "ALLOW_MEMORY_STORE"} {
		t.Setenv(k, "")
	}
	prev := store
	defer func() { store = prev }()
	store = nil
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := InitStore(ctx); err == nil {
		t.Fatal("must not silently fall back to throwaway users")
	}
}