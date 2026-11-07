package main

import (
	"encoding/json"
	"errors"
	"log"
	"math"
	"math/rand"
	"sort"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
)

// A GameRoom is an actor: ONE goroutine (run) owns every piece of room state.
// Other goroutines (WebSocket readers, the hub) only talk to it by sending
// events into its inbox. No locks around game state, no data races, and the
// rules of the game live in exactly one place.

const (
	gameTick       = 50 * time.Millisecond
	broadcastEvery = 200 * time.Millisecond // throttle for high-frequency updates (progress bars)
	roomIdleLimit  = 60 * time.Second       // a created room nobody joins is freed
	maxSpectators  = 20
	maxChatKeep    = 30
	maxChatRunes   = 200
	chatCooldown   = 700 * time.Millisecond
)

var errRoomClosed = errors.New("room is closed")

const (
	evJoin  = "join"
	evLeave = "leave"
	evMsg   = "msg"
)

type roomEvent struct {
	kind  string
	c     *gameClient
	msg   ClientMsg
	reply chan error
}

type gamePlayer struct {
	name      string
	client    *gameClient // nil while disconnected mid-game
	ready     bool
	spectator bool
	score     int
	gain      int
	lastChat  time.Time
}

type GameRoom struct {
	code    string
	def     *MapDef
	public  bool
	created time.Time
	inbox   chan roomEvent
	closed  chan struct{}
	onClose func()

	// Readable from other goroutines (hub quick-match).
	joinable atomic.Bool

	// Everything below is owned by run() and never touched elsewhere.
	rng      *rand.Rand
	players  map[string]*gamePlayer
	order    []string
	host     string
	phase    string
	phaseEnd time.Time
	idx      int
	mission  Mission
	reveal   *RevealView
	final    *FinalView
	done     []bool // per finished mission: did anyone score?
	chat     []ChatMsg
	dirty    bool
	urgent   bool
	lastSend time.Time
	stop     bool
}

func newGameRoom(code string, def *MapDef, public bool, seed int64) *GameRoom {
	r := &GameRoom{
		code: code, def: def, public: public, created: time.Now(),
		inbox:   make(chan roomEvent, 256),
		closed:  make(chan struct{}),
		rng:     rand.New(rand.NewSource(seed)),
		players: make(map[string]*gamePlayer),
		phase:   phaseLobby,
		idx:     -1,
	}
	r.syncCounters()
	return r
}

// ---- called from other goroutines -----------------------------------------

func (r *GameRoom) submit(ev roomEvent) bool {
	select {
	case r.inbox <- ev:
		return true
	case <-r.closed:
		return false
	}
}

func (r *GameRoom) join(c *gameClient) error {
	reply := make(chan error, 1)
	if !r.submit(roomEvent{kind: evJoin, c: c, reply: reply}) {
		return errRoomClosed
	}
	select {
	case err := <-reply:
		return err
	case <-r.closed:
		return errRoomClosed
	case <-time.After(5 * time.Second):
		return errRoomClosed
	}
}

func (r *GameRoom) leave(c *gameClient) { r.submit(roomEvent{kind: evLeave, c: c}) }

// ---- the actor loop --------------------------------------------------------

func (r *GameRoom) run() {
	defer func() {
		for _, p := range r.players {
			if p.client != nil {
				p.client.close()
			}
		}
		close(r.closed)
		if r.onClose != nil {
			r.onClose()
		}
	}()
	ticker := time.NewTicker(gameTick)
	defer ticker.Stop()
	for !r.stop {
		select {
		case ev := <-r.inbox:
			switch ev.kind {
			case evJoin:
				r.onJoin(ev)
			case evLeave:
				r.onLeave(ev.c)
			case evMsg:
				r.onMsg(ev)
			}
		case <-ticker.C:
			r.tick(time.Now())
		}
		r.flush(time.Now())
	}
}

