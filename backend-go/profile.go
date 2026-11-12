package main

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// ---------------------------------------------------------------------------
// Profile & settings API
//
//	GET  /api/me                 your profile
//	POST /api/me/profile         bio=...
//	POST /api/me/avatar          raw JPEG body (the app crops it to a square first)
//	POST /api/me/avatar/remove
//	POST /api/me/username        username=...&password=...   -> new token
//	POST /api/me/password        current_password=...&new_password=...
//	GET  /api/avatar/{username}  public avatar image (404 when none)
// ---------------------------------------------------------------------------

const (
	maxBioRunes            = 160
	maxAvatarUpload        = 256 << 10 // bytes accepted from the client
	maxAvatarSide          = 1024      // pixels; guards against decompression bombs
	minAvatarSide          = 32
	avatarQuality          = 85
	usernameChangeCooldown = 24 * time.Hour
)

var (
	MeHandler           = AuthMiddleware(meHandler)
	BioHandler          = AuthMiddleware(bioHandler)
	AvatarUploadHandler = AuthMiddlewareLimit(maxAvatarUpload, avatarUploadHandler)
	AvatarRemoveHandler = AuthMiddleware(avatarRemoveHandler)
	UsernameHandler     = AuthMiddleware(usernameHandler)
	PasswordHandler     = AuthMiddleware(passwordHandler)
	PublicAvatarHandler = http.HandlerFunc(publicAvatarHandler)
)

func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == method {
		return true
	}
	w.Header().Set("Allow", method)
	writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
	return false
}

