package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ---------------------------------------------------------------------------
// A studio room. The SERVER holds the one true sequencer, transport and queue.
// Clients send intentions ("put a pad here"); the server checks who they are,
// what role they hold and whether the message is well formed, then applies it
// and tells everybody. Nothing a client says about someone else is believed.
//
// Wire protocol (same envelope as the game rooms):
//
//	client -> server  {"type": ..., "payload": {...}}   (payloads are decoded strictly:
//	                                                     unknown fields are rejected)
//	ping{t} step{t,s,on} bpm{bpm} transport{playing} clear{} rec{state}
//	voice{on,mic,cam} rtc{to,kind,sdp} chat{text} queue{op,src,id} take{op,id}
//	consent{id,ok} publish{id} host{op,name,on,force}
//
//	server -> client  hello state step take take_gone chat pong rtc error closing kicked
//
// Roles: host (one), producer (edits the grid, records, queues tracks),
// listener (hears everything, can chat and ask questions, changes nothing).
// ---------------------------------------------------------------------------

const (
	studioTracks       = 8
	studioSteps        = 16
	studioMaxMembers   = 12
	studioMaxProducers = 8
	studioMinBPM       = 60
	studioMaxBPM       = 180
	studioDefaultBPM   = 90
	studioMaxFrame     = 16384
	studioMaxQueue     = 20
	studioMaxChat      = 30
	studioChatRunes    = 160
	studioMaxInvites   = 24
	studioRecMax       = 200 * time.Second // a "recording" flag nobody ends clears itself
	studioReadyMax     = 20 * time.Minute  // "recorded, not yet transmitted" is held this long
	studioEmptyGrace   = 15 * time.Minute  // nobody connected: closed after this
	studioHeldGrace    = 60 * time.Minute  // ...or this, while someone still has an untransmitted take
	studioHostAbsent   = 90 * time.Second  // host gone this long: the longest-serving producer takes over
	studioMemberGone   = 5 * time.Minute   // a disconnected non-recording member is forgotten
	studioTick         = time.Second
)

const (
	roleHost     = "host"
	roleProducer = "producer"
	roleListener = "listener"
)

var studioHouseTracks = map[string]string{
	"nebula-drift":   "Nebula Drift",
	"ion-storm":      "Ion Storm",
	"orbital-lounge": "Orbital Lounge",
	"cargo-bay-funk": "Cargo Bay Funk",
	"pulsar-run":     "Pulsar Run",
	"deep-field":     "Deep Field",
}

var errStudioClosed = errors.New("this studio has closed")

type studioMember struct {
	name      string
	role      string
	color     int
	client    *studioClient
	rec       string // idle | recording | ready
	recSince  time.Time
	startBeat int // quantised beat the current/last recording began on
	voiceOn   bool
	mic, cam  bool
	muted     bool // host-muted
	joinedAt  time.Time
	lostAt    time.Time
	bStep     *bucket
	bChat     *bucket
	bMisc     *bucket
	bVoice    *bucket
}

type studioQueueItem struct {
	ID    string `json:"id"`
	Src   string `json:"src"` // "house:<id>" or "track:<item id>"
	Title string `json:"title"`
	By    string `json:"by"`
}

type studioPlaying struct {
	ID    string `json:"id"`
	Src   string `json:"src"`
	Title string `json:"title"`
	By    string `json:"by"`
	Since int64  `json:"since"` // server unix ms: clients seek to now-since
	Len   int64  `json:"len"`   // ms until the next track starts by itself
}

type studioChat struct {
	ID   int    `json:"id"`
	From string `json:"from"`
	Text string `json:"text"`
	At   int64  `json:"at"`
}

type studioRoom struct {
	mu   sync.Mutex
	code string
	hub  *studioHub

	host        string
	public      bool
	inviteOnly  bool
	locked      bool
	friendsOnly bool
	members     map[string]*studioMember
	order       []string
	invited     map[string]time.Time
	banned      map[string]bool
	nextColor   int

	grid    [studioTracks][studioSteps]string
	bpm     int
	epoch   int64   // server unix ms the current tempo segment began
	offset  float64 // beat position at epoch
	playing bool

	queue    []studioQueueItem
	playingQ *studioPlaying
	qSeq     int
	takes    []string // item ids, oldest first
	chat     []studioChat
	chatSeq  int

	closed     bool
	emptySince time.Time
	live       atomic.Int32 // connected people (for the doorway counter)
	producers  atomic.Int32 // connected host + producers
	quiet      atomic.Bool  // private: not counted on the doorway
}

