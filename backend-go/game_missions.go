package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A Mission is one playable node on a map. The room (game_room.go) drives it:
// Start once, then Handle for each player action and Tick on a clock, until
// Tick reports finished. A mission never decides the final ranking itself: it
// reports a raw performance number per player (higher is better), and the room
// normalises every mission to 0-1000 so different games are comparable.
type Mission interface {
	Start(now time.Time, players []string)
	Handle(name string, raw json.RawMessage, now time.Time) bool // true if state changed
	Leave(name string)
	Tick(now time.Time) (changed, finished bool)
	Deadline() time.Time          // zero if the mission has no single deadline
	Public() any                  // visible to everyone in the room
	Private(name string) any      // visible only to that player
	Progress(name string) float64 // 0..1, drives the progress bars
	Raw() map[string]float64      // raw performance per player
	Stats() map[string]string     // one human-readable line per player
	Note() string                 // what the mission teaches / reveals at the end
}

func newMission(def *MissionDef, rng *rand.Rand) (Mission, error) {
	switch def.Kind {
	case "reaction":
		return &reactionMission{def: def, rng: rng}, nil
	case "math":
		return &mathMission{def: def, rng: rng}, nil
	case "typing":
		return &typingMission{def: def, rng: rng}, nil
	case "cipher":
		return &cipherMission{def: def, rng: rng}, nil
	case "talk":
		return &talkMission{def: def, rng: rng}, nil
	}
	return nil, fmt.Errorf("unknown mission kind %q", def.Kind)
}

