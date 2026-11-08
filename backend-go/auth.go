package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const (
	bcryptCost      = 12
	tokenTTL        = 15 * time.Minute
	jwtIssuer       = "engine-app"
	jwtAudience     = "engine-app-clients"
	maxBodyBytes    = 8 << 10 // 8 KB is plenty for auth forms
	minPasswordLen  = 12
	maxPasswordLen  = 72 // bcrypt silently/explicitly rejects anything longer
	maxFailedLogins = 5
	lockoutDuration = 15 * time.Minute
)

var (
	jwtKey         []byte
	allowedOrigins = map[string]bool{}
	dummyHash      string // used to equalise timing for unknown usernames

	users = make(map[string]User)
	mu    sync.RWMutex

	usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,32}$`)

	limiter = newRateLimiter(30, time.Minute) // per-IP: 30 auth requests/minute
	lockout = newLoginTracker()
)

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`
}

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type ctxKey string

const usernameCtxKey ctxKey = "username"

// InitAuth must be called once from main() before serving requests.
//
//	JWT_SECRET       required, >= 32 bytes (e.g. `openssl rand -base64 48`)
//	ALLOWED_ORIGINS  optional, comma-separated, e.g. "https://app.example.com"
func InitAuth() error {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return errors.New("JWT_SECRET must be set and at least 32 characters long")
	}
	jwtKey = []byte(secret)

	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			allowedOrigins[o] = true
		}
	}

	randomPw := make([]byte, 16)
	if _, err := rand.Read(randomPw); err != nil {
		return err
	}
	h, err := HashPassword(hex.EncodeToString(randomPw))
	if err != nil {
		return err
	}
	dummyHash = h
	return nil
}

// ---------------------------------------------------------------------------
// Passwords & tokens
// ---------------------------------------------------------------------------

func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(b), err
}

func CheckPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func GenerateJWT(user User) (string, error) {
	jti, err := newID()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := &Claims{
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   user.ID,
			Issuer:    jwtIssuer,
			Audience:  jwt.ClaimStrings{jwtAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtKey)
}

func ValidateJWT(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(
		tokenStr,
		claims,
		func(t *jwt.Token) (interface{}, error) { return jwtKey, nil },
		jwt.WithValidMethods([]string{"HS256"}), // blocks "alg: none" / algorithm confusion
		jwt.WithIssuer(jwtIssuer),
		jwt.WithAudience(jwtAudience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// AuthMiddleware protects routes. The username is available via UsernameFrom(r).
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return withSecurity("", func(w http.ResponseWriter, r *http.Request) {
		const prefix = "Bearer "
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, prefix) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		claims, err := ValidateJWT(strings.TrimSpace(h[len(prefix):]))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		mu.RLock()
		_, exists := users[claims.Username]
		mu.RUnlock()
		if !exists {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), usernameCtxKey, claims.Username)))
	})
}

func UsernameFrom(r *http.Request) string {
	s, _ := r.Context().Value(usernameCtxKey).(string)
	return s
}

// ---------------------------------------------------------------------------
// HTTP plumbing: headers, CORS, body limits, rate limiting
// ---------------------------------------------------------------------------

func setSecurityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Pragma", "no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
}

// applyCORS only reflects origins on the allowlist. Never use "*" with auth.
func applyCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if origin != "" && allowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "600")
	}
}

// withSecurity wraps a handler. Pass method "" to allow any method.
func withSecurity(method string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)
		applyCORS(w, r)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if method != "" && r.Method != method {
			w.Header().Set("Allow", method)
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		if !limiter.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "Too many requests")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		h(w, r)
	}
}

// clientIP deliberately ignores X-Forwarded-For (spoofable). If you sit behind
// a trusted reverse proxy, configure that proxy to set RemoteAddr/real IP instead.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ---- simple in-memory sliding-window rate limiter (use Redis if multi-instance)

type rateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	limit  int
	window time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: make(map[string][]time.Time), limit: limit, window: window}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	if len(rl.hits) > 10000 { // bound memory
		for k, ts := range rl.hits {
			if len(ts) == 0 || ts[len(ts)-1].Before(cutoff) {
				delete(rl.hits, k)
			}
		}
	}

	recent := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= rl.limit {
		rl.hits[key] = recent
		return false
	}
	rl.hits[key] = append(recent, now)
	return true
}

