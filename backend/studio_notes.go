package main

import "encoding/json"

// ---------------------------------------------------------------------------
// Starship Studio, Phase 2A: the melody core.
//
// The step grid stays for drums. Next to it the room keeps a validated NOTE LIST for three melodic
// tracks (chords, melody, bass/808), plus the room's key, one instrument per melodic track, shared
// reverb/delay sends and a master filter. Same rules as the grid: only producers edit, every message
// is decoded strictly, every number is bounds-checked, and the server tells everybody what happened.
//
//	client -> server
//	  note_add{t, notes:[{p,s,l,v?}]}   one note, or a whole chord / arpeggio, applied all-or-nothing
//	  note_move{id,p,s}  note_resize{id,l}  note_vel{id,v}  note_del{ids:[...]}
//	  note_clear{t}                      host only
//	  key{root,scale,lock}  instr{t,id}  bars{n} (host only)
//	  send{c,rev?,dly?}  nmix{t,vol?,mute?}  fx{filter?,div?,fb?}
//
//	server -> client   the same names, carrying the same fields plus "by" (and ids for new notes).
//	                   bars is answered with a full state, because shrinking the pattern prunes notes.
//
// Units: p is a MIDI pitch (60 = middle C), s and l are in sixteenth-note steps, v is 1..127.
// ---------------------------------------------------------------------------

const (
	studioMelodicTracks = 3 // 0 chords, 1 melody, 2 bass/808
	studioChannels      = studioTracks + studioMelodicTracks
	studioMinBars       = 1
	studioMaxBars       = 8
	studioDefaultBars   = 4
	studioMaxNotes      = 256 // per pattern, all three tracks together
	studioMaxNoteBatch  = 32  // one chord or arpeggio
	studioMaxNoteDel    = 64
	studioMinPitch      = 24 // C1
	studioMaxPitch      = 96 // C7
	studioDefaultNoteV  = 100
	studioMaxDelayFB   = 90 // delay feedback, percent
)

// studioScales is the allowlist of scales: semitone offsets from the key's root. The frontend has the
// same table in theory.ts; keep them identical (scripts/check-theory-parity.mjs compares them).
var studioScales = map[string][]int{
	"major":          {0, 2, 4, 5, 7, 9, 11},
	"minor":          {0, 2, 3, 5, 7, 8, 10},
	"harmonic_minor": {0, 2, 3, 5, 7, 8, 11},
	"dorian":         {0, 2, 3, 5, 7, 9, 10},
	"phrygian":       {0, 1, 3, 5, 7, 8, 10},
	"lydian":         {0, 2, 4, 6, 7, 9, 11},
	"mixolydian":     {0, 2, 4, 5, 7, 9, 10},
	"pent_minor":     {0, 3, 5, 7, 10},
	"pent_major":     {0, 2, 4, 7, 9},
	"blues":          {0, 3, 5, 6, 7, 10},
}

// studioInstruments is the allowlist of instrument ids. The client loads sample packs from
// public/studio-instruments/<id>/ when they exist and falls back to a built-in synth when they do
// not. An id is only ever a map key here, never a path. The sub 808 is a bass voice: bass track only.
var studioInstruments = map[string]bool{
	"piano": true, "epiano": true, "pad": true, "pluck": true, "bell": true, "lead": true, "sub808": true,
}

var studioDefaultInstr = [studioMelodicTracks]string{"piano", "bell", "sub808"}

// studioDelayDivs are the tempo-synced delay times. The client turns them into seconds from the room's BPM.
var studioDelayDivs = map[string]bool{"1/4": true, "1/8": true, "1/8d": true, "1/16": true}

const studioDefaultDelayDiv = "1/8d"

type studioNote struct {
	ID int    `json:"id"`
	T  int    `json:"t"` // melodic track 0..2
	P  int    `json:"p"` // MIDI pitch
	S  int    `json:"s"` // start, in sixteenths from the top of the pattern
	L  int    `json:"l"` // length, in sixteenths
	V  int    `json:"v"` // velocity 1..127
	By string `json:"by"`
}

type studioRoomKey struct {
	Root  int    `json:"root"` // 0 = C .. 11 = B
	Scale string `json:"scale"`
	Lock  bool   `json:"lock"`
}