func (r *GameRoom) tick(now time.Time) {
	switch r.phase {
	case phaseCountdown:
		if !now.Before(r.phaseEnd) {
			r.enterBriefing(0, now)
		}
	case phaseBriefing:
		if !now.Before(r.phaseEnd) {
			r.startPlaying(now)
		}
	case phasePlaying:
		changed, fin := r.mission.Tick(now)
		if changed {
			r.urgent = true
		}
		if fin {
			r.finishMission(now)
		}
	case phaseReveal:
		if !now.Before(r.phaseEnd) {
			if r.idx+1 < len(r.def.Missions) {
				r.enterBriefing(r.idx+1, now)
			} else {
				r.finishGame()
			}
		}
	}
	if len(r.players) == 0 && now.Sub(r.created) > roomIdleLimit {
		r.stop = true
	}
}

func (r *GameRoom) flush(now time.Time) {
	if r.urgent || (r.dirty && now.Sub(r.lastSend) >= broadcastEvery) {
		r.broadcastState(now)
		r.urgent, r.dirty, r.lastSend = false, false, now
	}
}

// ---- joining and leaving ---------------------------------------------------

func (r *GameRoom) onJoin(ev roomEvent) {
	c := ev.c
	p := r.players[c.name]
	if p != nil {
		if p.client != nil && p.client != c {
			p.client.close() // same user in a new tab: the new connection wins
		}
		p.client = c
	} else {
		spectator := r.phase != phaseLobby && r.phase != phaseFinished
		if spectator && r.spectatorCount() >= maxSpectators ||
			!spectator && r.scoredCount() >= r.def.MaxPlayers {
			ev.reply <- errRoomFull
			return
		}
		p = &gamePlayer{name: c.name, client: c, spectator: spectator}
		r.players[c.name] = p
		r.order = append(r.order, c.name)
	}
	r.ensureHost()
	ev.reply <- nil

	hello := HelloView{Protocol: protocolVersion, You: c.name, Chat: append([]ChatMsg(nil), r.chat...)}
	r.sendTo(p, Envelope{V: protocolVersion, Type: "hello", Payload: hello})
	r.syncCounters()
	r.urgent = true
}

func (r *GameRoom) onLeave(c *gameClient) {
	p := r.players[c.name]
	if p == nil || p.client != c {
		return // a stale connection (replaced by a newer one)
	}
	p.client = nil
	if r.phase == phaseLobby || r.phase == phaseFinished || p.spectator || r.phase == phaseCountdown {
		delete(r.players, p.name)
		r.removeFromOrder(p.name)
	} else if r.mission != nil {
		r.mission.Leave(p.name)
	}
	r.ensureHost()
	if r.phase == phaseCountdown && r.connectedScored() < r.def.MinPlayers {
		r.phase = phaseLobby // not enough players any more: back to the lobby
	}
	if r.connectedCount() == 0 {
		r.stop = true
		return
	}
	if r.phase == phaseLobby {
		r.maybeStart(time.Now())
	}
	r.syncCounters()
	r.urgent = true
}

func (r *GameRoom) removeFromOrder(name string) {
	for i, n := range r.order {
		if n == name {
			r.order = append(r.order[:i], r.order[i+1:]...)
			return
		}
	}
}

func (r *GameRoom) ensureHost() {
	if p := r.players[r.host]; p != nil && p.client != nil {
		return
	}
	r.host = ""
	for _, n := range r.order {
		if p := r.players[n]; p.client != nil && !p.spectator {
			r.host = n
			return
		}
	}
}

// ---- messages from players -------------------------------------------------

func (r *GameRoom) playerOf(c *gameClient) *gamePlayer {
	if p := r.players[c.name]; p != nil && p.client == c {
		return p
	}
	return nil
}

