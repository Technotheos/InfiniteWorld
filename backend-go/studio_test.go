package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSniffAudio(t *testing.T) {
	good := map[string][]byte{
		"wav":  []byte("RIFF\x24\x00\x00\x00WAVEfmt "),
		"ogg":  []byte("OggS\x00\x02"),
		"flac": []byte("fLaC\x00\x00"),
		"mp3":  []byte("ID3\x04\x00\x00"),
		"webm": append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84}, []byte("webm")...),
	}
	for want, head := range good {
		if got, ok := sniffAudio(head); !ok || string(got) != want {
			t.Errorf("%s: got %q ok=%v", want, got, ok)
		}
	}
	if _, ok := sniffAudio([]byte{0xFF, 0xFB, 0x90, 0x00}); !ok {
		t.Error("raw MPEG frame should be mp3")
	}
	bad := [][]byte{
		[]byte("<svg xmlns=\"http://www.w3.org/2000/svg\">"),
		[]byte("<!DOCTYPE html><html>"),
		[]byte("\x89PNG\r\n\x1a\n"),
		[]byte("MZ\x90\x00"),
		{0xFF, 0xF1, 0x50, 0x80},                                        // AAC/ADTS is not accepted
		append([]byte{0x1A, 0x45, 0xDF, 0xA3, 0x93, 0x42, 0x82, 0x88}, []byte("matroska")...), // video-capable container
		nil,
	}
	for i, head := range bad {
		if k, ok := sniffAudio(head); ok {
			t.Errorf("bad[%d] accepted as %s", i, k)
		}
	}
}

func TestSignedMediaAndTickets(t *testing.T) {
	jwtKey = []byte(strings.Repeat("k", 32))
	q := signMedia("abc", "alice")
	vals := map[string]string{}
	for _, kv := range strings.Split(q, "&") {
		p := strings.SplitN(kv, "=", 2)
		vals[p[0]] = p[1]
	}
	if !verifyMedia("abc", "alice", vals["e"], vals["s"]) {
		t.Fatal("valid signature rejected")
	}
	if verifyMedia("abd", "alice", vals["e"], vals["s"]) || verifyMedia("abc", "bob", vals["e"], vals["s"]) {
		t.Fatal("signature must bind item and user")
	}
	if verifyMedia("abc", "alice", "1", vals["s"]) {
		t.Fatal("tampered expiry accepted")
	}
	tk := makeTicket("ROOM1", "alice", time.Now().Add(time.Hour))
	got, ok := parseTicket(tk)
	if !ok || got.Room != "ROOM1" || got.User != "alice" {
		t.Fatalf("ticket round trip failed: %+v %v", got, ok)
	}
	if _, ok := parseTicket(tk + "x"); ok {
		t.Fatal("forged ticket accepted")
	}
}

func newTestRoom(t *testing.T) (*studioRoom, map[string]*studioClient) {
	t.Helper()
	r := newStudioRoom("TEST1", &studioHub{rooms: map[string]*studioRoom{}, nonces: map[string]time.Time{}}, "host", false)
	cs := map[string]*studioClient{}
	for _, n := range []string{"host", "prod", "listen"} {
		c := &studioClient{name: n, send: make(chan []byte, 256), done: make(chan struct{})}
		if err := r.join(c, func() bool { return false }); err != nil {
			t.Fatal(err)
		}
		cs[n] = c
	}
	r.mu.Lock()
	r.members["listen"].role = roleListener
	r.mu.Unlock()
	return r, cs
}

func msg(typ string, payload any) ClientMsg {
	b, _ := json.Marshal(payload)
	return ClientMsg{Type: typ, Payload: b}
}

func TestSequencerRulesAreServerSide(t *testing.T) {
	r, c := newTestRoom(t)
	r.handle(c["prod"], msg("step", map[string]any{"t": 2, "s": 5, "on": true}))
	if r.grid[2][5] != "prod" {
		t.Fatal("producer edit was not applied")
	}
	r.handle(c["listen"], msg("step", map[string]any{"t": 2, "s": 6, "on": true}))
	if r.grid[2][6] != "" {
		t.Fatal("a listener must not edit the grid")
	}
	for _, bad := range []map[string]any{{"t": 99, "s": 0, "on": true}, {"t": 0, "s": -1, "on": true}} {
		r.handle(c["prod"], msg("step", bad))
	}
	r.handle(c["prod"], ClientMsg{Type: "step", Payload: json.RawMessage(`{"t":1,"s":1,"on":true,"admin":true}`)})
	if r.grid[1][1] != "" {
		t.Fatal("unknown fields must be rejected")
	}
	r.handle(c["prod"], msg("bpm", map[string]any{"bpm": 150}))
	if r.bpm != studioDefaultBPM {
		t.Fatal("only the host may change tempo")
	}
	r.handle(c["host"], msg("bpm", map[string]any{"bpm": 999}))
	if r.bpm != studioDefaultBPM {
		t.Fatal("out-of-range tempo accepted")
	}
	r.handle(c["host"], msg("bpm", map[string]any{"bpm": 120}))
	if r.bpm != 120 {
		t.Fatal("host tempo change failed")
	}
}

