package main

import (
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait         = 10 * time.Second
	pongWait          = 60 * time.Second
	pingPeriod        = pongWait * 9 / 10
	maxMessageSize    = 4096 // bytes per incoming frame
	sendBufferSize    = 64
	maxRooms          = 1000
	maxClientsPerRoom = 100
	maxConnsPerUser   = 5
	maxActionLen      = 32
	msgRatePerSec     = 5.0
	msgBurst          = 10.0
)

var (
	roomIDRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	wsLimiter = newRateLimiter(60, time.Minute) // connection attempts per IP

	errTooManyConns = errors.New("too many connections for this user")
	errTooManyRooms = errors.New("server room limit reached")
	errRoomFull     = errors.New("room is full")
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	Subprotocols:    []string{"bearer"}, // browsers send the JWT as a 2nd subprotocol
	CheckOrigin:     checkOrigin,
}

// checkOrigin blocks cross-site WebSocket hijacking. Browsers always send
// Origin; non-browser clients (CLI, mobile) don't, and still must present a JWT.
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return allowedOrigins[origin]
}

// canJoinRoom is the hook for room-level authorization (membership, invites,
// ownership...). Right now any authenticated user may join any valid room.
func canJoinRoom(username, roomID string) bool {
	return true
}

type Message struct {
	RoomID  string `json:"room_id"`
	Sender  string `json:"sender"`
	Action  string `json:"action"`
	Content string `json:"content"`
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type Client struct {
	conn     *websocket.Conn
	room     *Room
	username string
	send     chan []byte
	done     chan struct{}
	once     sync.Once
	expiry   *time.Timer
}

// close is idempotent and safe from any goroutine. The send channel is never
// closed (avoids send-on-closed-channel panics); writePump exits via done.
func (c *Client) close() {
	c.once.Do(func() {
		close(c.done)
		c.conn.Close()
	})
}

type bucket struct {
	tokens, max, rate float64
	last              time.Time
}

func newBucket(rate, max float64) *bucket {
	return &bucket{tokens: max, max: max, rate: rate, last: time.Now()}
}

func (b *bucket) allow() bool {
	now := time.Now()
	b.tokens = math.Min(b.max, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (c *Client) readPump(m *Manager) {
	defer func() {
		if c.expiry != nil {
			c.expiry.Stop()
		}
		m.leave(c)
		c.close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	limiter := newBucket(msgRatePerSec, msgBurst)

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		if !limiter.allow() {
			c.conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "rate limit exceeded"),
				time.Now().Add(writeWait),
			)
			return
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if len(msg.Action) > maxActionLen {
			continue
		}

		// Never trust client-supplied identity or room.
		msg.RoomID = c.room.ID
		msg.Sender = c.username

		outbound, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		c.room.broadcast(c, outbound)
	}
}

func (c *Client) writePump() {
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

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

type Room struct {
	ID      string
	mu      sync.Mutex
	clients map[*Client]struct{}
}

func (r *Room) add(c *Client) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.clients) >= maxClientsPerRoom {
		return false
	}
	r.clients[c] = struct{}{}
	return true
}

// remove reports whether c was present and whether the room is now empty.
func (r *Room) remove(c *Client) (removed, empty bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.clients[c]; !ok {
		return false, len(r.clients) == 0
	}
	delete(r.clients, c)
	return true, len(r.clients) == 0
}

func (r *Room) broadcast(sender *Client, data []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for c := range r.clients {
		if c == sender {
			continue
		}
		select {
		case c.send <- data:
		default:
			go c.close() // slow consumer: disconnect instead of blocking the room
		}
	}
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

type Manager struct {
	mu    sync.Mutex
	rooms map[string]*Room
	conns map[string]int // open connections per username
}

func NewManager() *Manager {
	return &Manager{
		rooms: make(map[string]*Room),
		conns: make(map[string]int),
	}
}

// join creates the room if needed and registers the client atomically, so a
// room can't be garbage-collected between lookup and join.
func (m *Manager) join(c *Client, roomID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.conns[c.username] >= maxConnsPerUser {
		return errTooManyConns
	}

	room, ok := m.rooms[roomID]
	if !ok {
		if len(m.rooms) >= maxRooms {
			return errTooManyRooms
		}
		room = &Room{ID: roomID, clients: make(map[*Client]struct{})}
		m.rooms[roomID] = room
		log.Printf("[NEW ROOM] %s", roomID)
	}
	if !room.add(c) {
		return errRoomFull
	}

	c.room = room
	m.conns[c.username]++
	return nil
}

func (m *Manager) leave(c *Client) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if c.room == nil {
		return
	}
	removed, empty := c.room.remove(c)
	if !removed {
		return
	}
	if m.conns[c.username]--; m.conns[c.username] <= 0 {
		delete(m.conns, c.username)
	}
	if empty {
		delete(m.rooms, c.room.ID) // empty rooms are freed
		log.Printf("[ROOM CLOSED] %s", c.room.ID)
	}
}

// extractToken accepts the JWT from the Authorization header (non-browser
// clients) or from the Sec-WebSocket-Protocol header (browsers):
//
//	new WebSocket(url, ["bearer", token])
//
// Tokens in the URL query string are deliberately NOT accepted: URLs end up in
// proxy/server logs and browser history.
func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[len("Bearer "):])
	}
	for _, p := range websocket.Subprotocols(r) {
		if p != "bearer" && p != "" {
			return p
		}
	}
	return ""
}

func (m *Manager) HandleWS(w http.ResponseWriter, r *http.Request) {
	if !wsLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}

	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		roomID = "general"
	}
	if !roomIDRe.MatchString(roomID) {
		http.Error(w, "Invalid room_id", http.StatusBadRequest)
		return
	}

	claims, err := ValidateJWT(extractToken(r))
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	mu.RLock()
	_, exists := users[claims.Username]
	mu.RUnlock()
	if !exists {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !canJoinRoom(claims.Username, roomID) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}

	c := &Client{
		conn:     conn,
		username: claims.Username,
		send:     make(chan []byte, sendBufferSize),
		done:     make(chan struct{}),
	}

	if err := m.join(c, roomID); err != nil {
		conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, err.Error()),
			time.Now().Add(writeWait),
		)
		conn.Close()
		return
	}

	// A long-lived socket must not outlive the token that authorised it.
	if claims.ExpiresAt != nil {
		c.expiry = time.AfterFunc(time.Until(claims.ExpiresAt.Time), func() {
			conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"),
				time.Now().Add(writeWait),
			)
			c.close()
		})
	}

	go c.writePump()
	go c.readPump(m)
}
