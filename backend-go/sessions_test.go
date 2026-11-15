package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

const testOrigin = "http://localhost:5173"

func sessionEnv(t *testing.T) {
	t.Helper()
	profileSetup(t)
	old, oldGrace, oldSecure := allowedOrigins, rotationGrace, cookieSecure
	allowedOrigins = map[string]bool{testOrigin: true}
	rotationGrace = 0
	cookieSecure = true
	t.Cleanup(func() { allowedOrigins, rotationGrace, cookieSecure = old, oldGrace, oldSecure })
}

func login(t *testing.T, name string) (token string, cookie *http.Cookie) {
	t.Helper()
	r := formReq(http.MethodPost, "/api/login", "", url.Values{"username": {name}, "password": {"correct horse battery"}})
	w := do(LoginHandler, r)
	if w.Code != http.StatusOK {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	var out struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	for _, c := range w.Result().Cookies() {
		if c.Name == refreshCookieName {
			return out.Token, c
		}
	}
	t.Fatal("login did not set the refresh cookie")
	return
}

func refresh(c *http.Cookie, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if c != nil {
		r.AddCookie(c)
	}
	return do(RefreshHandler, r)
}

func newCookie(t *testing.T, w *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == refreshCookieName && c.Value != "" {
			return c
		}
	}
	t.Fatalf("no new refresh cookie in response (status %d)", w.Code)
	return nil
}

func TestLoginSetsHardenedRefreshCookie(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_cookie", "correct horse battery")
	_, c := login(t, "sc_cookie")
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/api/auth" {
		t.Fatalf("cookie not hardened: %+v", c)
	}
	if len(c.Value) < 40 {
		t.Fatalf("refresh token looks too short: %d chars", len(c.Value))
	}
	if time.Until(c.Expires) < 13*24*time.Hour {
		t.Fatalf("cookie lifetime too short: %v", c.Expires)
	}
}

func TestRefreshRotatesAndReturnsWorkingToken(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_rot", "correct horse battery")
	_, c1 := login(t, "sc_rot")

	w := refresh(c1, testOrigin)
	if w.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", w.Code, w.Body.String())
	}
	c2 := newCookie(t, w)
	if c2.Value == c1.Value {
		t.Fatal("refresh token was not rotated")
	}
	var out struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if me := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), out.Token)); me.Code != 200 {
		t.Fatalf("new access token rejected: %d", me.Code)
	}
}

func TestRefreshReuseRevokesWholeChain(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_reuse", "correct horse battery")
	_, c1 := login(t, "sc_reuse")
	c2 := newCookie(t, refresh(c1, testOrigin)) // legitimate rotation

	// An attacker (or a stale tab) replays the OLD token after the grace window.
	if w := refresh(c1, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("replayed token: got %d, want 401", w.Code)
	}
	if ev := lastAudit(t, "auth.refresh_reuse"); ev.Actor != "sc_reuse" || ev.Success {
		t.Fatalf("reuse must be audited as a failure: %+v", ev)
	}
	// ...and the legitimate newer token is now dead too.
	if w := refresh(c2, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("chain should be revoked, got %d", w.Code)
	}
}

func TestRefreshRaceWithinGraceIsNotAnAttack(t *testing.T) {
	sessionEnv(t)
	rotationGrace = time.Minute
	userWithPassword(t, "sc_race", "correct horse battery")
	_, c1 := login(t, "sc_race")
	c2 := newCookie(t, refresh(c1, testOrigin))

	if w := refresh(c1, testOrigin); w.Code != http.StatusConflict { // second tab, same instant
		t.Fatalf("got %d, want 409 retry", w.Code)
	}
	if w := refresh(c2, testOrigin); w.Code != http.StatusOK { // the chain survives
		t.Fatalf("chain must survive a race, got %d", w.Code)
	}
}

func TestRefreshRequiresKnownOrigin(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_csrf", "correct horse battery")
	_, c := login(t, "sc_csrf")
	for _, origin := range []string{"", "https://evil.example", "null"} {
		if w := refresh(c, origin); w.Code != http.StatusForbidden {
			t.Errorf("origin %q: got %d, want 403", origin, w.Code)
		}
	}
	if w := refresh(c, testOrigin); w.Code != http.StatusOK { // and the cookie was not burnt by the failures
		t.Fatalf("legit refresh after rejected attempts: %d", w.Code)
	}
	if w := refresh(nil, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("no cookie: got %d", w.Code)
	}
	if w := refresh(&http.Cookie{Name: refreshCookieName, Value: "made-up"}, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("garbage cookie: got %d", w.Code)
	}
}