func parseOp(raw json.RawMessage) string {
	var p struct {
		Op string `json:"op"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return ""
	}
	return p.Op
}

func copyInts(m map[string]int) map[string]int {
	out := make(map[string]int, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// ---------------------------------------------------------------------------
// Reaction: click when the orb turns green. Server-timed.
// ---------------------------------------------------------------------------

const reactionWindow = 2500 * time.Millisecond // how long players have after "go"

// Package vars (not consts) only so tests can shorten the pauses.
var reactionBetween = 1600 * time.Millisecond // pause that shows each round's result

type reactionMission struct {
	def     *MissionDef
	rng     *rand.Rand
	order   []string
	member  map[string]bool
	round   int
	status  string // wait | go | between
	goAt    time.Time
	shown   time.Time
	endAt   time.Time
	acted   map[string]bool
	cur     map[string]int // ms; -1 false start; -2 no click
	results map[string]int
	history map[string][]int
}

func (m *reactionMission) Start(now time.Time, players []string) {
	m.order = players
	m.member = map[string]bool{}
	m.history = map[string][]int{}
	for _, p := range players {
		m.member[p] = true
	}
	m.beginRound(now)
}

func (m *reactionMission) beginRound(now time.Time) {
	delay := m.def.MinDelayMS
	if span := m.def.MaxDelayMS - m.def.MinDelayMS; span > 0 {
		delay += m.rng.Intn(span + 1)
	}
	m.status = "wait"
	m.goAt = now.Add(time.Duration(delay) * time.Millisecond)
	m.acted = map[string]bool{}
	m.cur = map[string]int{}
	m.results = nil
}

func (m *reactionMission) finishRound(now time.Time) {
	for _, n := range m.order {
		if !m.acted[n] {
			m.cur[n] = -2
		}
		m.history[n] = append(m.history[n], m.cur[n])
	}
	m.results = copyInts(m.cur)
	m.status = "between"
	m.endAt = now.Add(reactionBetween)
}

func (m *reactionMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	if !m.member[name] || m.acted[name] || parseOp(raw) != "click" {
		return false
	}
	switch m.status {
	case "wait":
		m.cur[name] = -1 // false start
	case "go":
		m.cur[name] = int(now.Sub(m.shown).Milliseconds())
	default:
		return false
	}
	m.acted[name] = true
	return true
}

func (m *reactionMission) Leave(string) {}

func (m *reactionMission) Tick(now time.Time) (changed, finished bool) {
	all := len(m.acted) >= len(m.order)
	switch m.status {
	case "wait":
		if all {
			m.finishRound(now)
			return true, false
		}
		if !now.Before(m.goAt) {
			m.status, m.shown, m.endAt = "go", now, now.Add(reactionWindow)
			return true, false
		}
	case "go":
		if all || !now.Before(m.endAt) {
			m.finishRound(now)
			return true, false
		}
	case "between":
		if !now.Before(m.endAt) {
			m.round++
			if m.round >= m.def.Rounds {
				return true, true
			}
			m.beginRound(now)
			return true, false
		}
	}
	return false, false
}

func (m *reactionMission) Deadline() time.Time {
	if m.status == "go" {
		return m.endAt
	}
	return time.Time{}
}

func (m *reactionMission) Public() any {
	pub := map[string]any{"kind": "reaction", "round": m.round + 1, "rounds": m.def.Rounds, "status": m.status}
	if m.status == "between" {
		pub["results"] = m.results
	}
	return pub
}

func (m *reactionMission) Private(name string) any {
	return map[string]any{"acted": m.acted[name]}
}

func (m *reactionMission) Progress(name string) float64 {
	return float64(len(m.history[name])) / float64(m.def.Rounds)
}

func (m *reactionMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		sum := 0.0
		for _, rt := range m.history[n] {
			if rt >= 0 {
				sum += math.Max(0, 1000-float64(rt))
			}
		}
		out[n] = sum / float64(m.def.Rounds)
	}
	return out
}

func (m *reactionMission) Stats() map[string]string {
	out := map[string]string{}
	for _, n := range m.order {
		var valid []int
		fs := 0
		for _, rt := range m.history[n] {
			if rt >= 0 {
				valid = append(valid, rt)
			} else if rt == -1 {
				fs++
			}
		}
		line := "no valid clicks"
		if len(valid) > 0 {
			sum, best := 0, valid[0]
			for _, v := range valid {
				sum += v
				if v < best {
					best = v
				}
			}
			line = fmt.Sprintf("avg %d ms · best %d ms", sum/len(valid), best)
		}
		if fs > 0 {
			line += fmt.Sprintf(" · %d false start", fs)
			if fs > 1 {
				line += "s"
			}
		}
		out[n] = line
	}
	return out
}

func (m *reactionMission) Note() string {
	return "Most people react in 200-300 ms. Guessing early is punished, so the skill is staying calm and watching."
}

// ---------------------------------------------------------------------------
// Math sprint: same question sequence for everyone, each at their own pace.
// ---------------------------------------------------------------------------

type mathQ struct {
	text   string
	answer int
}

type mathState struct{ idx, correct, wrong int }

type mathMission struct {
	def      *MissionDef
	rng      *rand.Rand
	order    []string
	st       map[string]*mathState
	qs       []mathQ
	deadline time.Time
}

func genMath(rng *rand.Rand, n int) []mathQ {
	qs := make([]mathQ, 0, n)
	for i := 0; i < n; i++ {
		switch {
		case i < 10:
			a, b := 10+rng.Intn(40), 5+rng.Intn(30)
			if rng.Intn(2) == 0 {
				qs = append(qs, mathQ{fmt.Sprintf("%d + %d", a, b), a + b})
			} else {
				if b > a {
					a, b = b, a
				}
				qs = append(qs, mathQ{fmt.Sprintf("%d - %d", a, b), a - b})
			}
		case i < 25:
			a, b := 2+rng.Intn(11), 2+rng.Intn(11)
			qs = append(qs, mathQ{fmt.Sprintf("%d * %d", a, b), a * b})
		default:
			a, b, c := 2+rng.Intn(9), 2+rng.Intn(9), 5+rng.Intn(40)
			qs = append(qs, mathQ{fmt.Sprintf("%d * %d + %d", a, b, c), a*b + c})
		}
	}
	return qs
}

func (m *mathMission) Start(now time.Time, players []string) {
	m.order = players
	m.st = map[string]*mathState{}
	for _, p := range players {
		m.st[p] = &mathState{}
	}
	m.qs = genMath(m.rng, 60)
	m.deadline = now.Add(time.Duration(m.def.DurationMS) * time.Millisecond)
}

func (m *mathMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	var p struct {
		Op    string `json:"op"`
		Value string `json:"value"`
	}
	st := m.st[name]
	if st == nil || json.Unmarshal(raw, &p) != nil || p.Op != "answer" || len(p.Value) > 12 || st.idx >= len(m.qs) {
		return false
	}
	n, err := strconv.Atoi(strings.TrimSpace(p.Value))
	if err != nil {
		return false
	}
	if n == m.qs[st.idx].answer {
		st.correct++
		st.idx++
	} else {
		st.wrong++
	}
	return true
}

func (m *mathMission) Leave(string) {}

func (m *mathMission) Tick(now time.Time) (changed, finished bool) {
	return false, !now.Before(m.deadline)
}

func (m *mathMission) Deadline() time.Time { return m.deadline }
func (m *mathMission) Public() any         { return map[string]any{"kind": "math"} }

func (m *mathMission) Private(name string) any {
	st := m.st[name]
	if st == nil {
		return nil
	}
	q := ""
	if st.idx < len(m.qs) {
		q = m.qs[st.idx].text
	}
	return map[string]any{"q": q, "index": st.idx, "correct": st.correct, "wrong": st.wrong}
}

func (m *mathMission) Progress(name string) float64 {
	if st := m.st[name]; st != nil {
		return math.Min(1, float64(st.correct)/20)
	}
	return 0
}

func (m *mathMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		st := m.st[n]
		out[n] = math.Max(0, float64(st.correct*100-st.wrong*50))
	}
	return out
}

func (m *mathMission) Stats() map[string]string {
	out := map[string]string{}
	for _, n := range m.order {
		out[n] = fmt.Sprintf("%d correct · %d wrong", m.st[n].correct, m.st[n].wrong)
	}
	return out
}

func (m *mathMission) Note() string {
	return "Speed comes from pattern recognition: multiplication tables and number bonds you no longer have to think about."
}

// ---------------------------------------------------------------------------
// Typing: finish the passage; the server checks every character.
// ---------------------------------------------------------------------------

const maxTypingCPS = 22.0 // ~260 WPM: anything faster than this is pasted or scripted

var typingTexts = []string{
	"The quick packet hopped from router to router until it found the server waiting at the edge of the network.",
	"Every secure system starts with a simple rule: never trust input that you did not generate yourself.",
	"A good engineer reads the error message twice, reads the code once, and only then starts guessing.",
	"Memory is just a long street of numbered houses, and every pointer is an address written on a piece of paper.",
	"Fast hands help, but steady hands win: accuracy beats speed when the cursor is the only thing that matters.",
	"Learning to build things is slow at first, then suddenly one day the pieces start to fit together on their own.",
	"A strong password is long, unique, and boring to read, which is exactly why a machine cannot guess it quickly.",
}

type typingState struct {
	correct    int
	finished   bool
	finishedAt time.Time
}

type typingMission struct {
	def      *MissionDef
	rng      *rand.Rand
	order    []string
	st       map[string]*typingState
	text     []rune
	start    time.Time
	deadline time.Time
}

func (m *typingMission) Start(now time.Time, players []string) {
	m.order = players
	m.st = map[string]*typingState{}
	for _, p := range players {
		m.st[p] = &typingState{}
	}
	m.text = []rune(typingTexts[m.rng.Intn(len(typingTexts))])
	m.start = now
	m.deadline = now.Add(time.Duration(m.def.DurationMS) * time.Millisecond)
}

func (m *typingMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	var p struct {
		Op    string `json:"op"`
		Typed string `json:"typed"`
	}
	st := m.st[name]
	if st == nil || st.finished || json.Unmarshal(raw, &p) != nil || p.Op != "progress" {
		return false
	}
	typed := []rune(p.Typed)
	if len(typed) > len(m.text) {
		return false
	}
	// Plausibility: nobody types faster than maxTypingCPS. Reject, don't punish.
	if float64(len(typed)) > now.Sub(m.start).Seconds()*maxTypingCPS+12 {
		return false
	}
	c := 0
	for c < len(typed) && typed[c] == m.text[c] {
		c++
	}
	st.correct = c
	if c == len(m.text) {
		st.finished, st.finishedAt = true, now
	}
	return true
}

func (m *typingMission) Leave(string) {}

func (m *typingMission) Tick(now time.Time) (changed, finished bool) {
	all := true
	for _, n := range m.order {
		if !m.st[n].finished {
			all = false
		}
	}
	return false, all || !now.Before(m.deadline)
}

func (m *typingMission) Deadline() time.Time { return m.deadline }
func (m *typingMission) Public() any {
	return map[string]any{"kind": "typing", "text": string(m.text)}
}
func (m *typingMission) Private(string) any { return nil }

func (m *typingMission) Progress(name string) float64 {
	if st := m.st[name]; st != nil {
		return float64(st.correct) / float64(len(m.text))
	}
	return 0
}

func (m *typingMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		st := m.st[n]
		if st.finished {
			left := math.Max(0, m.deadline.Sub(st.finishedAt).Seconds())
			out[n] = float64(len(m.text)) + left*4
		} else {
			out[n] = float64(st.correct)
		}
	}
	return out
}

func (m *typingMission) Stats() map[string]string {
	out := map[string]string{}
	for _, n := range m.order {
		st := m.st[n]
		secs := float64(m.def.DurationMS) / 1000
		if st.finished {
			secs = st.finishedAt.Sub(m.start).Seconds()
		}
		wpm := 0
		if secs > 0 {
			wpm = int(math.Round(float64(st.correct) / 5 / (secs / 60)))
		}
		if st.finished {
			out[n] = fmt.Sprintf("%d WPM · finished in %.1fs", wpm, secs)
		} else {
			out[n] = fmt.Sprintf("%d WPM · %d%% typed", wpm, st.correct*100/len(m.text))
		}
	}
	return out
}

func (m *typingMission) Note() string {
	return "Typing speed is measured in words per minute (one word = 5 characters). One wrong character blocks you until you fix it, so accuracy is speed."
}

// ---------------------------------------------------------------------------
// Cipher: decode an encoding. First to solve scores most. Teaches the concept.
// ---------------------------------------------------------------------------

var cipherBetween = 2500 * time.Millisecond

var cipherWords = map[string][]string{
	"caesar": {"firewall", "payload", "exploit", "kernel", "socket", "packet", "handshake", "gateway", "buffer", "opcode", "token", "cipher"},
	"base64": {"firewall", "payload", "gateway", "exploit", "handshake", "backdoor", "password", "network"},
	"hex":    {"kernel", "socket", "packet", "buffer", "cipher", "shell", "debug", "stack"},
	"binary": {"root", "ping", "port", "byte", "sudo", "fuzz", "bash", "hash"},
}

var cipherNotes = map[string]string{
	"caesar": "A Caesar cipher moves every letter a fixed distance. Only 25 shifts exist, so an attacker just tries them all. That is called brute force.",
	"base64": "Base64 is an encoding, not encryption. It only changes how bytes are written and anyone can reverse it. Never use it to hide secrets.",
	"hex":    "Hexadecimal writes bytes in base 16, two digits per byte. You will read it constantly in memory dumps, packet captures and hashes.",
	"binary": "Computers store text as numbers. ASCII gives each letter one byte, so 'a' is 97, which is 01100001 in binary.",
}

// cipherEncode turns a lowercase ASCII word into its challenge string.
func cipherEncode(variant, word string, shift int) string {
	switch variant {
	case "caesar":
		out := make([]byte, len(word))
		for i := 0; i < len(word); i++ {
			out[i] = 'A' + (word[i]-'a'+byte(shift))%26
		}
		return string(out)
	case "base64":
		return base64.StdEncoding.EncodeToString([]byte(word))
	case "hex", "binary":
		parts := make([]string, len(word))
		for i := 0; i < len(word); i++ {
			if variant == "hex" {
				parts[i] = fmt.Sprintf("%02x", word[i])
			} else {
				parts[i] = fmt.Sprintf("%08b", word[i])
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}

func cipherHint(variant string, shift int) string {
	switch variant {
	case "caesar":
		return fmt.Sprintf("Every letter was shifted forward by %d. Shift each one back.", shift)
	case "base64":
		return "Base64 turns every 3 bytes into 4 characters. The = at the end is padding."
	case "hex":
		return "Each pair of hex digits is one byte. For example 61 is 'a' and 62 is 'b'."
	default:
		return "Eight bits make one letter. For example 01100001 is 'a'."
	}
}

type puzzle struct{ challenge, answer, hint string }

type cipherMission struct {
	def       *MissionDef
	rng       *rand.Rand
	order     []string
	round     int
	status    string // play | between
	pz        puzzle
	start     time.Time
	endAt     time.Time
	hintShown bool
	solved    map[string]bool
	attempts  map[string]int
	raw       map[string]float64
	times     map[string][]float64
	used      map[string]bool
}

func (m *cipherMission) per() time.Duration {
	return time.Duration(m.def.DurationMS) * time.Millisecond
}

func (m *cipherMission) Start(now time.Time, players []string) {
	m.order = players
	m.raw = map[string]float64{}
	m.times = map[string][]float64{}
	m.used = map[string]bool{}
	m.newPuzzle(now)
}

func (m *cipherMission) newPuzzle(now time.Time) {
	words := cipherWords[m.def.Variant]
	word := words[m.rng.Intn(len(words))]
	for _, i := range m.rng.Perm(len(words)) {
		if !m.used[words[i]] {
			word = words[i]
			break
		}
	}
	m.used[word] = true
	shift := 3 + m.rng.Intn(11)
	m.pz = puzzle{challenge: cipherEncode(m.def.Variant, word, shift), answer: word, hint: cipherHint(m.def.Variant, shift)}
	m.status, m.start, m.endAt, m.hintShown = "play", now, now.Add(m.per()), false
	m.solved = map[string]bool{}
	m.attempts = map[string]int{}
}

func (m *cipherMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	var p struct {
		Op    string `json:"op"`
		Value string `json:"value"`
	}
	if m.status != "play" || json.Unmarshal(raw, &p) != nil || p.Op != "answer" || len(p.Value) > 64 {
		return false
	}
	known := false
	for _, n := range m.order {
		known = known || n == name
	}
	if !known || m.solved[name] || m.attempts[name] >= 8 {
		return false
	}
	m.attempts[name]++
	if strings.ToLower(strings.TrimSpace(p.Value)) == m.pz.answer {
		elapsed := now.Sub(m.start)
		frac := math.Min(1, float64(elapsed)/float64(m.per()))
		m.raw[name] += math.Max(100, 1000-900*frac) // 1000 for instant, 100 at the buzzer
		m.times[name] = append(m.times[name], elapsed.Seconds())
		m.solved[name] = true
	} else {
		m.raw[name] -= 25
	}
	return true
}

func (m *cipherMission) Leave(string) {}

func (m *cipherMission) Tick(now time.Time) (changed, finished bool) {
	switch m.status {
	case "play":
		allSolved := true
		for _, n := range m.order {
			allSolved = allSolved && m.solved[n]
		}
		if allSolved || !now.Before(m.endAt) {
			m.status, m.endAt = "between", now.Add(cipherBetween)
			return true, false
		}
		if !m.hintShown && now.Sub(m.start) >= m.per()/3 {
			m.hintShown = true
			return true, false
		}
	case "between":
		if !now.Before(m.endAt) {
			m.round++
			if m.round >= m.def.Rounds {
				return true, true
			}
			m.newPuzzle(now)
			return true, false
		}
	}
	return false, false
}

func (m *cipherMission) Deadline() time.Time { return m.endAt }

func (m *cipherMission) Public() any {
	solved := []string{} // never null on the wire
	for _, n := range m.order {
		if m.solved[n] {
			solved = append(solved, n)
		}
	}
	sort.Strings(solved)
	pub := map[string]any{"kind": "cipher", "variant": m.def.Variant, "round": m.round + 1,
		"rounds": m.def.Rounds, "status": m.status, "challenge": m.pz.challenge, "solved": solved}
	if m.hintShown {
		pub["hint"] = m.pz.hint
	}
	if m.status == "between" {
		pub["answer"] = m.pz.answer
	}
	return pub
}

func (m *cipherMission) Private(name string) any {
	return map[string]any{"solved": m.solved[name], "attempts": m.attempts[name]}
}

func (m *cipherMission) Progress(name string) float64 {
	return float64(len(m.times[name])) / float64(m.def.Rounds)
}

func (m *cipherMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		out[n] = math.Max(0, m.raw[n])
	}
	return out
}

func (m *cipherMission) Stats() map[string]string {
	out := map[string]string{}
	for _, n := range m.order {
		t := m.times[n]
		if len(t) == 0 {
			out[n] = fmt.Sprintf("0/%d solved", m.def.Rounds)
			continue
		}
		sum := 0.0
		for _, v := range t {
			sum += v
		}
		out[n] = fmt.Sprintf("%d/%d solved · avg %.1fs", len(t), m.def.Rounds, sum/float64(len(t)))
	}
	return out
}

func (m *cipherMission) Note() string { return cipherNotes[m.def.Variant] }

// ---------------------------------------------------------------------------
// Talk: cooperative. A prompt, a conversation, and everyone must agree it is done.
// ---------------------------------------------------------------------------

type talkMission struct {
	def       *MissionDef
	rng       *rand.Rand
	order     []string
	required  map[string]bool
	done      map[string]bool
	prompt    string
	start     time.Time
	deadline  time.Time
	completed bool
	finishAt  time.Time
}

func (m *talkMission) Start(now time.Time, players []string) {
	m.order = players
	m.required = map[string]bool{}
	m.done = map[string]bool{}
	for _, p := range players {
		m.required[p] = true
	}
	m.prompt = m.def.Prompts[m.rng.Intn(len(m.def.Prompts))]
	m.start = now
	m.deadline = now.Add(time.Duration(m.def.DurationMS) * time.Millisecond)
}

func (m *talkMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	var p struct {
		Op    string `json:"op"`
		Value *bool  `json:"value"`
	}
	if !m.required[name] || json.Unmarshal(raw, &p) != nil || p.Op != "done" {
		return false
	}
	if p.Value != nil {
		m.done[name] = *p.Value
	} else {
		m.done[name] = !m.done[name]
	}
	return true
}

// Leave stops a disconnected player from blocking the group.
func (m *talkMission) Leave(name string) {
	delete(m.required, name)
	delete(m.done, name)
}

func (m *talkMission) Tick(now time.Time) (changed, finished bool) {
	if len(m.required) > 0 {
		all := true
		for n := range m.required {
			all = all && m.done[n]
		}
		if all {
			m.completed, m.finishAt = true, now
			return true, true
		}
	}
	return false, len(m.required) == 0 || !now.Before(m.deadline)
}

func (m *talkMission) Deadline() time.Time { return m.deadline }

func (m *talkMission) Public() any {
	done := []string{}
	for _, n := range m.order {
		if m.done[n] {
			done = append(done, n)
		}
	}
	return map[string]any{"kind": "talk", "prompt": m.prompt, "done": done, "total": len(m.required)}
}

func (m *talkMission) Private(name string) any {
	return map[string]any{"done": m.done[name]}
}

func (m *talkMission) Progress(name string) float64 {
	if m.done[name] {
		return 1
	}
	return 0
}

func (m *talkMission) Raw() map[string]float64 {
	out := map[string]float64{}
	for _, n := range m.order {
		if m.completed {
			out[n] = 1
		} else {
			out[n] = 0
		}
	}
	return out
}

func (m *talkMission) Stats() map[string]string {
	line := "time ran out before everyone agreed"
	if m.completed {
		line = fmt.Sprintf("completed together in %.0fs", m.finishAt.Sub(m.start).Seconds())
	}
	out := map[string]string{}
	for _, n := range m.order {
		out[n] = line
	}
	return out
}

func (m *talkMission) Note() string {
	return "Good conversations are not about winning. Asking one real question about what someone said beats any clever line."
}
