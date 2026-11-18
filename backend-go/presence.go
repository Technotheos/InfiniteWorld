package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// Presence and the lobby socket
//
//	GET /ws/lobby   one socket per open tab, for as long as you are signed in.
//
// Server -> client messages (same envelope as the game socket):
//
//	presence  {name, online, room?}   a FRIEND of yours went on/offline or moved
//	friends   (no payload)            your friend list changed: refetch it
//	counts    {"<map id>": n, ...}    players per game map, every few seconds
//	dm        {from, room_id}         someone opened a direct message to you
//
// Who sees what: only friends (mutual follows) ever receive someone's
// presence, and a user who turned on "hide my presence" looks offline to
// everyone. Which room a player is in comes from the game rooms themselves
// (SetRoom/ClearRoom), never from anything the client claims.
// ---------------------------------------------------------------------------

const (
	countsEvery      = 3 * time.Second
	socialCacheTTL   = 20 * time.Second
	maxLobbyPerUser  = 5
	lobbyMsgRate     = 2.0
	lobbyMsgBurst    = 5.0
	maxSocialCache   = 20000
)

// RoomRef is where a player currently is.
type RoomRef struct {
	Code   string `json:"code,omitempty"` // empty for private rooms: the code is not leaked
	Map    string `json:"map"`
	Name   string `json:"name"`
	Public bool   `json:"joinable"` // true -> the client may offer a "Join" button
}

// PresenceView is what a friend is allowed to see.
type PresenceView struct {
	Name   string   `json:"name"`
	Online bool     `json:"online"`
	Room   *RoomRef `json:"room,omitempty"`
}

type lobbyClient struct {
	conn   *websocket.Conn
	name   string
	send   chan []byte
	done   chan struct{}
	once   sync.Once
	expiry *time.Timer
}

func (c *lobbyClient) close() {
	c.once.Do(func() {
		close(c.done)
		c.conn.Close()
	})
}

func (c *lobbyClient) push(data []byte) {
	select {
	case c.send <- data:
	default:
		go c.close() // cannot keep up: drop it rather than block the hub
	}
}

type socialEntry struct {
	friends map[string]bool
	hide    bool
	until   time.Time
}

type PresenceHub struct {
	mu     sync.Mutex
	lobby  map[string]map[*lobbyClient]struct{}
	rooms  map[string]RoomRef // username -> game room they are in
	cache  map[string]socialEntry
	counts []byte // last counts message, to push only on change
}

var presenceHub = newPresenceHub()

func newPresenceHub() *PresenceHub {
	return &PresenceHub{
		lobby: map[string]map[*lobbyClient]struct{}{},
		rooms: map[string]RoomRef{},
		cache: map[string]socialEntry{},
	}
}

func envelopeBytes(typ string, payload any) []byte {
	b, err := json.Marshal(Envelope{V: protocolVersion, Type: typ, Payload: payload})
	if err != nil {
		return nil
	}
	return b
}

// ---- friend / privacy cache -------------------------------------------------

func (h *PresenceHub) entry(name string) socialEntry {
	h.mu.Lock()
	e, ok := h.cache[name]
	h.mu.Unlock()
	if ok && time.Now().Before(e.until) {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbTimeout)
	defer cancel()
	e = socialEntry{friends: map[string]bool{}, until: time.Now().Add(socialCacheTTL)}
	ss := socialStore()
	if fr, err := ss.Friends(ctx, name); err == nil {
		for _, f := range fr {
			e.friends[f] = true
		}
	} else {
		log.Printf("presence: friends of %s: %v", name, err)
		e.until = time.Now().Add(2 * time.Second) // retry soon
	}
	if p, err := ss.GetPrivacy(ctx, name); err == nil {
		e.hide = p.HidePresence
	}
	h.mu.Lock()
	if len(h.cache) > maxSocialCache {
		h.cache = map[string]socialEntry{}
	}
	h.cache[name] = e
	h.mu.Unlock()
	return e
}

// Invalidate forgets cached friends/privacy so a change applies at once.
func (h *PresenceHub) Invalidate(names ...string) {
	h.mu.Lock()
	for _, n := range names {
		delete(h.cache, n)
	}
	h.mu.Unlock()
}

// ---- state ------------------------------------------------------------------

// View is the presence of `name` as a friend would see it.
func (h *PresenceHub) View(name string) PresenceView {
	hide := h.entry(name).hide
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.viewLocked(name, hide)
}

func (h *PresenceHub) viewLocked(name string, hide bool) PresenceView {
	v := PresenceView{Name: name}
	if hide {
		return v
	}
	room, inRoom := h.rooms[name]
	if len(h.lobby[name]) == 0 && !inRoom {
		return v
	}
	v.Online = true
	if inRoom {
		r := room
		if !r.Public {
			r.Code = "" // never reveal a private room's code
		}
		v.Room = &r
	}
	return v
}

// FriendViews returns the presence of every friend of `name`.
func (h *PresenceHub) FriendViews(name string) []PresenceView {
	e := h.entry(name)
	names := make([]string, 0, len(e.friends))
	for f := range e.friends {
		names = append(names, f)
	}
	sort.Strings(names)
	out := make([]PresenceView, 0, len(names))
	for _, f := range names {
		out = append(out, h.View(f))
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Online && !out[j].Online })
	return out
}

