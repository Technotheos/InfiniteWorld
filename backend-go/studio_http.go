package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha1" // #nosec G505 -- coturn's REST credential scheme is HMAC-SHA1; it is not used for anything else
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// Starship Studio: HTTP and WebSocket surface.
//
//	POST /api/studio/rooms        private=0|1            -> {code}
//	POST /api/studio/quick                               -> {code}   (a public studio with space, or a new one)
//	POST /api/studio/join         code                   -> {ticket} (room rules are checked HERE and again on connect)
//	GET  /api/studio/ice                                 -> ephemeral TURN credentials
//	GET  /api/studio/invites                             -> [{from, code}] (private studios that invited you)
//	POST /api/studio/upload       multipart: room kind title declare file
//	GET  /api/studio/media-url?id=                       -> {url} signed for 60 s
//	GET  /api/studio/media/<id>?u&e&s                    -> audio bytes (signature AND membership checked)
//	POST /api/studio/report       id reason detail
//	GET  /api/studio/published                           -> tracks every contributor agreed to publish
//	GET  /ws/studio?room=CODE     subprotocols ["bearer", <ticket>]
//	GET  /api/admin/studio/reports        (users.disable)
//	POST /api/admin/studio/takedown  id   (users.disable)
// ---------------------------------------------------------------------------

const (
	studioMaxRooms     = 100
	studioConnRate     = 40.0
	studioConnBurst    = 80.0
	studioReportQuorum = 3 // distinct reporters that hide an item until a moderator looks
	studioMaxReports   = 500
)

var (
	studioNameRe = regexp.MustCompile(`^[a-z0-9_.-]{1,32}$`)
	studioIDRe   = regexp.MustCompile(`^[0-9a-f]{32}$`)

	studioUploadLimiter = newRateLimiter(12, time.Hour) // uploads per user per hour
	studioReportLimiter = newRateLimiter(20, time.Hour)
	studioJoinLimiter   = newRateLimiter(40, time.Minute)
)

type studioReport struct {
	ID       int       `json:"id"`
	Item     string    `json:"item"`
	Room     string    `json:"room"`
	Owner    string    `json:"owner"`
	Reporter string    `json:"reporter"`
	Reason   string    `json:"reason"`
	Detail   string    `json:"detail"`
	At       time.Time `json:"at"`
}

type studioHub struct {
	mu      sync.Mutex
	rooms   map[string]*studioRoom
	nonces  map[string]time.Time
	reports []studioReport
	repSeq  int
}

// studioHubInst lets the presence counter ask how many producers are on air.
var studioHubInst *studioHub

func NewStudioHub() *studioHub {
	h := &studioHub{rooms: map[string]*studioRoom{}, nonces: map[string]time.Time{}}
	studioHubInst = h
	return h
}

func (h *studioHub) Register(mux *http.ServeMux) error {
	if err := initStudioStorage(); err != nil {
		return fmt.Errorf("studio storage: %w", err)
	}
	initStudioTools()
	mux.HandleFunc("/api/studio/rooms", AuthMiddleware(h.handleCreate))
	mux.HandleFunc("/api/studio/quick", AuthMiddleware(h.handleQuick))
	mux.HandleFunc("/api/studio/join", AuthMiddleware(h.handleJoin))
	mux.HandleFunc("/api/studio/ice", AuthMiddleware(h.handleICE))
	mux.HandleFunc("/api/studio/invites", AuthMiddleware(h.handleInvites))
	mux.HandleFunc("/api/studio/upload", AuthMiddlewareLimit(studioMaxUploadBytes+(1<<20), h.handleUpload))
	mux.HandleFunc("/api/studio/media-url", AuthMiddleware(h.handleMediaURL))
	mux.HandleFunc("/api/studio/media/", h.handleMedia)
	mux.HandleFunc("/api/studio/report", AuthMiddleware(h.handleReport))
	mux.HandleFunc("/api/studio/published", AuthMiddleware(h.handlePublished))
	mux.HandleFunc("/ws/studio", h.HandleWS)
	mux.HandleFunc("/api/admin/studio/reports", adminRoute(http.MethodGet, PermUsersDisable, h.adminReports))
	mux.HandleFunc("/api/admin/studio/takedown", adminRoute(http.MethodPost, PermUsersDisable, h.adminTakedown))
	return nil
}

