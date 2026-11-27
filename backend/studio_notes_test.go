package main

import (
	"encoding/json"
	"testing"
)

// drainOne empties one test client's outbound queue.
func drainOne(c *studioClient) {
	for {
		select {
		case <-c.send:
		default:
			return
		}
	}
}

// drain empties every test client's queue so a long test never fills one (a full queue closes the client).
func drain(cs map[string]*studioClient) {
	for _, c := range cs {
		drainOne(c)
	}
}

// relaxLimits lifts the per-member rate limits so a test that sends many messages measures the RULES, not the limiter.
func relaxLimits(r *studioRoom) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.members {
		m.bStep, m.bMisc, m.bNote = newBucket(1000, 1000), newBucket(1000, 1000), newBucket(1000, 1000)
	}
}

// lastOfType returns the newest queued message of a type for one client (and drains the queue).
func lastOfType(c *studioClient, typ string) map[string]any {
	var found map[string]any
	for {
		select {
		case b := <-c.send:
			var env map[string]any
			if json.Unmarshal(b, &env) == nil && env["type"] == typ {
				if p, ok := env["payload"].(map[string]any); ok {
					found = p
				}
			}
		default:
			return found
		}
	}
}

func notesOf(r *studioRoom) []studioNote {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]studioNote{}, r.notes...)
}

func TestNoteAddRulesAreServerSide(t *testing.T) {
	r, c := newTestRoom(t)
	relaxLimits(r)
	// A4 (69) is in A minor. The producer's note lands, stamped with THEIR name and a server-made id.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 69, "s": 0, "l": 4, "v": 90}}}))
	ns := notesOf(r)
	if len(ns) != 1 || ns[0].By != "prod" || ns[0].V != 90 || ns[0].P != 69 || ns[0].ID == 0 || ns[0].T != 1 {
		t.Fatalf("producer note not stored properly: %+v", ns)
	}
	// A listener changes nothing.
	r.handle(c["listen"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 71, "s": 8, "l": 2}}}))
	if len(notesOf(r)) != 1 {
		t.Fatal("a listener must not add notes")
	}
	// Velocity defaults when it is left out.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 71, "s": 8, "l": 2}}}))
	if ns = notesOf(r); len(ns) != 2 || ns[1].V != studioDefaultNoteV {
		t.Fatalf("default velocity wrong: %+v", ns)
	}
	// Everything malformed is refused outright.
	bad := []map[string]any{
		{"t": 3, "notes": []map[string]any{{"p": 69, "s": 20, "l": 2}}},              // no such track
		{"t": -1, "notes": []map[string]any{{"p": 69, "s": 20, "l": 2}}},             // no such track
		{"t": 1, "notes": []map[string]any{{"p": 23, "s": 20, "l": 2}}},              // below the bounded pitch range
		{"t": 1, "notes": []map[string]any{{"p": 97, "s": 20, "l": 2}}},              // above it
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": -1, "l": 2}}},              // before the start
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 64, "l": 1}}},              // 4 bars = 64 steps: past the end
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 20, "l": 0}}},              // zero length
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 60, "l": 5}}},              // runs off the end
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 20, "l": 2, "v": 0}}},      // velocity out of range
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 20, "l": 2, "v": 128}}},    // ...either side
		{"t": 1, "notes": []map[string]any{}},                                        // empty
		{"t": 1, "notes": []map[string]any{{"p": 69, "s": 20, "l": 2, "admin": true}}}, // unknown field
	}
	for i, b := range bad {
		r.handle(c["prod"], msg("note_add", b))
		if len(notesOf(r)) != 2 {
			t.Fatalf("bad[%d] got through: %+v", i, notesOf(r))
		}
	}
	r.handle(c["prod"], ClientMsg{Type: "note_add", Payload: json.RawMessage(`{"t":1,"notes":[{"p":69,"s":20,"l":2}],"extra":1}`)})
	if len(notesOf(r)) != 2 {
		t.Fatal("unknown top-level field must be rejected")
	}
}

