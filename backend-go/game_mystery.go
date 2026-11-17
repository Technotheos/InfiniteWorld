package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Mystery: a social-deduction crime for 4-6 players.
//
// Every player is a suspect and is dealt a secret role:
//
//	culprit    committed the crime and lies in their testimony
//	detective  may verify one claim of one suspect
//	witness    saw the coat colour of the figure leaving the crime scene
//	trickster  (6+ players) wins if the WRONG person is accused
//	suspect    an honest innocent
//
// The case is generated, not scripted, and checked by the server: every honest
// player's testimony is true, and the culprit's lie about the crime window names
// at least two innocents who each contradict it. solvable() proves that for every
// generated case, so a group that cross-checks the testimony CAN always find the
// culprit by logic. Cameras, tips and a verification add more (and sometimes
// misleading) evidence on top.
//
// Phases (one mission, several sub-phases, each with its own deadline):
//
//	intro > alibi > investigate > interrogate > vote > unmask
// ---------------------------------------------------------------------------

// Package vars (not consts) only so tests can shorten them.
var (
	mysteryIntro  = 10 * time.Second
	mysteryVote   = 25 * time.Second
	mysteryUnmask = 12 * time.Second
)

var mysteryCoats = []string{"Red", "Blue", "Green", "Yellow", "Purple", "Orange", "White", "Teal"}

var mysteryRoleLabel = map[string]string{
	"culprit": "Culprit", "detective": "Detective", "witness": "Witness",
	"trickster": "Trickster", "suspect": "Suspect",
}

type mysteryTheme struct {
	Key     string
	Title   string
	Setting string
	Crime   string
	Rooms   []string // Rooms[0] is the scene of the crime
	Slots   []string // time slots; the crime happens during one of the middle ones
	Jobs    []string
	Lesson  string
}

var mysteryThemeKeys = []string{"museum", "lab", "liner"}

var mysteryThemes = map[string]*mysteryTheme{
	"museum": {
		Key:     "museum",
		Title:   "The Orion Diamond",
		Setting: "The Aurelian Museum, night of the winter gala. The chandeliers dim, the music stops, and a silent alarm lights up in the Vault.",
		Crime:   "The Orion Diamond has vanished from the Vault. The door log shows it was opened once, during the time marked below, and locked again behind the thief.",
		Rooms:   []string{"Vault", "Gallery", "Cafe", "Library", "Garden", "Security Office"},
		Slots:   []string{"9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM"},
		Jobs:    []string{"Curator", "Guard", "Chef", "Archivist", "Florist", "Auditor", "Violinist", "Restorer"},
		Lesson:  "Alibis are testable. A statement about yourself can only be checked against what others say about you, so good investigators cross-validate: they look for claims that independent witnesses contradict, and they weigh two independent statements above one.",
	},
	"lab": {
		Key:     "lab",
		Title:   "The Helix Serum",
		Setting: "Helix Biotech, a late shift. A storm knocks out the lights, and when they return the cold-storage alarm is blinking.",
		Crime:   "A vial of Helix-9 serum is missing from Cold Storage. The badge log shows the door opened once, during the time marked below.",
		Rooms:   []string{"Cold Storage", "Main Lab", "Server Room", "Break Room", "Rooftop", "Reception"},
		Slots:   []string{"11:00 PM", "11:20 PM", "11:40 PM", "12:00 AM"},
		Jobs:    []string{"Chemist", "Janitor", "Intern", "Director", "Technician", "Courier", "Analyst", "Guard"},
		Lesson:  "Logs and testimony answer different questions: a log says when something happened, testimony says who was where. Beware confirmation bias too. The first suspect you pick makes every later clue look like proof, so keep testing the other options.",
	},
	"liner": {
		Key:     "liner",
		Title:   "The Captain's Ledger",
		Setting: "The Starlight Liner, mid-Atlantic. A storm rocks the ship during the captain's dinner and the lamps swing in the dark.",
		Crime:   "The captain's ledger is gone from the Strongroom. The lock log shows it was opened once, during the time marked below.",
		Rooms:   []string{"Strongroom", "Dining Hall", "Engine Room", "Deck", "Bridge", "Cabins"},
		Slots:   []string{"8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM"},
		Jobs:    []string{"Purser", "Cook", "Engineer", "Navigator", "Steward", "Doctor", "Singer", "Deckhand"},
		Lesson:  "A timeline is a tool. Put every claim on one grid of who, where and when, and impossible things stand out: a person in two places, or a crowd in a room that was nearly empty. Keep what you know apart from what you were told.",
	},
}