// run ticks every room and sweeps stored audio. Stops with the server.
func (h *studioHub) run(ctx context.Context) {
	t := time.NewTicker(studioTick)
	defer t.Stop()
	last := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			h.mu.Lock()
			rooms := make([]*studioRoom, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.Unlock()
			for _, r := range rooms {
				r.tick(now)
			}
			if now.Sub(last) > 5*time.Minute {
				last = now
				studioStore.sweep(now)
				h.mu.Lock()
				for n, exp := range h.nonces {
					if now.After(exp) {
						delete(h.nonces, n)
					}
				}
				h.mu.Unlock()
			}
		}
	}
}

func (h *studioHub) room(code string) *studioRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

func (h *studioHub) forget(code string) {
	h.mu.Lock()
	delete(h.rooms, code)
	h.mu.Unlock()
	log.Printf("[STUDIO ROOM CLOSED] %s", code)
}

func (h *studioHub) newRoomLocked(host string, private bool) (*studioRoom, error) {
	if len(h.rooms) >= studioMaxRooms {
		return nil, errors.New("the studio dock is full right now; try again soon")
	}
	code := randomCode()
	for h.rooms[code] != nil {
		code = randomCode()
	}
	r := newStudioRoom(code, h, host, private)
	h.rooms[code] = r
	log.Printf("[STUDIO ROOM] %s private=%v", code, private)
	return r, nil
}

// liveCounts is "producers on air" for the doorway. Private studios are not counted: the
// number must never reveal that a closed session exists.
func (h *studioHub) liveCounts() map[string]int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, r := range h.rooms {
		if !r.quiet.Load() {
			n += int(r.producers.Load())
		}
	}
	if n == 0 {
		return map[string]int{}
	}
	return map[string]int{"studio": n}
}

// ---- small helpers ------------------------------------------------------------

func jwtExpiry(r *http.Request) time.Time {
	tok := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if c, err := ValidateJWT(tok); err == nil && c.ExpiresAt != nil {
		return c.ExpiresAt.Time
	}
	return time.Now().Add(10 * time.Minute)
}

func friendOfFn(ctx context.Context, host, name string) func() bool {
	return func() bool {
		names, err := socialStore().Friends(ctx, host)
		if err != nil {
			return false // fail closed
		}
		for _, n := range names {
			if normalizeUsername(n) == normalizeUsername(name) {
				return true
			}
		}
		return false
	}
}

func (r *studioRoom) check(ctx context.Context, name string) error {
	r.mu.Lock()
	host := r.host
	err := r.mayJoinLocked(name, friendOfFn(ctx, host, name))
	r.mu.Unlock()
	return err
}

func postOnly(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return false
	}
	return true
}

// ---- rooms --------------------------------------------------------------------

func (h *studioHub) handleCreate(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	priv := r.PostFormValue("private")
	h.mu.Lock()
	room, err := h.newRoomLocked(UsernameFrom(r), priv == "1" || priv == "true")
	h.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"code": room.code})
}