// ---- per-username lockout (tracked for unknown usernames too, to avoid enumeration)

type loginState struct {
	failures    int
	lockedUntil time.Time
}

type loginTracker struct {
	mu sync.Mutex
	m  map[string]*loginState
}

func newLoginTracker() *loginTracker { return &loginTracker{m: make(map[string]*loginState)} }

func (t *loginTracker) isLocked(username string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	s, ok := t.m[username]
	return ok && time.Now().Before(s.lockedUntil)
}

func (t *loginTracker) fail(username string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if len(t.m) > 10000 {
		now := time.Now()
		for k, s := range t.m {
			if now.After(s.lockedUntil) && s.failures == 0 {
				delete(t.m, k)
			}
		}
	}
	s, ok := t.m[username]
	if !ok {
		s = &loginState{}
		t.m[username] = s
	}
	// Reset the counter once a previous lockout has expired.
	if !s.lockedUntil.IsZero() && time.Now().After(s.lockedUntil) {
		s.failures, s.lockedUntil = 0, time.Time{}
	}
	s.failures++
	if s.failures >= maxFailedLogins {
		s.lockedUntil = time.Now().Add(lockoutDuration)
	}
}

func (t *loginTracker) reset(username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.m, username)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

func normalizeUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validatePassword(pw string) error {
	if len(pw) < minPasswordLen {
		return fmt.Errorf("password must be at least %d characters", minPasswordLen)
	}
	if len(pw) > maxPasswordLen {
		return fmt.Errorf("password must be at most %d bytes", maxPasswordLen)
	}
	return nil
}

func validateEmail(email string) (string, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return "", nil // optional, as in the original
	}
	if len(email) > 254 {
		return "", errors.New("invalid email")
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return "", errors.New("invalid email")
	}
	return strings.ToLower(email), nil
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

var RegisterHandler = withSecurity(http.MethodPost, registerHandler)
var LoginHandler = withSecurity(http.MethodPost, loginHandler)

func registerHandler(w http.ResponseWriter, r *http.Request) {
	// PostFormValue reads the body only, so credentials never come from the URL/query string.
	username := normalizeUsername(r.PostFormValue("username"))
	password := r.PostFormValue("password")

	if !usernameRe.MatchString(username) {
		writeError(w, http.StatusBadRequest, "Username must be 3-32 characters: a-z, 0-9, '_', '.', '-'")
		return
	}
	if err := validatePassword(password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	email, err := validateEmail(r.PostFormValue("email"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Hash BEFORE taking the lock so slow bcrypt calls never block other requests.
	hashed, err := HashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	id, err := newID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	mu.Lock()
	if _, exists := users[username]; exists {
		mu.Unlock()
		writeError(w, http.StatusConflict, "Username already taken")
		return
	}
	users[username] = User{
		ID:        id, // random ID, not the username
		Username:  username,
		Email:     email,
		Password:  hashed,
		CreatedAt: time.Now(),
	}
	mu.Unlock()

	writeJSON(w, http.StatusCreated, map[string]string{"message": "User registered successfully"})
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	username := normalizeUsername(r.PostFormValue("username"))
	password := r.PostFormValue("password")

	if lockout.isLocked(username) {
		w.Header().Set("Retry-After", fmt.Sprint(int(lockoutDuration.Seconds())))
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts, try again later")
		return
	}

	mu.RLock()
	user, exists := users[username]
	mu.RUnlock()

	// Always run bcrypt, even for unknown users, so response time doesn't reveal
	// which usernames exist.
	hash := dummyHash
	if exists {
		hash = user.Password
	}
	passwordOK := CheckPasswordHash(password, hash)

	if !exists || !passwordOK {
		lockout.fail(username)
		writeError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}
	lockout.reset(username)

	tokenString, err := GenerateJWT(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      tokenString,
		"username":   user.Username,
		"expires_in": int(tokenTTL.Seconds()),
	})
}
