package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"os"
	"time"
)

// ---------------------------------------------------------------------------
// Sessions: short-lived access token + rotating refresh cookie.
//
//	access token   JWT, 15 min, held in memory by the app (never in localStorage),
//	               sent as "Authorization: Bearer ...".
//	refresh token  random 256-bit value in an HttpOnly, Secure, SameSite=Strict
//	               cookie scoped to /api/auth. JavaScript cannot read it, so an XSS
//	               bug cannot steal the long-lived credential. Only its SHA-256 is
//	               stored server-side.
//
// Every refresh rotates the token. If an already-used token is presented again
// (it was stolen, or replayed) the whole chain is revoked. "Log out
// everywhere" bumps users.token_version, which kills outstanding access tokens
// immediately and revokes every refresh token.
// ---------------------------------------------------------------------------

const (
	refreshCookieName = "iw_rt"
	refreshCookiePath = "/api/auth"
	refreshTTL        = 14 * 24 * time.Hour
	familyMaxAge      = 60 * 24 * time.Hour // absolute cap on a rotation chain
)

var cookieSecure = true

// initSessions reads COOKIE_SECURE. It defaults to true; set it to "false" only
// for plain-http testing on a LAN address (browsers refuse Secure cookies there).
func initSessions() error {
	cookieSecure = os.Getenv("COOKIE_SECURE") != "false"
	if !cookieSecure {
		log.Printf("⚠️  COOKIE_SECURE=false: the refresh cookie is sent over plain HTTP. Development only.")
	}
	return nil
}

func hashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

func newRefreshToken() (raw string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashToken(raw), nil
}

func setRefreshCookie(w http.ResponseWriter, raw string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookieName, Value: raw, Path: refreshCookiePath,
		Expires: expires, MaxAge: int(time.Until(expires).Seconds()),
		HttpOnly: true, Secure: cookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

func clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookieName, Value: "", Path: refreshCookiePath,
		MaxAge: -1, Expires: time.Unix(0, 0),
		HttpOnly: true, Secure: cookieSecure, SameSite: http.SameSiteStrictMode,
	})
}

// startSession begins a new login on this device: a new refresh-token chain
// and a fresh access token.
func startSession(w http.ResponseWriter, r *http.Request, user User) (string, error) {
	raw, hash, err := newRefreshToken()
	if err != nil {
		return "", err
	}
	family, err := newID()
	if err != nil {
		return "", err
	}
	now := time.Now()
	err = userStore().CreateSession(r.Context(), NewSession{
		UserID: user.ID, FamilyID: family, Hash: hash,
		Expires: now.Add(refreshTTL), FamilyExpires: now.Add(familyMaxAge),
		UserAgent: r.UserAgent(), IP: clientIP(r),
	})
	if err != nil {
		return "", err
	}
	setRefreshCookie(w, raw, now.Add(refreshTTL))
	return GenerateJWT(user)
}

// checkClaims is the one place that decides whether a verified token still
// counts: the account must exist, not be disabled, still be the same account
// (a renamed username can be reused by someone else), and the token must not
// predate a "log out everywhere".
func checkClaims(ctx context.Context, c *Claims) (AuthInfo, bool) {
	info, ok, err := userStore().AuthState(ctx, c.Username)
	if err != nil {
		log.Printf("auth state lookup failed: %v", err)
		return AuthInfo{}, false // fail closed
	}
	if !ok || info.Disabled || info.TokenVersion != c.TV || info.ID != c.Subject {
		return AuthInfo{}, false
	}
	return info, true
}

// ---- handlers ----------------------------------------------------------------

var (
	RefreshHandler       = withSecurity(http.MethodPost, refreshHandler)
	LogoutHandler        = withSecurity(http.MethodPost, logoutHandler)
	LogoutAllHandler     = AuthMiddleware(logoutAllHandler)
	SessionsHandler      = AuthMiddleware(sessionsHandler)
	SessionRevokeHandler = AuthMiddleware(sessionRevokeHandler)
)

func tokenResponse(token string, user User) map[string]interface{} {
	return map[string]interface{}{
		"token": token, "username": user.Username, "expires_in": int(tokenTTL.Seconds()),
	}
}

