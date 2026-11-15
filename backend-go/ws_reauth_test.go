package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// shortToken is a valid access token for `name` that expires after ttl.
func shortToken(t *testing.T, name string, ttl time.Duration) string {
	t.Helper()
	_ = tokenFor(t, name) // makes sure the user exists
	mu.RLock()
	u := users[name]
	mu.RUnlock()
	tok, err := generateJWTWithTTL(u, ttl)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func dialWith(t *testing.T, host, code, token string) *websocket.Conn {
	t.Helper()
	d := websocket.Dialer{Subprotocols: []string{"bearer", token}}
	conn, resp, err := d.Dial("ws://"+host+"/ws/game?room="+code, nil)
	if err != nil {
		t.Fatalf("dial: %v (resp=%v)", err, resp)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// waitClose returns the close code/text the server ended the socket with.
func waitClose(conn *websocket.Conn, within time.Duration) (int, string, bool) {
	conn.SetReadDeadline(time.Now().Add(within))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			if ce, ok := err.(*websocket.CloseError); ok {
				return ce.Code, ce.Text, true
			}
			return 0, err.Error(), false
		}
	}
}

func sendReauth(conn *websocket.Conn, token string) {
	payload, _ := json.Marshal(token)
	b, _ := json.Marshal(map[string]any{"type": "reauth", "payload": json.RawMessage(payload)})
	_ = conn.WriteMessage(websocket.TextMessage, b)
}

func TestGameSocketClosesWhenTokenExpiresWithoutRenewal(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	u, _ := url.Parse(srv.URL)
	conn := dialWith(t, u.Host, room.code, shortToken(t, "ra_plain", 1200*time.Millisecond))
	code, text, ok := waitClose(conn, 4*time.Second)
	if !ok || code != websocket.ClosePolicyViolation || text != "token expired" {
		t.Fatalf("expected 1008 token expired, got %d %q ok=%v", code, text, ok)
	}
}

func TestGameSocketSurvivesWithInBandRenewal(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	u, _ := url.Parse(srv.URL)
	conn := dialWith(t, u.Host, room.code, shortToken(t, "ra_renew", 1200*time.Millisecond))

	time.Sleep(500 * time.Millisecond)
	sendReauth(conn, shortToken(t, "ra_renew", time.Minute)) // a freshly refreshed token

	// well past the ORIGINAL expiry, the socket must still be open
	if code, text, closed := waitClose(conn, 2500*time.Millisecond); closed {
		t.Fatalf("socket was closed despite renewal: %d %q", code, text)
	}
}

func TestInBandRenewalRejectsBadTokens(t *testing.T) {
	h, srv := newTestHub(t)
	u, _ := url.Parse(srv.URL)
	cases := map[string]func() string{
		"another user's token": func() string { return shortToken(t, "ra_victim", time.Minute) },
		"garbage":              func() string { return "not.a.jwt" },
		"empty":                func() string { return "" },
		"revoked token": func() string {
			tok := shortToken(t, "ra_revoked", time.Minute)
			if err := userStore().RevokeAllSessions(t.Context(), "ra_revoked"); err != nil {
				t.Fatal(err)
			}
			return tok
		},
	}
	for name, mk := range cases {
		room, _ := h.create(h.maps["testmap"], true)
		conn := dialWith(t, u.Host, room.code, shortToken(t, "ra_attacker_"+string(name[0])+string(rune('a'+len(name)%20)), time.Minute))
		sendReauth(conn, mk())
		code, text, ok := waitClose(conn, 3*time.Second)
		if !ok || code != websocket.ClosePolicyViolation {
			t.Errorf("%s: renewal must close the socket, got %d %q ok=%v", name, code, text, ok)
		}
	}
}

func TestChatSocketRenewalAndSanitising(t *testing.T) {
	setupAuth(t)
	m := NewManager()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", m.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	u, _ := url.Parse(srv.URL)

	dial := func(token string) *websocket.Conn {
		d := websocket.Dialer{Subprotocols: []string{"bearer", token}}
		c, resp, err := d.Dial("ws://"+u.Host+"/ws?room_id=ra-room", nil)
		if err != nil {
			t.Fatalf("dial: %v (resp=%v)", err, resp)
		}
		t.Cleanup(func() { c.Close() })
		return c
	}
	alice := dial(shortToken(t, "ra_chat_a", 1200*time.Millisecond))
	bob := dial(shortToken(t, "ra_chat_b", time.Minute))

	// renew alice in-band, then chat past the original expiry
	time.Sleep(400 * time.Millisecond)
	renew, _ := json.Marshal(map[string]string{"action": "reauth", "content": shortToken(t, "ra_chat_a", time.Minute)})
	_ = alice.WriteMessage(websocket.TextMessage, renew)

	time.Sleep(1300 * time.Millisecond)
	hello, _ := json.Marshal(map[string]string{"action": "chat", "content": "hi\u202e there\u200b!"})
	if err := alice.WriteMessage(websocket.TextMessage, hello); err != nil {
		t.Fatalf("renewed socket should still accept writes: %v", err)
	}
	bob.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, raw, err := bob.ReadMessage()
		if err != nil {
			t.Fatalf("bob never received alice's message: %v", err)
		}
		var msg Message
		if json.Unmarshal(raw, &msg) != nil || msg.Action != "chat" {
			continue
		}
		if msg.Content != "hi there!" || msg.Sender != "ra_chat_a" {
			t.Fatalf("relayed message not sanitised: %+v", msg)
		}
		return
	}
}
