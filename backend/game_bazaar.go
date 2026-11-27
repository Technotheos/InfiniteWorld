package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"time"
)

// ---------------------------------------------------------------------------
// Bazaar: bid-your-confidence trivia. Every round shows one question. Players
// pick an answer AND how much they dare to stake on it (cautious / confident /
// all-in). Right answers pay the stake, wrong ones cost it. Three variants:
//
//	estimate  guess a number; the closer, the bigger the payout
//	fib       one of four statements is false: spot it
//	chain     a chain of ideas is missing one link: pick it
//
// The server owns the answers, the clock and the maths; the client only sends
// {op:"answer", value, bet}. A random "market event" can twist any round.
// ---------------------------------------------------------------------------

// Package var (not const) only so tests can shorten the pause.
var bazaarBetween = 4500 * time.Millisecond // how long each round's answer stays on screen

var bazaarStakes = [4]int{0, 50, 100, 200} // index = bet level 1..3

var bazaarNotes = map[string]string{
	"estimate": "Good estimators do not need exact facts. They anchor on something they know, adjust, and bet less when their range is wide. Calibration, knowing how sure you really are, is a skill you can train.",
	"fib":      "Spotting a false statement is a different skill from knowing facts. Ask what would have to be true if it were right. Myths survive because they sound plausible and get repeated.",
	"chain":    "Most real knowledge is a chain of causes. When one link is missing, the links around it constrain the answer, so you can reason your way to it instead of just recalling it.",
}

type bazaarAnswer struct {
	value float64
	bet   int
	at    time.Time
}

type bazaarResult struct {
	Name   string `json:"name"`
	Answer string `json:"answer"`
	Bet    int    `json:"bet"`
	Delta  int    `json:"delta"`
	Right  bool   `json:"right"`
}

type bazaarMission struct {
	def    *MissionDef
	rng    *rand.Rand
	order  []string
	member map[string]bool
	items  []int // bank indexes, one per round
	round  int
	status string // ask | between
	start  time.Time
	endAt  time.Time
	event  string

	prompt  string
	unit    string
	options []string
	chain   []string
	blank   int
	correct int
	struck  int
	hint    string
	explain string
	truth   string
	est     *estimateQ

	answers     map[string]bazaarAnswer
	results     []bazaarResult
	penaltyName string
	penaltyText string

	net    map[string]int
	right  map[string]int
	played map[string]int
}

func fmtNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func (m *bazaarMission) bankSize() int {
	switch m.def.Variant {
	case "estimate":
		return len(estimateBank)
	case "fib":
		return len(fibBank)
	}
	return len(chainBank)
}

func (m *bazaarMission) Start(now time.Time, players []string) {
	m.order = players
	m.member = map[string]bool{}
	m.net = map[string]int{}
	m.right = map[string]int{}
	m.played = map[string]int{}
	for _, p := range players {
		m.member[p] = true
	}
	perm := m.rng.Perm(m.bankSize())
	n := m.def.Rounds
	if n > len(perm) {
		n = len(perm)
	}
	m.items = perm[:n]
	m.beginRound(now)
}

