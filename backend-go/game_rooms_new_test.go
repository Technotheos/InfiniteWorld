package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"testing"
	"time"
)

// Tests for the Brain Bazaar and Midnight Mystery rooms. Like the other mission
// tests they use a fake clock: no sleeping, no sockets.

func jraw(s string) json.RawMessage { return json.RawMessage(s) }

func TestNewRoomMapsLoad(t *testing.T) {
	maps, err := LoadMaps()
	if err != nil {
		t.Fatal(err)
	}
	bz, my := maps["brain-bazaar"], maps["midnight-mystery"]
	if bz == nil || my == nil {
		t.Fatal("missing brain-bazaar or midnight-mystery")
	}
	if len(bz.Missions) != 3 || len(my.Missions) != 2 {
		t.Fatalf("unexpected mission counts: %d, %d", len(bz.Missions), len(my.Missions))
	}
	if my.MinPlayers != 4 || my.MaxPlayers != 6 {
		t.Fatal("midnight-mystery is a 4-6 player room")
	}
}

func TestNewMissionKindsValidate(t *testing.T) {
	bad := map[string]MissionDef{
		"bazaar no variant": {Kind: "bazaar", Title: "b"},
		"bazaar rounds":     {Kind: "bazaar", Title: "b", Variant: "fib", Rounds: 99},
		"mystery variant":   {Kind: "mystery", Title: "m", Variant: "castle"},
	}
	for name, d := range bad {
		d := d
		if err := d.normalize(); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
	ok := MissionDef{Kind: "mystery", Title: "m"}
	if err := ok.normalize(); err != nil || ok.DurationMS == 0 {
		t.Fatalf("a bare mystery mission should get defaults: %v", err)
	}
}

// ---- Midnight Mystery ------------------------------------------------------

func TestMysteryCasesAreSolvable(t *testing.T) {
	names := []string{"ann", "ben", "cy", "dee", "eli", "fay"}
	for _, key := range mysteryThemeKeys {
		th := mysteryThemes[key]
		for n := 4; n <= 6; n++ {
			for seed := int64(1); seed <= 120; seed++ {
				c := newMysteryCase(rand.New(rand.NewSource(seed)), th, names[:n])
				if !c.solvable() {
					t.Fatalf("%s n=%d seed=%d: case cannot be solved by logic", key, n, seed)
				}
				counts := map[string]int{}
				for _, p := range c.names {
					counts[c.roles[p]]++
				}
				if counts["culprit"] != 1 || counts["detective"] != 1 || counts["witness"] != 1 {
					t.Fatalf("%s n=%d seed=%d: bad role split %v", key, n, seed, counts)
				}
				if (n >= 6) != (counts["trickster"] == 1) {
					t.Fatalf("%s n=%d seed=%d: trickster only appears with 6 players: %v", key, n, seed, counts)
				}
				k := c.crimeSlot
				if k < 1 || k > len(th.Slots)-2 || c.loc[c.culprit][k] != 0 {
					t.Fatalf("%s n=%d seed=%d: culprit must be at the scene during the crime", key, n, seed)
				}
				if c.claims[c.culprit][k].Room == 0 {
					t.Fatalf("%s n=%d seed=%d: the culprit must lie about the crime slot", key, n, seed)
				}
				for _, p := range c.names {
					for s, claim := range c.claims[p] {
						if claim.Hidden {
							if c.roles[p] != "trickster" || s == k {
								t.Fatalf("%s n=%d seed=%d: only the trickster hides, never at the crime slot", key, n, seed)
							}
							continue
						}
						if p != c.culprit || s != k {
							if claim.Room != c.loc[p][s] {
								t.Fatalf("%s n=%d seed=%d: %s tells a lie they should not", key, n, seed, p)
							}
						}
					}
				}
			}
		}
	}
}

func TestMysteryFullRound(t *testing.T) {
	def := &MissionDef{Kind: "mystery", Title: "M", Variant: "museum", DurationMS: 1000}
	if err := def.normalize(); err != nil {
		t.Fatal(err)
	}
	m := &mysteryMission{def: def, rng: rand.New(rand.NewSource(7))}
	players := []string{"ann", "ben", "cy", "dee", "eli"}
	now := time.Unix(1000, 0)
	m.Start(now, players)
	if m.phase != "intro" {
		t.Fatalf("expected intro, got %s", m.phase)
	}

	var culprit, detective, witness, innocent string
	for _, p := range players {
		switch m.c.roles[p] {
		case "culprit":
			culprit = p
		case "detective":
			detective = p
		case "witness":
			witness = p
		default:
			innocent = p
		}
	}
	if culprit == "" || detective == "" || witness == "" || innocent == "" {
		t.Fatalf("roles missing: %v", m.c.roles)
	}

	// testimony stays secret during the intro, and actions only work in their own phase
	if _, ok := m.Public().(map[string]any)["claims"]; ok {
		t.Fatal("claims must not be public during the intro")
	}
	if m.Handle("ann", jraw(`{"op":"inquire","room":1,"slot":0}`), now) {
		t.Fatal("a camera inquiry before the investigation must be refused")
	}
	step := func(d time.Duration) {
		now = now.Add(d)
		m.Tick(now)
	}
	slice := time.Duration(def.DurationMS) * time.Millisecond

	step(mysteryIntro + time.Millisecond)
	if m.phase != "alibi" {
		t.Fatalf("expected alibi, got %s", m.phase)
	}
	if _, ok := m.Public().(map[string]any)["claims"]; !ok {
		t.Fatal("claims should be public once the alibi phase starts")
	}

	press := fmt.Sprintf(`{"op":"press","target":%q,"slot":%d}`, culprit, m.c.crimeSlot)
	if !m.Handle(detective, jraw(press), now) {
		t.Fatal("pressing a suspect should work")
	}
	if m.Handle(detective, jraw(press), now) {
		t.Fatal("pressing the same claim twice must be refused")
	}

	step(slice*8/10 + time.Millisecond)
	if m.phase != "investigate" {
		t.Fatalf("expected investigate, got %s", m.phase)
	}
	for i := 0; i < 2; i++ {
		if !m.Handle("ann", jraw(`{"op":"inquire","room":1,"slot":1}`), now) {
			t.Fatal("two camera inquiries are allowed")
		}
	}
	if m.Handle("ann", jraw(`{"op":"inquire","room":1,"slot":1}`), now) {
		t.Fatal("a third camera inquiry must be refused")
	}
	if got := m.Private("ann").(map[string]any)["log"].([]string); len(got) != 2 {
		t.Fatalf("expected two camera readings, got %v", got)
	}

	verify := fmt.Sprintf(`{"op":"verify","target":%q,"slot":%d}`, culprit, m.c.crimeSlot)
	if m.Handle(witness, jraw(verify), now) {
		t.Fatal("only the detective may verify")
	}
	if !m.Handle(detective, jraw(verify), now) {
		t.Fatal("the detective should be able to verify")
	}
	if m.verified[culprit+"|"+strconv.Itoa(m.c.crimeSlot)] != "bad" || !m.exposed {
		t.Fatal("the culprit's lie about the crime slot must be refuted")
	}

	if !m.Handle(witness, jraw(`{"op":"tip"}`), now) {
		t.Fatal("the witness may post a tip")
	}
	frame := fmt.Sprintf(`{"op":"tip","target":%q}`, innocent)
	if !m.Handle(culprit, jraw(frame), now) {
		t.Fatal("the culprit may plant a tip")
	}
	if m.Handle(detective, jraw(`{"op":"tip"}`), now) {
		t.Fatal("the detective has no tip to post")
	}
	if m.tips[0].Coat != m.c.coat[culprit] || m.tips[1].Coat != m.c.coat[innocent] {
		t.Fatal("witness tips are true, planted tips frame someone else")
	}
	if m.Private(culprit).(map[string]any)["role"] != "culprit" || m.Private(witness).(map[string]any)["role"] != "witness" {
		t.Fatal("each player must see their own role")
	}

	step(slice + time.Millisecond)
	step(slice + time.Millisecond)
	if m.phase != "vote" {
		t.Fatalf("expected vote, got %s", m.phase)
	}
	if m.Handle(culprit, jraw(fmt.Sprintf(`{"op":"vote","target":%q}`, culprit)), now) {
		t.Fatal("nobody may vote for themselves")
	}
	for _, p := range players {
		target := culprit
		if p == culprit {
			target = innocent
		}
		if !m.Handle(p, jraw(fmt.Sprintf(`{"op":"vote","target":%q}`, target)), now) {
			t.Fatalf("%s could not vote", p)
		}
	}
	m.Tick(now) // everyone has voted: no need to wait for the timer
	if m.phase != "unmask" || !m.caught {
		t.Fatalf("expected the culprit to be caught in the unmask phase, got %s caught=%v", m.phase, m.caught)
	}
	if m.Public().(map[string]any)["unmask"] == nil {
		t.Fatal("the unmask data must be public after the vote")
	}
	raw := m.Raw()
	if raw[culprit] >= raw[detective] {
		t.Fatalf("a caught culprit should score below the detective who exposed them: %v", raw)
	}
	if m.Note() == "" || m.Stats()[culprit] == "" {
		t.Fatal("the unmask must teach something and describe each player")
	}
	now = now.Add(mysteryUnmask + time.Millisecond)
	if _, fin := m.Tick(now); !fin {
		t.Fatal("the mission should finish after the unmask")
	}
}

func TestMysteryTieLetsCulpritEscape(t *testing.T) {
	def := &MissionDef{Kind: "mystery", Title: "M", DurationMS: 1000}
	if err := def.normalize(); err != nil {
		t.Fatal(err)
	}
	m := &mysteryMission{def: def, rng: rand.New(rand.NewSource(11))}
	players := []string{"ann", "ben", "cy", "dee"}
	m.Start(time.Unix(0, 0), players)
	m.votes = map[string]string{"ann": "ben", "ben": "cy", "cy": "dee", "dee": "ann"} // 1-1-1-1
	m.finalize()
	if m.caught || m.accused != "" {
		t.Fatal("a tied vote must not accuse anyone")
	}
	if raw := m.Raw(); raw[m.c.culprit] < 900 {
		t.Fatalf("a culprit who gets away should score high, got %v", raw[m.c.culprit])
	}
}

// ---- Brain Bazaar ----------------------------------------------------------

func newBazaar(t *testing.T, variant string, rounds int, players []string) (*bazaarMission, time.Time) {
	t.Helper()
	def := &MissionDef{Kind: "bazaar", Title: "B", Variant: variant, Rounds: rounds, DurationMS: 1000}
	if err := def.normalize(); err != nil {
		t.Fatal(err)
	}
	m := &bazaarMission{def: def, rng: rand.New(rand.NewSource(3))}
	now := time.Unix(2000, 0)
	m.Start(now, players)
	m.event, m.struck, m.hint = eventNone, -1, "" // make the payouts deterministic
	return m, now
}

func TestBazaarFibRound(t *testing.T) {
	m, now := newBazaar(t, "fib", 2, []string{"ann", "ben"})
	if m.status != "ask" || len(m.options) != 4 {
		t.Fatalf("round should be open with four statements, got %s / %d", m.status, len(m.options))
	}
	if m.Handle("ann", jraw(`{"op":"answer","value":9,"bet":1}`), now) {
		t.Fatal("an out-of-range answer must be refused")
	}
	if m.Handle("ann", jraw(`{"op":"answer","value":1,"bet":7}`), now) {
		t.Fatal("an invalid bet must be refused")
	}
	if m.Handle("zed", jraw(`{"op":"answer","value":1,"bet":1}`), now) {
		t.Fatal("a stranger cannot play")
	}
	wrong := (m.correct + 1) % 4
	if !m.Handle("ann", jraw(fmt.Sprintf(`{"op":"answer","value":%d,"bet":3}`, m.correct)), now) {
		t.Fatal("ann's answer should be accepted")
	}
	if !m.Handle("ben", jraw(fmt.Sprintf(`{"op":"answer","value":%d,"bet":2}`, wrong)), now) {
		t.Fatal("ben's answer should be accepted")
	}
	if m.Handle("ann", jraw(fmt.Sprintf(`{"op":"answer","value":%d,"bet":1}`, wrong)), now) {
		t.Fatal("only one answer per round")
	}
	if _, fin := m.Tick(now); fin || m.status != "between" {
		t.Fatalf("everyone answered, the round should resolve (status %s)", m.status)
	}
	if m.net["ann"] < 200 || m.net["ann"] > 250 {
		t.Fatalf("an all-in right answer pays 200 plus a speed bonus, got %d", m.net["ann"])
	}
	if m.net["ben"] != -100 {
		t.Fatalf("a wrong 100-coin bet costs 100, got %d", m.net["ben"])
	}
	if m.penaltyName != "ben" {
		t.Fatalf("the biggest loser gets the wacky penalty, got %q", m.penaltyName)
	}
	if raw := m.Raw(); raw["ben"] != 0 || raw["ann"] <= 0 {
		t.Fatalf("raw scores must never go negative: %v", raw)
	}
	if m.Public().(map[string]any)["answer"] == nil {
		t.Fatal("the answer and explanation are shown between rounds")
	}

	now = now.Add(bazaarBetween + time.Millisecond)
	if ch, fin := m.Tick(now); !ch || fin || m.round != 1 || m.status != "ask" {
		t.Fatalf("expected round 2 to open (round=%d status=%s)", m.round, m.status)
	}
	now = now.Add(1001 * time.Millisecond) // nobody answers: time runs out
	m.Tick(now)
	if m.status != "between" {
		t.Fatalf("an unanswered round must still resolve, got %s", m.status)
	}
	now = now.Add(bazaarBetween + time.Millisecond)
	if _, fin := m.Tick(now); !fin {
		t.Fatal("the mission should finish after the last round")
	}
}

func TestBazaarEstimateTiers(t *testing.T) {
	m, now := newBazaar(t, "estimate", 1, []string{"ann", "ben", "cy"})
	truth, span := m.est.Answer, m.est.Span
	guess := func(name string, v float64, bet int) {
		t.Helper()
		if !m.Handle(name, jraw(fmt.Sprintf(`{"op":"answer","value":%v,"bet":%d}`, v, bet)), now) {
			t.Fatalf("%s's guess was refused", name)
		}
	}
	guess("ann", truth, 2)            // bullseye: double the stake, plus the closest-guess bonus
	guess("ben", truth+span*0.10, 1)  // close: the stake
	guess("cy", truth+span*2, 3)      // far off: lose the stake
	m.Tick(now)
	if m.net["ann"] != 240 || m.net["ben"] != 50 || m.net["cy"] != -200 {
		t.Fatalf("unexpected payouts: %v", m.net)
	}
	if m.penaltyName != "cy" {
		t.Fatalf("cy lost the most, got penalty for %q", m.penaltyName)
	}
}

func TestBazaarMarketEvents(t *testing.T) {
	m, now := newBazaar(t, "chain", 1, []string{"ann", "ben"})
	m.event = eventBull
	wrong := (m.correct + 1) % 4
	m.Handle("ann", jraw(fmt.Sprintf(`{"op":"answer","value":%d,"bet":1}`, m.correct)), now)
	m.Handle("ben", jraw(fmt.Sprintf(`{"op":"answer","value":%d,"bet":1}`, wrong)), now)
	m.Tick(now)
	if m.net["ann"] < 100 || m.net["ben"] != -50 {
		t.Fatalf("a bull market doubles wins but not losses: %v", m.net)
	}
}