func newStudioRoom(code string, hub *studioHub, host string, private bool) *studioRoom {
	now := time.Now()
	r := &studioRoom{
		code: code, hub: hub, host: host, public: !private, inviteOnly: private,
		members: map[string]*studioMember{}, invited: map[string]time.Time{}, banned: map[string]bool{},
		bpm: studioDefaultBPM, epoch: now.UnixMilli(), playing: true, emptySince: now,
	}
	r.quiet.Store(private)
	// A starter groove so the first person in sees pads flare right away. It belongs to nobody.
	for _, s := range []int{0, 4, 8, 12} {
		r.grid[0][s] = "·"
	}
	for _, s := range []int{4, 12} {
		r.grid[1][s] = "·"
	}
	for _, s := range []int{2, 6, 10, 14} {
		r.grid[3][s] = "·"
	}
	return r
}

// ---- clock ------------------------------------------------------------------

// beatAt is the one shared musical clock. Everyone derives it from the same
// (epoch, offset, bpm) and their own measured offset to the server clock.
func (r *studioRoom) beatAt(nowMs int64) float64 {
	if !r.playing {
		return r.offset
	}
	return r.offset + float64(nowMs-r.epoch)*float64(r.bpm)/60000.0
}

func (r *studioRoom) rebase(nowMs int64) {
	r.offset = r.beatAt(nowMs)
	r.epoch = nowMs
}

// ---- views ------------------------------------------------------------------

type studioMemberView struct {
	Name      string     `json:"name"`
	Role      string     `json:"role"`
	Color     int        `json:"color"`
	Connected bool       `json:"connected"`
	Rec       string     `json:"rec"`
	Muted     bool       `json:"muted"`
	Voice     *VoiceView `json:"voice,omitempty"`
}

type studioTakeView struct {
	ID        string   `json:"id"`
	By        string   `json:"by"`
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	StartBeat int      `json:"start_beat"`
	LenBeats  int      `json:"len_beats"`
	DurMs     int      `json:"dur_ms"`
	At        int64    `json:"at"`
	Published bool     `json:"published"`
	Need      []string `json:"need,omitempty"`  // contributors who have not agreed to publish yet
	Agreed    []string `json:"agreed,omitempty"` // ...and who have
}

type studioStateView struct {
	Code        string             `json:"code"`
	You         string             `json:"you"`
	Role        string             `json:"role"`
	Host        string             `json:"host"`
	Public      bool               `json:"public"`
	InviteOnly  bool               `json:"invite_only"`
	FriendsOnly bool               `json:"friends_only"`
	Locked      bool               `json:"locked"`
	Held        bool               `json:"held"`
	HeldBy      []string           `json:"held_by"`
	BPM         int                `json:"bpm"`
	Epoch       int64              `json:"epoch"`
	Offset      float64            `json:"offset"`
	Playing     bool               `json:"playing"`
	Now         int64              `json:"now"`
	Members     []studioMemberView `json:"members"`
	Owners      []string           `json:"owners"`
	Grid        [][]int            `json:"grid"` // -1 empty, 0 starter pad, n = owners[n-1]
	Queue       []studioQueueItem  `json:"queue"`
	NowPlaying  *studioPlaying     `json:"now_playing,omitempty"`
	Takes       []studioTakeView   `json:"takes"`
	Chat        []studioChat       `json:"chat"`
	Invited     []string           `json:"invited,omitempty"` // host only
	Tracks      int                `json:"tracks"`
	Steps       int                `json:"steps"`
}

func (r *studioRoom) heldByLocked() []string {
	var out []string
	for _, n := range r.order {
		if m := r.members[n]; m != nil && (m.rec == "recording" || m.rec == "ready") {
			out = append(out, n)
		}
	}
	return out
}

