package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"time"
)

// ---------------------------------------------------------------------------
// Relic: a cursed object is shown to everyone, then buried somewhere on the map.
// Players walk the 3D map and dig for it.
//
// The server owns the secret. The exact burial point NEVER leaves this file
// until the hunt is over. What players get is:
//
//	- the zone it was buried in (everyone watches the burial: public)
//	- a private "heat" reading from where they are standing (cold..burning),
//	  quantised into 5 bands so one reading is a hint, not a coordinate
//	- during a Wail the curse lies: readings are scrambled for a few seconds
//
// Position is server-checked: clients send where they walk, the server clamps
// speed and bounds. A dig uses the position the SERVER has, never one the client
// claims, so a client cannot teleport to the spot or dig from far away.
//
// Phases: show > bury > hunt > found. Raw score: finders by speed, everyone
// else by how close their best dig came.
// ---------------------------------------------------------------------------

// Package vars (not consts) only so tests can shorten them.
var (
	relicShow     = 8 * time.Second
	relicBury     = 7 * time.Second
	relicGrace    = 6 * time.Second // after the first find, others can still dig it up
	relicWailGap  = 30 * time.Second
	relicWailLen  = 6 * time.Second
	relicDigCool  = 1800 * time.Millisecond
	relicMaxSpeed = 11.0 // world units per second (clients walk at ~7)
)

const (
	relicBound   = 28.0 // the map is a square, +-relicBound
	relicReach   = 2.3  // a dig this close to the relic unearths it
	relicDigs    = 6
	relicMaxHole = 60
)

