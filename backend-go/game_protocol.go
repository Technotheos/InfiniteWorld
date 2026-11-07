package main

import "encoding/json"

// Wire protocol for game rooms (/ws/game). Every server message is an
// Envelope; every client message is a ClientMsg. Both are JSON text frames.
//
//	server -> client: {"v":1,"type":"hello|state|chat|error","payload":{...}}
//	client -> server: {"type":"ready|start|chat|act|rematch","payload":{...}}
//
// The server owns all game state. Clients only send intentions ("I clicked",
// "my typed text is ..."); the server decides what they mean and what they score.

const protocolVersion = 1

const (
	phaseLobby     = "lobby"
	phaseCountdown = "countdown"
	phaseBriefing  = "briefing"
	phasePlaying   = "playing"
	phaseReveal    = "reveal"
	phaseFinished  = "finished"
)

type Envelope struct {
	V       int    `json:"v"`
	Type    string `json:"type"`
	Payload any    `json:"payload,omitempty"`
}

type ClientMsg struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// ---- views sent to clients -------------------------------------------------

type MissionInfo struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Brief string `json:"brief"`
}

type MapInfo struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	Tagline    string        `json:"tagline"`
	Theme      string        `json:"theme"`
	Mode       string        `json:"mode"`
	MinPlayers int           `json:"min_players"`
	MaxPlayers int           `json:"max_players"`
	Missions   []MissionInfo `json:"missions"`
}

type PlayerView struct {
	Name      string  `json:"name"`
	Ready     bool    `json:"ready"`
	Connected bool    `json:"connected"`
	Spectator bool    `json:"spectator"`
	Host      bool    `json:"host"`
	Score     int     `json:"score"`
	Gain      int     `json:"gain"`
	Progress  float64 `json:"progress"`
}

type BriefView struct {
	Index int    `json:"index"`
	Total int    `json:"total"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Brief string `json:"brief"`
}

type RevealView struct {
	Kind   string            `json:"kind"`
	Title  string            `json:"title"`
	Note   string            `json:"note"`
	Stats  map[string]string `json:"stats"`
	Points map[string]int    `json:"points"`
}

type RankRow struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
	Place int    `json:"place"`
}

type FinalView struct {
	Mode    string    `json:"mode"`
	Won     bool      `json:"won"` // coop maps: did the team finish every mission?
	Ranking []RankRow `json:"ranking"`
}

type StateView struct {
	Code     string       `json:"code"`
	Map      MapInfo      `json:"map"`
	Phase    string       `json:"phase"`
	You      string       `json:"you"`
	Spectate bool         `json:"spectating"`
	Players  []PlayerView `json:"players"`
	Mission  int          `json:"mission"`  // index of the current mission, -1 before the game
	Deadline int64        `json:"deadline"` // unix ms when this phase/puzzle ends, 0 if none
	Now      int64        `json:"now"`      // server clock (unix ms) so clients can correct for skew
	Brief    *BriefView   `json:"brief,omitempty"`
	Play     any          `json:"play,omitempty"`    // public mission data
	Private  any          `json:"private,omitempty"` // data only this player may see
	Reveal   *RevealView  `json:"reveal,omitempty"`
	Result   *FinalView   `json:"result,omitempty"`
}

type ChatMsg struct {
	From string `json:"from"`
	Text string `json:"text"`
	At   int64  `json:"at"`
}

type HelloView struct {
	Protocol int       `json:"protocol"`
	You      string    `json:"you"`
	Chat     []ChatMsg `json:"chat"`
}