func TestHeldRoomNeedsExplicitClose(t *testing.T) {
	r, c := newTestRoom(t)
	r.handle(c["prod"], msg("rec", map[string]any{"state": "recording"}))
	r.mu.Lock()
	held := len(r.heldByLocked())
	r.mu.Unlock()
	if held != 1 {
		t.Fatal("recording member must hold the session")
	}
	r.handle(c["host"], msg("host", map[string]any{"op": "close"}))
	if r.closed {
		t.Fatal("close without force must not close a held room")
	}
	r.handle(c["prod"], msg("host", map[string]any{"op": "close", "force": true}))
	if r.closed {
		t.Fatal("only the host may close")
	}
	r.handle(c["host"], msg("host", map[string]any{"op": "close", "force": true}))
	if !r.closed {
		t.Fatal("host force-close failed")
	}
}

func TestRoomRules(t *testing.T) {
	r, c := newTestRoom(t)
	r.handle(c["host"], msg("host", map[string]any{"op": "invite_only", "on": true}))
	if err := r.check(context.Background(), "stranger"); err == nil {
		t.Fatal("invite-only room admitted a stranger")
	}
	r.handle(c["host"], msg("host", map[string]any{"op": "invite", "name": "Friend"}))
	if err := r.check(context.Background(), "friend"); err != nil {
		t.Fatalf("invited user refused: %v", err)
	}
	r.handle(c["host"], msg("host", map[string]any{"op": "kick", "name": "prod"}))
	if err := r.check(context.Background(), "prod"); err == nil {
		t.Fatal("kicked user was allowed back")
	}
	if r.isMember("prod") {
		t.Fatal("kicked user still a member")
	}
}

func TestVelocityIsServerSide(t *testing.T) {
	r, c := newTestRoom(t)
	// a new pad gets the default velocity; hats off the beat start quieter
	r.handle(c["prod"], msg("step", map[string]any{"t": 0, "s": 1, "on": true}))
	if r.vel[0][1] != 100 {
		t.Fatalf("default velocity: got %d", r.vel[0][1])
	}
	r.handle(c["prod"], msg("step", map[string]any{"t": 3, "s": 1, "on": true}))
	if r.vel[3][1] != 72 {
		t.Fatalf("off-beat hat default: got %d", r.vel[3][1])
	}
	// explicit velocity on placement, and out-of-range values are refused outright
	r.handle(c["prod"], msg("step", map[string]any{"t": 1, "s": 2, "on": true, "v": 40}))
	if r.vel[1][2] != 40 {
		t.Fatalf("placed velocity: got %d", r.vel[1][2])
	}
	for _, bad := range []int{0, -5, 128, 9999} {
		r.handle(c["prod"], msg("step", map[string]any{"t": 2, "s": 3, "on": true, "v": bad}))
		if r.grid[2][3] != "" {
			t.Fatalf("velocity %d must be rejected", bad)
		}
		r.handle(c["prod"], msg("vel", map[string]any{"t": 1, "s": 2, "v": bad}))
		if r.vel[1][2] != 40 {
			t.Fatalf("vel message with %d changed the pad", bad)
		}
	}
	// vel edits a pad in place and does not change who placed it
	r.handle(c["host"], msg("vel", map[string]any{"t": 1, "s": 2, "v": 127}))
	if r.vel[1][2] != 127 || r.grid[1][2] != "prod" {
		t.Fatalf("vel edit: vel=%d owner=%q", r.vel[1][2], r.grid[1][2])
	}
	// it cannot create a pad, and a listener cannot touch one
	r.handle(c["prod"], msg("vel", map[string]any{"t": 5, "s": 5, "v": 90}))
	if r.vel[5][5] != 0 || r.grid[5][5] != "" {
		t.Fatal("vel must not switch a pad on")
	}
	r.handle(c["listen"], msg("vel", map[string]any{"t": 1, "s": 2, "v": 10}))
	if r.vel[1][2] != 127 {
		t.Fatal("a listener must not change velocity")
	}
	// switching a pad off clears its velocity; clear wipes all of them
	r.handle(c["prod"], msg("step", map[string]any{"t": 1, "s": 2, "on": false}))
	if r.vel[1][2] != 0 {
		t.Fatal("pad off must zero its velocity")
	}
	r.handle(c["host"], msg("clear", nil))
	for tr := range r.vel {
		for s := range r.vel[tr] {
			if r.vel[tr][s] != 0 || r.grid[tr][s] != "" {
				t.Fatal("clear left a pad behind")
			}
		}
	}
	// the starter groove carries velocities too
	fresh := newStudioRoom("T2", &studioHub{rooms: map[string]*studioRoom{}, nonces: map[string]time.Time{}}, "host", false)
	if fresh.vel[0][0] != 100 || fresh.vel[3][2] != 72 || fresh.vel[3][0] != 0 {
		t.Fatalf("starter velocities wrong: %d %d %d", fresh.vel[0][0], fresh.vel[3][2], fresh.vel[3][0])
	}
}

