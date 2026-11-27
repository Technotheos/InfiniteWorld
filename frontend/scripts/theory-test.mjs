// Tests for src/studio/theory.ts.  Run:  node --experimental-strip-types scripts/theory-test.mjs
// (Node 22.6+; no dependencies.)
import assert from 'node:assert/strict';
import * as T from '../src/studio/theory.ts';
import * as I from '../src/studio/instruments.ts';

const Am = { root: 9, scale: 'minor', lock: true };
const Fsm = { root: 6, scale: 'major', lock: true };
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('inScale: A minor', () => {
  for (const p of [57, 59, 60, 62, 64, 65, 67, 69]) assert.ok(T.inScale(9, 'minor', p), `${p}`);
  for (const p of [58, 61, 63, 66, 68]) assert.ok(!T.inScale(9, 'minor', p), `${p}`);
});

ok('inScale: F# major has E# (F) but not G', () => {
  assert.ok(T.inScale(6, 'major', 65));
  assert.ok(!T.inScale(6, 'major', 67));
});

ok('snapToScale lands in key, nearest, ties go down, stays in range', () => {
  for (const sc of T.SCALE_IDS) for (let root = 0; root < 12; root++) for (let p = T.PITCH_MIN; p <= T.PITCH_MAX; p++) {
    const s = T.snapToScale(root, sc, p);
    assert.ok(T.inScale(root, sc, s) && s >= T.PITCH_MIN && s <= T.PITCH_MAX, `${sc} ${root} ${p} -> ${s}`);
    assert.ok(Math.abs(s - p) <= 2, `${sc} ${root} ${p} -> ${s} moved too far`);
  }
  assert.equal(T.snapToScale(9, 'minor', 70), 69); // A# -> tie between A and B: down
  assert.equal(T.snapToScale(9, 'minor', 61), 60); // C# -> C
  assert.equal(T.snapToScale(9, 'minor', 100), 96 - 0 > 0 ? T.snapToScale(9, 'minor', 96) : 0);
});

ok('lockPitch respects the lock', () => {
  assert.equal(T.lockPitch(Am, 70), 69);
  assert.equal(T.lockPitch({ ...Am, lock: false }, 70), 70);
});

ok('spelling follows the relative major', () => {
  assert.equal(T.keyLabel({ root: 9, scale: 'minor', lock: true }), 'A minor');
  assert.equal(T.keyLabel({ root: 6, scale: 'major', lock: true }), 'F♯ major');
  assert.equal(T.keyLabel({ root: 2, scale: 'minor', lock: true }), 'D minor');
  assert.ok(T.usesFlats(2, 'minor')); // D minor -> F major -> B♭
  assert.ok(!T.usesFlats(9, 'minor'));
  assert.equal(T.noteName(60), 'C4');
  assert.equal(T.noteName(70, true), 'B♭4');
});

