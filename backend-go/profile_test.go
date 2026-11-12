package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// These tests use the in-memory store (the same one game_test.go uses).

func profileSetup(t *testing.T) {
	t.Helper()
	setupAuth(t)
	limiter = newRateLimiter(10000, time.Minute) // other tests share the fake client IP
	lockout = newLoginTracker()
}

// userWithPassword inserts a user whose password is known.
func userWithPassword(t *testing.T, name, password string) (User, string) {
	t.Helper()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	u := User{ID: "id-" + name, Username: name, Password: hash, CreatedAt: time.Now()}
	mu.Lock()
	users[name] = u
	mu.Unlock()
	tok, err := GenerateJWT(u)
	if err != nil {
		t.Fatal(err)
	}
	return u, tok
}

func formReq(method, path, token string, form url.Values) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	return r
}

func do(h http.HandlerFunc, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func jpegBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x * 4), uint8(y * 4), 120, 255})
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestMeAndBio(t *testing.T) {
	profileSetup(t)
	_, tok := userWithPassword(t, "pt_bio", "correct horse battery")

	if w := do(MeHandler, httptest.NewRequest(http.MethodGet, "/api/me", nil)); w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d", w.Code)
	}

	w := do(BioHandler, formReq(http.MethodPost, "/api/me/profile", tok, url.Values{"bio": {"  Hello, stars.  "}}))
	if w.Code != http.StatusOK {
		t.Fatalf("set bio: %d %s", w.Code, w.Body.String())
	}

	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	w = do(MeHandler, r)
	var me map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatal(err)
	}
	if me["username"] != "pt_bio" || me["bio"] != "Hello, stars." {
		t.Fatalf("unexpected profile: %v", me)
	}

	tooLong := strings.Repeat("a", maxBioRunes+1)
	if w := do(BioHandler, formReq(http.MethodPost, "/api/me/profile", tok, url.Values{"bio": {tooLong}})); w.Code != http.StatusBadRequest {
		t.Fatalf("long bio: got %d", w.Code)
	}
	if w := do(BioHandler, formReq(http.MethodPost, "/api/me/profile", tok, url.Values{"bio": {"a\x00b"}})); w.Code != http.StatusBadRequest {
		t.Fatalf("control char bio: got %d", w.Code)
	}
}

func TestAvatarRoundTrip(t *testing.T) {
	profileSetup(t)
	_, tok := userWithPassword(t, "pt_avatar", "correct horse battery")

	upload := func(body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/me/avatar", bytes.NewReader(body))
		r.Header.Set("Content-Type", "image/jpeg")
		r.Header.Set("Authorization", "Bearer "+tok)
		return do(AvatarUploadHandler, r)
	}

	// Not an image / wrong format / too small are rejected.
	if w := upload([]byte("not an image")); w.Code != http.StatusBadRequest {
		t.Fatalf("garbage: got %d", w.Code)
	}
	var pngBuf bytes.Buffer
	_ = png.Encode(&pngBuf, image.NewRGBA(image.Rect(0, 0, 64, 64)))
	if w := upload(pngBuf.Bytes()); w.Code != http.StatusBadRequest {
		t.Fatalf("png: got %d", w.Code)
	}
	if w := upload(jpegBytes(t, 16, 16)); w.Code != http.StatusBadRequest {
		t.Fatalf("tiny jpeg: got %d", w.Code)
	}

	if w := upload(jpegBytes(t, 64, 64)); w.Code != http.StatusOK {
		t.Fatalf("valid jpeg: %d %s", w.Code, w.Body.String())
	}

	// Public fetch works without a token and is a JPEG.
	w := do(PublicAvatarHandler, httptest.NewRequest(http.MethodGet, "/api/avatar/PT_Avatar", nil))
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("public avatar: %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	if _, err := jpeg.Decode(bytes.NewReader(w.Body.Bytes())); err != nil {
		t.Fatalf("served avatar is not a valid jpeg: %v", err)
	}

	// Conditional request returns 304.
	r := httptest.NewRequest(http.MethodGet, "/api/avatar/pt_avatar", nil)
	r.Header.Set("If-None-Match", w.Header().Get("ETag"))
	if w2 := do(PublicAvatarHandler, r); w2.Code != http.StatusNotModified {
		t.Fatalf("etag: got %d", w2.Code)
	}

	// Remove it.
	rm := httptest.NewRequest(http.MethodPost, "/api/me/avatar/remove", nil)
	rm.Header.Set("Authorization", "Bearer "+tok)
	if w := do(AvatarRemoveHandler, rm); w.Code != http.StatusOK {
		t.Fatalf("remove: %d", w.Code)
	}
	if w := do(PublicAvatarHandler, httptest.NewRequest(http.MethodGet, "/api/avatar/pt_avatar", nil)); w.Code != http.StatusNotFound {
		t.Fatalf("after remove: got %d", w.Code)
	}
}