func (r *studioRoom) takeViewLocked(it studioItem) studioTakeView {
	v := studioTakeView{ID: it.ID, By: it.Owner, Kind: it.Kind, Title: it.Title, StartBeat: it.StartBeat,
		LenBeats: it.LenBeats, DurMs: it.DurMs, At: it.CreatedAt.UnixMilli(), Published: it.Published}
	for _, c := range it.Contributors {
		if it.Consent[c] {
			v.Agreed = append(v.Agreed, c)
		} else {
			v.Need = append(v.Need, c)
		}
	}
	return v
}

func (r *studioRoom) stateLocked(me string) studioStateView {
	now := time.Now().UnixMilli()
	mm := r.members[me]
	v := studioStateView{
		Code: r.code, You: me, Host: r.host, Public: r.public && !r.inviteOnly && !r.locked,
		InviteOnly: r.inviteOnly, FriendsOnly: r.friendsOnly, Locked: r.locked,
		BPM: r.bpm, Epoch: r.epoch, Offset: r.offset, Playing: r.playing, Now: now,
		Queue: append([]studioQueueItem{}, r.queue...), NowPlaying: r.playingQ,
		Tracks: studioTracks, Steps: studioSteps,
	}
	if mm != nil {
		v.Role = mm.role
	}
	v.HeldBy = r.heldByLocked()
	if v.HeldBy == nil {
		v.HeldBy = []string{}
	}
	v.Held = len(v.HeldBy) > 0
	for _, n := range r.order {
		m := r.members[n]
		mv := studioMemberView{Name: m.name, Role: m.role, Color: m.color, Connected: m.client != nil, Rec: m.rec, Muted: m.muted}
		if m.voiceOn {
			mv.Voice = &VoiceView{On: true, Mic: m.mic && !m.muted, Cam: m.cam}
		}
		v.Members = append(v.Members, mv)
	}
	idx := map[string]int{}
	for t := 0; t < studioTracks; t++ {
		row := make([]int, studioSteps)
		for s := 0; s < studioSteps; s++ {
			o := r.grid[t][s]
			switch o {
			case "":
				row[s] = -1
			case "·":
				row[s] = 0
			default:
				i, ok := idx[o]
				if !ok {
					v.Owners = append(v.Owners, o)
					i = len(v.Owners)
					idx[o] = i
				}
				row[s] = i
			}
		}
		v.Grid = append(v.Grid, row)
	}
	if v.Owners == nil {
		v.Owners = []string{}
	}
	for _, id := range r.takes {
		if it, ok := studioStore.view(id); ok && !it.Quarantined {
			v.Takes = append(v.Takes, r.takeViewLocked(it))
		}
	}
	if v.Takes == nil {
		v.Takes = []studioTakeView{}
	}
	v.Chat = append([]studioChat{}, r.chat...)
	if me == r.host {
		for n := range r.invited {
			v.Invited = append(v.Invited, n)
		}
		sort.Strings(v.Invited)
	}
	return v
}

func (r *studioRoom) sendLocked(m *studioMember, typ string, payload any) {
	if m == nil || m.client == nil {
		return
	}
	if b, err := json.Marshal(Envelope{V: protocolVersion, Type: typ, Payload: payload}); err == nil {
		m.client.push(b)
	}
}

func (r *studioRoom) broadcastLocked(typ string, payload any) {
	b, err := json.Marshal(Envelope{V: protocolVersion, Type: typ, Payload: payload})
	if err != nil {
		return
	}
	for _, m := range r.members {
		if m.client != nil {
			m.client.push(b)
		}
	}
}

// syncLocked sends every connected member their own snapshot.
func (r *studioRoom) syncLocked() {
	for _, m := range r.members {
		if m.client != nil {
			r.sendLocked(m, "state", r.stateLocked(m.name))
		}
	}
	r.countLocked()
}

func (r *studioRoom) countLocked() {
	var live, prod int32
	for _, m := range r.members {
		if m.client != nil {
			live++
			if m.role == roleHost || m.role == roleProducer {
				prod++
			}
		}
	}
	r.live.Store(live)
	r.producers.Store(prod)
}