func (h *studioHub) handleQuick(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	me := UsernameFrom(r)
	h.mu.Lock()
	defer h.mu.Unlock()
	var best *studioRoom
	bestN := -1
	for _, rm := range h.rooms {
		rm.mu.Lock()
		open := !rm.closed && rm.public && !rm.inviteOnly && !rm.locked && !rm.friendsOnly && len(rm.members) < studioMaxMembers
		n := len(rm.members)
		rm.mu.Unlock()
		if open && n > bestN {
			best, bestN = rm, n
		}
	}
	if best == nil {
		var err error
		if best, err = h.newRoomLocked(me, false); err != nil {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": best.code})
}

func (h *studioHub) handleJoin(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	me := UsernameFrom(r)
	if !studioJoinLimiter.allow(me) {
		writeError(w, http.StatusTooManyRequests, "Slow down a little.")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(r.PostFormValue("code")))
	if !roomCodeRe.MatchString(code) {
		writeError(w, http.StatusBadRequest, "That is not a studio code.")
		return
	}
	room := h.room(code)
	if room == nil {
		writeError(w, http.StatusNotFound, "No studio with that code.")
		return
	}
	if err := room.check(r.Context(), me); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ticket": makeTicket(code, me, jwtExpiry(r)), "code": code})
}

func (h *studioHub) handleInvites(w http.ResponseWriter, r *http.Request) {
	me := UsernameFrom(r)
	type inv struct {
		From string `json:"from"`
		Code string `json:"code"`
	}
	out := []inv{}
	h.mu.Lock()
	for _, rm := range h.rooms {
		rm.mu.Lock()
		if _, ok := rm.invited[me]; ok && !rm.closed && !rm.banned[me] {
			out = append(out, inv{From: rm.host, Code: rm.code})
		}
		rm.mu.Unlock()
	}
	h.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"invites": out})
}

// handleICE hands out short-lived TURN credentials (coturn "use-auth-secret" scheme). Nothing
// permanent ever reaches a browser. Without TURN_URLS and TURN_SECRET only STUN is offered, and
// the client greys out its "relay only" switch.
func (h *studioHub) handleICE(w http.ResponseWriter, r *http.Request) {
	me := UsernameFrom(r)
	type srv struct {
		URLs       []string `json:"urls"`
		Username   string   `json:"username,omitempty"`
		Credential string   `json:"credential,omitempty"`
	}
	servers := []srv{}
	if stun := splitList(os.Getenv("STUDIO_STUN_URLS")); len(stun) > 0 {
		servers = append(servers, srv{URLs: stun})
	}
	relay := false
	turn, secret := splitList(os.Getenv("TURN_URLS")), os.Getenv("TURN_SECRET")
	if len(turn) > 0 && len(secret) >= 16 {
		exp := time.Now().Add(10 * time.Minute).Unix()
		user := strconv.FormatInt(exp, 10) + ":" + me
		mac := hmac.New(sha1.New, []byte(secret))
		mac.Write([]byte(user))
		servers = append(servers, srv{URLs: turn, Username: user, Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil))})
		relay = true
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": servers, "relay_available": relay, "ttl": 600})
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ---- WebSocket ----------------------------------------------------------------

type studioClient struct {
	conn   *websocket.Conn
	name   string
	room   *studioRoom
	send   chan []byte
	done   chan struct{}
	once   sync.Once
	expiry *time.Timer
}

func (c *studioClient) close() {
	c.once.Do(func() {
		close(c.done)
		if c.conn != nil {
			c.conn.Close()
		}
	})
}

func (c *studioClient) closeAfter(d time.Duration) { time.AfterFunc(d, c.close) }

func (c *studioClient) push(data []byte) {
	select {
	case c.send <- data:
	default:
		go c.close() // cannot keep up: drop it, never stall the room
	}
}

func (c *studioClient) readPump() {
	defer func() {
		if c.expiry != nil {
			c.expiry.Stop()
		}
		c.room.leave(c)
		c.close()
	}()
	c.conn.SetReadLimit(studioMaxFrame)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(pongWait)) })
	limiter := newBucket(studioConnRate, studioConnBurst)
	rtcLimiter := newBucket(rtcMsgRate, rtcMsgBurst)
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if !limiter.allow() {
			c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rate limit exceeded"), time.Now().Add(writeWait))
			return
		}
		var msg ClientMsg
		if json.Unmarshal(raw, &msg) != nil || msg.Type == "" || len(msg.Type) > 16 {
			continue
		}
		if msg.Type == "rtc" && !rtcLimiter.allow() {
			continue
		}
		if msg.Type == "reauth" {
			var tok string
			if json.Unmarshal(msg.Payload, &tok) == nil {
				if exp, ok := renewSocketAuth(tok, c.name); ok {
					if c.expiry != nil {
						c.expiry.Reset(time.Until(exp))
					}
					continue
				}
			}
			c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"), time.Now().Add(writeWait))
			return
		}
		c.room.handle(c, msg)
	}
}