func (r *GameRoom) onMsg(ev roomEvent) {
	p := r.playerOf(ev.c)
	if p == nil {
		return
	}
	now := time.Now()
	switch ev.msg.Type {
	case "ready":
		var v struct {
			Ready bool `json:"ready"`
		}
		if r.phase != phaseLobby || p.spectator || json.Unmarshal(ev.msg.Payload, &v) != nil {
			return
		}
		p.ready = v.Ready
		r.urgent = true
		r.maybeStart(now)
	case "start":
		if r.phase == phaseLobby && p.name == r.host && r.connectedScored() >= r.def.MinPlayers {
			r.startCountdown(now)
		}
	case "chat":
		var v struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(ev.msg.Payload, &v) != nil {
			return
		}
		text := cleanChat(v.Text)
		if text == "" || now.Sub(p.lastChat) < chatCooldown {
			return
		}
		p.lastChat = now
		msg := ChatMsg{From: p.name, Text: text, At: now.UnixMilli()}
		r.chat = append(r.chat, msg)
		if len(r.chat) > maxChatKeep {
			r.chat = r.chat[len(r.chat)-maxChatKeep:]
		}
		r.broadcast(Envelope{V: protocolVersion, Type: "chat", Payload: msg})
	case "act":
		if r.phase == phasePlaying && !p.spectator && r.mission != nil {
			if r.mission.Handle(p.name, ev.msg.Payload, now) {
				r.dirty = true
			}
		}
	case "rematch":
		if r.phase == phaseFinished && !p.spectator {
			r.rematch()
		}
	}
}

func cleanChat(s string) string {
	var b strings.Builder
	n := 0
	for _, ch := range strings.TrimSpace(s) {
		if unicode.IsControl(ch) {
			ch = ' '
		}
		b.WriteRune(ch)
		if n++; n >= maxChatRunes {
			break
		}
	}
	return strings.TrimSpace(b.String())
}

// ---- game flow -------------------------------------------------------------

func (r *GameRoom) maybeStart(now time.Time) {
	if r.phase != phaseLobby || r.connectedScored() < r.def.MinPlayers {
		return
	}
	for _, p := range r.players {
		if !p.spectator && p.client != nil && !p.ready {
			return
		}
	}
	r.startCountdown(now)
}

func (r *GameRoom) startCountdown(now time.Time) {
	for _, p := range r.players {
		p.ready, p.score, p.gain = false, 0, 0
	}
	r.done, r.final, r.reveal = nil, nil, nil
	r.phase = phaseCountdown
	r.phaseEnd = now.Add(time.Duration(r.def.CountdownMS) * time.Millisecond)
	r.syncCounters()
	r.urgent = true
}

func (r *GameRoom) enterBriefing(i int, now time.Time) {
	r.idx = i
	r.phase = phaseBriefing
	r.phaseEnd = now.Add(time.Duration(r.def.BriefingMS) * time.Millisecond)
	r.reveal = nil
	r.urgent = true
}

func (r *GameRoom) startPlaying(now time.Time) {
	m, err := newMission(&r.def.Missions[r.idx], r.rng)
	if err != nil {
		log.Printf("[room %s] cannot start mission: %v", r.code, err)
		r.stop = true
		return
	}
	for _, p := range r.players {
		p.gain = 0
	}
	m.Start(now, r.scoredNames())
	r.mission = m
	r.phase = phasePlaying
	r.urgent = true
}

// finishMission converts raw performance into 0-1000 points relative to the
// best player, so a reaction test and a typing test weigh the same.
func (r *GameRoom) finishMission(now time.Time) {
	raw := r.mission.Raw()
	best := 0.0
	for _, v := range raw {
		best = math.Max(best, v)
	}
	def := r.def.Missions[r.idx]
	rev := &RevealView{Kind: def.Kind, Title: def.Title, Note: r.mission.Note(),
		Stats: r.mission.Stats(), Points: map[string]int{}}
	for _, p := range r.players {
		if p.spectator {
			continue
		}
		pts := 0
		if v := raw[p.name]; best > 0 && v > 0 {
			pts = int(math.Round(1000 * v / best))
		}
		p.gain = pts
		p.score += pts
		rev.Points[p.name] = pts
	}
	r.done = append(r.done, best > 0)
	r.reveal = rev
	r.mission = nil
	r.phase = phaseReveal
	r.phaseEnd = now.Add(time.Duration(r.def.RevealMS) * time.Millisecond)
	r.urgent = true
}

func (r *GameRoom) finishGame() {
	var rows []RankRow
	for _, n := range r.order {
		if p := r.players[n]; !p.spectator {
			rows = append(rows, RankRow{Name: p.name, Score: p.score})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Score > rows[j].Score })
	for i := range rows {
		rows[i].Place = 1
		for _, o := range rows {
			if o.Score > rows[i].Score {
				rows[i].Place++
			}
		}
	}
	won := true
	for _, d := range r.done {
		won = won && d
	}
	r.final = &FinalView{Mode: r.def.Mode, Won: won, Ranking: rows}
	r.phase = phaseFinished
	r.syncCounters()
	r.urgent = true
}