func (r *studioRoom) errLocked(m *studioMember, code, msg string, extra map[string]any) {
	p := map[string]any{"code": code, "message": msg}
	for k, v := range extra {
		p[k] = v
	}
	r.sendLocked(m, "error", p)
}

// ---- joining ----------------------------------------------------------------

// mayJoinLocked applies the room's rules. It runs when a ticket is issued AND again
// when the socket connects, because a lot can change in 45 seconds.
func (r *studioRoom) mayJoinLocked(name string, isFriendOfHost func() bool) error {
	if r.closed {
		return errStudioClosed
	}
	if r.banned[name] {
		return errors.New("you were removed from this studio")
	}
	if m := r.members[name]; m != nil {
		return nil // already aboard (a reconnect): the rules applied when they first came in
	}
	if name == r.host {
		return nil
	}
	_, invited := r.invited[name]
	if r.locked && !invited {
		return errors.New("this studio is locked")
	}
	if r.inviteOnly && !invited {
		return errors.New("this studio is invite-only")
	}
	if r.friendsOnly && !invited && !isFriendOfHost() {
		return errors.New("this studio is for the host's friends")
	}
	if len(r.members) >= studioMaxMembers {
		return errors.New("this studio is full")
	}
	return nil
}

func (r *studioRoom) producersLocked() int {
	n := 0
	for _, m := range r.members {
		if m.role == roleHost || m.role == roleProducer {
			n++
		}
	}
	return n
}

func (r *studioRoom) join(c *studioClient, isFriendOfHost func() bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.mayJoinLocked(c.name, isFriendOfHost); err != nil {
		return err
	}
	m := r.members[c.name]
	if m == nil {
		role := roleProducer
		if c.name == r.host {
			role = roleHost
		} else if r.producersLocked() >= studioMaxProducers {
			role = roleListener
		}
		m = &studioMember{name: c.name, role: role, color: r.nextColor % 8, rec: "idle", joinedAt: time.Now(),
			bStep: newBucket(25, 40), bChat: newBucket(1, 3), bMisc: newBucket(6, 12), bVoice: newBucket(3, 6)}
		r.nextColor++
		r.members[c.name] = m
		r.order = append(r.order, c.name)
		delete(r.invited, c.name)
	}
	if m.client != nil && m.client != c {
		old := m.client
		go old.close() // same person in a second tab: the newest connection wins
	}
	m.client = c
	m.lostAt = time.Time{}
	r.emptySince = time.Time{}
	r.sendLocked(m, "hello", map[string]any{"protocol": protocolVersion, "you": m.name})
	r.syncLocked()
	r.presenceLocked()
	return nil
}

// presenceLocked tells friends where everyone is. Never a code, so no "Join" shortcut: friends
// get in through the doorway (public quick-join) or an invite. Private studios say so, which
// is what makes the sealed iris show on their doorway.
func (r *studioRoom) presenceLocked() {
	name := "Starship Studio"
	if r.inviteOnly {
		name = "Private session"
	}
	for _, m := range r.members {
		if m.client != nil {
			presenceHub.SetRoom(m.name, RoomRef{Map: "studio", Name: name})
		}
	}
}

func (r *studioRoom) leave(c *studioClient) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.members[c.name]
	if m == nil || m.client != c {
		return // replaced by a newer connection
	}
	m.client = nil
	m.lostAt = time.Now()
	m.voiceOn, m.mic, m.cam = false, false, false
	presenceHub.ClearRoom(m.name, "")
	// A member who is not holding the room open just leaves. One who is mid-recording
	// stays on the list (offline) so everybody can see who the room is waiting for.
	if m.rec == "idle" {
		r.forgetLocked(m.name)
	}
	r.syncLocked()
}

