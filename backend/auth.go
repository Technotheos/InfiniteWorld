package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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

	// Two budgets per IP. `limiter` guards the endpoints an attacker would hammer
	// (login, signup, refresh): 30/minute. `apiLimiter` covers requests that
	// already carry a valid login, which are far less abusable and must not break
	// people sharing an address (an office, a school, a phone hotspot): 300/minute.
	limiter    = newRateLimiter(30, time.Minute)
	apiLimiter = newRateLimiter(300, time.Minute)
	// Lockout is keyed by username+IP, so a stranger cannot lock YOU out by
	// failing from their own address. lockoutUser is the per-username ceiling
	// (a distributed guessing attack) and is much higher.
	lockout     = newLoginTracker()
	lockoutUser = newLoginTrackerN(30)
)

func loginLocked(username, ip string) bool {
	return lockout.isLocked(username+"|"+ip) || lockoutUser.isLocked(username)
}

func loginFailed(username, ip string) {
	lockout.fail(username + "|" + ip)
	lockoutUser.fail(username)
}

func loginSucceeded(username, ip string) {
	lockout.reset(username + "|" + ip)
	lockoutUser.reset(username)
}

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`

	// IAM fields (see iam.go). Role "" is treated as "user".
	Role           Role      `json:"-"`
	DisabledAt     time.Time `json:"-"`
	DisabledReason string    `json:"-"`
	TokenVersion   int       `json:"-"`

	// Profile fields (see profile.go). Avatar bytes are never put in JSON.
	Bio               string    `json:"-"`
	Avatar            []byte    `json:"-"`
	AvatarUpdated     time.Time `json:"-"`
	UsernameChangedAt time.Time `json:"-"`
}

type Claims struct {
	Username string `json:"username"`
	// TV is the user's token_version when this token was issued. Bumping the
	// user's version ("log out everywhere", password change, disable) makes
	// every older access token fail immediately.
	TV int `json:"tv"`
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

	origins, err := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))
	if err != nil {
		return err
	}
	allowedOrigins = origins
	if err := initNetPolicy(); err != nil {
		return err
	}
	if err := initSessions(); err != nil {
		return err
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

func GenerateJWT(user User) (string, error) { return generateJWTWithTTL(user, tokenTTL) }

func generateJWTWithTTL(user User, ttl time.Duration) (string, error) {
	jti, err := newID()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := &Claims{
		Username: user.Username,
		TV:       user.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			Subject:   user.ID,
			Issuer:    jwtIssuer,
			Audience:  jwt.ClaimStrings{jwtAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
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
	return AuthMiddlewareLimit(maxBodyBytes, next)
}

// AuthMiddlewareLimit is AuthMiddleware with a custom request-body cap
// (used by the avatar upload, which is larger than an auth form).
func AuthMiddlewareLimit(limit int64, next http.HandlerFunc) http.HandlerFunc {
	return withSecurityPolicy("", limit, true, func(w http.ResponseWriter, r *http.Request) {
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
		info, ok := checkClaims(r.Context(), claims)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), usernameCtxKey, claims.Username)
		ctx = context.WithValue(ctx, authInfoCtxKey, info)
		next(w, r.WithContext(ctx))
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
	if origin != "" && originListed(r, origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true") // needed for the refresh cookie
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "600")
	}
}

// withSecurity wraps a handler. Pass method "" to allow any method.
func withSecurity(method string, h http.HandlerFunc) http.HandlerFunc {
	return withSecurityLimit(method, maxBodyBytes, h)
}

// withSecurityLimit is withSecurity with an explicit request-body cap.
func withSecurityLimit(method string, limit int64, h http.HandlerFunc) http.HandlerFunc {
	return withSecurityPolicy(method, limit, false, h)
}

// withSecurityPolicy is the shared wrapper. authed selects the generous
// rate-limit budget for routes that sit behind AuthMiddleware.
func withSecurityPolicy(method string, limit int64, authed bool, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)
		applyCORS(w, r)

		if r.Method == http.MethodOptions {
			if !originAllowed(r) {
				writeError(w, http.StatusForbidden, "Origin not allowed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// CSRF defence in depth: a state-changing request that names a foreign
		// origin is refused even if the browser would have let it through.
		if isStateChanging(r.Method) && !originAllowed(r) {
			writeError(w, http.StatusForbidden, "Origin not allowed")
			return
		}
		if method != "" && r.Method != method {
			w.Header().Set("Allow", method)
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		lm := limiter
		if authed {
			lm = apiLimiter
		}
		if !lm.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "Too many requests")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		h(w, r)
	}
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
	mu  sync.Mutex
	m   map[string]*loginState
	max int
}

func newLoginTracker() *loginTracker { return newLoginTrackerN(maxFailedLogins) }

func newLoginTrackerN(max int) *loginTracker {
	return &loginTracker{m: make(map[string]*loginState), max: max}
}

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
	if s.failures >= t.max {
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
	// The store assigns a random ID (never the username) and enforces uniqueness.
	if _, err := userStore().Create(r.Context(), username, email, hashed); err != nil {
		switch {
		case errors.Is(err, ErrUsernameTaken):
			writeError(w, http.StatusConflict, "Username already taken")
		case errors.Is(err, ErrEmailTaken):
			writeError(w, http.StatusConflict, "Email already in use")
		default:
			log.Printf("register: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
		}
		return
	}

	auditOK(r, "auth.signup", username, nil)
	writeJSON(w, http.StatusCreated, map[string]string{"message": "User registered successfully"})
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	username := normalizeUsername(r.PostFormValue("username"))
	password := r.PostFormValue("password")

	ip := clientIP(r)
	if loginLocked(username, ip) {
		audit(r, AuditEvent{Action: "auth.login_locked", Target: auditName(username), Success: false})
		w.Header().Set("Retry-After", fmt.Sprint(int(lockoutDuration.Seconds())))
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts, try again later")
		return
	}

	user, exists, err := userStore().ByUsername(r.Context(), username)
	if err != nil {
		log.Printf("login lookup: %v", err)
		writeError(w, http.StatusServiceUnavailable, "Service temporarily unavailable")
		return
	}

	// Always run bcrypt, even for unknown users, so response time doesn't reveal
	// which usernames exist.
	hash := dummyHash
	if exists {
		hash = user.Password
	}
	passwordOK := CheckPasswordHash(password, hash)

	if !exists || !passwordOK {
		loginFailed(username, ip)
		audit(r, AuditEvent{Action: "auth.login", Target: auditName(username), Success: false})
		writeError(w, http.StatusUnauthorized, "Invalid username or password")
		return
	}
	if !user.DisabledAt.IsZero() { // only revealed to someone who knew the password
		audit(r, AuditEvent{Actor: user.Username, Action: "auth.login", Success: false,
			Detail: map[string]any{"reason": "account disabled"}})
		writeError(w, http.StatusForbidden, "This account has been disabled")
		return
	}
	loginSucceeded(username, ip)

	tokenString, err := startSession(w, r, user)
	if err != nil {
		log.Printf("login: start session: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	audit(r, AuditEvent{Actor: user.Username, Action: "auth.login", Success: true})
	writeJSON(w, http.StatusOK, tokenResponse(tokenString, user))
}

// auditName makes a username safe to put in the log: failed logins sometimes
// carry a password typed into the username box, which must never be stored.
func auditName(username string) string {
	if usernameRe.MatchString(username) {
		return username
	}
	return "(invalid)"
}