func TestStateChangingRequestFromForeignOriginIsRefused(t *testing.T) {
	sessionEnv(t)
	_, tok := mkUser(t, "sc_origin", RoleUser)
	r := formReq(http.MethodPost, "/api/me/profile", tok, url.Values{"bio": {"hi"}})
	r.Header.Set("Origin", "https://evil.example")
	if w := do(BioHandler, r); w.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403", w.Code)
	}
	r = formReq(http.MethodPost, "/api/me/profile", tok, url.Values{"bio": {"hi"}})
	r.Header.Set("Origin", testOrigin)
	if w := do(BioHandler, r); w.Code != http.StatusOK {
		t.Fatalf("allowed origin: got %d", w.Code)
	}
	// CORS: credentials are only offered to allowed origins
	pre := httptest.NewRequest(http.MethodOptions, "/api/auth/refresh", nil)
	pre.Header.Set("Origin", testOrigin)
	w := do(RefreshHandler, pre)
	if w.Header().Get("Access-Control-Allow-Origin") != testOrigin || w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("missing CORS headers: %v", w.Header())
	}
	pre = httptest.NewRequest(http.MethodOptions, "/api/auth/refresh", nil)
	pre.Header.Set("Origin", "https://evil.example")
	w = do(RefreshHandler, pre)
	if w.Code != http.StatusForbidden || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign preflight: %d %v", w.Code, w.Header())
	}
}

func TestLogoutEndsOnlyThisDevice(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_out", "correct horse battery")
	_, a := login(t, "sc_out")
	_, b := login(t, "sc_out") // a second device

	r := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	r.Header.Set("Origin", testOrigin)
	r.AddCookie(a)
	w := do(LogoutHandler, r)
	if w.Code != 200 {
		t.Fatalf("logout: %d", w.Code)
	}
	var cleared bool
	for _, c := range w.Result().Cookies() {
		cleared = cleared || (c.Name == refreshCookieName && c.MaxAge < 0)
	}
	if !cleared {
		t.Fatal("logout must clear the cookie")
	}
	if w := refresh(a, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("logged-out device can still refresh: %d", w.Code)
	}
	if w := refresh(b, testOrigin); w.Code != http.StatusOK {
		t.Fatalf("other device must stay signed in: %d", w.Code)
	}
}

func TestLogoutEverywhere(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_all", "correct horse battery")
	tokA, a := login(t, "sc_all")
	_, b := login(t, "sc_all")

	r := bearer(httptest.NewRequest(http.MethodPost, "/api/auth/logout-all", nil), tokA)
	if w := do(LogoutAllHandler, r); w.Code != 200 {
		t.Fatalf("logout-all: %d", w.Code)
	}
	if w := refresh(a, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("device A still refreshes: %d", w.Code)
	}
	if w := refresh(b, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("device B still refreshes: %d", w.Code)
	}
	// the access token dies immediately too, not after 15 minutes
	if me := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), tokA)); me.Code != http.StatusUnauthorized {
		t.Fatalf("old access token still valid: %d", me.Code)
	}
	if ev := lastAudit(t, "auth.logout_all"); ev.Actor != "sc_all" {
		t.Fatalf("not audited: %+v", ev)
	}
}

func TestPasswordChangeSignsOutOtherDevices(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_pw", "correct horse battery")
	tokA, _ := login(t, "sc_pw")
	_, other := login(t, "sc_pw")

	w := do(PasswordHandler, formReq(http.MethodPost, "/api/me/password", tokA,
		url.Values{"current_password": {"correct horse battery"}, "new_password": {"an entirely new passphrase"}}))
	if w.Code != 200 {
		t.Fatalf("change password: %d %s", w.Code, w.Body.String())
	}
	var out struct{ Token string }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Token == "" {
		t.Fatal("response must carry a fresh token so this device stays signed in")
	}
	_ = newCookie(t, w) // and a fresh refresh cookie

	if w := refresh(other, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("other device survived a password change: %d", w.Code)
	}
	if me := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), tokA)); me.Code != http.StatusUnauthorized {
		t.Fatalf("old access token survived: %d", me.Code)
	}
	if me := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), out.Token)); me.Code != 200 {
		t.Fatalf("new token rejected: %d", me.Code)
	}
}