func (r *studioRoom) forgetLocked(name string) {
	delete(r.members, name)
	for i, n := range r.order {
		if n == name {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
}

// ---- messages ---------------------------------------------------------------

func decodeStrict(raw []byte, v any) bool {
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		return false
	}
	return !d.More()
}

func (r *studioRoom) isProducer(m *studioMember) bool {
	return m.role == roleHost || m.role == roleProducer
}

func (r *studioRoom) handle(c *studioClient, msg ClientMsg) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	m := r.members[c.name]
	if m == nil || m.client != c {
		return
	}
	now := time.Now()
	nowMs := now.UnixMilli()
	p := msg.Payload

	switch msg.Type {
	case "ping":
		var v struct {
			T float64 `json:"t"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) {
			return
		}
		r.sendLocked(m, "pong", map[string]any{"t": v.T, "now": nowMs})

	case "step":
		var v struct {
			T  int  `json:"t"`
			S  int  `json:"s"`
			On bool `json:"on"`
		}
		if !r.isProducer(m) || !m.bStep.allow() || !decodeStrict(p, &v) ||
			v.T < 0 || v.T >= studioTracks || v.S < 0 || v.S >= studioSteps {
			return
		}
		by := ""
		if v.On {
			by = m.name
		}
		if r.grid[v.T][v.S] == by && v.On {
			return // already mine: nothing to say
		}
		r.grid[v.T][v.S] = by
		r.broadcastLocked("step", map[string]any{"t": v.T, "s": v.S, "on": v.On, "by": m.name, "at": nowMs})

	case "clear":
		if m.role != roleHost || !m.bMisc.allow() {
			return
		}
		r.grid = [studioTracks][studioSteps]string{}
		r.syncLocked()

	case "bpm":
		var v struct {
			BPM int `json:"bpm"`
		}
		if m.role != roleHost || !m.bMisc.allow() || !decodeStrict(p, &v) || v.BPM < studioMinBPM || v.BPM > studioMaxBPM {
			return
		}
		r.rebase(nowMs) // no jump in the beat when the tempo changes
		r.bpm = v.BPM
		r.syncLocked()

	case "transport":
		var v struct {
			Playing bool `json:"playing"`
		}
		if m.role != roleHost || !m.bMisc.allow() || !decodeStrict(p, &v) || v.Playing == r.playing {
			return
		}
		r.rebase(nowMs)
		r.playing = v.Playing
		if v.Playing {
			r.epoch = nowMs
		}
		r.syncLocked()

	case "rec":
		var v struct {
			State string `json:"state"`
		}
		if !r.isProducer(m) || !m.bMisc.allow() || !decodeStrict(p, &v) {
			return
		}
		switch v.State {
		case "recording":
			if m.muted {
				r.errLocked(m, "muted", "The host has muted you.", nil)
				return
			}
			m.startBeat = int(math.Round(r.beatAt(nowMs))) // snapped to the beat by the server
			m.recSince = now
		case "ready":
			if m.rec != "recording" {
				return
			}
			m.recSince = now
		case "idle":
		default:
			return
		}
		m.rec = v.State
		r.syncLocked()

	case "voice":
		var v struct {
			On  bool `json:"on"`
			Mic bool `json:"mic"`
			Cam bool `json:"cam"`
		}
		if !m.bVoice.allow() || !decodeStrict(p, &v) {
			return
		}
		m.voiceOn, m.mic, m.cam = v.On, v.On && v.Mic && !m.muted, v.On && v.Cam
		r.syncLocked()

	case "rtc":
		// Signalling only: the server relays offers and answers between two people who are both
		// in the booth, never looks inside, and never carries audio or video. A muted member's
		// signalling is dropped, so nobody can open a NEW audio path to them.
		var v struct {
			To   string `json:"to"`
			Kind string `json:"kind"`
			SDP  string `json:"sdp"`
		}
		if !m.voiceOn || !decodeStrict(p, &v) || (v.Kind != "offer" && v.Kind != "answer") ||
			v.SDP == "" || len(v.SDP) > maxSDPBytes || v.To == m.name {
			return
		}
		if t := r.members[v.To]; t != nil && t.voiceOn && t.client != nil && !t.muted && !m.muted {
			r.sendLocked(t, "rtc", map[string]string{"from": m.name, "kind": v.Kind, "sdp": v.SDP})
		}

	case "chat":
		var v struct {
			Text string `json:"text"`
		}
		if !m.bChat.allow() || !decodeStrict(p, &v) {
			return
		}
		text := stripText(v.Text, studioChatRunes, false)
		if text == "" {
			return
		}
		r.chatSeq++
		cm := studioChat{ID: r.chatSeq, From: m.name, Text: text, At: nowMs}
		r.chat = append(r.chat, cm)
		if len(r.chat) > studioMaxChat {
			r.chat = r.chat[len(r.chat)-studioMaxChat:]
		}
		r.broadcastLocked("chat", cm)

	case "queue":
		r.queueLocked(m, p, nowMs)

	case "take":
		var v struct {
			Op string `json:"op"`
			ID string `json:"id"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) || v.Op != "remove" {
			return
		}
		it := studioStore.get(v.ID)
		if it == nil || it.Room != r.code || (it.Owner != m.name && m.role != roleHost) {
			return
		}
		r.removeItemLocked(it.ID)
		r.syncLocked()

	case "publish":
		// The owner proposes. Publishing needs EVERY contributor's explicit yes.
		var v struct {
			ID string `json:"id"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) {
			return
		}
		it := studioStore.get(v.ID)
		if it == nil || it.Room != r.code || it.Owner != m.name {
			return
		}
		if cur, _ := studioStore.view(v.ID); cur.Published {
			return
		}
		seen := map[string]bool{it.Owner: true}
		who := []string{it.Owner}
		for t := 0; t < studioTracks; t++ {
			for s := 0; s < studioSteps; s++ {
				if o := r.grid[t][s]; o != "" && o != "·" && !seen[o] {
					seen[o] = true
					who = append(who, o)
				}
			}
		}
		sort.Strings(who)
		studioStore.mu.Lock()
		it.Contributors = who
		it.Consent = map[string]bool{it.Owner: true}
		studioStore.mu.Unlock()
		r.maybePublishLocked(it)
		r.syncLocked()

	case "consent":
		var v struct {
			ID string `json:"id"`
			OK bool   `json:"ok"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) {
			return
		}
		it := studioStore.get(v.ID)
		if it == nil || it.Room != r.code {
			return
		}
		studioStore.mu.Lock()
		listed := false
		for _, c := range it.Contributors {
			if c == m.name {
				listed = true
			}
		}
		if listed {
			it.Consent[m.name] = v.OK
			if !v.OK {
				it.Published = false // any contributor can withdraw at any time
			}
		}
		studioStore.mu.Unlock()
		if listed {
			r.maybePublishLocked(it)
			r.syncLocked()
		}

	case "host":
		r.hostLocked(m, p, now)
	}
}