func (r *GameRoom) rematch() {
	for _, n := range append([]string(nil), r.order...) {
		p := r.players[n]
		if p.client == nil {
			delete(r.players, n)
			r.removeFromOrder(n)
			continue
		}
		p.ready, p.score, p.gain = false, 0, 0
		p.spectator = p.spectator && r.scoredCount() >= r.def.MaxPlayers
	}
	r.phase, r.idx, r.mission, r.reveal, r.final, r.done = phaseLobby, -1, nil, nil, nil, nil
	r.ensureHost()
	r.syncCounters()
	r.urgent = true
}

// ---- helpers ---------------------------------------------------------------

func (r *GameRoom) scoredCount() int {
	n := 0
	for _, p := range r.players {
		if !p.spectator {
			n++
		}
	}
	return n
}

func (r *GameRoom) spectatorCount() int { return len(r.players) - r.scoredCount() }

func (r *GameRoom) connectedCount() int {
	n := 0
	for _, p := range r.players {
		if p.client != nil {
			n++
		}
	}
	return n
}

func (r *GameRoom) connectedScored() int {
	n := 0
	for _, p := range r.players {
		if p.client != nil && !p.spectator {
			n++
		}
	}
	return n
}

func (r *GameRoom) scoredNames() []string {
	var out []string
	for _, n := range r.order {
		if p := r.players[n]; p.client != nil && !p.spectator {
			out = append(out, n)
		}
	}
	return out
}

func (r *GameRoom) syncCounters() {
	r.joinable.Store(r.public && r.phase == phaseLobby && r.scoredCount() < r.def.MaxPlayers)
}

// ---- sending ---------------------------------------------------------------

func (r *GameRoom) sendTo(p *gamePlayer, env Envelope) {
	if p.client == nil {
		return
	}
	if data, err := json.Marshal(env); err == nil {
		p.client.push(data)
	}
}

func (r *GameRoom) broadcast(env Envelope) {
	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	for _, p := range r.players {
		if p.client != nil {
			p.client.push(data)
		}
	}
}

func (r *GameRoom) broadcastState(now time.Time) {
	for _, p := range r.players {
		r.sendTo(p, Envelope{V: protocolVersion, Type: "state", Payload: r.viewFor(p, now)})
	}
}

func (r *GameRoom) viewFor(me *gamePlayer, now time.Time) StateView {
	v := StateView{Code: r.code, Map: r.def.Info(), Phase: r.phase, You: me.name,
		Spectate: me.spectator, Mission: r.idx, Now: now.UnixMilli()}
	playing := r.phase == phasePlaying && r.mission != nil
	for _, n := range r.order {
		p := r.players[n]
		pv := PlayerView{Name: p.name, Ready: p.ready, Connected: p.client != nil,
			Spectator: p.spectator, Host: p.name == r.host, Score: p.score, Gain: p.gain}
		if playing && !p.spectator {
			pv.Progress = r.mission.Progress(p.name)
		}
		v.Players = append(v.Players, pv)
	}
	switch r.phase {
	case phaseCountdown, phaseBriefing, phaseReveal:
		v.Deadline = r.phaseEnd.UnixMilli()
	}
	if r.idx >= 0 && r.idx < len(r.def.Missions) && r.phase != phaseLobby && r.phase != phaseCountdown && r.phase != phaseFinished {
		d := r.def.Missions[r.idx]
		v.Brief = &BriefView{Index: r.idx, Total: len(r.def.Missions), Kind: d.Kind, Title: d.Title, Brief: d.Brief}
	}
	if playing {
		v.Play = r.mission.Public()
		if !me.spectator {
			v.Private = r.mission.Private(me.name)
		}
		if dl := r.mission.Deadline(); !dl.IsZero() {
			v.Deadline = dl.UnixMilli()
		}
	}
	if r.phase == phaseReveal {
		v.Reveal = r.reveal
	}
	v.Result = r.final
	return v
}