func (c *studioClient) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()
	for {
		select {
		case msg := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}

// HandleWS: GET /ws/studio?room=ABCDE with subprotocols ["bearer", <room ticket>].
// The ticket (not the login token) is what opens the socket: it is room-scoped, single-use and
// lives 45 seconds. The Origin header is checked by the shared upgrader.
func (h *studioHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	if !wsLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	code := strings.ToUpper(r.URL.Query().Get("room"))
	if !roomCodeRe.MatchString(code) {
		http.Error(w, "Invalid room code", http.StatusBadRequest)
		return
	}
	tk, ok := parseTicket(extractToken(r))
	if !ok || tk.Room != code {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	h.mu.Lock()
	_, used := h.nonces[tk.Nonce]
	if !used {
		h.nonces[tk.Nonce] = time.Now().Add(2 * studioTicketTTL)
	}
	h.mu.Unlock()
	if used {
		http.Error(w, "Unauthorized", http.StatusUnauthorized) // a ticket opens one socket, once
		return
	}
	room := h.room(code)
	if room == nil {
		http.Error(w, "Studio not found", http.StatusNotFound)
		return
	}
	if err := room.check(r.Context(), tk.User); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("studio upgrade error: %v", err)
		return
	}
	c := &studioClient{conn: conn, name: tk.User, room: room, send: make(chan []byte, sendBufferSize), done: make(chan struct{})}
	if err := room.join(c, friendOfFn(context.Background(), room.hostName(), tk.User)); err != nil {
		conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, err.Error()), time.Now().Add(writeWait))
		conn.Close()
		return
	}
	// The socket may not outlive the login that opened it; the client renews it with "reauth".
	if d := time.Until(tk.JWTExp); d > 0 {
		c.expiry = time.AfterFunc(d, func() {
			conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"), time.Now().Add(writeWait))
			c.close()
		})
	}
	go c.writePump()
	go c.readPump()
}

func (r *studioRoom) hostName() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.host
}

// canTransmit says whether this person may upload this kind of file to this room right now.
// A take is only accepted from someone who started a recording themselves (the "rec" message),
// so nobody's audio can be submitted on their behalf.
func (r *studioRoom) canTransmit(name, kind string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.members[name]
	if r.closed || m == nil || m.client == nil || !r.isProducer(m) || m.muted {
		return false
	}
	if kind == "take" {
		return m.rec == "recording" || m.rec == "ready"
	}
	return kind == "track"
}

// ---- upload -------------------------------------------------------------------

