package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// User storage
//
// Two implementations behind one interface:
//
//	pgStore      PostgreSQL (used when DATABASE_URL or POSTGRES_* is configured)
//	memoryStore  the original in-process map (tests, or running without a DB)
//
// The rest of the server only calls the methods on UserStore below.
// ---------------------------------------------------------------------------

var (
	ErrUsernameTaken = errors.New("username already taken")
	ErrEmailTaken    = errors.New("email already in use")
)

type UserStore interface {
	// Create inserts a user. The store assigns the ID and CreatedAt.
	Create(ctx context.Context, username, email, passwordHash string) (User, error)
	// ByUsername returns (user, true, nil) when found, (_, false, nil) when not.
	ByUsername(ctx context.Context, username string) (User, bool, error)
	// Exists reports whether a user with this username exists.
	Exists(ctx context.Context, username string) (bool, error)

	// Profile methods (implemented in store_profile.go).
	Profile(ctx context.Context, username string) (Profile, error)
	SetBio(ctx context.Context, username, bio string) error
	SetAvatar(ctx context.Context, username string, jpeg []byte) error
	RemoveAvatar(ctx context.Context, username string) error
	Avatar(ctx context.Context, username string) (data []byte, updated time.Time, found bool, err error)
	// Rename changes the username. It returns ErrUsernameTaken, or a
	// *RenameTooSoonError when the cooldown has not passed.
	Rename(ctx context.Context, oldName, newName string, cooldown time.Duration) error
	SetPassword(ctx context.Context, username, passwordHash string) error
	Close()
}

// store is set once at startup by InitStore. While it is nil, the in-memory
// map in auth.go is used directly, which keeps the existing tests working.
var store UserStore

// ---- in-memory ------------------------------------------------------------

// memoryStore wraps the package-level `users` map and `mu` from auth.go.
type memoryStore struct{}

func (memoryStore) Create(_ context.Context, username, email, hash string) (User, error) {
	id, err := newID()
	if err != nil {
		return User{}, err
	}
	mu.Lock()
	defer mu.Unlock()
	if _, exists := users[username]; exists {
		return User{}, ErrUsernameTaken
	}
	if email != "" {
		for _, u := range users {
			if u.Email == email {
				return User{}, ErrEmailTaken
			}
		}
	}
	u := User{ID: id, Username: username, Email: email, Password: hash, CreatedAt: time.Now()}
	users[username] = u
	return u, nil
}

func (memoryStore) ByUsername(_ context.Context, username string) (User, bool, error) {
	mu.RLock()
	defer mu.RUnlock()
	u, ok := users[username]
	return u, ok, nil
}

func (memoryStore) Exists(_ context.Context, username string) (bool, error) {
	mu.RLock()
	defer mu.RUnlock()
	_, ok := users[username]
	return ok, nil
}

func (memoryStore) Close() {}

// ---- PostgreSQL -----------------------------------------------------------

const dbTimeout = 3 * time.Second

type pgStore struct {
	pool *pgxpool.Pool

	// Small positive cache for Exists(): the JWT middleware, the REST API and
	// every WebSocket upgrade ask "does this user still exist?". Caching a
	// "yes" for a short time keeps that off the database.
	cacheMu sync.Mutex
	cache   map[string]time.Time // username -> cached until
}

const existsCacheTTL = 30 * time.Second

func newPGStore(ctx context.Context, dsn string) (*pgStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("invalid database url: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}

	// The database container may still be starting: retry for ~20 seconds.
	deadline := time.Now().Add(20 * time.Second)
	for {
		pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = pool.Ping(pctx)
		cancel()
		if err == nil {
			break
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			pool.Close()
			return nil, fmt.Errorf("database not reachable: %w", err)
		}
		log.Printf("waiting for database: %v", err)
		time.Sleep(time.Second)
	}

	// Fail fast with a clear message if migrations have not been applied.
	var ok bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.users') IS NOT NULL`).Scan(&ok); err != nil || !ok {
		pool.Close()
		return nil, errors.New(`table "users" not found: run the migrations first (docker compose run --rm migrate)`)
	}
	return &pgStore{pool: pool, cache: make(map[string]time.Time)}, nil
}