func storeUnavailable(w http.ResponseWriter, what string, err error) {
	if errors.Is(err, ErrUserNotFound) {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	log.Printf("%s: %v", what, err)
	writeError(w, http.StatusInternalServerError, "Internal server error")
}

// ---- GET /api/me ------------------------------------------------------------

func meHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	p, err := userStore().Profile(r.Context(), UsernameFrom(r))
	if err != nil {
		storeUnavailable(w, "profile", err)
		return
	}
	out := map[string]interface{}{
		"username":       p.Username,
		"bio":            p.Bio,
		"created_at":     p.CreatedAt,
		"avatar_version": int64(0),
	}
	if !p.AvatarUpdated.IsZero() {
		out["avatar_version"] = p.AvatarUpdated.UnixMilli()
	}
	if !p.UsernameChangedAt.IsZero() {
		if next := p.UsernameChangedAt.Add(usernameChangeCooldown); next.After(time.Now()) {
			out["username_change_available_at"] = next
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- POST /api/me/profile ---------------------------------------------------

func validateBio(s string) (string, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if !utf8.ValidString(s) {
		return "", errors.New("bio contains invalid characters")
	}
	if utf8.RuneCountInString(s) > maxBioRunes {
		return "", fmt.Errorf("bio must be at most %d characters", maxBioRunes)
	}
	for _, c := range s {
		if c != '\n' && unicode.IsControl(c) {
			return "", errors.New("bio contains invalid characters")
		}
	}
	// Keep it a short blurb: at most two line breaks.
	if strings.Count(s, "\n") > 2 {
		return "", errors.New("bio can have at most 3 lines")
	}
	return s, nil
}

func bioHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	bio, err := validateBio(r.PostFormValue("bio"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := userStore().SetBio(r.Context(), UsernameFrom(r), bio); err != nil {
		storeUnavailable(w, "set bio", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"bio": bio})
}

// ---- avatar -----------------------------------------------------------------

// normalizeAvatar checks that data really is a reasonably sized JPEG and
// re-encodes it. Re-encoding drops EXIF/GPS metadata and anything appended to
// the file, so only pixels are ever stored.
func normalizeAvatar(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("no image received")
	}
	if http.DetectContentType(data) != "image/jpeg" {
		return nil, errors.New("avatar must be a JPEG image")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("that image could not be read")
	}
	if cfg.Width > maxAvatarSide || cfg.Height > maxAvatarSide {
		return nil, fmt.Errorf("image is too large (max %dx%d)", maxAvatarSide, maxAvatarSide)
	}
	if cfg.Width < minAvatarSide || cfg.Height < minAvatarSide {
		return nil, errors.New("image is too small")
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("that image could not be read")
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, image.Image(img), &jpeg.Options{Quality: avatarQuality}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func avatarUploadHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	data, err := io.ReadAll(r.Body) // already capped by MaxBytesReader
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "Image is too large (max 256 KB)")
		return
	}
	clean, err := normalizeAvatar(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	username := UsernameFrom(r)
	if err := userStore().SetAvatar(r.Context(), username, clean); err != nil {
		storeUnavailable(w, "set avatar", err)
		return
	}
	p, err := userStore().Profile(r.Context(), username)
	if err != nil {
		storeUnavailable(w, "profile after avatar", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"avatar_version": p.AvatarUpdated.UnixMilli()})
}

func avatarRemoveHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if err := userStore().RemoveAvatar(r.Context(), UsernameFrom(r)); err != nil {
		storeUnavailable(w, "remove avatar", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"avatar_version": 0})
}

// publicAvatarHandler serves /api/avatar/{username}. It is public on purpose
// (an <img> tag cannot send an Authorization header) and, like usernames in a
// chat room, carries nothing but the picture itself.
func publicAvatarHandler(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	name := normalizeUsername(strings.TrimPrefix(r.URL.Path, "/api/avatar/"))
	if !usernameRe.MatchString(name) {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	data, updated, found, err := userStore().Avatar(r.Context(), name)
	if err != nil {
		log.Printf("avatar: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if !found {
		h.Set("Cache-Control", "public, max-age=60")
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	etag := `"` + strconv.FormatInt(updated.UnixMilli(), 10) + `"`
	h.Set("ETag", etag)
	// The app adds ?v=<version>, so a changed picture is a new URL; the short
	// max-age just keeps the old one from lingering for other viewers.
	h.Set("Cache-Control", "public, max-age=300")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "image/jpeg")
	h.Set("Content-Length", strconv.Itoa(len(data)))
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
}

// ---- POST /api/me/username --------------------------------------------------

// verifyPassword checks the signed-in user's password, sharing the login
// lockout so this endpoint cannot be used to guess it.
func verifyPassword(w http.ResponseWriter, r *http.Request, username, password string) bool {
	if lockout.isLocked(username) {
		w.Header().Set("Retry-After", strconv.Itoa(int(lockoutDuration.Seconds())))
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts, try again later")
		return false
	}
	u, exists, err := userStore().ByUsername(r.Context(), username)
	if err != nil {
		log.Printf("verify password lookup: %v", err)
		writeError(w, http.StatusServiceUnavailable, "Service temporarily unavailable")
		return false
	}
	if !exists {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return false
	}
	if !CheckPasswordHash(password, u.Password) {
		lockout.fail(username)
		writeError(w, http.StatusForbidden, "Incorrect password")
		return false
	}
	lockout.reset(username)
	return true
}

func usernameHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	current := UsernameFrom(r)
	next := normalizeUsername(r.PostFormValue("username"))
	password := r.PostFormValue("password")

	if !usernameRe.MatchString(next) {
		writeError(w, http.StatusBadRequest, "Username must be 3-32 characters: a-z, 0-9, '_', '.', '-'")
		return
	}
	if next == current {
		writeError(w, http.StatusBadRequest, "That is already your username")
		return
	}
	if !verifyPassword(w, r, current, password) {
		return
	}

	if err := userStore().Rename(r.Context(), current, next, usernameChangeCooldown); err != nil {
		var tooSoon *RenameTooSoonError
		switch {
		case errors.Is(err, ErrUsernameTaken):
			writeError(w, http.StatusConflict, "Username already taken")
		case errors.As(err, &tooSoon):
			w.Header().Set("Retry-After", strconv.Itoa(int(time.Until(tooSoon.Until).Seconds())+1))
			writeError(w, http.StatusTooManyRequests, "You changed your username recently. Try again later.")
		default:
			storeUnavailable(w, "rename", err)
		}
		return
	}

	// The old token carries the old name, so hand back a fresh one.
	user, ok, err := userStore().ByUsername(r.Context(), next)
	if err != nil || !ok {
		log.Printf("rename: reload %q: ok=%v err=%v", next, ok, err)
		writeError(w, http.StatusInternalServerError, "Username changed, please log in again")
		return
	}
	token, err := GenerateJWT(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Username changed, please log in again")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token":      token,
		"username":   user.Username,
		"expires_in": int(tokenTTL.Seconds()),
	})
}

// ---- POST /api/me/password --------------------------------------------------

func passwordHandler(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	username := UsernameFrom(r)
	current := r.PostFormValue("current_password")
	next := r.PostFormValue("new_password")

	if err := validatePassword(next); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if next == current {
		writeError(w, http.StatusBadRequest, "Choose a password you have not used here before")
		return
	}
	if !verifyPassword(w, r, username, current) {
		return
	}
	hashed, err := HashPassword(next) // slow by design, done outside any lock
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if err := userStore().SetPassword(r.Context(), username, hashed); err != nil {
		storeUnavailable(w, "set password", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Password updated"})
}