func TestKitMixAndSwingRules(t *testing.T) {
	r, c := newTestRoom(t)
	if r.kits[0] != studioDefaultKit || r.kits[5] != "" || r.kits[6] != "" {
		t.Fatalf("default kits wrong: %v", r.kits)
	}
	r.handle(c["prod"], msg("kit", map[string]any{"t": 0, "id": "trap"}))
	if r.kits[0] != "trap" {
		t.Fatal("producer kit change failed")
	}
	for _, bad := range []map[string]any{
		{"t": 0, "id": "../../etc/passwd"}, // an id is a map key, never a path
		{"t": 0, "id": "nope"},
		{"t": 5, "id": "trap"}, // the bass is a synth: no kit
		{"t": 99, "id": "trap"},
	} {
		r.handle(c["prod"], msg("kit", bad))
	}
	if r.kits[0] != "trap" || r.kits[5] != "" {
		t.Fatalf("a bad kit message got through: %v", r.kits)
	}
	r.handle(c["listen"], msg("kit", map[string]any{"t": 1, "id": "house"}))
	if r.kits[1] != studioDefaultKit {
		t.Fatal("a listener must not change kits")
	}

	r.handle(c["prod"], msg("mix", map[string]any{"t": 2, "vol": 35, "mute": true}))
	if r.vol[2] != 35 || !r.mute[2] {
		t.Fatalf("mix not applied: vol=%d mute=%v", r.vol[2], r.mute[2])
	}
	r.handle(c["prod"], msg("mix", map[string]any{"t": 2, "mute": false})) // mute alone leaves the fader
	if r.vol[2] != 35 || r.mute[2] {
		t.Fatalf("partial mix wrong: vol=%d mute=%v", r.vol[2], r.mute[2])
	}
	for _, bad := range []map[string]any{{"t": 2, "vol": 101}, {"t": 2, "vol": -1}, {"t": 9, "vol": 5}, {"t": 2}} {
		r.handle(c["prod"], msg("mix", bad))
	}
	if r.vol[2] != 35 {
		t.Fatal("a bad mix message got through")
	}
	r.handle(c["listen"], msg("mix", map[string]any{"t": 2, "vol": 0}))
	if r.vol[2] != 35 {
		t.Fatal("a listener must not change the mix")
	}

	if r.swing != studioMinSwing {
		t.Fatalf("default swing: %d", r.swing)
	}
	r.handle(c["prod"], msg("swing", map[string]any{"v": 66}))
	if r.swing != 66 {
		t.Fatal("swing not applied")
	}
	for _, bad := range []int{49, 76, -1, 1000} {
		r.handle(c["prod"], msg("swing", map[string]any{"v": bad}))
	}
	r.handle(c["listen"], msg("swing", map[string]any{"v": 55}))
	if r.swing != 66 {
		t.Fatalf("swing rules broken: %d", r.swing)
	}

	// everything above reaches a newcomer in the state snapshot
	r.mu.Lock()
	st := r.stateLocked("prod")
	r.mu.Unlock()
	if st.Swing != 66 || st.Kits[0] != "trap" || st.Vol[2] != 35 || len(st.Vel) != studioTracks || len(st.Vel[0]) != studioSteps || len(st.Mute) != studioTracks {
		t.Fatalf("state snapshot is missing the new fields: %+v", st)
	}
}