func (s *pgStore) Create(ctx context.Context, username, email, hash string) (User, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()

	// Empty email is stored as NULL so the unique index only applies to real addresses.
	var emailArg *string
	if email != "" {
		emailArg = &email
	}
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash)
		 VALUES ($1, $2, $3)
		 RETURNING id::text, created_at`,
		username, emailArg, hash,
	).Scan(&u.ID, &u.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			if strings.Contains(pgErr.ConstraintName, "email") {
				return User{}, ErrEmailTaken
			}
			return User{}, ErrUsernameTaken
		}
		return User{}, err
	}
	u.Username, u.Email, u.Password = username, email, hash
	return u, nil
}

func (s *pgStore) ByUsername(ctx context.Context, username string) (User, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()

	var u User
	var email *string
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, username, email, password_hash, created_at
		   FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &email, &u.Password, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, err
	}
	if email != nil {
		u.Email = *email
	}
	return u, true, nil
}

func (s *pgStore) Exists(ctx context.Context, username string) (bool, error) {
	now := time.Now()
	s.cacheMu.Lock()
	until, hit := s.cache[username]
	s.cacheMu.Unlock()
	if hit && now.Before(until) {
		return true, nil
	}

	ctx, cancel := context.WithTimeout(ctx, dbTimeout)
	defer cancel()
	var ok bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)`, username).Scan(&ok); err != nil {
		return false, err
	}
	if ok {
		s.cacheMu.Lock()
		if len(s.cache) > 10000 { // bound memory
			for k, t := range s.cache {
				if now.After(t) {
					delete(s.cache, k)
				}
			}
		}
		s.cache[username] = now.Add(existsCacheTTL)
		s.cacheMu.Unlock()
	}
	return ok, nil
}

func (s *pgStore) Close() { s.pool.Close() }

// ---- wiring ---------------------------------------------------------------

// databaseURL returns DATABASE_URL, or builds one from the POSTGRES_* variables
// already used by docker-compose.yml (host defaults to 127.0.0.1:5432).
func databaseURL() string {
	if v := strings.TrimSpace(os.Getenv("DATABASE_URL")); v != "" {
		return v
	}
	user, pass, name := os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_PASSWORD"), os.Getenv("POSTGRES_DB")
	if user == "" || pass == "" || name == "" {
		return ""
	}
	host := os.Getenv("POSTGRES_HOST")
	if host == "" {
		host = "127.0.0.1:5432"
	}
	sslmode := os.Getenv("POSTGRES_SSLMODE")
	if sslmode == "" {
		sslmode = "disable" // loopback only; use "require" or "verify-full" for a remote database
	}
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(user, pass),
		Host:     host,
		Path:     "/" + name,
		RawQuery: "sslmode=" + url.QueryEscape(sslmode),
	}
	return u.String()
}

// InitStore connects to PostgreSQL when configured. With no database
// configured it keeps the in-memory map and says so loudly, because every
// account is lost on restart in that mode.
func InitStore(ctx context.Context) error {
	dsn := databaseURL()
	if dsn == "" {
		if os.Getenv("ALLOW_MEMORY_STORE") != "1" {
			return errors.New("no database configured: set DATABASE_URL (or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB), or ALLOW_MEMORY_STORE=1 to run with throwaway in-memory users")
		}
		log.Printf("⚠️  ALLOW_MEMORY_STORE=1: users are kept in memory and will be LOST on restart")
		store = memoryStore{}
		return nil
	}
	s, err := newPGStore(ctx, dsn)
	if err != nil {
		return err
	}
	store = s
	log.Printf("✅ PostgreSQL connected: users and logins are persisted")
	return nil
}

// userStore returns the active store (the in-memory one while store is nil).
func userStore() UserStore {
	if store != nil {
		return store
	}
	return memoryStore{}
}

// userExists is used by the JWT checks in auth.go, ws.go and game_hub.go.
func userExists(ctx context.Context, username string) bool {
	if store == nil { // tests insert straight into the map
		mu.RLock()
		defer mu.RUnlock()
		_, ok := users[username]
		return ok
	}
	ok, err := store.Exists(ctx, username)
	if err != nil {
		log.Printf("user lookup failed: %v", err)
		return false // fail closed
	}
	return ok
}