func TestNoteKeyLockOverlapAndBatches(t *testing.T) {
	r, c := newTestRoom(t)
	relaxLimits(r)
	// A#4 (70) is not in A minor: refused while the lock is on...
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 70, "s": 0, "l": 2}}}))
	if len(notesOf(r)) != 0 {
		t.Fatal("an out-of-key note must be refused while the key lock is on")
	}
	// ...and accepted once the lock is off.
	r.handle(c["prod"], msg("key", map[string]any{"root": 9, "scale": "minor", "lock": false}))
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 70, "s": 0, "l": 2}}}))
	if len(notesOf(r)) != 1 {
		t.Fatal("with the lock off an out-of-key note is allowed")
	}
	// The same pitch cannot sound twice at once, but a different track, an adjacent note and another pitch are fine.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 70, "s": 1, "l": 2}}}))
	if len(notesOf(r)) != 1 {
		t.Fatal("overlapping notes on the same pitch must be refused")
	}
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": []map[string]any{{"p": 70, "s": 1, "l": 2}}}))
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 70, "s": 2, "l": 2}}}))
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 72, "s": 0, "l": 2}}}))
	if len(notesOf(r)) != 4 {
		t.Fatalf("legal neighbours were refused: %+v", notesOf(r))
	}
	r.handle(c["host"], msg("note_clear", map[string]any{"t": 0}))
	r.handle(c["host"], msg("note_clear", map[string]any{"t": 1}))

	// A chord is applied all or nothing.
	r.handle(c["prod"], msg("key", map[string]any{"root": 9, "scale": "minor", "lock": true}))
	chord := []map[string]any{{"p": 57, "s": 0, "l": 16}, {"p": 60, "s": 0, "l": 16}, {"p": 64, "s": 0, "l": 16}}
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": chord}))
	ns := notesOf(r)
	if len(ns) != 3 || ns[0].ID == ns[1].ID || ns[1].ID == ns[2].ID {
		t.Fatalf("chord not applied with distinct ids: %+v", ns)
	}
	// Dropping the same chord again collides with itself: nothing at all is added.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": chord}))
	if len(notesOf(r)) != 3 {
		t.Fatal("a colliding chord must not be partly applied")
	}
	// One out-of-key note poisons the whole batch.
	mixed := []map[string]any{{"p": 62, "s": 16, "l": 8}, {"p": 63, "s": 16, "l": 8}} // D is in A minor, D# is not
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": mixed}))
	if len(notesOf(r)) != 3 {
		t.Fatal("a batch with an out-of-key note must be refused whole")
	}
	// A batch is capped.
	big := make([]map[string]any, 0, studioMaxNoteBatch+1)
	for i := 0; i <= studioMaxNoteBatch; i++ {
		big = append(big, map[string]any{"p": 57, "s": 16 + i, "l": 1})
	}
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": big}))
	if len(notesOf(r)) != 3 {
		t.Fatal("an oversized batch must be refused")
	}

	// The room-wide cap: fill the pattern, then one more note is refused.
	r.mu.Lock()
	for len(r.notes) < studioMaxNotes {
		r.noteSeq++
		r.notes = append(r.notes, studioNote{ID: r.noteSeq, T: 1, P: 60, S: 40, L: 1, V: 100, By: "prod"})
	}
	r.mu.Unlock()
	drain(c)
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 2, "notes": []map[string]any{{"p": 33, "s": 0, "l": 4}}}))
	if len(notesOf(r)) != studioMaxNotes {
		t.Fatalf("the note cap was exceeded: %d", len(notesOf(r)))
	}
	if e := lastOfType(c["prod"], "error"); e == nil || e["code"] != "notes_full" {
		t.Fatalf("the producer should be told the pattern is full, got %v", e)
	}
}