func TestSessionListAndRevokeOne(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_list", "correct horse battery")
	tok, cur := login(t, "sc_list")
	_, other := login(t, "sc_list")

	r := bearer(httptest.NewRequest(http.MethodGet, "/api/auth/sessions", nil), tok)
	r.AddCookie(cur)
	w := do(SessionsHandler, r)
	var out struct{ Sessions []SessionInfo }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if len(out.Sessions) != 2 {
		t.Fatalf("want 2 sessions, got %d: %s", len(out.Sessions), w.Body.String())
	}
	var currentCount int
	var otherID string
	for _, s := range out.Sessions {
		if s.Current {
			currentCount++
		} else {
			otherID = s.ID
		}
	}
	if currentCount != 1 || otherID == "" {
		t.Fatalf("exactly one session must be marked current: %+v", out.Sessions)
	}

	rv := bearer(formReq(http.MethodPost, "/api/auth/sessions/revoke", tok, url.Values{"id": {otherID}}), tok)
	if w := do(SessionRevokeHandler, rv); w.Code != 200 {
		t.Fatalf("revoke: %d", w.Code)
	}
	if w := refresh(other, testOrigin); w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session still refreshes: %d", w.Code)
	}
	// cannot revoke somebody else's session
	userWithPassword(t, "sc_list_b", "correct horse battery")
	tokB, curB := login(t, "sc_list_b")
	_ = curB
	rv = formReq(http.MethodPost, "/api/auth/sessions/revoke", tokB, url.Values{"id": {out.Sessions[0].ID}})
	if w := do(SessionRevokeHandler, rv); w.Code != http.StatusNotFound {
		t.Fatalf("revoking another user's session: got %d, want 404", w.Code)
	}
}

func TestRenamedAccountTokenCannotBeReused(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_old_name", "correct horse battery")
	oldTok, _ := login(t, "sc_old_name")

	// the account is renamed, and a different person takes the old name
	mu.Lock()
	u := users["sc_old_name"]
	delete(users, "sc_old_name")
	u.Username = "sc_new_name"
	users["sc_new_name"] = u
	users["sc_old_name"] = User{ID: "someone-else", Username: "sc_old_name"}
	mu.Unlock()

	if me := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), oldTok)); me.Code != http.StatusUnauthorized {
		t.Fatalf("a token must not authenticate as whoever now owns the old username: %d", me.Code)
	}
}

func TestLoginLockoutIsPerIPAndAuditedWithoutPasswords(t *testing.T) {
	sessionEnv(t)
	userWithPassword(t, "sc_lock", "correct horse battery")
	bad := func(ip string) int {
		r := formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"sc_lock"}, "password": {"wrong password!!"}})
		r.RemoteAddr = ip + ":1111"
		return do(LoginHandler, r).Code
	}
	for i := 0; i < maxFailedLogins; i++ {
		bad("198.51.100.7")
	}
	if code := bad("198.51.100.7"); code != http.StatusTooManyRequests {
		t.Fatalf("attacker IP should be locked out, got %d", code)
	}
	// the real owner, from another address, is NOT locked out by a stranger
	r := formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"sc_lock"}, "password": {"correct horse battery"}})
	r.RemoteAddr = "192.0.2.50:2222"
	if w := do(LoginHandler, r); w.Code != http.StatusOK {
		t.Fatalf("owner locked out by a stranger: %d", w.Code)
	}
	// a password typed into the username box must never reach the log
	r = formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"hunter2 is my password"}, "password": {"x"}})
	do(LoginHandler, r)
	for _, ev := range func() []AuditEvent { e, _ := userStore().AuditList(t.Context(), AuditFilter{Limit: 200}); return e }() {
		if strings.Contains(ev.Target, "hunter2") {
			t.Fatalf("audit log leaked a typed password: %+v", ev)
		}
	}
}

func TestRateLimitBudgets(t *testing.T) {
	profileSetup(t)
	limiter = newRateLimiter(30, time.Minute)
	apiLimiter = newRateLimiter(300, time.Minute)
	_, tok := mkUser(t, "rl_user", RoleUser)

	// Signed-in traffic from one address (an office, a phone hotspot) has plenty of room...
	for i := 0; i < 120; i++ {
		if w := do(MeHandler, bearer(httptest.NewRequest(http.MethodGet, "/api/me", nil), tok)); w.Code != 200 {
			t.Fatalf("authenticated request %d got %d", i, w.Code)
		}
	}
	// ...while credential endpoints stay tight.
	limited := 0
	for i := 0; i < 40; i++ {
		r := formReq(http.MethodPost, "/api/login", "", url.Values{"username": {"nobody_here"}, "password": {"x"}})
		if do(LoginHandler, r).Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Fatal("login attempts must still be rate limited")
	}
}