type relicZone struct {
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

var relicZones = []relicZone{
	{"Weeping Grove", -17, -15},
	{"Drowned Chapel", 17, -14},
	{"Bone Orchard", -16, 17},
	{"Old Well", 17, 17},
}

type relicKind struct {
	Key   string
	Name  string
	Lore  string
	Curse string
}

var relicKeys = []string{"idol", "lantern", "mask"}

var relicKinds = map[string]*relicKind{
	"idol": {
		Key:   "idol",
		Name:  "The Weeping Idol",
		Lore:  "A jade idol that cries black water. Every village that kept it lost its wells within a year.",
		Curse: "Whoever holds it hears their own name whispered from the ground.",
	},
	"lantern": {
		Key:   "lantern",
		Name:  "The Hollow Lantern",
		Lore:  "A lantern with no flame and no wick. It glows brighter the closer the living come.",
		Curse: "Its light is a hunger. It was buried so it could not follow anyone home.",
	},
	"mask": {
		Key:   "mask",
		Name:  "The Hungry Mask",
		Lore:  "A bone mask worn by the last keeper of the Bone Orchard. The keeper was never found; the mask was.",
		Curse: "It remembers every face that looked at it, and it is looking back.",
	},
}

type relicHole struct {
	X  float64 `json:"x"`
	Z  float64 `json:"z"`
	By string  `json:"by"`
}

type relicPlayer struct {
	x, z, ry   float64
	lastMove   time.Time
	lastDig    time.Time
	digs       int
	best       float64 // closest dig so far, +Inf if none
	foundAt    time.Duration
	found      bool
	order      int // 1 = first to find it
	lastDigMsg string
}

type relicMission struct {
	def *MissionDef
	rng *rand.Rand

	kind    *relicKind
	order   []string
	member  map[string]bool
	ps      map[string]*relicPlayer
	phase   string // show | bury | hunt | found
	phaseAt time.Time
	endAt   time.Time
	huntAt  time.Time

	zone     int
	rx, rz   float64 // THE SECRET
	holes    []relicHole
	finders  []string
	wailing  bool
	nextWail time.Time
	wailEnd  time.Time
	wails    int
}

func (m *relicMission) Start(now time.Time, players []string) {
	key := m.def.Variant
	if key == "" {
		key = relicKeys[m.rng.Intn(len(relicKeys))]
	}
	m.kind = relicKinds[key]
	m.order = players
	m.member = map[string]bool{}
	m.ps = map[string]*relicPlayer{}
	for i, p := range players {
		a := float64(i) / float64(len(players)) * 2 * math.Pi
		m.member[p] = true
		m.ps[p] = &relicPlayer{x: math.Cos(a) * 3.2, z: math.Sin(a) * 3.2, ry: a + math.Pi, digs: relicDigs, best: math.Inf(1)}
	}
	m.zone = m.rng.Intn(len(relicZones))
	z := relicZones[m.zone]
	// Somewhere in the zone, not dead centre, so "go to the landmark" is not enough.
	ang := m.rng.Float64() * 2 * math.Pi
	rad := 1.5 + m.rng.Float64()*6.5
	m.rx = relicClamp(z.X+math.Cos(ang)*rad, -relicBound+2, relicBound-2)
	m.rz = relicClamp(z.Z+math.Sin(ang)*rad, -relicBound+2, relicBound-2)
	m.phase = "show"
	m.phaseAt = now
	m.endAt = now.Add(relicShow)
}

func relicClamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func relicRound(v float64) float64          { return math.Round(v*10) / 10 }
func (m *relicMission) dist(p *relicPlayer) float64 {
	return math.Hypot(p.x-m.rx, p.z-m.rz)
}

func (m *relicMission) hunting() bool { return m.phase == "hunt" || m.phase == "found" }

func (m *relicMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	p := m.ps[name]
	if p == nil || !m.hunting() {
		return false
	}
	switch parseOp(raw) {
	case "move":
		var v struct {
			X  float64 `json:"x"`
			Z  float64 `json:"z"`
			Ry float64 `json:"ry"`
		}
		if json.Unmarshal(raw, &v) != nil || math.IsNaN(v.X) || math.IsNaN(v.Z) || math.IsNaN(v.Ry) {
			return false
		}
		tx, tz := relicClamp(v.X, -relicBound, relicBound), relicClamp(v.Z, -relicBound, relicBound)
		dt := now.Sub(p.lastMove).Seconds()
		if p.lastMove.IsZero() || dt > 0.6 {
			dt = 0.6
		}
		if dt < 0.02 {
			return false
		}
		// Speed limit: a client that claims a longer step is pulled back along the same line.
		step := math.Hypot(tx-p.x, tz-p.z)
		if limit := relicMaxSpeed*dt + 0.4; step > limit {
			k := limit / step
			tx, tz = p.x+(tx-p.x)*k, p.z+(tz-p.z)*k
		}
		p.x, p.z, p.ry, p.lastMove = tx, tz, math.Mod(v.Ry, 2*math.Pi), now
		return true
	case "dig":
		if p.found || p.digs <= 0 || now.Sub(p.lastDig) < relicDigCool {
			return false
		}
		p.digs--
		p.lastDig = now
		d := m.dist(p)
		if d < p.best {
			p.best = d
		}
		if d <= relicReach {
			p.found = true
			p.foundAt = now.Sub(m.huntAt)
			m.finders = append(m.finders, name)
			p.order = len(m.finders)
			p.lastDigMsg = "You unearthed it!"
			if m.phase == "hunt" {
				m.phase = "found"
				m.phaseAt = now
				m.endAt = now.Add(relicGrace)
			}
			return true
		}
		if len(m.holes) < relicMaxHole {
			m.holes = append(m.holes, relicHole{X: relicRound(p.x), Z: relicRound(p.z), By: name})
		}
		switch {
		case d < 5:
			p.lastDigMsg = "Dirt and bone. Something is very close."
		case d < 11:
			p.lastDigMsg = "Nothing here, but the ground is uneasy."
		default:
			p.lastDigMsg = "Just dirt. You are far off."
		}
		return true
	}
	return false
}

func (m *relicMission) Leave(string) {}

func (m *relicMission) allSpent() bool {
	for _, n := range m.order {
		if p := m.ps[n]; !p.found && p.digs > 0 {
			return false
		}
	}
	return true
}

func (m *relicMission) Tick(now time.Time) (changed, finished bool) {
	switch m.phase {
	case "show":
		if !now.Before(m.endAt) {
			m.phase, m.phaseAt, m.endAt = "bury", now, now.Add(relicBury)
			return true, false
		}
	case "bury":
		if !now.Before(m.endAt) {
			m.phase, m.phaseAt, m.huntAt = "hunt", now, now
			m.endAt = now.Add(time.Duration(m.def.DurationMS) * time.Millisecond)
			m.nextWail = now.Add(relicWailGap)
			return true, false
		}
	case "hunt":
		if m.allSpent() || !now.Before(m.endAt) {
			m.phase, m.phaseAt, m.endAt, m.wailing = "found", now, now.Add(3*time.Second), false
			return true, false
		}
		if m.wailing && !now.Before(m.wailEnd) {
			m.wailing = false
			return true, false
		}
		if !m.wailing && !now.Before(m.nextWail) {
			m.wailing, m.wailEnd = true, now.Add(relicWailLen)
			m.nextWail = now.Add(relicWailGap)
			m.wails++
			return true, false
		}
	case "found":
		if !now.Before(m.endAt) {
			return true, true
		}
	}
	return false, false
}

func (m *relicMission) Deadline() time.Time { return m.endAt }

// heat is the private reading: 0 cold .. 4 burning. While the curse wails, it lies.
func (m *relicMission) heat(p *relicPlayer) (band int, lying bool) {
	d := m.dist(p)
	switch {
	case d <= 4.5:
		band = 4
	case d <= 9:
		band = 3
	case d <= 16:
		band = 2
	case d <= 26:
		band = 1
	}
	if m.wailing && m.phase == "hunt" {
		// Deterministic wobble from position, so the lie flickers but does not leak the truth by averaging.
		band = int(math.Abs(math.Floor(p.x*3.1+p.z*1.7+float64(m.wails)*7))) % 5
		return band, true
	}
	return band, false
}

func (m *relicMission) Public() any {
	pos := make(map[string][3]float64, len(m.ps))
	found := []string{}
	for _, n := range m.order {
		p := m.ps[n]
		pos[n] = [3]float64{relicRound(p.x), relicRound(p.z), relicRound(p.ry)}
		if p.found {
			found = append(found, n)
		}
	}
	pub := map[string]any{
		"kind": "relic", "phase": m.phase, "relic": map[string]string{"key": m.kind.Key, "name": m.kind.Name, "lore": m.kind.Lore, "curse": m.kind.Curse},
		"zones": relicZones, "bound": relicBound, "reach": relicReach, "phase_at": m.phaseAt.UnixMilli(),
		"pos": pos, "holes": m.holes, "found": found, "wail": m.wailing && m.phase == "hunt", "wails": m.wails,
	}
	if m.phase != "show" {
		pub["zone"] = m.zone // everyone watches the burial, so the zone is public from then on
	}
	if m.phase == "found" {
		pub["spot"] = [2]float64{relicRound(m.rx), relicRound(m.rz)} // the hunt is over: now it is safe to show
	}
	return pub
}

func (m *relicMission) Private(name string) any {
	p := m.ps[name]
	if p == nil {
		return nil
	}
	heat, lying := 0, false
	if m.phase == "hunt" {
		heat, lying = m.heat(p)
	}
	return map[string]any{"digs": p.digs, "heat": heat, "lying": lying, "found": p.found, "msg": p.lastDigMsg}
}

func (m *relicMission) Progress(name string) float64 {
	p := m.ps[name]
	if p == nil {
		return 0
	}
	if p.found {
		return 1
	}
	if math.IsInf(p.best, 1) {
		return 0
	}
	return relicClamp(1-p.best/40, 0, 0.95)
}

func (m *relicMission) Raw() map[string]float64 {
	out := map[string]float64{}
	remain := float64(m.def.DurationMS) / 1000
	for n, p := range m.ps {
		switch {
		case p.found:
			left := math.Max(0, remain-p.foundAt.Seconds())
			out[n] = math.Max(500, 1000+left-150*float64(p.order-1))
		case !math.IsInf(p.best, 1):
			out[n] = math.Max(0, 400-p.best*10)
		}
	}
	return out
}

func (m *relicMission) Stats() map[string]string {
	out := map[string]string{}
	for n, p := range m.ps {
		switch {
		case p.found && p.order == 1:
			out[n] = fmt.Sprintf("Unearthed it first, after %.0fs", p.foundAt.Seconds())
		case p.found:
			out[n] = fmt.Sprintf("Unearthed it (#%d), after %.0fs", p.order, p.foundAt.Seconds())
		case math.IsInf(p.best, 1):
			out[n] = "Never dug"
		default:
			out[n] = fmt.Sprintf("Closest dig: %.0f m away", p.best)
		}
	}
	return out
}

func (m *relicMission) Note() string {
	return "Hot and cold is a gradient signal. One reading tells you little, but readings from several places let you triangulate, " +
		"and when a sensor is noisy (the Wail) the right move is to wait and average instead of trusting one sample."
}