// initMusic sets the defaults for a new room: A minor with the lock on, 4 bars, the first instrument set,
// and a little reverb and echo on the melodic tracks (this is what makes a piano loop sound spacious).
func (r *studioRoom) initMusic() {
	r.bars = studioDefaultBars
	r.keyRoot = 9
	r.keyScale = "minor"
	r.keyLock = true
	r.instr = studioDefaultInstr
	for i := range r.nvol {
		r.nvol[i] = studioDefaultVol
	}
	r.filter = 100
	r.dlyDiv = studioDefaultDelayDiv
	r.dlyFB = 40
	r.send[studioTracks+0] = [2]uint8{35, 10}
	r.send[studioTracks+1] = [2]uint8{30, 25}
	r.send[studioTracks+2] = [2]uint8{0, 0}
}

func (r *studioRoom) loopSteps() int { return r.bars * studioSteps }

// inKey is true when the pitch belongs to the room's scale, or when the lock is off.
func (r *studioRoom) inKey(p int) bool {
	if !r.keyLock {
		return true
	}
	rel := ((p-r.keyRoot)%12 + 12) % 12
	for _, d := range studioScales[r.keyScale] {
		if d == rel {
			return true
		}
	}
	return false
}

// noteFits checks everything about a note that does not depend on the other notes.
func (r *studioRoom) noteFits(t, p, s, l int) bool {
	return t >= 0 && t < studioMelodicTracks &&
		p >= studioMinPitch && p <= studioMaxPitch &&
		s >= 0 && l >= 1 && s+l <= r.loopSteps()
}

func notesOverlap(a, b studioNote) bool {
	return a.T == b.T && a.P == b.P && a.S < b.S+b.L && b.S < a.S+a.L
}

// overlapsLocked: the same pitch on the same track may not sound twice at once. skipID is the note being
// moved or resized (it must not collide with itself); extra holds notes of the same batch not yet stored.
func (r *studioRoom) overlapsLocked(n studioNote, skipID int, extra []studioNote) bool {
	for _, o := range r.notes {
		if o.ID != skipID && notesOverlap(n, o) {
			return true
		}
	}
	for _, o := range extra {
		if notesOverlap(n, o) {
			return true
		}
	}
	return false
}

func (r *studioRoom) noteIndexLocked(id int) int {
	for i := range r.notes {
		if r.notes[i].ID == id {
			return i
		}
	}
	return -1
}

// fillMusicLocked adds the melodic parts to a state snapshot.
func (r *studioRoom) fillMusicLocked(v *studioStateView) {
	v.Bars = r.bars
	v.Key = studioRoomKey{Root: r.keyRoot, Scale: r.keyScale, Lock: r.keyLock}
	v.Notes = append([]studioNote{}, r.notes...)
	v.Instr = append([]string{}, r.instr[:]...)
	v.Send = make([][]int, studioChannels)
	for c := 0; c < studioChannels; c++ {
		v.Send[c] = []int{int(r.send[c][0]), int(r.send[c][1])}
	}
	v.NVol = make([]int, studioMelodicTracks)
	v.NMute = make([]bool, studioMelodicTracks)
	for t := 0; t < studioMelodicTracks; t++ {
		v.NVol[t] = int(r.nvol[t])
		v.NMute[t] = r.nmute[t]
	}
	v.Filter = int(r.filter)
	v.DlyDiv = r.dlyDiv
	v.DlyFB = int(r.dlyFB)
}

