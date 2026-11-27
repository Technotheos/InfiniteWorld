package main

import (
	"encoding/json"
	"math"
	"math/rand"
	"strings"
	"testing"
	"time"
)

func newTestRelic(t *testing.T) (*relicMission, time.Time) {
	t.Helper()
	def := &MissionDef{Kind: "relic", Title: "R", DurationMS: 20000}
	if err := def.normalize(); err != nil {
		t.Fatal(err)
	}
	m := &relicMission{def: def, rng: rand.New(rand.NewSource(7))}
	now := time.Now()
	m.Start(now, []string{"ann", "bob"})
	now = now.Add(relicShow)
	m.Tick(now)
	now = now.Add(relicBury)
	m.Tick(now)
	if m.phase != "hunt" {
		t.Fatalf("expected hunt, got %s", m.phase)
	}
	return m, now
}

func TestRelicNeverLeaksTheSpotBeforeTheHuntEnds(t *testing.T) {
	m, now := newTestRelic(t)
	pub, _ := json.Marshal(m.Public())
	priv, _ := json.Marshal(m.Private("ann"))
	if strings.Contains(string(pub), `"spot"`) || strings.Contains(string(priv), `"spot"`) {
		t.Fatal("burial spot leaked while hunting")
	}
	// Digging far from the relic must not reveal it either.
	m.ps["ann"].x, m.ps["ann"].z = m.rx+20, m.rz
	m.Handle("ann", jraw(`{"op":"dig"}`), now.Add(time.Second))
	pub, _ = json.Marshal(m.Public())
	if strings.Contains(string(pub), `"spot"`) {
		t.Fatal("a failed dig leaked the spot")
	}
}

func TestRelicSpeedIsClamped(t *testing.T) {
	m, now := newTestRelic(t)
	p := m.ps["ann"]
	sx, sz := p.x, p.z
	m.Handle("ann", jraw(`{"op":"move","x":0,"z":0}`), now) // seeds lastMove
	sx, sz = p.x, p.z
	m.Handle("ann", jraw(`{"op":"move","x":28,"z":28}`), now.Add(100*time.Millisecond))
	if step := math.Hypot(p.x-sx, p.z-sz); step > relicMaxSpeed*0.1+0.5 {
		t.Fatalf("teleported %.1f units in 100 ms", step)
	}
}

func TestRelicDigUsesServerPositionAndScores(t *testing.T) {
	m, now := newTestRelic(t)
	// A dig far away is a miss and costs a dig.
	m.ps["bob"].x, m.ps["bob"].z = m.rx+15, m.rz
	m.Handle("bob", jraw(`{"op":"dig"}`), now.Add(time.Second))
	if m.ps["bob"].found || m.ps["bob"].digs != relicDigs-1 {
		t.Fatal("far dig should miss and use one dig")
	}
	// Cooldown: an immediate second dig is ignored.
	if m.Handle("bob", jraw(`{"op":"dig"}`), now.Add(time.Second+10*time.Millisecond)) {
		t.Fatal("dig cooldown not enforced")
	}
	// Standing on it finds it, and the hunt moves to the found phase.
	m.ps["ann"].x, m.ps["ann"].z = m.rx+0.5, m.rz
	m.Handle("ann", jraw(`{"op":"dig"}`), now.Add(3*time.Second))
	if !m.ps["ann"].found || m.phase != "found" {
		t.Fatal("expected ann to unearth it")
	}
	raw := m.Raw()
	if raw["ann"] <= raw["bob"] {
		t.Fatalf("finder must outscore a near miss: %v", raw)
	}
	pub, _ := json.Marshal(m.Public())
	if !strings.Contains(string(pub), `"spot"`) {
		t.Fatal("spot should be revealed once the relic is found")
	}
	if _, fin := m.Tick(now.Add(3*time.Second + relicGrace)); !fin {
		t.Fatal("mission should finish after the grace period")
	}
}

func TestRelicMapHasVoice(t *testing.T) {
	maps, err := LoadMaps()
	if err != nil {
		t.Fatal(err)
	}
	d := maps["cursed-relic"]
	if d == nil || !d.Voice || !d.Info().Voice {
		t.Fatal("cursed-relic must exist and advertise voice")
	}
}