func TestChangeUsername(t *testing.T) {
	profileSetup(t)
	const pw = "correct horse battery"
	_, tok := userWithPassword(t, "pt_old", pw)
	userWithPassword(t, "pt_taken", pw)

	change := func(token, name, password string) *httptest.ResponseRecorder {
		return do(UsernameHandler, formReq(http.MethodPost, "/api/me/username", token,
			url.Values{"username": {name}, "password": {password}}))
	}

	if w := change(tok, "pt_new", "wrong password!!"); w.Code != http.StatusForbidden {
		t.Fatalf("wrong password: got %d", w.Code)
	}
	if w := change(tok, "bad name", pw); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid name: got %d", w.Code)
	}
	if w := change(tok, "pt_taken", pw); w.Code != http.StatusConflict {
		t.Fatalf("taken: got %d", w.Code)
	}

	w := change(tok, "PT_New", pw) // normalised to lower case
	if w.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Token    string `json:"token"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Username != "pt_new" {
		t.Fatalf("bad response: %v %s", err, w.Body.String())
	}
	claims, err := ValidateJWT(out.Token)
	if err != nil || claims.Username != "pt_new" {
		t.Fatalf("new token invalid: %v", err)
	}

	// The old token no longer works; the new one does.
	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if w := do(MeHandler, r); w.Code != http.StatusUnauthorized {
		t.Fatalf("old token still works: %d", w.Code)
	}
	r = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.Header.Set("Authorization", "Bearer "+out.Token)
	if w := do(MeHandler, r); w.Code != http.StatusOK {
		t.Fatalf("new token rejected: %d", w.Code)
	}

	// Cooldown.
	if w := change(out.Token, "pt_newer", pw); w.Code != http.StatusTooManyRequests {
		t.Fatalf("cooldown: got %d", w.Code)
	}
}

func TestChangePassword(t *testing.T) {
	profileSetup(t)
	const pw = "correct horse battery"
	_, tok := userWithPassword(t, "pt_pw", pw)

	change := func(cur, next string) *httptest.ResponseRecorder {
		return do(PasswordHandler, formReq(http.MethodPost, "/api/me/password", tok,
			url.Values{"current_password": {cur}, "new_password": {next}}))
	}
	if w := change(pw, "short"); w.Code != http.StatusBadRequest {
		t.Fatalf("short: got %d", w.Code)
	}
	if w := change("not the password", "a brand new passphrase"); w.Code != http.StatusForbidden {
		t.Fatalf("wrong current: got %d", w.Code)
	}
	if w := change(pw, "a brand new passphrase"); w.Code != http.StatusOK {
		t.Fatalf("change: got %d %s", w.Code, w.Body.String())
	}

	mu.RLock()
	hash := users["pt_pw"].Password
	mu.RUnlock()
	if !CheckPasswordHash("a brand new passphrase", hash) || CheckPasswordHash(pw, hash) {
		t.Fatal("password was not replaced")
	}
}