func (r *studioRoom) maybePublishLocked(it *studioItem) {
	studioStore.mu.Lock()
	defer studioStore.mu.Unlock()
	if len(it.Contributors) == 0 {
		return
	}
	for _, c := range it.Contributors {
		if !it.Consent[c] {
			return
		}
	}
	it.Published = true
}

func (r *studioRoom) queueLocked(m *studioMember, p json.RawMessage, nowMs int64) {
	var v struct {
		Op  string `json:"op"`
		Src string `json:"src"`
		ID  string `json:"id"`
	}
	if !r.isProducer(m) || !m.bMisc.allow() || !decodeStrict(p, &v) {
		return
	}
	switch v.Op {
	case "add":
		if len(r.queue) >= studioMaxQueue {
			r.errLocked(m, "queue_full", "The queue is full.", nil)
			return
		}
		title := ""
		switch {
		case strings.HasPrefix(v.Src, "house:"):
			title = studioHouseTracks[strings.TrimPrefix(v.Src, "house:")]
		case strings.HasPrefix(v.Src, "track:"):
			if it, ok := studioStore.view(strings.TrimPrefix(v.Src, "track:")); ok && it.Room == r.code && it.Kind == "track" && !it.Quarantined {
				title = it.Title
			}
		}
		if title == "" {
			return
		}
		r.qSeq++
		r.queue = append(r.queue, studioQueueItem{ID: "q" + itoa(r.qSeq), Src: v.Src, Title: title, By: m.name})
		if r.playingQ == nil {
			r.advanceQueueLocked(nowMs)
		}
	case "remove":
		for i, q := range r.queue {
			if q.ID == v.ID && (q.By == m.name || m.role == roleHost) {
				r.queue = append(r.queue[:i], r.queue[i+1:]...)
				break
			}
		}
	case "next":
		r.advanceQueueLocked(nowMs)
	case "stop":
		r.playingQ = nil
	default:
		return
	}
	r.syncLocked()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// advanceQueueLocked starts the next queued track. The queue entry is consumed when it starts.
func (r *studioRoom) advanceQueueLocked(nowMs int64) {
	if len(r.queue) == 0 {
		r.playingQ = nil
		return
	}
	q := r.queue[0]
	r.queue = r.queue[1:]
	length := int64(3 * 60 * 1000) // generated house loops are re-looped for three minutes
	if strings.HasPrefix(q.Src, "track:") {
		if it, ok := studioStore.view(strings.TrimPrefix(q.Src, "track:")); ok {
			length = int64(it.DurMs)
		}
	}
	r.playingQ = &studioPlaying{ID: q.ID, Src: q.Src, Title: q.Title, By: q.By, Since: nowMs, Len: length}
}

// ---- host controls ----------------------------------------------------------

func (r *studioRoom) hostLocked(m *studioMember, p json.RawMessage, now time.Time) {
	if m.role != roleHost || !m.bMisc.allow() {
		return
	}
	var v struct {
		Op    string `json:"op"`
		Name  string `json:"name"`
		On    bool   `json:"on"`
		Role  string `json:"role"`
		Force bool   `json:"force"`
	}
	if !decodeStrict(p, &v) {
		return
	}
	target := r.members[v.Name]
	switch v.Op {
	case "lock":
		r.locked = v.On
	case "invite_only":
		r.inviteOnly = v.On
		r.quiet.Store(v.On)
		r.presenceLocked()
	case "friends_only":
		r.friendsOnly = v.On
	case "invite":
		name := normalizeUsername(v.Name)
		if !studioNameRe.MatchString(name) || name == m.name || r.banned[name] || len(r.invited) >= studioMaxInvites {
			return
		}
		r.invited[name] = now
	case "uninvite":
		delete(r.invited, normalizeUsername(v.Name))
	case "mute":
		if target == nil || target == m {
			return
		}
		target.muted = v.On
		if v.On {
			target.mic = false
			if target.rec == "recording" {
				target.rec = "idle" // muting also stops their capture; their own device is told below
			}
			r.errLocked(target, "muted", "The host muted you.", nil)
		}
	case "role":
		if target == nil || target == m || target.role == roleHost || (v.Role != roleProducer && v.Role != roleListener) {
			return
		}
		if v.Role == roleProducer && target.role != roleProducer && r.producersLocked() >= studioMaxProducers {
			r.errLocked(m, "full", "Every producer seat is taken.", nil)
			return
		}
		target.role = v.Role
		if v.Role == roleListener && target.rec != "idle" {
			target.rec = "idle"
		}
	case "kick":
		if target == nil || target == m {
			return
		}
		r.banned[target.name] = true
		delete(r.invited, target.name)
		if c := target.client; c != nil {
			r.sendLocked(target, "kicked", map[string]string{"message": "The host removed you from this studio."})
			go c.closeAfter(300 * time.Millisecond)
			presenceHub.ClearRoom(target.name, "")
		}
		r.forgetLocked(target.name)
	case "close":
		if held := r.heldByLocked(); len(held) > 0 && !v.Force {
			// "Nobody leaves until the track is done": the host must say so twice.
			r.errLocked(m, "held", "Someone is still recording.", map[string]any{"held_by": held})
			return
		}
		r.shutdownLocked("The host closed the studio.")
		return
	default:
		return
	}
	r.syncLocked()
}

// ---- takes ------------------------------------------------------------------

// landed is called by the upload handler once a file passed the whole pipeline.
func (r *studioRoom) landed(it *studioItem) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	m := r.members[it.Owner]
	studioStore.mu.Lock()
	if m != nil && it.Kind == "take" {
		it.StartBeat = m.startBeat
		m.rec = "idle"
	}
	if it.Kind == "take" {
		secPerBeat := 60.0 / float64(r.bpm)
		it.LenBeats = int(math.Ceil(float64(it.DurMs) / 1000.0 / secPerBeat))
		if it.LenBeats < 1 {
			it.LenBeats = 1
		}
	}
	studioStore.mu.Unlock()
	r.takes = append(r.takes, it.ID)
	if cur, ok := studioStore.view(it.ID); ok {
		r.broadcastLocked("take", r.takeViewLocked(cur))
	}
	r.syncLocked()
}