// POST /api/auth/refresh: trade the cookie for a new access token (and rotate it).
func refreshHandler(w http.ResponseWriter, r *http.Request) {
	// Cookie-authenticated, so insist on a known Origin (CSRF defence).
	if !originRequired(r) {
		writeError(w, http.StatusForbidden, "Origin not allowed")
		return
	}
	c, err := r.Cookie(refreshCookieName)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "No session")
		return
	}
	newRaw, newHash, err := newRefreshToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	now := time.Now()
	res, err := userStore().RotateSession(r.Context(), hashToken(c.Value), newHash, now.Add(refreshTTL), r.UserAgent(), clientIP(r))
	switch {
	case errors.Is(err, ErrSessionRace):
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusConflict, "Session was just refreshed, retry")
		return
	case errors.Is(err, ErrSessionReuse):
		audit(r, AuditEvent{Actor: res.Username, Action: "auth.refresh_reuse", Success: false,
			Detail: map[string]any{"note": "rotated token replayed; session chain revoked"}})
		clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "Session expired")
		return
	case errors.Is(err, ErrSessionInvalid):
		clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "Session expired")
		return
	case err != nil:
		log.Printf("refresh: %v", err)
		writeError(w, http.StatusServiceUnavailable, "Service temporarily unavailable")
		return
	}

	user, ok, err := userStore().ByUsername(r.Context(), res.Username)
	if err != nil || !ok || !user.DisabledAt.IsZero() {
		clearRefreshCookie(w)
		writeError(w, http.StatusUnauthorized, "Session expired")
		return
	}
	token, err := GenerateJWT(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	setRefreshCookie(w, newRaw, now.Add(refreshTTL))
	writeJSON(w, http.StatusOK, tokenResponse(token, user))
}

// POST /api/auth/logout: end this device's session.
func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if !originRequired(r) {
		writeError(w, http.StatusForbidden, "Origin not allowed")
		return
	}
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		if username, ok, err := userStore().RevokeSessionByHash(r.Context(), hashToken(c.Value)); err != nil {
			log.Printf("logout: %v", err)
		} else if ok {
			audit(r, AuditEvent{Actor: username, Action: "auth.logout", Success: true})
		}
	}
	clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /api/auth/logout-all: every device, right now.
func logoutAllHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	username := UsernameFrom(r)
	if err := userStore().RevokeAllSessions(r.Context(), username); err != nil {
		storeUnavailable(w, "logout all", err)
		return
	}
	auditOK(r, "auth.logout_all", username, nil)
	clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// GET /api/auth/sessions: the devices currently signed in.
func sessionsHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	var current []byte
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		current = hashToken(c.Value)
	}
	list, err := userStore().ListSessions(r.Context(), UsernameFrom(r), current)
	if err != nil {
		storeUnavailable(w, "list sessions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sessions": list})
}

// POST /api/auth/sessions/revoke  id=<session id>
func sessionRevokeHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	id := r.PostFormValue("id")
	ok, err := userStore().RevokeFamily(r.Context(), UsernameFrom(r), id)
	if err != nil {
		storeUnavailable(w, "revoke session", err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "Session not found")
		return
	}
	auditOK(r, "auth.session_revoked", UsernameFrom(r), map[string]any{"session": clip(id, 40)})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// sessionJanitor deletes long-expired refresh tokens now and then.
func sessionJanitor(ctx context.Context) {
	run := func() {
		if err := userStore().PurgeSessions(ctx); err != nil {
			log.Printf("purge sessions: %v", err)
		}
	}
	run()
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

// ---- in-band renewal for long-lived sockets ------------------------------------
//
// A WebSocket is authenticated once, when it opens, and is closed when that
// access token ends (15 minutes). To keep a long game or chat going without a
// disconnect, the client sends its newly refreshed token over the open socket
// ({"type":"reauth"} / {"action":"reauth"}) and the server extends the deadline.
// The new token gets the same checks as a login: valid signature, not revoked,
// and it must belong to the SAME account as the socket, so a token for another
// user can never be used to take over a connection.

func renewSocketAuth(rawToken, username string) (time.Time, bool) {
	claims, err := ValidateJWT(rawToken)
	if err != nil || claims.Username != username || claims.ExpiresAt == nil {
		return time.Time{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	if _, ok := checkClaims(ctx, claims); !ok {
		return time.Time{}, false
	}
	return claims.ExpiresAt.Time, true
}