func (h *studioHub) handleUpload(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	// The server's global 10 s read/write limits are for small JSON; an audio upload gets its own.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(120 * time.Second))
	_ = rc.SetWriteDeadline(time.Now().Add(180 * time.Second))

	me := UsernameFrom(r)
	if !studioUploadLimiter.allow(me) {
		w.Header().Set("Retry-After", "600")
		writeError(w, http.StatusTooManyRequests, "That is a lot of uploads. Try again in a little while.")
		return
	}
	if !studioBin.ready() {
		writeError(w, http.StatusServiceUnavailable, errStudioNoTools.Error())
		return
	}
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "Expected a multipart upload.")
		return
	}
	fields := map[string]string{}
	var tmpPath string
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "The upload was cut off.")
			return
		}
		name := part.FormName()
		if name != "file" {
			b, _ := io.ReadAll(io.LimitReader(part, 257))
			if len(b) <= 256 && (name == "room" || name == "kind" || name == "title" || name == "declare") {
				fields[name] = string(b)
			}
			continue
		}
		// Every rule that does not need the bytes is checked BEFORE a byte is written to disk.
		code := strings.ToUpper(strings.TrimSpace(fields["room"]))
		kind := fields["kind"]
		if fields["declare"] != "1" {
			writeError(w, http.StatusBadRequest, "Please confirm you own the rights to this audio.")
			return
		}
		room := h.room(code)
		if !roomCodeRe.MatchString(code) || room == nil || (kind != "take" && kind != "track") || !room.canTransmit(me, kind) {
			writeError(w, http.StatusForbidden, "You can't upload to this studio right now.")
			return
		}
		tmp, err := studioStore.tmpFile()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Could not store the upload.")
			return
		}
		tmpPath = tmp.Name()
		n, cerr := io.Copy(tmp, io.LimitReader(part, studioMaxUploadBytes+1))
		tmp.Close()
		if cerr != nil || n == 0 || n > studioMaxUploadBytes {
			os.Remove(tmpPath)
			if n > studioMaxUploadBytes {
				writeError(w, http.StatusRequestEntityTooLarge, errStudioTooBig.Error())
			} else {
				writeError(w, http.StatusBadRequest, "The upload was empty or cut off.")
			}
			return
		}
		break
	}
	if tmpPath == "" {
		writeError(w, http.StatusBadRequest, "No audio file in the upload.")
		return
	}
	defer os.Remove(tmpPath)

	code := strings.ToUpper(strings.TrimSpace(fields["room"]))
	kind := fields["kind"]
	title := stripText(fields["title"], 60, false)
	if title == "" {
		if kind == "track" {
			title = "Untitled track"
		} else {
			title = "Take"
		}
	}
	room := h.room(code)
	if room == nil {
		writeError(w, http.StatusNotFound, "That studio has closed.")
		return
	}
	it, err := studioStore.ingest(r.Context(), me, code, kind, title, tmpPath)
	if err != nil {
		status := http.StatusUnprocessableEntity
		switch {
		case errors.Is(err, errStudioQuota):
			status = http.StatusInsufficientStorage
		case errors.Is(err, errStudioNoTools):
			status = http.StatusServiceUnavailable
		case errors.Is(err, errStudioInfected):
			status = http.StatusUnprocessableEntity
		}
		auditFail(r, "studio.upload", code, err)
		writeError(w, status, capitalize(err.Error())+".")
		return
	}
	// The room may have closed, or the person been removed, while we were encoding.
	if !room.canTransmit(me, kind) {
		studioStore.drop(it.ID)
		writeError(w, http.StatusForbidden, "You can't upload to this studio right now.")
		return
	}
	room.landed(it)
	auditOK(r, "studio.upload", it.ID, map[string]any{"room": code, "kind": kind, "bytes": it.Bytes, "dur_ms": it.DurMs}) // metadata only
	writeJSON(w, http.StatusCreated, map[string]any{"id": it.ID, "dur_ms": it.DurMs})
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func auditFail(r *http.Request, action, target string, err error) {
	audit(r, AuditEvent{Action: action, Target: target, Success: false, Detail: map[string]any{"reason": clip(err.Error(), 120)}})
}

// ---- reading audio ------------------------------------------------------------

// studioCanRead is THE access rule, checked on every fetch: you are in the item's room right now,
// or every contributor agreed to publish it. A signed URL alone is never enough.
func (h *studioHub) studioCanRead(user string, it studioItem) bool {
	if it.Quarantined || it.Removed {
		return false
	}
	if it.Published {
		return true
	}
	if rm := h.room(it.Room); rm != nil {
		return rm.isMember(user)
	}
	return false
}

func (h *studioHub) handleMediaURL(w http.ResponseWriter, r *http.Request) {
	me := UsernameFrom(r)
	id := r.URL.Query().Get("id")
	if !studioIDRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "Bad id.")
		return
	}
	it, ok := studioStore.view(id)
	if !ok || !h.studioCanRead(me, it) {
		writeError(w, http.StatusNotFound, "Not found.") // same answer for "missing" and "not yours"
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": "/api/studio/media/" + id + "?" + signMedia(id, me), "ttl": int(studioSigTTL.Seconds())})
}