func (m *bazaarMission) beginRound(now time.Time) {
	idx := m.items[m.round]
	m.status = "ask"
	m.start = now
	m.endAt = now.Add(time.Duration(m.def.DurationMS) * time.Millisecond)
	m.answers = map[string]bazaarAnswer{}
	m.results = nil
	m.penaltyName, m.penaltyText = "", ""
	m.struck, m.hint, m.chain, m.options, m.est, m.unit = -1, "", nil, nil, nil, ""
	m.blank, m.correct = 0, 0

	switch m.def.Variant {
	case "estimate":
		q := estimateBank[idx]
		m.est = &q
		m.prompt, m.unit, m.explain = q.Q, q.Unit, q.Explain
		m.truth = fmtNum(q.Answer)
		if q.Unit != "" {
			m.truth += " " + q.Unit
		}
	case "fib":
		s := fibBank[idx]
		m.options = make([]string, 4)
		for pos, src := range m.rng.Perm(4) {
			m.options[pos] = s.Statements[src]
			if src == s.Fib {
				m.correct = pos
			}
		}
		m.prompt = "Spot the fib. Exactly one statement is false. Topic: " + s.Topic
		m.explain = s.Explain
		m.truth = m.options[m.correct]
	default: // chain
		c := chainBank[idx]
		m.options = make([]string, 4)
		for pos, src := range m.rng.Perm(4) {
			m.options[pos] = c.Options[src]
			if src == c.Answer {
				m.correct = pos
			}
		}
		m.chain = append([]string(nil), c.Nodes...)
		m.blank = c.Blank
		m.prompt = c.Title + ": which link is missing?"
		m.explain = c.Explain
		m.truth = m.options[m.correct]
	}

	switch r := m.rng.Intn(100); {
	case r < 45:
		m.event = eventNone
	case r < 65:
		m.event = eventBull
	case r < 80:
		m.event = eventCrash
	default:
		m.event = eventTip
	}
	if m.event == eventTip {
		if m.est != nil {
			lo := m.est.Answer - m.est.Span*0.4
			if lo < 0 && m.est.Answer >= 0 {
				lo = 0
			}
			hi := m.est.Answer + m.est.Span*0.4
			m.hint = fmt.Sprintf("Insider tip: the true value is between %s and %s.", fmtNum(math.Round(lo*10)/10), fmtNum(math.Round(hi*10)/10))
		} else {
			wrong := []int{}
			for i := range m.options {
				if i != m.correct {
					wrong = append(wrong, i)
				}
			}
			m.struck = wrong[m.rng.Intn(len(wrong))]
			m.hint = "Insider tip: one wrong answer has been struck out."
		}
	}
}

func (m *bazaarMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	var p struct {
		Op    string  `json:"op"`
		Value float64 `json:"value"`
		Bet   int     `json:"bet"`
	}
	if m.status != "ask" || !m.member[name] || json.Unmarshal(raw, &p) != nil || p.Op != "answer" {
		return false
	}
	if _, done := m.answers[name]; done {
		return false
	}
	if p.Bet < 1 || p.Bet > 3 {
		return false
	}
	if math.IsNaN(p.Value) || math.IsInf(p.Value, 0) || math.Abs(p.Value) > 1e12 {
		return false
	}
	if len(m.options) > 0 {
		i := int(p.Value)
		if float64(i) != p.Value || i < 0 || i >= len(m.options) || i == m.struck {
			return false
		}
	}
	m.answers[name] = bazaarAnswer{value: p.Value, bet: p.Bet, at: now}
	return true
}

func (m *bazaarMission) Leave(name string) { delete(m.member, name) }

func (m *bazaarMission) Tick(now time.Time) (changed, finished bool) {
	switch m.status {
	case "ask":
		if len(m.member) == 0 {
			return false, true
		}
		all := true
		for n := range m.member {
			if _, ok := m.answers[n]; !ok {
				all = false
			}
		}
		if all || !now.Before(m.endAt) {
			m.resolve(now)
			return true, false
		}
	case "between":
		if !now.Before(m.endAt) {
			m.round++
			if m.round >= len(m.items) {
				return true, true
			}
			m.beginRound(now)
			return true, false
		}
	}
	return false, false
}

