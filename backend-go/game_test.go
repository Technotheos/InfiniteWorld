package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

var authOnce sync.Once

func setupAuth(t *testing.T) {
	t.Helper()
	authOnce.Do(func() {
		os.Setenv("JWT_SECRET", strings.Repeat("test-secret-", 4))
		if err := InitAuth(); err != nil {
			t.Fatalf("InitAuth: %v", err)
		}
		reactionBetween, cipherBetween = 60*time.Millisecond, 60*time.Millisecond
	})
}

func tokenFor(t *testing.T, name string) string {
	t.Helper()
	u := User{ID: "id-" + name, Username: name}
	mu.Lock()
	users[name] = u
	mu.Unlock()
	tok, err := GenerateJWT(u)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func testMap(t *testing.T) *MapDef {
	t.Helper()
	d := &MapDef{ID: "testmap", Name: "Test", MinPlayers: 2, MaxPlayers: 3,
		CountdownMS: 50, BriefingMS: 50, RevealMS: 80,
		Missions: []MissionDef{
			{Kind: "reaction", Title: "R", Rounds: 2, MinDelayMS: 30, MaxDelayMS: 60},
			{Kind: "math", Title: "M", DurationMS: 700},
			{Kind: "typing", Title: "T", DurationMS: 1500},
			{Kind: "cipher", Title: "C", Variant: "hex", Rounds: 1, DurationMS: 1500},
			{Kind: "talk", Title: "K", DurationMS: 1500},
		}}
	if err := d.normalize(); err != nil {
		t.Fatal(err)
	}
	return d
}

func newTestHub(t *testing.T) (*GameHub, *httptest.Server) {
	t.Helper()
	setupAuth(t)
	def := testMap(t)
	real, err := LoadMaps()
	if err != nil {
		t.Fatal(err)
	}
	real[def.ID] = def
	h := &GameHub{rooms: map[string]*GameRoom{}, maps: real, order: sortedMapIDs(real)}
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, srv
}

func evalMath(q string) int {
	f := strings.Fields(q)
	var nums []int
	var ops []string
	for i, tok := range f {
		if i%2 == 0 {
			n, _ := strconv.Atoi(tok)
			nums = append(nums, n)
		} else {
			ops = append(ops, tok)
		}
	}
	vals, vops := []int{nums[0]}, []string{}
	for i, op := range ops {
		if op == "*" {
			vals[len(vals)-1] *= nums[i+1]
		} else {
			vals, vops = append(vals, nums[i+1]), append(vops, op)
		}
	}
	res := vals[0]
	for i, op := range vops {
		if op == "+" {
			res += vals[i+1]
		} else {
			res -= vals[i+1]
		}
	}
	return res
}

func cipherDecode(variant, ch string) string {
	switch variant {
	case "caesar":
		for shift := 1; shift < 26; shift++ {
			b := make([]byte, len(ch))
			for i := 0; i < len(ch); i++ {
				b[i] = 'a' + byte((int(ch[i]-'A')-shift+26)%26)
			}
			for _, w := range cipherWords["caesar"] {
				if w == string(b) {
					return w
				}
			}
		}
	case "base64":
		b, _ := base64.StdEncoding.DecodeString(ch)
		return string(b)
	case "hex":
		var out []byte
		for _, p := range strings.Fields(ch) {
			b, _ := hex.DecodeString(p)
			out = append(out, b...)
		}
		return string(out)
	case "binary":
		var out []byte
		for _, p := range strings.Fields(ch) {
			n, _ := strconv.ParseUint(p, 2, 8)
			out = append(out, byte(n))
		}
		return string(out)
	}
	return ""
}

// ---------------------------------------------------------------------------
// maps
// ---------------------------------------------------------------------------

func TestLoadMaps(t *testing.T) {
	maps, err := LoadMaps()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"arena", "cipher-lab", "spark"} {
		d := maps[id]
		if d == nil {
			t.Fatalf("missing map %s", id)
		}
		if got := len(d.Info().Missions); got != len(d.Missions) || got == 0 {
			t.Fatalf("%s: bad mission info", id)
		}
	}
	if maps["spark"].Mode != "coop" {
		t.Fatal("spark should be coop")
	}
}