func TestNoteMoveResizeVelocityDelete(t *testing.T) {
	r, c := newTestRoom(t)
	relaxLimits(r)
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 69, "s": 0, "l": 4}, {"p": 72, "s": 0, "l": 4}}}))
	ns := notesOf(r)
	if len(ns) != 2 {
		t.Fatal("setup failed")
	}
	a, b := ns[0].ID, ns[1].ID

	// Anyone with the producer role may edit a note, and it stays the original author's colour.
	r.handle(c["host"], msg("note_move", map[string]any{"id": a, "p": 71, "s": 8}))
	ns = notesOf(r)
	if ns[0].P != 71 || ns[0].S != 8 || ns[0].By != "prod" {
		t.Fatalf("move failed: %+v", ns[0])
	}
	// Out of the key (while locked), out of range, off the end, onto another note, or no id: all refused.
	for i, mv := range []map[string]any{
		{"id": a, "p": 70, "s": 8}, {"id": a, "p": 200, "s": 8}, {"id": a, "p": 71, "s": 63}, {"id": a, "p": 71, "s": -2},
		{"id": a, "p": 72, "s": 0}, {"id": 9999, "p": 71, "s": 8},
	} {
		r.handle(c["prod"], msg("note_move", mv))
		if got := notesOf(r)[0]; got.P != 71 || got.S != 8 {
			t.Fatalf("bad move %d changed the note: %+v", i, got)
		}
	}
	r.handle(c["listen"], msg("note_move", map[string]any{"id": a, "p": 72, "s": 20}))
	if got := notesOf(r)[0]; got.S != 8 {
		t.Fatal("a listener must not move notes")
	}

	// Resize.
	r.handle(c["prod"], msg("note_resize", map[string]any{"id": a, "l": 8}))
	if notesOf(r)[0].L != 8 {
		t.Fatal("resize failed")
	}
	for _, l := range []int{0, -1, 57, 9999} { // s=8: 8+57 = 65 runs off a 64-step pattern
		r.handle(c["prod"], msg("note_resize", map[string]any{"id": a, "l": l}))
		if notesOf(r)[0].L != 8 {
			t.Fatalf("bad length %d accepted", l)
		}
	}
	// Resizing into a neighbour on the same pitch is refused.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 1, "notes": []map[string]any{{"p": 71, "s": 20, "l": 2}}}))
	r.handle(c["prod"], msg("note_resize", map[string]any{"id": a, "l": 14}))
	if notesOf(r)[0].L != 8 {
		t.Fatal("a resize that overlaps must be refused")
	}

	// Velocity.
	r.handle(c["prod"], msg("note_vel", map[string]any{"id": b, "v": 33}))
	if notesOf(r)[1].V != 33 {
		t.Fatal("velocity edit failed")
	}
	for _, v := range []int{0, 128, -4} {
		r.handle(c["prod"], msg("note_vel", map[string]any{"id": b, "v": v}))
		if notesOf(r)[1].V != 33 {
			t.Fatalf("bad velocity %d accepted", v)
		}
	}

	// Delete: a listener cannot; a producer can; unknown ids are ignored; the room is told only what really went.
	r.handle(c["listen"], msg("note_del", map[string]any{"ids": []int{a}}))
	if len(notesOf(r)) != 3 {
		t.Fatal("a listener must not delete notes")
	}
	drain(c)
	r.handle(c["prod"], msg("note_del", map[string]any{"ids": []int{a, 424242}}))
	if len(notesOf(r)) != 2 {
		t.Fatal("delete failed")
	}
	ev := lastOfType(c["host"], "note_del")
	ids, _ := ev["ids"].([]any)
	if len(ids) != 1 || int(ids[0].(float64)) != a {
		t.Fatalf("the broadcast should list only the deleted id, got %v", ev)
	}
	r.handle(c["prod"], msg("note_del", map[string]any{"ids": []int{}}))
	if len(notesOf(r)) != 2 {
		t.Fatal("an empty delete must do nothing")
	}
}