func (r *studioRoom) removeItemLocked(id string) {
	for i, t := range r.takes {
		if t == id {
			r.takes = append(r.takes[:i], r.takes[i+1:]...)
			break
		}
	}
	// A removed track also leaves the queue.
	for i := len(r.queue) - 1; i >= 0; i-- {
		if r.queue[i].Src == "track:"+id {
			r.queue = append(r.queue[:i], r.queue[i+1:]...)
		}
	}
	studioStore.drop(id)
	r.broadcastLocked("take_gone", map[string]string{"id": id})
}

// pull is the takedown path (moderator or auto-quarantine): remove it from the room and from disk.
func (r *studioRoom) pull(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.closed {
		r.removeItemLocked(id)
		r.syncLocked()
	}
}

// ---- who may do what outside the socket --------------------------------------

func (r *studioRoom) memberRole(name string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return "", false
	}
	m := r.members[name]
	if m == nil || m.client == nil {
		return "", false
	}
	return m.role, true
}

func (r *studioRoom) isMember(name string) bool {
	_, ok := r.memberRole(name)
	return ok
}

// ---- lifecycle ----------------------------------------------------------------

func (r *studioRoom) shutdownLocked(msg string) {
	if r.closed {
		return
	}
	r.closed = true
	r.broadcastLocked("closing", map[string]string{"message": msg})
	for _, m := range r.members {
		if m.client != nil {
			presenceHub.ClearRoom(m.name, "")
			go m.client.closeAfter(400 * time.Millisecond)
		}
	}
	r.live.Store(0)
	r.producers.Store(0)
	studioStore.markRoomClosed(r.code)
	go r.hub.forget(r.code)
}