// musicLocked handles every Phase 2A message. The caller holds r.mu and has already checked that the
// sender is a connected member of this room.
func (r *studioRoom) musicLocked(m *studioMember, typ string, p json.RawMessage, nowMs int64) {
	if !r.isProducer(m) {
		return // listeners hear and watch; they change nothing
	}
	switch typ {

	case "note_add":
		var v struct {
			T     int `json:"t"`
			Notes []struct {
				P int  `json:"p"`
				S int  `json:"s"`
				L int  `json:"l"`
				V *int `json:"v"`
			} `json:"notes"`
		}
		if !m.bNote.allow() || !decodeStrict(p, &v) || v.T < 0 || v.T >= studioMelodicTracks ||
			len(v.Notes) < 1 || len(v.Notes) > studioMaxNoteBatch || len(r.notes)+len(v.Notes) > studioMaxNotes {
			if len(r.notes)+len(v.Notes) > studioMaxNotes {
				r.errLocked(m, "notes_full", "This pattern is full. Delete a few notes first.", nil)
			}
			return
		}
		added := make([]studioNote, 0, len(v.Notes))
		for _, in := range v.Notes {
			vel := studioDefaultNoteV
			if in.V != nil {
				vel = *in.V
			}
			n := studioNote{T: v.T, P: in.P, S: in.S, L: in.L, V: vel, By: m.name}
			if !r.noteFits(n.T, n.P, n.S, n.L) || vel < 1 || vel > 127 {
				return
			}
			if !r.inKey(n.P) {
				r.errLocked(m, "out_of_key", "That note is outside the key. Turn the key lock off to play it.", nil)
				return
			}
			if r.overlapsLocked(n, 0, added) {
				r.errLocked(m, "overlap", "That pitch is already playing there.", nil)
				return
			}
			added = append(added, n)
		}
		// Everything passed: only now do the notes get ids and join the pattern (all or nothing).
		for i := range added {
			r.noteSeq++
			added[i].ID = r.noteSeq
		}
		r.notes = append(r.notes, added...)
		r.broadcastLocked("note_add", map[string]any{"notes": added, "by": m.name, "at": nowMs})

	case "note_move":
		var v struct {
			ID int `json:"id"`
			P  int `json:"p"`
			S  int `json:"s"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) {
			return
		}
		i := r.noteIndexLocked(v.ID)
		if i < 0 {
			return
		}
		n := r.notes[i]
		n.P, n.S = v.P, v.S
		if n.P == r.notes[i].P && n.S == r.notes[i].S {
			return
		}
		if !r.noteFits(n.T, n.P, n.S, n.L) {
			return
		}
		if n.P != r.notes[i].P && !r.inKey(n.P) {
			r.errLocked(m, "out_of_key", "That note is outside the key. Turn the key lock off to play it.", nil)
			return
		}
		if r.overlapsLocked(n, n.ID, nil) {
			return
		}
		r.notes[i] = n
		r.broadcastLocked("note_move", map[string]any{"id": n.ID, "p": n.P, "s": n.S, "by": m.name})

	case "note_resize":
		var v struct {
			ID int `json:"id"`
			L  int `json:"l"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) {
			return
		}
		i := r.noteIndexLocked(v.ID)
		if i < 0 || r.notes[i].L == v.L {
			return
		}
		n := r.notes[i]
		n.L = v.L
		if !r.noteFits(n.T, n.P, n.S, n.L) || r.overlapsLocked(n, n.ID, nil) {
			return
		}
		r.notes[i] = n
		r.broadcastLocked("note_resize", map[string]any{"id": n.ID, "l": n.L, "by": m.name})

	case "note_vel":
		var v struct {
			ID int `json:"id"`
			V  int `json:"v"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) || v.V < 1 || v.V > 127 {
			return
		}
		i := r.noteIndexLocked(v.ID)
		if i < 0 || r.notes[i].V == v.V {
			return
		}
		r.notes[i].V = v.V
		r.broadcastLocked("note_vel", map[string]any{"id": v.ID, "v": v.V, "by": m.name})

	case "note_del":
		var v struct {
			IDs []int `json:"ids"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) || len(v.IDs) < 1 || len(v.IDs) > studioMaxNoteDel {
			return
		}
		gone := make([]int, 0, len(v.IDs))
		for _, id := range v.IDs {
			if i := r.noteIndexLocked(id); i >= 0 {
				r.notes = append(r.notes[:i], r.notes[i+1:]...)
				gone = append(gone, id)
			}
		}
		if len(gone) > 0 {
			r.broadcastLocked("note_del", map[string]any{"ids": gone, "by": m.name})
		}

	case "note_clear":
		var v struct {
			T int `json:"t"`
		}
		if m.role != roleHost || !m.bMisc.allow() || !decodeStrict(p, &v) || v.T < 0 || v.T >= studioMelodicTracks {
			return
		}
		kept := r.notes[:0]
		for _, n := range r.notes {
			if n.T != v.T {
				kept = append(kept, n)
			}
		}
		r.notes = kept
		r.syncLocked()

	case "key":
		var v struct {
			Root  int    `json:"root"`
			Scale string `json:"scale"`
			Lock  bool   `json:"lock"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) || v.Root < 0 || v.Root > 11 || studioScales[v.Scale] == nil {
			return
		}
		if v.Root == r.keyRoot && v.Scale == r.keyScale && v.Lock == r.keyLock {
			return
		}
		r.keyRoot, r.keyScale, r.keyLock = v.Root, v.Scale, v.Lock
		r.broadcastLocked("key", map[string]any{"root": v.Root, "scale": v.Scale, "lock": v.Lock, "by": m.name})

	case "instr":
		var v struct {
			T  int    `json:"t"`
			ID string `json:"id"`
		}
		if !m.bMisc.allow() || !decodeStrict(p, &v) || v.T < 0 || v.T >= studioMelodicTracks || !studioInstruments[v.ID] ||
			(v.ID == "sub808" && v.T != 2) || r.instr[v.T] == v.ID {
			return
		}
		r.instr[v.T] = v.ID
		r.broadcastLocked("instr", map[string]any{"t": v.T, "id": v.ID, "by": m.name})

	case "bars":
		var v struct {
			N int `json:"n"`
		}
		if m.role != roleHost || !m.bMisc.allow() || !decodeStrict(p, &v) || v.N < studioMinBars || v.N > studioMaxBars || v.N == r.bars {
			return
		}
		r.bars = v.N
		// A shorter pattern loses what no longer fits: notes starting past the end go, the rest are trimmed.
		limit := r.loopSteps()
		kept := r.notes[:0]
		for _, n := range r.notes {
			if n.S >= limit {
				continue
			}
			if n.S+n.L > limit {
				n.L = limit - n.S
			}
			kept = append(kept, n)
		}
		r.notes = kept
		r.syncLocked()

	case "send":
		var v struct {
			C   int  `json:"c"`
			Rev *int `json:"rev"`
			Dly *int `json:"dly"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) || v.C < 0 || v.C >= studioChannels || (v.Rev == nil && v.Dly == nil) ||
			(v.Rev != nil && (*v.Rev < 0 || *v.Rev > 100)) || (v.Dly != nil && (*v.Dly < 0 || *v.Dly > 100)) {
			return
		}
		if v.Rev != nil {
			r.send[v.C][0] = uint8(*v.Rev)
		}
		if v.Dly != nil {
			r.send[v.C][1] = uint8(*v.Dly)
		}
		r.broadcastLocked("send", map[string]any{"c": v.C, "rev": int(r.send[v.C][0]), "dly": int(r.send[v.C][1]), "by": m.name})

	case "nmix":
		var v struct {
			T    int   `json:"t"`
			Vol  *int  `json:"vol"`
			Mute *bool `json:"mute"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) || v.T < 0 || v.T >= studioMelodicTracks || (v.Vol == nil && v.Mute == nil) ||
			(v.Vol != nil && (*v.Vol < 0 || *v.Vol > 100)) {
			return
		}
		if v.Vol != nil {
			r.nvol[v.T] = uint8(*v.Vol)
		}
		if v.Mute != nil {
			r.nmute[v.T] = *v.Mute
		}
		r.broadcastLocked("nmix", map[string]any{"t": v.T, "vol": int(r.nvol[v.T]), "mute": r.nmute[v.T], "by": m.name})

	case "fx":
		var v struct {
			Filter *int    `json:"filter"`
			Div    *string `json:"div"`
			FB     *int    `json:"fb"`
		}
		if !m.bStep.allow() || !decodeStrict(p, &v) || (v.Filter == nil && v.Div == nil && v.FB == nil) ||
			(v.Filter != nil && (*v.Filter < 0 || *v.Filter > 100)) ||
			(v.Div != nil && !studioDelayDivs[*v.Div]) ||
			(v.FB != nil && (*v.FB < 0 || *v.FB > studioMaxDelayFB)) {
			return
		}
		if v.Filter != nil {
			r.filter = uint8(*v.Filter)
		}
		if v.Div != nil {
			r.dlyDiv = *v.Div
		}
		if v.FB != nil {
			r.dlyFB = uint8(*v.FB)
		}
		r.broadcastLocked("fx", map[string]any{"filter": int(r.filter), "div": r.dlyDiv, "fb": int(r.dlyFB), "by": m.name})
	}
}