// resolve scores the round: payout by stake, speed bonus, then the market event.
func (m *bazaarMission) resolve(now time.Time) {
	closest, bestErr := "", math.MaxFloat64
	if m.est != nil {
		for _, n := range m.order {
			if a, ok := m.answers[n]; ok {
				if e := math.Abs(a.value - m.est.Answer); e < bestErr {
					closest, bestErr = n, e
				}
			}
		}
	}
	window := float64(m.endAt.Sub(m.start))
	if window <= 0 {
		window = 1
	}

	var results []bazaarResult
	for _, n := range m.order {
		if !m.member[n] {
			continue
		}
		a, ok := m.answers[n]
		if !ok {
			results = append(results, bazaarResult{Name: n, Answer: "no bet", Bet: 0, Delta: 0})
			continue
		}
		stake := bazaarStakes[a.bet]
		delta, right, shown := 0, false, ""
		if m.est != nil {
			e := math.Abs(a.value-m.est.Answer) / m.est.Span
			switch {
			case e <= 0.05:
				delta, right = 2*stake, true
			case e <= 0.15:
				delta, right = stake, true
			case e <= 0.35:
				delta = 0
			default:
				delta = -stake
			}
			if right && n == closest {
				delta += 40 // closest guess in the market
			}
			shown = fmtNum(a.value)
			if m.unit != "" {
				shown += " " + m.unit
			}
		} else {
			i := int(a.value)
			shown = m.options[i]
			if i == m.correct {
				right = true
				frac := 1 - float64(a.at.Sub(m.start))/window
				frac = math.Max(0, math.Min(1, frac))
				delta = stake + int(float64(stake)*0.25*frac)
			} else {
				delta = -stake
			}
		}
		if delta > 0 && m.event == eventBull {
			delta *= 2
		}
		if delta < 0 && m.event == eventCrash {
			delta *= 2
		}
		m.net[n] += delta
		m.played[n]++
		if right {
			m.right[n]++
		}
		results = append(results, bazaarResult{Name: n, Answer: shown, Bet: a.bet, Delta: delta, Right: right})
	}
	sort.SliceStable(results, func(i, j int) bool { return results[i].Delta > results[j].Delta })
	m.results = results

	// Wacky penalty: the single biggest loser of the round, if anyone lost coins.
	if len(results) >= 2 {
		last := results[len(results)-1]
		if last.Delta < 0 && results[len(results)-2].Delta > last.Delta {
			m.penaltyName = last.Name
			m.penaltyText = bazaarPenalties[m.rng.Intn(len(bazaarPenalties))]
		}
	}
	m.status = "between"
	m.endAt = now.Add(bazaarBetween)
}

func (m *bazaarMission) Deadline() time.Time { return m.endAt }

func (m *bazaarMission) Public() any {
	locked := []string{}
	for _, n := range m.order {
		if _, ok := m.answers[n]; ok {
			locked = append(locked, n)
		}
	}
	sort.Strings(locked)
	net := map[string]int{}
	for _, n := range m.order {
		net[n] = m.net[n]
	}
	pub := map[string]any{
		"kind": "bazaar", "variant": m.def.Variant, "round": m.round + 1, "rounds": len(m.items),
		"status": m.status, "event": m.event, "prompt": m.prompt, "unit": m.unit,
		"locked": locked, "net": net,
	}
	if m.options != nil {
		pub["options"] = m.options
		if m.struck >= 0 {
			pub["struck"] = m.struck
		}
	}
	if m.chain != nil {
		pub["chain"] = m.chain
		pub["blank"] = m.blank
	}
	if m.hint != "" {
		pub["hint"] = m.hint
	}
	if m.status == "between" {
		pub["answer"] = m.truth
		pub["correct"] = m.correct
		pub["explain"] = m.explain
		pub["results"] = m.results
		if m.penaltyName != "" {
			pub["penalty"] = map[string]string{"name": m.penaltyName, "text": m.penaltyText}
		}
	}
	return pub
}

func (m *bazaarMission) Private(name string) any {
	a, ok := m.answers[name]
	out := map[string]any{"answered": ok, "net": m.net[name]}
	if ok {
		out["bet"] = a.bet
		out["value"] = a.value
	}
	return out
}

func (m *bazaarMission) Progress(name string) float64 {
	total := float64(len(m.items))
	if total == 0 {
		return 0
	}
	p := float64(m.round)
	if _, ok := m.answers[name]; ok {
		p += 0.5
	}
	return math.Min(1, p/total)
}

func (m *bazaarMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		out[n] = math.Max(0, float64(m.net[n]))
	}
	return out
}

func (m *bazaarMission) Stats() map[string]string {
	out := map[string]string{}
	for _, n := range m.order {
		out[n] = fmt.Sprintf("%+d coins · %d/%d right", m.net[n], m.right[n], len(m.items))
	}
	return out
}

func (m *bazaarMission) Note() string { return bazaarNotes[m.def.Variant] }