// ---- the case --------------------------------------------------------------

type myClaim struct {
	Room   int      `json:"room"` // -1 when hidden
	With   []string `json:"with"`
	Hidden bool     `json:"hidden,omitempty"`
}

type mySuspect struct {
	Name string `json:"name"`
	Coat int    `json:"coat"`
	Job  int    `json:"job"`
}

type mysteryCase struct {
	theme     *mysteryTheme
	names     []string
	crimeSlot int
	culprit   string
	roles     map[string]string
	loc       map[string][]int     // the truth: room index per slot
	claims    map[string][]myClaim // what each player says (honest, except the culprit at the crime slot)
	coat      map[string]int
	job       map[string]int
	falseWith []string // innocents named in the culprit's lie who contradict it
	falseRoom int
}

func containsStr(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

func (c *mysteryCase) truthClaim(rng *rand.Rand, p string, t int) myClaim {
	room := c.loc[p][t]
	with := []string{}
	for _, q := range c.names {
		if q != p && c.loc[q][t] == room {
			with = append(with, q)
		}
	}
	rng.Shuffle(len(with), func(i, j int) { with[i], with[j] = with[j], with[i] })
	if len(with) > 2 {
		with = with[:2]
	}
	return myClaim{Room: room, With: with}
}

func genMysteryCase(rng *rand.Rand, theme *mysteryTheme, players []string) *mysteryCase {
	n := len(players)
	slots := len(theme.Slots)
	rooms := len(theme.Rooms)
	c := &mysteryCase{
		theme: theme, names: append([]string(nil), players...),
		roles: map[string]string{}, loc: map[string][]int{}, claims: map[string][]myClaim{},
		coat: map[string]int{}, job: map[string]int{},
	}

	// roles, coats and occupations
	perm := rng.Perm(n)
	for i, idx := range perm {
		role := "suspect"
		switch {
		case i == 0:
			role = "culprit"
		case i == 1:
			role = "detective"
		case i == 2:
			role = "witness"
		case i == 3 && n >= 6:
			role = "trickster"
		}
		c.roles[players[idx]] = role
	}
	c.culprit = players[perm[0]]
	coats, jobs := rng.Perm(len(mysteryCoats)), rng.Perm(len(theme.Jobs))
	for i, p := range players {
		c.coat[p] = coats[i%len(coats)]
		c.job[p] = jobs[i%len(jobs)]
	}

	// the truth: where everybody really was
	c.crimeSlot = 1 + rng.Intn(slots-2)
	for _, p := range players {
		row := make([]int, slots)
		for t := range row {
			row[t] = 1 + rng.Intn(rooms-1) // never the scene of the crime...
		}
		c.loc[p] = row
	}
	for _, p := range players { // ...except as a red herring: some innocents visited it at another time
		if p == c.culprit {
			continue
		}
		for t := 0; t < slots; t++ {
			if t != c.crimeSlot && rng.Intn(100) < 18 {
				c.loc[p][t] = 0
			}
		}
	}
	c.loc[c.culprit][c.crimeSlot] = 0

	// honest testimony for everyone; the trickster refuses to explain one non-crime slot
	for _, p := range players {
		row := make([]myClaim, slots)
		for t := 0; t < slots; t++ {
			row[t] = c.truthClaim(rng, p, t)
		}
		if c.roles[p] == "trickster" {
			h := rng.Intn(slots - 1)
			if h >= c.crimeSlot {
				h++
			}
			row[h] = myClaim{Room: -1, With: []string{}, Hidden: true}
		}
		c.claims[p] = row
	}

	// the culprit's lie: claim to be elsewhere, in the company of two innocents who were not there
	k := c.crimeSlot
	var cands []string
	for _, p := range players {
		if p != c.culprit && !c.claims[p][k].Hidden {
			cands = append(cands, p)
		}
	}
	placed := false
	for _, v := range rng.Perm(rooms - 1) {
		r := v + 1
		var liars, honest []string
		for _, p := range cands {
			if c.loc[p][k] == r {
				honest = append(honest, p)
			} else {
				liars = append(liars, p)
			}
		}
		if len(liars) < 2 {
			continue
		}
		rng.Shuffle(len(liars), func(i, j int) { liars[i], liars[j] = liars[j], liars[i] })
		with := append([]string(nil), liars[:2]...)
		if len(honest) > 0 && rng.Intn(100) < 60 {
			with = append(with, honest[0]) // someone who really was there makes the lie more believable
		}
		rng.Shuffle(len(with), func(i, j int) { with[i], with[j] = with[j], with[i] })
		c.claims[c.culprit][k] = myClaim{Room: r, With: with}
		c.falseWith, c.falseRoom = liars[:2], r
		placed = true
		break
	}
	if !placed { // tiny groups: still lie, even if the case cannot be fully proven
		with := append([]string(nil), cands...)
		c.claims[c.culprit][k] = myClaim{Room: 1, With: with}
		c.falseWith, c.falseRoom = with, 1
	}
	return c
}

// conflicts reports whether claim a (made by x) and claim b (made by y) for the
// same slot cannot both be true: one of them puts the other person in a different room.
func conflicts(x string, a myClaim, y string, b myClaim) bool {
	if a.Hidden || b.Hidden || a.Room == b.Room {
		return false
	}
	return containsStr(a.With, y) || containsStr(b.With, x)
}

// consistentWithout reports whether everybody's testimony, except skip's, agrees.
func (c *mysteryCase) consistentWithout(skip string) bool {
	for t := range c.theme.Slots {
		for i, x := range c.names {
			if x == skip {
				continue
			}
			for _, y := range c.names[i+1:] {
				if y == skip {
					continue
				}
				if conflicts(x, c.claims[x][t], y, c.claims[y][t]) {
					return false
				}
			}
		}
	}
	return true
}

// solvable proves the case can be cracked by logic alone: assuming any one innocent
// is the liar leaves a contradiction among the others, and only the real culprit's
// removal makes the testimony consistent.
func (c *mysteryCase) solvable() bool {
	if !c.consistentWithout(c.culprit) {
		return false
	}
	for _, p := range c.names {
		if p != c.culprit && c.consistentWithout(p) {
			return false
		}
	}
	return true
}

func newMysteryCase(rng *rand.Rand, theme *mysteryTheme, players []string) *mysteryCase {
	var last *mysteryCase
	for try := 0; try < 300; try++ {
		last = genMysteryCase(rng, theme, players)
		if last.solvable() {
			return last
		}
	}
	return last
}

func (c *mysteryCase) headcount(room, slot int) int {
	n := 0
	for _, p := range c.names {
		if c.loc[p][slot] == room {
			n++
		}
	}
	return n
}

// ---- the mission -----------------------------------------------------------

type myTip struct {
	ID     int
	Coat   int
	Text   string
	Author string
	True   bool
}

type myFeed struct {
	Kind   string `json:"kind"` // press | verify
	Who    string `json:"who,omitempty"`
	Target string `json:"target,omitempty"`
	Slot   int    `json:"slot"`
	Text   string `json:"text,omitempty"`
}

type mysteryMission struct {
	def    *MissionDef
	rng    *rand.Rand
	theme  *mysteryTheme
	c      *mysteryCase
	order  []string
	member map[string]bool

	phase    string // intro | alibi | investigate | interrogate | vote | unmask
	phaseEnd time.Time

	votes      map[string]string
	inqLeft    map[string]int
	inqLog     map[string][]string
	pressLeft  map[string]int
	pressed    map[string]bool
	verifyLeft map[string]int
	verified   map[string]string // "name|slot" -> ok | bad | hidden
	tipPosted  map[string]bool
	tips       []myTip
	feed       []myFeed
	sharp      map[string]int
	exposed    bool

	accused string
	caught  bool
	final   map[string]float64
	stats   map[string]string
	note    string
}

func (m *mysteryMission) Start(now time.Time, players []string) {
	m.member = map[string]bool{}
	for _, p := range players {
		m.member[p] = true
	}
	if len(players) == 0 {
		players = []string{"nobody"} // nobody is here; Tick ends the mission at once
	}
	m.order = players
	key := m.def.Variant
	if mysteryThemes[key] == nil {
		key = mysteryThemeKeys[m.rng.Intn(len(mysteryThemeKeys))]
	}
	m.theme = mysteryThemes[key]
	m.c = newMysteryCase(m.rng, m.theme, players)

	m.votes = map[string]string{}
	m.inqLeft = map[string]int{}
	m.inqLog = map[string][]string{}
	m.pressLeft = map[string]int{}
	m.pressed = map[string]bool{}
	m.verifyLeft = map[string]int{}
	m.verified = map[string]string{}
	m.tipPosted = map[string]bool{}
	m.sharp = map[string]int{}
	m.feed = []myFeed{}
	for _, p := range players {
		m.inqLeft[p] = 2
		m.pressLeft[p] = 2
		if m.c.roles[p] == "detective" {
			m.verifyLeft[p] = 1
			if len(players) >= 6 {
				m.verifyLeft[p] = 2
			}
		}
	}
	m.phase, m.phaseEnd = "intro", now.Add(mysteryIntro)
}

func (m *mysteryMission) validSlot(s int) bool { return s >= 0 && s < len(m.theme.Slots) }
func (m *mysteryMission) validRoom(r int) bool { return r >= 0 && r < len(m.theme.Rooms) }

func (m *mysteryMission) addFeed(f myFeed) {
	m.feed = append(m.feed, f)
	if len(m.feed) > 60 {
		m.feed = m.feed[len(m.feed)-60:]
	}
}

func (m *mysteryMission) randomOther(skip ...string) string {
	var pool []string
	for _, n := range m.order {
		if !containsStr(skip, n) {
			pool = append(pool, n)
		}
	}
	if len(pool) == 0 {
		return m.order[0]
	}
	return pool[m.rng.Intn(len(pool))]
}

func (m *mysteryMission) camera(room, slot int) string {
	th := m.theme
	if room == 0 {
		return fmt.Sprintf("%s at %s: no camera covers this room, so there is nothing to see.", th.Rooms[0], th.Slots[slot])
	}
	n := m.c.headcount(room, slot)
	word := "people"
	if n == 1 {
		word = "person"
	}
	return fmt.Sprintf("Camera in the %s at %s: %d %s on screen.", th.Rooms[room], th.Slots[slot], n, word)
}

func (m *mysteryMission) Handle(name string, raw json.RawMessage, now time.Time) bool {
	if !m.member[name] {
		return false
	}
	var p struct {
		Op     string `json:"op"`
		Room   int    `json:"room"`
		Slot   int    `json:"slot"`
		Target string `json:"target"`
	}
	if json.Unmarshal(raw, &p) != nil || len(p.Target) > 64 {
		return false
	}
	_, targetKnown := m.c.claims[p.Target]
	switch p.Op {
	case "inquire": // a camera reading, private to the asker (who may share it, or lie about it)
		if m.phase != "investigate" || m.inqLeft[name] <= 0 || !m.validRoom(p.Room) || !m.validSlot(p.Slot) {
			return false
		}
		m.inqLeft[name]--
		m.inqLog[name] = append(m.inqLog[name], m.camera(p.Room, p.Slot))
		return true

	case "verify": // detective only: is this claim true? the answer is public
		if m.phase != "investigate" || m.c.roles[name] != "detective" || m.verifyLeft[name] <= 0 ||
			!targetKnown || p.Target == name || !m.validSlot(p.Slot) {
			return false
		}
		key := p.Target + "|" + strconv.Itoa(p.Slot)
		if _, dup := m.verified[key]; dup {
			return false
		}
		claim := m.c.claims[p.Target][p.Slot]
		slot := m.theme.Slots[p.Slot]
		if claim.Hidden {
			m.verified[key] = "hidden"
			m.addFeed(myFeed{Kind: "verify", Target: p.Target, Slot: p.Slot,
				Text: fmt.Sprintf("The Detective could not check %s at %s: a private errand, nothing on record.", p.Target, slot)})
			return true
		}
		m.verifyLeft[name]--
		if claim.Room == m.c.loc[p.Target][p.Slot] {
			m.verified[key] = "ok"
			m.addFeed(myFeed{Kind: "verify", Target: p.Target, Slot: p.Slot,
				Text: fmt.Sprintf("VERIFIED: %s really was in the %s at %s.", p.Target, m.theme.Rooms[claim.Room], slot)})
		} else {
			m.verified[key] = "bad"
			if p.Target == m.c.culprit {
				m.exposed = true
			}
			m.addFeed(myFeed{Kind: "verify", Target: p.Target, Slot: p.Slot,
				Text: fmt.Sprintf("REFUTED: what %s said about %s is false.", p.Target, slot)})
		}
		return true

	case "tip": // anonymous tip: the witness's is true, the culprit's and trickster's are planted
		role := m.c.roles[name]
		if m.phase != "investigate" || m.tipPosted[name] || (role != "witness" && role != "culprit" && role != "trickster") {
			return false
		}
		var coat int
		truthful := false
		switch role {
		case "witness":
			coat, truthful = m.c.coat[m.c.culprit], true
		case "culprit":
			target := p.Target
			if !targetKnown || target == name {
				target = m.randomOther(name)
			}
			coat = m.c.coat[target]
		default:
			coat = m.c.coat[m.randomOther(name, m.c.culprit)]
		}
		m.tipPosted[name] = true
		m.tips = append(m.tips, myTip{ID: len(m.tips) + 1, Coat: coat, Author: name, True: truthful,
			Text: fmt.Sprintf("A figure in a %s coat was seen slipping out of the %s around %s.",
				strings.ToLower(mysteryCoats[coat]), m.theme.Rooms[0], m.theme.Slots[m.c.crimeSlot])})
		return true

	case "press": // publicly challenge someone's claim about one time slot
		if (m.phase != "alibi" && m.phase != "investigate" && m.phase != "interrogate") ||
			m.pressLeft[name] <= 0 || !targetKnown || p.Target == name || !m.validSlot(p.Slot) {
			return false
		}
		key := name + "|" + p.Target + "|" + strconv.Itoa(p.Slot)
		if m.pressed[key] {
			return false
		}
		m.pressed[key] = true
		m.pressLeft[name]--
		if p.Target == m.c.culprit && p.Slot == m.c.crimeSlot {
			m.sharp[name]++
		}
		m.addFeed(myFeed{Kind: "press", Who: name, Target: p.Target, Slot: p.Slot})
		return true

	case "vote":
		if m.phase != "vote" || !targetKnown || p.Target == name {
			return false
		}
		m.votes[name] = p.Target
		return true
	}
	return false
}

func (m *mysteryMission) Leave(name string) { delete(m.member, name) }

func (m *mysteryMission) allVoted() bool {
	for n := range m.member {
		if _, ok := m.votes[n]; !ok {
			return false
		}
	}
	return len(m.member) > 0
}

func (m *mysteryMission) Tick(now time.Time) (changed, finished bool) {
	if len(m.member) == 0 {
		m.finalize()
		return false, true
	}
	if m.phase == "vote" && m.allVoted() {
		m.advance(now)
		return true, false
	}
	if now.Before(m.phaseEnd) {
		return false, false
	}
	if m.phase == "unmask" {
		return true, true
	}
	m.advance(now)
	return true, false
}

func (m *mysteryMission) advance(now time.Time) {
	d := time.Duration(m.def.DurationMS) * time.Millisecond
	switch m.phase {
	case "intro":
		m.phase, m.phaseEnd = "alibi", now.Add(d*8/10)
	case "alibi":
		m.phase, m.phaseEnd = "investigate", now.Add(d)
	case "investigate":
		m.phase, m.phaseEnd = "interrogate", now.Add(d)
	case "interrogate":
		m.phase, m.phaseEnd = "vote", now.Add(mysteryVote)
	case "vote":
		m.finalize()
		m.phase, m.phaseEnd = "unmask", now.Add(mysteryUnmask)
	}
}

// finalize counts the votes and scores everybody. It runs once.
func (m *mysteryMission) finalize() {
	if m.final != nil {
		return
	}
	c := m.c
	counts := map[string]int{}
	for voter, target := range m.votes {
		if containsStr(m.order, voter) {
			counts[target]++
		}
	}
	best, accused, tie := 0, "", false
	for _, n := range m.order {
		switch v := counts[n]; {
		case v > best:
			best, accused, tie = v, n, false
		case v == best && v > 0:
			tie = true
		}
	}
	if tie {
		accused = ""
	}
	m.accused = accused
	m.caught = accused != "" && accused == c.culprit

	m.final = map[string]float64{}
	m.stats = map[string]string{}
	for _, n := range m.order {
		role := c.roles[n]
		vote := m.votes[n]
		v := 0.0
		line := ""
		switch role {
		case "culprit":
			fooled := 0
			for voter, target := range m.votes {
				if voter != n && target != n && containsStr(m.order, voter) {
					fooled++
				}
			}
			if m.caught {
				v = 150 + 100*float64(fooled)
				line = fmt.Sprintf("Culprit · caught, but fooled %d", fooled)
			} else {
				v = 900 + 50*float64(fooled)
				line = fmt.Sprintf("Culprit · got away, fooled %d", fooled)
			}
		case "trickster":
			if accused != "" && !m.caught {
				v = 700
				line = "Trickster · the wrong person was accused"
			} else {
				v = 200
				line = "Trickster · the culprit was caught"
			}
		default:
			if m.caught {
				v = 500
			} else {
				v = 100
			}
			right := vote == c.culprit && vote != ""
			if right {
				v += 300
			}
			sharp := m.sharp[n]
			if sharp > 2 {
				sharp = 2
			}
			v += 100 * float64(sharp)
			if role == "detective" && m.exposed {
				v += 100
			}
			if role == "witness" {
				for _, t := range m.tips {
					if t.Author == n && t.True {
						v += 100
					}
				}
			}
			verdict := "missed"
			if right {
				verdict = "spotted the culprit"
			}
			line = fmt.Sprintf("%s · %s", mysteryRoleLabel[role], verdict)
		}
		m.final[n] = v
		m.stats[n] = line
	}
	m.note = m.theme.Lesson + " " + m.explain()
}

func (m *mysteryMission) explain() string {
	c, th := m.c, m.theme
	k := c.crimeSlot
	if len(c.falseWith) == 0 {
		return fmt.Sprintf("%s was in the %s at %s.", c.culprit, th.Rooms[0], th.Slots[k])
	}
	who := "Both of them"
	if len(c.falseWith) == 1 {
		who = "They"
	}
	return fmt.Sprintf("Here, %s was really in the %s at %s, but their testimony put them in the %s with %s. %s said they were elsewhere. Those are independent statements, and two honest voices outweigh one self-serving claim.",
		c.culprit, th.Rooms[0], th.Slots[k], th.Rooms[c.falseRoom], joinNames(c.falseWith), who)
}

func (m *mysteryMission) Deadline() time.Time { return m.phaseEnd }

func (m *mysteryMission) Public() any {
	c, th := m.c, m.theme
	suspects := make([]mySuspect, 0, len(m.order))
	for _, n := range m.order {
		suspects = append(suspects, mySuspect{Name: n, Coat: c.coat[n], Job: c.job[n]})
	}
	voted := []string{}
	for _, n := range m.order {
		if _, ok := m.votes[n]; ok {
			voted = append(voted, n)
		}
	}
	sort.Strings(voted)
	tips := make([]map[string]any, 0, len(m.tips))
	for _, t := range m.tips {
		tips = append(tips, map[string]any{"id": t.ID, "coat": t.Coat, "text": t.Text})
	}
	pub := map[string]any{
		"kind": "mystery", "phase": m.phase, "theme": th.Key, "title": th.Title,
		"setting": th.Setting, "crime": th.Crime, "rooms": th.Rooms, "slots": th.Slots,
		"coats": mysteryCoats, "jobs": th.Jobs, "crime_slot": c.crimeSlot,
		"suspects": suspects, "voted": voted, "tips": tips, "feed": m.feed, "verified": m.verified,
	}
	if m.phase != "intro" {
		pub["claims"] = c.claims
	}
	if m.phase == "unmask" {
		votes := map[string]string{}
		for k, v := range m.votes {
			votes[k] = v
		}
		pub["unmask"] = map[string]any{
			"culprit": c.culprit, "accused": m.accused, "caught": m.caught, "roles": c.roles,
			"truth": c.loc, "votes": votes, "why": m.explain(), "lesson": th.Lesson,
		}
	}
	return pub
}

func (m *mysteryMission) Private(name string) any {
	role, ok := m.c.roles[name]
	if !ok || !m.member[name] {
		return nil
	}
	log := m.inqLog[name]
	if log == nil {
		log = []string{}
	}
	out := map[string]any{
		"role": role, "inquiries": m.inqLeft[name], "log": log, "press": m.pressLeft[name],
		"verify": m.verifyLeft[name], "tip_used": m.tipPosted[name], "vote": m.votes[name],
	}
	switch role {
	case "culprit":
		out["truth"] = m.c.loc[name] // the culprit knows where they really were
	case "witness":
		out["saw"] = m.c.coat[m.c.culprit]
	}
	return out
}

func (m *mysteryMission) Progress(name string) float64 {
	switch m.phase {
	case "intro":
		return 0
	case "alibi":
		return 0.2
	case "investigate":
		return 0.4
	case "interrogate":
		return 0.6
	case "vote":
		if _, ok := m.votes[name]; ok {
			return 1
		}
		return 0.8
	}
	return 1
}

func (m *mysteryMission) Raw() map[string]float64 {
	m.finalize()
	return m.final
}

func (m *mysteryMission) Stats() map[string]string {
	m.finalize()
	return m.stats
}

func (m *mysteryMission) Note() string {
	m.finalize()
	return m.note
}