ok('A minor palette: Am Bdim C Dm Em F G', () => {
  assert.deepEqual(T.chordPalette(Am, false).map((c) => c.name), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.deepEqual(T.chordPalette(Am, false).map((c) => c.numeral), ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
});

ok('A minor sevenths', () => {
  assert.deepEqual(T.chordPalette(Am, true).map((c) => c.name), ['Am7', 'Bm7♭5', 'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7']);
});

ok('F# major palette', () => {
  assert.deepEqual(T.chordPalette(Fsm, false).map((c) => c.name), ['F♯', 'G♯m', 'A♯m', 'B', 'C♯', 'D♯m', 'Fdim']); // the vii° is spelled Fdim, not E♯dim (same notes)
});

ok('every chord is made of in-key notes, in every key and scale, triads and sevenths', () => {
  for (const sc of T.SCALE_IDS) for (let root = 0; root < 12; root++) for (const seventh of [false, true]) {
    const key = { root, scale: sc, lock: true };
    for (const c of T.chordPalette(key, seventh)) for (const inv of [0, 1, 2]) {
      const ps = T.invert(c.pitches, inv);
      for (const p of ps) {
        assert.ok(p >= T.PITCH_MIN && p <= T.PITCH_MAX, `range ${sc} ${root} ${c.name}`);
        // chords stack from the parent scale, so test against the parent
        assert.ok(T.inScale(root, T.parentScale(sc), p), `${sc} ${root} ${c.name} inv${inv} has ${p}`);
        // and the lock in the room uses the CHOSEN scale: pentatonic/blues are subsets of the parent
      }
    }
  }
});

ok('inversions keep the pitch classes and rotate the bass', () => {
  const c = T.chordAt(Am, 0, false).pitches; // A C E
  const i1 = T.invert(c, 1);
  const i2 = T.invert(c, 2);
  assert.deepEqual(i1.map((p) => p % 12).sort(), c.map((p) => p % 12).sort());
  assert.equal(i1[0] % 12, 0);  // C in the bass
  assert.equal(i2[0] % 12, 4);  // E in the bass
  assert.deepEqual(T.invert(c, 3), T.invert(c, 0)); // wraps
});

ok('smooth voicing moves little between chords', () => {
  const prog = T.PROGRESSIONS.find((p) => p.id === 'sad-loop');
  const chords = prog.degrees.map((d) => T.chordAt(Am, d, false).pitches);
  const v = T.smoothVoicing(chords);
  const centre = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  for (let i = 1; i < v.length; i++) assert.ok(Math.abs(centre(v[i]) - centre(v[i - 1])) <= 4.5, `jump at ${i}`);
});

ok('voiceChord: block, strum, arpeggio', () => {
  const ps = [57, 60, 64];
  assert.deepEqual(T.voiceChord(ps, 'block', 0, 16).map((x) => [x.p, x.s, x.l]), [[57, 0, 16], [60, 0, 16], [64, 0, 16]]);
  const st = T.voiceChord(ps, 'strum', 16, 16);
  assert.deepEqual(st.map((x) => x.s), [16, 17, 18]);
  assert.ok(st.every((x) => x.s + x.l === 32), 'a strum still ends together');
  const up = T.voiceChord(ps, 'arp-up', 0, 16);
  assert.equal(up.length, 8);
  assert.deepEqual(up.slice(0, 4).map((x) => x.p), [57, 60, 64, 57]);
  assert.deepEqual(up.map((x) => x.s), [0, 2, 4, 6, 8, 10, 12, 14]);
  const dn = T.voiceChord(ps, 'arp-down', 0, 16);
  assert.deepEqual(dn.slice(0, 4).map((x) => x.p), [64, 60, 57, 64]);
  const long = T.voiceChord(ps, 'arp-up', 0, 128);
  assert.ok(long.length <= T.MAX_BATCH, 'a batch never exceeds the server cap');
  assert.ok(T.voiceChord(ps, 'arp-up', 0, 1).length === 3, 'a one-step chord is just a block');
});

ok('no two notes in a voiced chord overlap on the same pitch', () => {
  for (const mode of ['block', 'strum', 'arp-up', 'arp-down']) {
    const notes = T.voiceChord([57, 60, 64, 67], mode, 0, 16);
    for (const a of notes) for (const b of notes) if (a !== b && a.p === b.p) assert.ok(a.s + a.l <= b.s || b.s + b.l <= a.s, `${mode} overlaps`);
  }
});

ok('progression presets drop in-key, fit the pattern, and stay inside the server limits', () => {
  for (const key of [Am, Fsm, { root: 2, scale: 'dorian', lock: true }, { root: 4, scale: 'pent_minor', lock: true }]) {
    const progs = T.progressionsFor(key.scale);
    assert.ok(progs.length >= 4);
    for (const p of progs) for (const mode of ['block', 'strum', 'arp-up']) {
      const batches = T.progressionNotes(key, p, { seventh: false, inversion: 0, mode, length: 16, vel: 100 });
      assert.equal(batches.length, 4);
      for (const b of batches) {
        assert.ok(b.length <= T.MAX_BATCH);
        for (const nt of b) {
          assert.ok(nt.p >= T.PITCH_MIN && nt.p <= T.PITCH_MAX && nt.s >= 0 && nt.l >= 1 && nt.s + nt.l <= 64, JSON.stringify(nt));
          // the room's lock uses the chosen scale. Chords come from the parent scale, which for the
          // pentatonic/blues keys is a superset, so with the lock on those chords need the lock off:
          if (T.parentScale(key.scale) === key.scale) assert.ok(T.inScale(key.root, key.scale, nt.p), `${key.scale} ${nt.p}`);
        }
      }
    }
  }
  assert.equal(T.barsNeeded(4, 16), 4);
  assert.equal(T.barsNeeded(4, 8), 2);
  assert.equal(T.barsNeeded(4, 32), 8);
});

ok('minor keys get the sad loops, major keys get pop', () => {
  assert.ok(T.progressionsFor('minor').some((p) => p.id === 'sad-loop'));
  assert.ok(T.progressionsFor('major').some((p) => p.id === 'pop'));
  assert.ok(!T.progressionsFor('minor').some((p) => p.id === 'pop'));
  assert.equal(T.familyOf('dorian'), 'minor');
  assert.equal(T.familyOf('lydian'), 'major');
  assert.equal(T.familyOf('blues'), 'minor');
});

ok('808 bass follows the chord roots, in the sub range, in key', () => {
  const batches = T.progressionNotes(Am, T.PROGRESSIONS.find((p) => p.id === 'sad-loop'), { seventh: false, inversion: 0, mode: 'block', length: 16, vel: 100 });
  const chordNotes = batches.flat().map((d, i) => ({ id: i + 1, t: 0, by: 'x', v: 100, ...d }));
  const bass = T.bassFromChords(chordNotes, 64);
  assert.equal(bass.length, 4);
  assert.deepEqual(bass.map((b) => b.s), [0, 16, 32, 48]);
  for (const b of bass) {
    assert.ok(b.p >= 28 && b.p <= 39, `${b.p} is outside the sub octave`);
    assert.ok(T.inScale(9, 'minor', b.p));
    assert.ok(b.s + b.l <= 64);
  }
  // i - VI - III - VII in A minor: A F C G
  assert.deepEqual(bass.map((b) => b.p % 12), [9, 5, 0, 7]);
});

ok('delay times follow the tempo', () => {
  assert.ok(Math.abs(T.delaySeconds('1/4', 120) - 0.5) < 1e-9);
  assert.ok(Math.abs(T.delaySeconds('1/8d', 90) - 0.5) < 1e-9);
  assert.ok(Math.abs(T.delaySeconds('1/16', 60) - 0.25) < 1e-9);
});

ok('the 808 is only offered on the bass track', () => {
  assert.ok(!T.instrumentsForTrack(0).some((i) => i.id === 'sub808'));
  assert.ok(T.instrumentsForTrack(2).some((i) => i.id === 'sub808'));
});

ok('bass finds the real root of inverted, strummed and arpeggiated chords', () => {
  const asNotes = (batches) => batches.flat().map((d, i) => ({ id: i + 1, t: 0, by: 'x', v: 100, ...d }));
  const prog = T.PROGRESSIONS.find((p) => p.id === 'sad-loop');
  for (const mode of ['block', 'strum', 'arp-up', 'arp-down']) {
    for (const seventh of [false, true]) {
      const notes = asNotes(T.progressionNotes(Am, prog, { seventh, inversion: 0, mode, length: 16, vel: 100 }));
      const bass = T.bassFromChords(notes, 64);
      assert.deepEqual(bass.map((b) => b.p % 12), [9, 5, 0, 7], `${mode} seventh=${seventh}`);
      assert.deepEqual(bass.map((b) => b.s), [0, 16, 32, 48], `${mode} starts`);
    }
  }
  // every inversion of every triad in A minor names the same root
  for (const c of T.chordPalette(Am, false)) for (let inv = 0; inv < 3; inv++) {
    assert.equal(T.chordRootPc(T.invert(c.pitches, inv)), c.pitches[0] % 12, `${c.name} inv ${inv}`);
  }
  // two chords in one bar still split (block onsets), and an empty chord track gives no bass
  const two = asNotes([T.voiceChord([57, 60, 64], 'block', 0, 8), T.voiceChord([53, 57, 60], 'block', 8, 8)]);
  assert.deepEqual(T.bassFromChords(two, 64).map((b) => [b.s, b.l, b.p % 12]), [[0, 8, 9], [8, 8, 5]]);
  assert.deepEqual(T.bassFromChords([], 64), []);
});

ok('instrument manifests are validated before any file name becomes a URL', () => {
  const good = { id: 'piano', license: 'CC0-1.0', samples: [{ note: 60, file: 'C4.ogg' }] };
  assert.ok(I.parseManifest(good, 'piano'));
  assert.equal(I.parseManifest(good, 'bell'), null, 'id must match');
  assert.equal(I.parseManifest({ ...good, license: '' }, 'piano'), null, 'a pack must name its licence');
  for (const file of ['../x.ogg', 'a/b.ogg', 'C4.exe', '', 'C4.ogg?x=1', '/etc/passwd', 'a\\b.wav'])
    assert.equal(I.parseManifest({ ...good, samples: [{ note: 60, file }] }, 'piano'), null, file);
  for (const note of [-1, 128, 60.5, '60']) assert.equal(I.parseManifest({ ...good, samples: [{ note, file: 'a.ogg' }] }, 'piano'), null, String(note));
  assert.equal(I.parseManifest({ ...good, samples: [] }, 'piano'), null);
  assert.equal(I.parseManifest({ ...good, samples: Array.from({ length: 49 }, (_, i) => ({ note: i, file: `n${i}.ogg` })) }, 'piano'), null);
  assert.equal(I.parseManifest({ ...good, release: 99 }, 'piano').release, 2);
  assert.ok(Math.abs(I.hz(69) - 440) < 1e-9 && Math.abs(I.hz(33) - 55) < 1e-9, 'A4 = 440, A1 = 55');
  assert.ok(I.noteAmp(127) > I.noteAmp(64) && I.noteAmp(64) > I.noteAmp(10));
});

console.log(`\n${n} theory tests passed`);
