package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// GameHub owns the set of live game rooms and exposes the HTTP + WebSocket
// endpoints. It reuses your existing auth (ValidateJWT, AuthMiddleware),
// origin check, per-IP limiter and WebSocket constants from auth.go / ws.go.
//
// Wiring in main.go (two lines):
//
//	hub, err := NewGameHub()
//	if err != nil { log.Fatal(err) }
//	hub.Register(mux)

const (
	maxGameRooms = 200
	gameMsgRate  = 12.0 // actions per second per connection (typing progress + answers)
	gameMsgBurst = 24.0
	codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32 symbols, no 0/O/1/I confusion
)

var roomCodeRe = regexp.MustCompile(`^[A-Z0-9]{4,8}$`)

type GameHub struct {
	mu    sync.Mutex
	rooms map[string]*GameRoom
	maps  map[string]*MapDef
	order []string
}

func NewGameHub() (*GameHub, error) {
	maps, err := LoadMaps()
	if err != nil {
		return nil, err
	}
	return &GameHub{rooms: make(map[string]*GameRoom), maps: maps, order: sortedMapIDs(maps)}, nil
}

func (h *GameHub) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/maps", withSecurity(http.MethodGet, h.handleMaps))
	mux.HandleFunc("/api/rooms", AuthMiddleware(h.handleCreate))
	mux.HandleFunc("/api/rooms/quick", AuthMiddleware(h.handleQuick))
	mux.HandleFunc("/ws/game", h.HandleWS)
}

func randomCode() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)] // 256 % 32 == 0, so no modulo bias
	}
	return string(b)
}

func randomSeed() int64 {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return int64(binary.LittleEndian.Uint64(b[:]) >> 1)
}

// newRoomLocked must be called with h.mu held.
func (h *GameHub) newRoomLocked(def *MapDef, public bool) (*GameRoom, error) {
	if len(h.rooms) >= maxGameRooms {
		return nil, errTooManyRooms
	}
	code := randomCode()
	for h.rooms[code] != nil {
		code = randomCode()
	}
	room := newGameRoom(code, def, public, randomSeed())
	room.onClose = func() {
		h.mu.Lock()
		if h.rooms[code] == room {
			delete(h.rooms, code)
		}
		h.mu.Unlock()
		log.Printf("[GAME ROOM CLOSED] %s", code)
	}
	h.rooms[code] = room
	go room.run()
	log.Printf("[GAME ROOM] %s (%s, public=%v)", code, def.ID, public)
	return room, nil
}

func (h *GameHub) get(code string) *GameRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

func (h *GameHub) create(def *MapDef, public bool) (*GameRoom, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.newRoomLocked(def, public)
}

// quick returns an open public lobby for this map, or makes one.
func (h *GameHub) quick(def *MapDef) (*GameRoom, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		if r.def.ID == def.ID && r.joinable.Load() {
			return r, nil
		}
	}
	return h.newRoomLocked(def, true)
}

// ---- HTTP ------------------------------------------------------------------

func (h *GameHub) handleMaps(w http.ResponseWriter, r *http.Request) {
	infos := make([]MapInfo, 0, len(h.order))
	for _, id := range h.order {
		infos = append(infos, h.maps[id].Info())
	}
	writeJSON(w, http.StatusOK, map[string]any{"maps": infos})
}

func (h *GameHub) mapFromForm(w http.ResponseWriter, r *http.Request) *MapDef {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return nil
	}
	def := h.maps[strings.TrimSpace(r.PostFormValue("map"))]
	if def == nil {
		writeError(w, http.StatusNotFound, "Unknown map")
	}
	return def
}

func (h *GameHub) handleCreate(w http.ResponseWriter, r *http.Request) {
	def := h.mapFromForm(w, r)
	if def == nil {
		return
	}
	priv := r.PostFormValue("private")
	room, err := h.create(def, !(priv == "1" || priv == "true"))
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"code": room.code, "map": def.ID})
}

func (h *GameHub) handleQuick(w http.ResponseWriter, r *http.Request) {
	def := h.mapFromForm(w, r)
	if def == nil {
		return
	}
	room, err := h.quick(def)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": room.code, "map": def.ID})
}

// ---- WebSocket -------------------------------------------------------------

type gameClient struct {
	conn   *websocket.Conn
	name   string
	room   *GameRoom
	send   chan []byte
	done   chan struct{}
	once   sync.Once
	expiry *time.Timer
}

func (c *gameClient) close() {
	c.once.Do(func() {
		close(c.done)
		c.conn.Close()
	})
}

// push never blocks the room: a client that cannot keep up is dropped.
func (c *gameClient) push(data []byte) {
	select {
	case c.send <- data:
	default:
		go c.close()
	}
}

func (c *gameClient) readPump() {
	defer func() {
		if c.expiry != nil {
			c.expiry.Stop()
		}
		c.room.leave(c)
		c.close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	limiter := newBucket(gameMsgRate, gameMsgBurst)
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
		if json.Unmarshal(raw, &msg) != nil || msg.Type == "" || len(msg.Type) > 16 {
			continue
		}
		c.room.submit(roomEvent{kind: evMsg, c: c, msg: msg})
	}
}

func (c *gameClient) writePump() {
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

// HandleWS: GET /ws/game?room=ABCDE  with subprotocols ["bearer", <jwt>].
func (h *GameHub) HandleWS(w http.ResponseWriter, r *http.Request) {
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
	claims, err := ValidateJWT(extractToken(r))
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if !userExists(r.Context(), claims.Username) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	room := h.get(code)
	if room == nil {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("game upgrade error: %v", err)
		return
	}
	c := &gameClient{conn: conn, name: claims.Username, room: room,
		send: make(chan []byte, sendBufferSize), done: make(chan struct{})}

	if err := room.join(c); err != nil {
		conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, err.Error()),
			time.Now().Add(writeWait))
		conn.Close()
		return
	}
	// A socket must not outlive the token that authorised it.
	if claims.ExpiresAt != nil {
		c.expiry = time.AfterFunc(time.Until(claims.ExpiresAt.Time), func() {
			conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "token expired"),
				time.Now().Add(writeWait))
			c.close()
		})
	}
	go c.writePump()
	go c.readPump()
}