func (h *PresenceHub) Connect(c *lobbyClient) bool {
	h.mu.Lock()
	set := h.lobby[c.name]
	if len(set) >= maxLobbyPerUser {
		h.mu.Unlock()
		return false
	}
	if set == nil {
		set = map[*lobbyClient]struct{}{}
		h.lobby[c.name] = set
	}
	first := len(set) == 0
	set[c] = struct{}{}
	h.mu.Unlock()
	if first {
		go h.notify(c.name)
	}
	return true
}

func (h *PresenceHub) Disconnect(c *lobbyClient) {
	h.mu.Lock()
	set := h.lobby[c.name]
	if _, ok := set[c]; !ok {
		h.mu.Unlock()
		return
	}
	delete(set, c)
	last := len(set) == 0
	if last {
		delete(h.lobby, c.name)
	}
	h.mu.Unlock()
	if last {
		go h.notify(c.name)
	}
}

// SetRoom / ClearRoom are called by the game rooms (never by clients).
func (h *PresenceHub) SetRoom(name string, ref RoomRef) {
	h.mu.Lock()
	h.rooms[name] = ref
	h.mu.Unlock()
	go h.notify(name)
}

func (h *PresenceHub) ClearRoom(name, code string) {
	h.mu.Lock()
	cur, ok := h.rooms[name]
	if !ok || cur.Code != code {
		h.mu.Unlock()
		return // already moved to another room
	}
	delete(h.rooms, name)
	h.mu.Unlock()
	go h.notify(name)
}

// ---- pushing ----------------------------------------------------------------

func (h *PresenceHub) clientsOf(names ...string) []*lobbyClient {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []*lobbyClient
	for _, n := range names {
		for c := range h.lobby[n] {
			out = append(out, c)
		}
	}
	return out
}

// notify tells the online friends of `name` how `name` looks now.
func (h *PresenceHub) notify(name string) {
	e := h.entry(name)
	if len(e.friends) == 0 {
		return
	}
	data := envelopeBytes("presence", h.View(name))
	if data == nil {
		return
	}
	targets := make([]string, 0, len(e.friends))
	for f := range e.friends {
		targets = append(targets, f)
	}
	for _, c := range h.clientsOf(targets...) {
		c.push(data)
	}
}

// FriendsChanged is called after a follow/unfollow: it refreshes the caches
// and tells both people's open tabs to reload their friend list.
func (h *PresenceHub) FriendsChanged(a, b string) {
	h.Invalidate(a, b)
	if data := envelopeBytes("friends", nil); data != nil {
		for _, c := range h.clientsOf(a, b) {
			c.push(data)
		}
	}
}

// PrivacyChanged re-announces the user so friends see them vanish or return.
func (h *PresenceHub) PrivacyChanged(name string) {
	h.Invalidate(name)
	go h.notify(name)
}

// SendTo pushes one message to every open tab of a user.
func (h *PresenceHub) SendTo(name, typ string, payload any) {
	data := envelopeBytes(typ, payload)
	if data == nil {
		return
	}
	for _, c := range h.clientsOf(name) {
		c.push(data)
	}
}

func (h *PresenceHub) broadcastAll(data []byte) {
	h.mu.Lock()
	var all []*lobbyClient
	for _, set := range h.lobby {
		for c := range set {
			all = append(all, c)
		}
	}
	h.mu.Unlock()
	for _, c := range all {
		c.push(data)
	}
}

// runCounts pushes "N playing" per map to every lobby socket, only when it changed.
func (h *PresenceHub) runCounts(ctx context.Context, hub *GameHub) {
	t := time.NewTicker(countsEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			data := envelopeBytes("counts", hub.liveCounts())
			if data == nil {
				continue
			}
			h.mu.Lock()
			same := string(data) == string(h.counts)
			h.counts = data
			h.mu.Unlock()
			if !same {
				h.broadcastAll(data)
			}
		}
	}
}

func (h *PresenceHub) lastCounts() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.counts
}

// ---- the socket -------------------------------------------------------------

func (c *lobbyClient) writePump() {
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

func (c *lobbyClient) readPump() {
	defer func() {
		if c.expiry != nil {
			c.expiry.Stop()
		}
		presenceHub.Disconnect(c)
		c.close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	limiter := newBucket(lobbyMsgRate, lobbyMsgBurst)
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if !limiter.allow() {
			c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rate limit exceeded"),
				time.Now().Add(writeWait))
			return
		}
		var msg ClientMsg
		if json.Unmarshal(raw, &msg) != nil || msg.Type != "reauth" {
			continue // the lobby socket only listens for token renewals
		}
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
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"),
			time.Now().Add(writeWait))
		return
	}
}

// LobbyHandler: GET /ws/lobby with subprotocols ["bearer", <jwt>].
func LobbyHandler(w http.ResponseWriter, r *http.Request) {
	if !wsLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	claims, err := ValidateJWT(extractToken(r))
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if _, ok := checkClaims(r.Context(), claims); !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("lobby upgrade error: %v", err)
		return
	}
	c := &lobbyClient{conn: conn, name: claims.Username,
		send: make(chan []byte, sendBufferSize), done: make(chan struct{})}
	if !presenceHub.Connect(c) {
		conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "too many open tabs"),
			time.Now().Add(writeWait))
		conn.Close()
		return
	}
	if claims.ExpiresAt != nil {
		c.expiry = time.AfterFunc(time.Until(claims.ExpiresAt.Time), func() {
			conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"),
				time.Now().Add(writeWait))
			c.close()
		})
	}
	if data := presenceHub.lastCounts(); data != nil {
		c.push(data) // show counts immediately instead of waiting for the next tick
	}
	go c.writePump()
	go c.readPump()
}