func TestMapValidationRejectsBadMaps(t *testing.T) {
	ok := MissionDef{Kind: "math", Title: "M"}
	bad := map[string]MapDef{
		"bad id":       {ID: "Bad ID!", Name: "x", MinPlayers: 1, MaxPlayers: 2, Missions: []MissionDef{ok}},
		"min>max":      {ID: "okid", Name: "x", MinPlayers: 3, MaxPlayers: 2, Missions: []MissionDef{ok}},
		"no missions":  {ID: "okid", Name: "x", MinPlayers: 1, MaxPlayers: 2},
		"unknown kind": {ID: "okid", Name: "x", MinPlayers: 1, MaxPlayers: 2, Missions: []MissionDef{{Kind: "hack", Title: "h"}}},
		"cipher no variant": {ID: "okid", Name: "x", MinPlayers: 1, MaxPlayers: 2,
			Missions: []MissionDef{{Kind: "cipher", Title: "c"}}},
		"too many rounds": {ID: "okid", Name: "x", MinPlayers: 1, MaxPlayers: 2,
			Missions: []MissionDef{{Kind: "reaction", Title: "r", Rounds: 99}}},
		"huge duration": {ID: "okid", Name: "x", MinPlayers: 1, MaxPlayers: 2,
			Missions: []MissionDef{{Kind: "math", Title: "m", DurationMS: 99999999}}},
	}
	for name, d := range bad {
		d := d
		if err := d.normalize(); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

// ---------------------------------------------------------------------------
// missions (fake clock)
// ---------------------------------------------------------------------------

func click() json.RawMessage { return json.RawMessage(`{"op":"click"}`) }

func TestReactionMission(t *testing.T) {
	setupAuth(t)
	def := &MissionDef{Kind: "reaction", Title: "R", Rounds: 1, MinDelayMS: 100, MaxDelayMS: 100}
	m := &reactionMission{def: def, rng: rand.New(rand.NewSource(1))}
	t0 := time.Now()
	m.Start(t0, []string{"a", "b"})

	if pub := m.Public().(map[string]any); pub["status"] != "wait" {
		t.Fatalf("expected wait, got %v", pub["status"])
	}
	if b, _ := json.Marshal(m.Public()); strings.Contains(string(b), "go_at") || strings.Contains(strings.ToLower(string(b)), "goat") {
		t.Fatal("public data must not leak when the orb turns green")
	}
	if !m.Handle("b", click(), t0.Add(50*time.Millisecond)) { // b clicks early
		t.Fatal("false start should register")
	}
	if m.Handle("b", click(), t0.Add(60*time.Millisecond)) {
		t.Fatal("a player may act once per round")
	}
	if ch, _ := m.Tick(t0.Add(100 * time.Millisecond)); !ch || m.Public().(map[string]any)["status"] != "go" {
		t.Fatal("should flip to go at the scheduled time")
	}
	m.Handle("a", click(), t0.Add(350*time.Millisecond)) // 250 ms after go
	m.Tick(t0.Add(351 * time.Millisecond))               // everyone acted -> between
	if _, fin := m.Tick(t0.Add(351*time.Millisecond + reactionBetween)); !fin {
		t.Fatal("mission should finish after the last round")
	}
	raw := m.Raw()
	if raw["a"] != 750 || raw["b"] != 0 {
		t.Fatalf("raw = %v, want a=750 b=0", raw)
	}
	if !strings.Contains(m.Stats()["a"], "avg 250 ms") || !strings.Contains(m.Stats()["b"], "false start") {
		t.Fatalf("stats = %v", m.Stats())
	}
}

func TestMathMission(t *testing.T) {
	def := &MissionDef{Kind: "math", Title: "M", DurationMS: 1000}
	m := &mathMission{def: def, rng: rand.New(rand.NewSource(7))}
	t0 := time.Now()
	m.Start(t0, []string{"a", "b"})
	ans := func(name string, v int) json.RawMessage {
		return json.RawMessage(`{"op":"answer","value":"` + strconv.Itoa(v) + `"}`)
	}
	for i := 0; i < 3; i++ {
		q := m.Private("a").(map[string]any)["q"].(string)
		m.Handle("a", ans("a", evalMath(q)), t0)
	}
	q := m.Private("b").(map[string]any)["q"].(string)
	m.Handle("b", ans("b", evalMath(q)+1), t0) // wrong
	if m.Handle("a", json.RawMessage(`{"op":"answer","value":"abc"}`), t0) {
		t.Fatal("non-numeric answers are ignored")
	}
	if m.Handle("zed", ans("zed", 1), t0) {
		t.Fatal("unknown players are ignored")
	}
	raw := m.Raw()
	if raw["a"] != 300 || raw["b"] != 0 {
		t.Fatalf("raw = %v", raw)
	}
	if _, fin := m.Tick(t0.Add(500 * time.Millisecond)); fin {
		t.Fatal("must not finish early")
	}
	if _, fin := m.Tick(t0.Add(time.Second)); !fin {
		t.Fatal("must finish at the deadline")
	}
}

func TestMathQuestionsAreCorrect(t *testing.T) {
	for _, q := range genMath(rand.New(rand.NewSource(3)), 60) {
		if evalMath(q.text) != q.answer {
			t.Fatalf("question %q has wrong stored answer %d", q.text, q.answer)
		}
	}
}

func TestTypingMission(t *testing.T) {
	def := &MissionDef{Kind: "typing", Title: "T", DurationMS: 20000}
	m := &typingMission{def: def, rng: rand.New(rand.NewSource(2))}
	t0 := time.Now()
	m.Start(t0, []string{"cheat", "typo", "fast"})
	text := string(m.text)
	prog := func(s string) json.RawMessage {
		b, _ := json.Marshal(map[string]string{"op": "progress", "typed": s})
		return b
	}
	// Pasting the whole passage instantly is rejected by the plausibility check.
	if m.Handle("cheat", prog(text), t0.Add(100*time.Millisecond)) {
		t.Fatal("instant paste should be rejected")
	}
	// A typo only counts the correct prefix.
	m.Handle("typo", prog(text[:10]+"#"+text[11:20]), t0.Add(3*time.Second))
	if got := m.st["typo"].correct; got != 10 {
		t.Fatalf("typo correct prefix = %d, want 10", got)
	}
	// Finishing at a believable speed earns the passage length plus a time bonus.
	finishAt := t0.Add(8 * time.Second)
	if !m.Handle("fast", prog(text), finishAt) {
		t.Fatal("believable full typing should be accepted")
	}
	raw := m.Raw()
	if raw["fast"] <= float64(len(text)) || raw["typo"] != 10 || raw["cheat"] != 0 {
		t.Fatalf("raw = %v", raw)
	}
	if m.Handle("typo", prog(text+"x"), finishAt) {
		t.Fatal("typing past the end is ignored")
	}
}

func TestCipherRoundTrip(t *testing.T) {
	for variant, words := range cipherWords {
		for _, w := range words {
			for _, shift := range []int{3, 13} {
				if got := cipherDecode(variant, cipherEncode(variant, w, shift)); got != w {
					t.Fatalf("%s/%s shift %d: decoded %q", variant, w, shift, got)
				}
			}
		}
	}
}

func TestCipherMission(t *testing.T) {
	def := &MissionDef{Kind: "cipher", Title: "C", Variant: "base64", Rounds: 2, DurationMS: 3000}
	m := &cipherMission{def: def, rng: rand.New(rand.NewSource(5))}
	t0 := time.Now()
	m.Start(t0, []string{"a", "b"})
	pub := m.Public().(map[string]any)
	if _, has := pub["hint"]; has {
		t.Fatal("hint should not be visible at the start")
	}
	if _, has := pub["answer"]; has {
		t.Fatal("answer must not be visible while playing")
	}
	answer := cipherDecode("base64", pub["challenge"].(string))
	say := func(name, v string, at time.Time) bool {
		b, _ := json.Marshal(map[string]string{"op": "answer", "value": v})
		return m.Handle(name, b, at)
	}
	say("b", "wrong", t0.Add(100*time.Millisecond))
	say("a", answer, t0.Add(300*time.Millisecond))
	if ch, _ := m.Tick(t0.Add(1100 * time.Millisecond)); !ch {
		t.Fatal("hint should appear after a third of the time")
	}
	if _, has := m.Public().(map[string]any)["hint"]; !has {
		t.Fatal("hint missing")
	}
	if say("a", answer, t0.Add(1200*time.Millisecond)) {
		t.Fatal("cannot solve the same puzzle twice")
	}
	m.Tick(t0.Add(3100 * time.Millisecond)) // time up -> between
	if m.Public().(map[string]any)["answer"] != answer {
		t.Fatal("answer should be revealed between puzzles")
	}
	raw := m.Raw()
	if raw["a"] < 900 || raw["b"] != 0 {
		t.Fatalf("raw = %v (fast solver ~1000, wrong guesser 0)", raw)
	}
}

func TestTalkMission(t *testing.T) {
	def := &MissionDef{Kind: "talk", Title: "K", DurationMS: 1000, Prompts: []string{"p"}}
	m := &talkMission{def: def, rng: rand.New(rand.NewSource(1))}
	t0 := time.Now()
	m.Start(t0, []string{"a", "b", "c"})
	done := json.RawMessage(`{"op":"done","value":true}`)
	m.Handle("a", done, t0)
	m.Handle("b", done, t0)
	if _, fin := m.Tick(t0.Add(10 * time.Millisecond)); fin {
		t.Fatal("c has not agreed yet")
	}
	m.Leave("c") // a disconnected player must not block the group
	if _, fin := m.Tick(t0.Add(20 * time.Millisecond)); !fin || m.Raw()["a"] != 1 {
		t.Fatal("group should complete once everyone present agreed")
	}

	m2 := &talkMission{def: def, rng: rand.New(rand.NewSource(1))}
	m2.Start(t0, []string{"a", "b"})
	if _, fin := m2.Tick(t0.Add(2 * time.Second)); !fin || m2.Raw()["a"] != 0 {
		t.Fatal("timeout should finish the mission with no credit")
	}
}

// ---------------------------------------------------------------------------
// room rules (driven directly, no sockets)
// ---------------------------------------------------------------------------

type fixedMission struct{ raw map[string]float64 }

func (f fixedMission) Start(time.Time, []string)                      {}
func (f fixedMission) Handle(string, json.RawMessage, time.Time) bool { return false }
func (f fixedMission) Leave(string)                                   {}
func (f fixedMission) Tick(time.Time) (bool, bool)                    { return false, true }
func (f fixedMission) Deadline() time.Time                            { return time.Time{} }
func (f fixedMission) Public() any                                    { return nil }
func (f fixedMission) Private(string) any                             { return nil }
func (f fixedMission) Progress(string) float64                        { return 0 }
func (f fixedMission) Raw() map[string]float64                        { return f.raw }
func (f fixedMission) Stats() map[string]string                       { return map[string]string{} }
func (f fixedMission) Note() string                                   { return "" }

func TestScoreNormalizationAndPlaces(t *testing.T) {
	r := newGameRoom("TEST1", testMap(t), true, 1)
	for _, n := range []string{"a", "b", "c", "d"} {
		r.players[n] = &gamePlayer{name: n}
		r.order = append(r.order, n)
	}
	r.idx, r.mission = 0, fixedMission{raw: map[string]float64{"a": 50, "b": 25, "c": 0, "d": 50}}
	r.finishMission(time.Now())
	want := map[string]int{"a": 1000, "b": 500, "c": 0, "d": 1000}
	for n, w := range want {
		if got := r.players[n].score; got != w {
			t.Fatalf("%s scored %d, want %d", n, got, w)
		}
	}
	r.finishGame()
	places := map[string]int{}
	for _, row := range r.final.Ranking {
		places[row.Name] = row.Place
	}
	if places["a"] != 1 || places["d"] != 1 || places["b"] != 3 || places["c"] != 4 {
		t.Fatalf("places = %v (ties share a place, the next place is skipped)", places)
	}
}

// ---------------------------------------------------------------------------
// WebSocket bots
// ---------------------------------------------------------------------------

type bot struct {
	t       *testing.T
	name    string
	conn    *websocket.Conn
	wmu     sync.Mutex
	mu      sync.Mutex
	last    StateView
	states  chan StateView
	reveals map[string]RevealView
	final   *FinalView
	chats   []ChatMsg
	sent    map[string]bool
}

func dial(t *testing.T, srv *httptest.Server, code, name string) *bot {
	t.Helper()
	tok := tokenFor(t, name)
	u, _ := url.Parse(srv.URL)
	wsURL := "ws://" + u.Host + "/ws/game?room=" + code
	d := websocket.Dialer{Subprotocols: []string{"bearer", tok}}
	conn, resp, err := d.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("%s dial: %v (resp=%v)", name, err, resp)
	}
	b := &bot{t: t, name: name, conn: conn, states: make(chan StateView, 2048),
		reveals: map[string]RevealView{}, sent: map[string]bool{}}
	t.Cleanup(func() { conn.Close() })
	go b.read()
	return b
}

// dialRaw returns a bare connection with no background reader, for tests that
// need to read frames themselves.
func dialRaw(t *testing.T, srv *httptest.Server, code, name string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(srv.URL)
	d := websocket.Dialer{Subprotocols: []string{"bearer", tokenFor(t, name)}}
	conn, resp, err := d.Dial("ws://"+u.Host+"/ws/game?room="+code, nil)
	if err != nil {
		t.Fatalf("%s dial: %v (resp=%v)", name, err, resp)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func (b *bot) read() {
	defer close(b.states)
	for {
		_, raw, err := b.conn.ReadMessage()
		if err != nil {
			return
		}
		var env struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if json.Unmarshal(raw, &env) != nil {
			continue
		}
		switch env.Type {
		case "state":
			var st StateView
			if json.Unmarshal(env.Payload, &st) != nil {
				continue
			}
			b.mu.Lock()
			b.last = st
			if st.Reveal != nil {
				b.reveals[st.Reveal.Title] = *st.Reveal
			}
			if st.Result != nil {
				f := *st.Result
				b.final = &f
			}
			b.mu.Unlock()
			select {
			case b.states <- st:
			default:
			}
		case "chat":
			var c ChatMsg
			if json.Unmarshal(env.Payload, &c) == nil {
				b.mu.Lock()
				b.chats = append(b.chats, c)
				b.mu.Unlock()
			}
		}
	}
}

func (b *bot) send(typ string, payload any) {
	p, _ := json.Marshal(payload)
	msg, _ := json.Marshal(ClientMsg{Type: typ, Payload: p})
	b.wmu.Lock()
	defer b.wmu.Unlock()
	b.conn.WriteMessage(websocket.TextMessage, msg)
}

func (b *bot) once(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.sent[key] {
		return false
	}
	b.sent[key] = true
	return true
}

func (b *bot) snapshot() StateView {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.last
}

func (b *bot) waitFor(timeout time.Duration, pred func(StateView) bool) StateView {
	b.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if st := b.snapshot(); pred(st) {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	b.t.Fatalf("%s: timed out; last phase=%s", b.name, b.snapshot().Phase)
	return StateView{}
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// skilled plays every mission well; clumsy false-starts and ignores the rest.
func (b *bot) play(skilled bool) {
	for st := range b.states {
		if st.Phase == phaseLobby {
			if b.once("ready") {
				b.send("ready", map[string]bool{"ready": true})
			}
			continue
		}
		if st.Phase != phasePlaying || st.Play == nil {
			continue
		}
		play, priv := asMap(st.Play), asMap(st.Private)
		switch play["kind"] {
		case "reaction":
			round := strconv.Itoa(int(play["round"].(float64)))
			if skilled && play["status"] == "go" && b.once("click"+round) {
				b.send("act", map[string]string{"op": "click"})
			}
			if !skilled && play["status"] == "wait" && b.once("click"+round) {
				b.send("act", map[string]string{"op": "click"})
			}
		case "math":
			if !skilled || priv == nil {
				continue
			}
			idx := strconv.Itoa(int(priv["index"].(float64)))
			if q, _ := priv["q"].(string); q != "" && b.once("math"+idx) {
				b.send("act", map[string]any{"op": "answer", "value": strconv.Itoa(evalMath(q))})
			}
		case "typing":
			if text, _ := play["text"].(string); skilled && b.once("typing") {
				go func() {
					for n := 1; n <= len(text) && n < 60; n++ {
						b.send("act", map[string]string{"op": "progress", "typed": text[:n]})
						time.Sleep(60 * time.Millisecond)
					}
				}()
			}
		case "cipher":
			ch, _ := play["challenge"].(string)
			if skilled && play["status"] == "play" && b.once("cipher"+ch) {
				b.send("act", map[string]string{"op": "answer", "value": cipherDecode(play["variant"].(string), ch)})
			}
		case "talk":
			if b.once("talk") {
				b.send("act", map[string]any{"op": "done", "value": true})
			}
		}
	}
}

func TestFullGameWithBots(t *testing.T) {
	h, srv := newTestHub(t)
	room, err := h.create(h.maps["testmap"], true)
	if err != nil {
		t.Fatal(err)
	}
	alice := dial(t, srv, room.code, "alice")
	bob := dial(t, srv, room.code, "bob")
	go alice.play(true)
	go bob.play(false)

	alice.waitFor(20*time.Second, func(s StateView) bool { return s.Phase == phaseFinished })
	alice.mu.Lock()
	defer alice.mu.Unlock()

	if alice.final == nil || len(alice.final.Ranking) != 2 {
		t.Fatalf("expected a 2-player ranking, got %+v", alice.final)
	}
	top := alice.final.Ranking[0]
	if top.Name != "alice" || top.Place != 1 || alice.final.Ranking[1].Place != 2 {
		t.Fatalf("alice should win clearly: %+v", alice.final.Ranking)
	}
	if top.Score < 4000 || top.Score > 5000 {
		t.Fatalf("alice score %d outside 4000-5000", top.Score)
	}
	if bobScore := alice.final.Ranking[1].Score; bobScore > 1000 {
		t.Fatalf("bob only joined the talk mission, scored %d", bobScore)
	}
	for _, title := range []string{"R", "M", "T", "C", "K"} {
		rev, ok := alice.reveals[title]
		if !ok {
			t.Fatalf("missing reveal for mission %s", title)
		}
		if title != "K" && rev.Points["bob"] != 0 {
			t.Errorf("bob should score 0 in %s, got %d", title, rev.Points["bob"])
		}
	}
	if alice.reveals["R"].Points["alice"] != 1000 {
		t.Errorf("alice should take reaction, got %v", alice.reveals["R"].Points)
	}
	if alice.reveals["C"].Note == "" {
		t.Error("cipher reveal should teach something")
	}
}

func TestLobbyReadyChatAndRematch(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	alice := dial(t, srv, room.code, "alice")
	bob := dial(t, srv, room.code, "bob")
	alice.waitFor(3*time.Second, func(s StateView) bool { return len(s.Players) == 2 && s.Phase == phaseLobby })

	// alone-ready must not start the game (min 2 players, both must be ready)
	alice.send("ready", map[string]bool{"ready": true})
	time.Sleep(150 * time.Millisecond)
	if alice.snapshot().Phase != phaseLobby {
		t.Fatal("game started before everyone was ready")
	}
	alice.send("chat", map[string]string{"text": "  hello\x00 world  "})
	bob.waitFor(2*time.Second, func(StateView) bool { bob.mu.Lock(); defer bob.mu.Unlock(); return len(bob.chats) == 1 })
	bob.mu.Lock()
	if bob.chats[0].From != "alice" || bob.chats[0].Text != "hello  world" {
		t.Fatalf("chat = %+v", bob.chats[0])
	}
	bob.mu.Unlock()

	// the host is the first player to join
	for _, p := range alice.snapshot().Players {
		if p.Host != (p.Name == "alice") {
			t.Fatalf("host flag wrong: %+v", alice.snapshot().Players)
		}
	}
	bob.send("ready", map[string]bool{"ready": true})
	alice.waitFor(3*time.Second, func(s StateView) bool { return s.Phase == phaseCountdown || s.Phase == phaseBriefing })
}

func TestSpectatorAndReconnect(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	alice := dial(t, srv, room.code, "alice")
	bob := dial(t, srv, room.code, "bob")
	alice.waitFor(3*time.Second, func(s StateView) bool { return len(s.Players) == 2 })
	alice.send("ready", map[string]bool{"ready": true})
	bob.send("ready", map[string]bool{"ready": true})
	alice.waitFor(3*time.Second, func(s StateView) bool { return s.Phase == phaseBriefing })

	carol := dial(t, srv, room.code, "carol") // joins mid-game
	st := carol.waitFor(3*time.Second, func(s StateView) bool { return s.You == "carol" })
	if !st.Spectate {
		t.Fatal("late joiners must be spectators")
	}
	carol.send("act", map[string]string{"op": "click"}) // spectators cannot act; must not crash anything

	bob.conn.Close() // bob drops mid-game...
	alice.waitFor(3*time.Second, func(s StateView) bool {
		for _, p := range s.Players {
			if p.Name == "bob" && !p.Connected {
				return true
			}
		}
		return false
	})
	bob2 := dial(t, srv, room.code, "bob") // ...and comes back as himself, not a spectator
	st = bob2.waitFor(3*time.Second, func(s StateView) bool { return s.You == "bob" })
	if st.Spectate {
		t.Fatal("a reconnecting player keeps their seat")
	}
}

// ---------------------------------------------------------------------------
// HTTP + security
// ---------------------------------------------------------------------------

func TestRESTEndpoints(t *testing.T) {
	_, srv := newTestHub(t)
	tok := tokenFor(t, "restuser")
	post := func(path string, form url.Values, auth bool) (*http.Response, map[string]any) {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if auth {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return resp, out
	}

	resp, out := http.Get(srv.URL + "/api/maps")
	_ = out
	if resp != nil {
		defer resp.Body.Close()
	}
	var listing struct{ Maps []MapInfo }
	json.NewDecoder(resp.Body).Decode(&listing)
	if len(listing.Maps) < 3 {
		t.Fatalf("expected at least 3 maps, got %d", len(listing.Maps))
	}

	if r, _ := post("/api/rooms/quick", url.Values{"map": {"arena"}}, false); r.StatusCode != 401 {
		t.Fatalf("quick without auth = %d, want 401", r.StatusCode)
	}
	if r, _ := post("/api/rooms/quick", url.Values{"map": {"nope"}}, true); r.StatusCode != 404 {
		t.Fatalf("unknown map = %d, want 404", r.StatusCode)
	}
	_, a := post("/api/rooms/quick", url.Values{"map": {"arena"}}, true)
	_, b := post("/api/rooms/quick", url.Values{"map": {"arena"}}, true)
	if a["code"] == nil || a["code"] != b["code"] {
		t.Fatalf("quick-match should reuse the open lobby: %v vs %v", a, b)
	}
	_, p := post("/api/rooms", url.Values{"map": {"arena"}, "private": {"1"}}, true)
	if p["code"] == nil || p["code"] == a["code"] {
		t.Fatalf("private rooms are separate and not quick-matched: %v", p)
	}
	_, q := post("/api/rooms/quick", url.Values{"map": {"arena"}}, true)
	if q["code"] != a["code"] {
		t.Fatalf("quick-match must never place players in a private room: %v", q)
	}
}

func TestWebSocketRejectsBadRequests(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	u, _ := url.Parse(srv.URL)
	base := "ws://" + u.Host + "/ws/game?room="

	try := func(target string, subprotocols []string) int {
		d := websocket.Dialer{Subprotocols: subprotocols}
		_, resp, err := d.Dial(target, nil)
		if err == nil {
			t.Fatalf("%s: expected the handshake to fail", target)
		}
		if resp == nil {
			t.Fatalf("%s: no response: %v", target, err)
		}
		return resp.StatusCode
	}
	if c := try(base+room.code, nil); c != 401 {
		t.Errorf("no token = %d, want 401", c)
	}
	if c := try(base+room.code, []string{"bearer", "not.a.jwt"}); c != 401 {
		t.Errorf("bad token = %d, want 401", c)
	}
	good := tokenFor(t, "wsuser")
	if c := try(base+"ZZZZZ", []string{"bearer", good}); c != 404 {
		t.Errorf("unknown room = %d, want 404", c)
	}
	if c := try(base+"x!", []string{"bearer", good}); c != 400 {
		t.Errorf("malformed code = %d, want 400", c)
	}
	// a token in the query string is deliberately ignored
	if c := try(base+room.code+"&token="+good, nil); c != 401 {
		t.Errorf("query-string token = %d, want 401", c)
	}
}

func TestWebSocketFloodGetsDisconnected(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	conn := dialRaw(t, srv, room.code, "flooder")
	msg, _ := json.Marshal(ClientMsg{Type: "chat", Payload: json.RawMessage(`{"text":"spam"}`)})
	for i := 0; i < 200; i++ {
		if conn.WriteMessage(websocket.TextMessage, msg) != nil {
			break // already disconnected
		}
	}
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue
		}
		if !websocket.IsCloseError(err, websocket.ClosePolicyViolation) {
			t.Fatalf("expected a policy-violation close, got %v", err)
		}
		return
	}
}

func TestRoomsAreFreedWhenEmpty(t *testing.T) {
	h, srv := newTestHub(t)
	room, _ := h.create(h.maps["testmap"], true)
	b := dial(t, srv, room.code, "leaver")
	b.waitFor(2*time.Second, func(s StateView) bool { return len(s.Players) == 1 })
	b.conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.get(room.code) == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("empty room was not freed")
}
