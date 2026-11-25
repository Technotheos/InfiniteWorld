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