func TestKeyInstrumentAndBars(t *testing.T) {
	r, c := newTestRoom(t)
	relaxLimits(r)
	if r.keyRoot != 9 || r.keyScale != "minor" || !r.keyLock || r.bars != studioDefaultBars {
		t.Fatalf("defaults wrong: %d %s %v %d", r.keyRoot, r.keyScale, r.keyLock, r.bars)
	}
	if r.instr != studioDefaultInstr {
		t.Fatalf("default instruments wrong: %v", r.instr)
	}

	// Key: allowlisted scales and 0..11 roots only.
	r.handle(c["prod"], msg("key", map[string]any{"root": 6, "scale": "major", "lock": true}))
	if r.keyRoot != 6 || r.keyScale != "major" {
		t.Fatal("key change failed")
	}
	for _, k := range []map[string]any{
		{"root": 12, "scale": "major", "lock": true}, {"root": -1, "scale": "major", "lock": true},
		{"root": 0, "scale": "../../etc", "lock": true}, {"root": 0, "scale": "", "lock": true},
	} {
		r.handle(c["prod"], msg("key", k))
		if r.keyRoot != 6 || r.keyScale != "major" {
			t.Fatalf("bad key got through: %v", k)
		}
	}
	r.handle(c["listen"], msg("key", map[string]any{"root": 0, "scale": "minor", "lock": false}))
	if r.keyRoot != 6 || !r.keyLock {
		t.Fatal("a listener must not change the key")
	}
	// F# major: F#4 (66) is in key; G4 (67) is not.
	if !r.inKey(66) || r.inKey(67) { // G natural is not in F# major (G# is)
		t.Fatal("inKey is wrong for F# major")
	}

	// Instruments: allowlist only, and the 808 lives on the bass track only.
	r.handle(c["prod"], msg("instr", map[string]any{"t": 0, "id": "epiano"}))
	if r.instr[0] != "epiano" {
		t.Fatal("instrument change failed")
	}
	for _, in := range []map[string]any{
		{"t": 0, "id": "../../etc/passwd"}, {"t": 0, "id": "nope"}, {"t": 5, "id": "piano"}, {"t": 0, "id": "sub808"}, {"t": -1, "id": "piano"},
	} {
		r.handle(c["prod"], msg("instr", in))
	}
	if r.instr[0] != "epiano" || r.instr[2] != "sub808" {
		t.Fatalf("a bad instrument message got through: %v", r.instr)
	}
	r.handle(c["listen"], msg("instr", map[string]any{"t": 1, "id": "piano"}))
	if r.instr[1] != studioDefaultInstr[1] {
		t.Fatal("a listener must not change instruments")
	}

	// Bars: host only, 1..8. A shorter pattern drops what no longer fits and trims the rest.
	r.handle(c["prod"], msg("key", map[string]any{"root": 9, "scale": "minor", "lock": true}))
	r.handle(c["prod"], msg("bars", map[string]any{"n": 8}))
	if r.bars != studioDefaultBars {
		t.Fatal("only the host may change the pattern length")
	}
	r.handle(c["host"], msg("bars", map[string]any{"n": 8}))
	if r.bars != 8 {
		t.Fatal("host bars change failed")
	}
	for _, n := range []int{0, 9, -3} {
		r.handle(c["host"], msg("bars", map[string]any{"n": n}))
		if r.bars != 8 {
			t.Fatalf("bars=%d accepted", n)
		}
	}
	// A note in bar 7, one in bar 1 that will be trimmed when we go to 2 bars, and one that spans the cut.
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": []map[string]any{{"p": 57, "s": 96, "l": 16}, {"p": 60, "s": 0, "l": 8}, {"p": 64, "s": 24, "l": 16}}}))
	if len(notesOf(r)) != 3 {
		t.Fatalf("setup failed: %+v", notesOf(r))
	}
	r.handle(c["host"], msg("bars", map[string]any{"n": 2}))
	ns := notesOf(r)
	if len(ns) != 2 {
		t.Fatalf("the note past the end should be dropped: %+v", ns)
	}
	for _, n := range ns {
		if n.S+n.L > 2*studioSteps {
			t.Fatalf("a note still runs past the new end: %+v", n)
		}
		if n.P == 64 && n.L != 8 {
			t.Fatalf("the spanning note should be trimmed to the cut, got length %d", n.L)
		}
	}
	// The snapshot a newcomer gets carries all of it.
	r.mu.Lock()
	st := r.stateLocked("prod")
	r.mu.Unlock()
	if st.Bars != 2 || st.Key.Root != 9 || st.Key.Scale != "minor" || len(st.Notes) != 2 || len(st.Instr) != studioMelodicTracks ||
		len(st.Send) != studioChannels || len(st.NVol) != studioMelodicTracks || st.DlyDiv == "" {
		t.Fatalf("state snapshot is missing the melodic fields: %+v", st)
	}
	// The drum grid is untouched by the pattern length.
	if len(st.Grid) != studioTracks || len(st.Grid[0]) != studioSteps {
		t.Fatal("the drum grid must stay 8 x 16")
	}
}