// tick does the housekeeping: stuck recording flags, absent host, idle rooms.
func (r *studioRoom) tick(now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	changed := false
	var connected int
	for _, n := range append([]string(nil), r.order...) {
		m := r.members[n]
		if m == nil {
			continue
		}
		if m.client != nil {
			connected++
		}
		if m.rec == "recording" && now.Sub(m.recSince) > studioRecMax {
			m.rec, changed = "idle", true
		}
		if m.rec == "ready" && now.Sub(m.recSince) > studioReadyMax {
			m.rec, changed = "idle", true
		}
		if m.client == nil && !m.lostAt.IsZero() && now.Sub(m.lostAt) > studioMemberGone && m.rec == "idle" {
			r.forgetLocked(n)
			changed = true
		}
	}
	// Host gone for a while: hand the console to the longest-serving connected producer.
	if h := r.members[r.host]; h == nil || (h.client == nil && !h.lostAt.IsZero() && now.Sub(h.lostAt) > studioHostAbsent) {
		for _, n := range r.order {
			if c := r.members[n]; c != nil && c.client != nil && c.name != r.host && c.role == roleProducer {
				if h != nil {
					h.role = roleProducer
				}
				c.role, r.host = roleHost, c.name
				changed = true
				break
			}
		}
	}
	if connected == 0 {
		if r.emptySince.IsZero() {
			r.emptySince = now
		}
		grace := studioEmptyGrace
		if len(r.heldByLocked()) > 0 {
			grace = studioHeldGrace
		}
		if now.Sub(r.emptySince) > grace {
			r.shutdownLocked("The studio was empty for too long.")
			return
		}
	} else {
		r.emptySince = time.Time{}
	}
	// The lounge: when a house loop or track has run its length, move on.
	if r.playingQ != nil && now.UnixMilli()-r.playingQ.Since > r.playingQ.Len+1500 {
		r.advanceQueueLocked(now.UnixMilli())
		changed = true
	}
	if changed {
		r.syncLocked()
	}
}
