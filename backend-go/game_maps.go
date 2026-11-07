package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
)

// A "map" is a room type described as data: who can play, and the ordered list
// of missions players must get through. New rooms = new JSON file in maps/,
// no Go changes needed (as long as the mission kinds already exist).

//go:embed maps/*.json
var mapFiles embed.FS

type MissionDef struct {
	Kind       string   `json:"kind"` // reaction | math | typing | cipher | talk
	Title      string   `json:"title"`
	Brief      string   `json:"brief"`
	DurationMS int      `json:"duration_ms,omitempty"` // time limit (per puzzle for cipher)
	Rounds     int      `json:"rounds,omitempty"`      // reaction rounds / cipher puzzles
	Variant    string   `json:"variant,omitempty"`     // cipher: caesar | base64 | hex | binary
	MinDelayMS int      `json:"min_delay_ms,omitempty"`
	MaxDelayMS int      `json:"max_delay_ms,omitempty"`
	Prompts    []string `json:"prompts,omitempty"` // talk: conversation starters
}

type MapDef struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Tagline     string       `json:"tagline"`
	Theme       string       `json:"theme"`
	Mode        string       `json:"mode"` // versus (default) | coop
	MinPlayers  int          `json:"min_players"`
	MaxPlayers  int          `json:"max_players"`
	CountdownMS int          `json:"countdown_ms,omitempty"`
	BriefingMS  int          `json:"briefing_ms,omitempty"`
	RevealMS    int          `json:"reveal_ms,omitempty"`
	Missions    []MissionDef `json:"missions"`
}

var (
	mapIDRe    = regexp.MustCompile(`^[a-z0-9-]{2,24}$`)
	knownKinds = map[string]bool{"reaction": true, "math": true, "typing": true, "cipher": true, "talk": true}
	cipherVars = map[string]bool{"caesar": true, "base64": true, "hex": true, "binary": true}
)

var defaultTalkPrompts = []string{
	"Each person shares one thing they are proud of this month. Ask each other one question about it.",
}

// normalize fills defaults and rejects anything unsafe or nonsensical. Maps are
// loaded once at startup, so a broken file fails the boot, not a live game.
func (d *MapDef) normalize() error {
	if !mapIDRe.MatchString(d.ID) {
		return fmt.Errorf("map id %q must match %s", d.ID, mapIDRe)
	}
	if d.Name == "" || len(d.Name) > 40 {
		return fmt.Errorf("map %s: name is required (max 40 chars)", d.ID)
	}
	if d.Mode == "" {
		d.Mode = "versus"
	}
	if d.Mode != "versus" && d.Mode != "coop" {
		return fmt.Errorf("map %s: mode must be versus or coop", d.ID)
	}
	if d.Theme == "" {
		d.Theme = "nebula"
	}
	if d.MinPlayers < 1 || d.MaxPlayers < d.MinPlayers || d.MaxPlayers > 12 {
		return fmt.Errorf("map %s: need 1 <= min_players <= max_players <= 12", d.ID)
	}
	if d.CountdownMS == 0 {
		d.CountdownMS = 3000
	}
	if d.BriefingMS == 0 {
		d.BriefingMS = 5000
	}
	if d.RevealMS == 0 {
		d.RevealMS = 7000
	}
	if n := len(d.Missions); n < 1 || n > 8 {
		return fmt.Errorf("map %s: needs 1-8 missions", d.ID)
	}
	for i := range d.Missions {
		if err := d.Missions[i].normalize(); err != nil {
			return fmt.Errorf("map %s, mission %d: %w", d.ID, i+1, err)
		}
	}
	return nil
}

func (m *MissionDef) normalize() error {
	if !knownKinds[m.Kind] {
		return fmt.Errorf("unknown kind %q", m.Kind)
	}
	if m.Title == "" || len(m.Title) > 40 {
		return fmt.Errorf("title is required (max 40 chars)")
	}
	if len(m.Brief) > 200 {
		return fmt.Errorf("brief too long")
	}
	switch m.Kind {
	case "reaction":
		if m.Rounds == 0 {
			m.Rounds = 3
		}
		if m.Rounds < 1 || m.Rounds > 10 {
			return fmt.Errorf("rounds must be 1-10")
		}
		if m.MinDelayMS == 0 && m.MaxDelayMS == 0 {
			m.MinDelayMS, m.MaxDelayMS = 1500, 4000
		}
		if m.MinDelayMS < 0 || m.MaxDelayMS < m.MinDelayMS || m.MaxDelayMS > 15000 {
			return fmt.Errorf("invalid reaction delay range")
		}
	case "cipher":
		if !cipherVars[m.Variant] {
			return fmt.Errorf("cipher variant must be caesar, base64, hex or binary")
		}
		if m.Rounds == 0 {
			m.Rounds = 2
		}
		if m.Rounds < 1 || m.Rounds > 8 {
			return fmt.Errorf("rounds must be 1-8")
		}
		fallthrough
	case "math", "typing", "talk":
		if m.DurationMS == 0 {
			m.DurationMS = 30000
		}
		if m.DurationMS < 100 || m.DurationMS > 300000 {
			return fmt.Errorf("duration_ms must be 100-300000")
		}
		if m.Kind == "talk" && len(m.Prompts) == 0 {
			m.Prompts = defaultTalkPrompts
		}
	}
	return nil
}

// Info is the public description of a map (what the lobby and the trail show).
func (d *MapDef) Info() MapInfo {
	info := MapInfo{ID: d.ID, Name: d.Name, Tagline: d.Tagline, Theme: d.Theme, Mode: d.Mode,
		MinPlayers: d.MinPlayers, MaxPlayers: d.MaxPlayers}
	for _, m := range d.Missions {
		info.Missions = append(info.Missions, MissionInfo{Kind: m.Kind, Title: m.Title, Brief: m.Brief})
	}
	return info
}

// LoadMaps reads and validates every embedded maps/*.json file.
func LoadMaps() (map[string]*MapDef, error) {
	entries, err := mapFiles.ReadDir("maps")
	if err != nil {
		return nil, err
	}
	out := make(map[string]*MapDef)
	for _, e := range entries {
		raw, err := mapFiles.ReadFile("maps/" + e.Name())
		if err != nil {
			return nil, err
		}
		var d MapDef
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields() // typos in a map file should fail loudly
		if err := dec.Decode(&d); err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		if err := d.normalize(); err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		if _, dup := out[d.ID]; dup {
			return nil, fmt.Errorf("%s: duplicate map id %s", e.Name(), d.ID)
		}
		out[d.ID] = &d
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no maps found")
	}
	return out, nil
}

func sortedMapIDs(maps map[string]*MapDef) []string {
	ids := make([]string, 0, len(maps))
	for id := range maps {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