func TestSendsMixAndFilter(t *testing.T) {
	r, c := newTestRoom(t)
	relaxLimits(r)
	r.handle(c["prod"], msg("send", map[string]any{"c": 8, "rev": 70, "dly": 15}))
	if r.send[8] != [2]uint8{70, 15} {
		t.Fatalf("send not applied: %v", r.send[8])
	}
	r.handle(c["prod"], msg("send", map[string]any{"c": 8, "rev": 10})) // partial: the delay send stays
	if r.send[8] != [2]uint8{10, 15} {
		t.Fatalf("partial send wrong: %v", r.send[8])
	}
	r.handle(c["prod"], msg("send", map[string]any{"c": 1, "dly": 50})) // grid tracks have sends too
	if r.send[1][1] != 50 {
		t.Fatal("a drum track send failed")
	}
	for _, s := range []map[string]any{{"c": 11, "rev": 5}, {"c": -1, "rev": 5}, {"c": 8, "rev": 101}, {"c": 8, "dly": -1}, {"c": 8}} {
		r.handle(c["prod"], msg("send", s))
	}
	if r.send[8] != [2]uint8{10, 15} {
		t.Fatalf("a bad send got through: %v", r.send[8])
	}
	r.handle(c["listen"], msg("send", map[string]any{"c": 8, "rev": 0}))
	if r.send[8][0] != 10 {
		t.Fatal("a listener must not change sends")
	}

	r.handle(c["prod"], msg("nmix", map[string]any{"t": 2, "vol": 40, "mute": true}))
	if r.nvol[2] != 40 || !r.nmute[2] {
		t.Fatal("melodic mix failed")
	}
	for _, n := range []map[string]any{{"t": 3, "vol": 5}, {"t": 2, "vol": 101}, {"t": 2}} {
		r.handle(c["prod"], msg("nmix", n))
	}
	if r.nvol[2] != 40 {
		t.Fatal("a bad nmix got through")
	}

	r.handle(c["prod"], msg("fx", map[string]any{"filter": 30, "div": "1/4", "fb": 55}))
	if r.filter != 30 || r.dlyDiv != "1/4" || r.dlyFB != 55 {
		t.Fatalf("fx failed: %d %s %d", r.filter, r.dlyDiv, r.dlyFB)
	}
	for _, f := range []map[string]any{{"filter": 101}, {"filter": -1}, {"div": "7/3"}, {"div": "../x"}, {"fb": 91}, {}} {
		r.handle(c["prod"], msg("fx", f))
	}
	if r.filter != 30 || r.dlyDiv != "1/4" || r.dlyFB != 55 {
		t.Fatal("a bad fx message got through")
	}
	r.handle(c["listen"], msg("fx", map[string]any{"filter": 100}))
	if r.filter != 30 {
		t.Fatal("a listener must not touch the filter")
	}
}

func TestNotesAreBroadcastAndClearedWithTheGrid(t *testing.T) {
	r, c := newTestRoom(t)
	drain(c)
	r.handle(c["prod"], msg("note_add", map[string]any{"t": 0, "notes": []map[string]any{{"p": 57, "s": 0, "l": 16}}}))
	for _, who := range []string{"host", "prod", "listen"} {
		ev := lastOfType(c[who], "note_add")
		if ev == nil || ev["by"] != "prod" {
			t.Fatalf("%s did not receive the note_add broadcast: %v", who, ev)
		}
		list, _ := ev["notes"].([]any)
		if len(list) != 1 {
			t.Fatalf("%s got %d notes", who, len(list))
		}
	}
	r.handle(c["host"], msg("clear", nil))
	if len(notesOf(r)) != 0 {
		t.Fatal("clear should empty the note list too")
	}
}