func (h *studioHub) handleMedia(w http.ResponseWriter, r *http.Request) {
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
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !apiLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "Too many requests")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/studio/media/")
	q := r.URL.Query()
	user := q.Get("u")
	if !studioIDRe.MatchString(id) || !studioNameRe.MatchString(user) || !verifyMedia(id, user, q.Get("e"), q.Get("s")) {
		writeError(w, http.StatusForbidden, "Link expired.")
		return
	}
	it, ok := studioStore.view(id)
	if !ok || !h.studioCanRead(user, it) {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	f, err := os.Open(it.Path)
	if err != nil {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(120 * time.Second))
	hd := w.Header()
	hd.Set("Content-Type", "audio/mp4")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Disposition", `attachment; filename="studio-audio.m4a"`) // never the uploader's name
	hd.Set("Cache-Control", "private, no-store")
	hd.Set("Cross-Origin-Resource-Policy", "cross-origin") // the app and the API are on different origins
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (h *studioHub) handlePublished(w http.ResponseWriter, r *http.Request) {
	type row struct {
		ID           string   `json:"id"`
		Title        string   `json:"title"`
		Owner        string   `json:"owner"`
		Contributors []string `json:"contributors"`
		DurMs        int      `json:"dur_ms"`
	}
	out := []row{}
	studioStore.mu.Lock()
	for _, it := range studioStore.items {
		if it.Published && !it.Quarantined && !it.Removed {
			out = append(out, row{it.ID, it.Title, it.Owner, append([]string(nil), it.Contributors...), it.DurMs})
		}
	}
	studioStore.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > 100 {
		out = out[:100]
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": out})
}

// ---- report and takedown ------------------------------------------------------

func (h *studioHub) handleReport(w http.ResponseWriter, r *http.Request) {
	if !postOnly(w, r) {
		return
	}
	me := UsernameFrom(r)
	if !studioReportLimiter.allow(me) {
		writeError(w, http.StatusTooManyRequests, "Too many reports. Thank you; a moderator will look.")
		return
	}
	id := r.PostFormValue("id")
	reason := r.PostFormValue("reason")
	if !studioIDRe.MatchString(id) || (reason != "copyright" && reason != "abuse" && reason != "other") {
		writeError(w, http.StatusBadRequest, "Pick a reason.")
		return
	}
	it, ok := studioStore.view(id)
	if !ok || !h.studioCanRead(me, it) {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	detail := stripText(r.PostFormValue("detail"), 300, true)

	quarantine := false
	studioStore.mu.Lock()
	if live := studioStore.items[id]; live != nil {
		live.Reporters[me] = true
		if len(live.Reporters) >= studioReportQuorum && !live.Quarantined {
			live.Quarantined, quarantine = true, true
		}
	}
	studioStore.mu.Unlock()

	h.mu.Lock()
	h.repSeq++
	h.reports = append(h.reports, studioReport{ID: h.repSeq, Item: id, Room: it.Room, Owner: it.Owner, Reporter: me, Reason: reason, Detail: detail, At: time.Now()})
	if len(h.reports) > studioMaxReports {
		h.reports = h.reports[len(h.reports)-studioMaxReports:]
	}
	h.mu.Unlock()

	if quarantine {
		if rm := h.room(it.Room); rm != nil {
			rm.refresh()
		}
	}
	auditOK(r, "studio.report", id, map[string]any{"reason": reason, "quarantined": quarantine})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (r *studioRoom) refresh() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.closed {
		r.syncLocked()
	}
}

func (h *studioHub) adminReports(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	out := append([]studioReport(nil), h.reports...)
	h.mu.Unlock()
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": out})
}

// adminTakedown deletes the audio for good: out of the room, off the disk, out of the owner's quota.
func (h *studioHub) adminTakedown(w http.ResponseWriter, r *http.Request) {
	id := r.PostFormValue("id")
	if !studioIDRe.MatchString(id) {
		writeError(w, http.StatusBadRequest, "Bad id.")
		return
	}
	it, ok := studioStore.view(id)
	if !ok {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	if rm := h.room(it.Room); rm != nil {
		rm.pull(id)
	} else {
		studioStore.drop(id)
	}
	audit(r, AuditEvent{Action: "studio.takedown", Target: id, Success: true,
		Detail: map[string]any{"owner": it.Owner, "room": it.Room, "note": clip(stripText(r.PostFormValue("note"), 200, false), 200)}})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
