/* Music theory for the piano roll: keys, scales, chords, progressions, strum and arpeggio.
 * Pure functions, no DOM and no audio, so they run (and are tested) anywhere.
 *
 * Units, same as the server (backend-go/studio_notes.go): pitch is a MIDI number (60 = middle C);
 * start and length are in sixteenth-note steps; velocity is 1..127. */

export const PITCH_MIN = 24; // C1: the server refuses anything outside 24..96
export const PITCH_MAX = 96; // C7
export const STEPS_PER_BAR = 16;
export const MAX_BARS = 8;
export const MIN_BARS = 1;
export const MAX_NOTES = 256;
export const MAX_BATCH = 32;

export interface Note {
  id: number;
  t: number; // melodic track: 0 chords, 1 melody, 2 bass / 808
  p: number;
  s: number;
  l: number;
  v: number;
  by: string;
}

export interface NoteDraft {
  p: number;
  s: number;
  l: number;
  v?: number;
}

export const MELODIC_TRACKS = [
  { id: 'chords', label: 'Chords' },
  { id: 'melody', label: 'Melody' },
  { id: 'bass', label: 'Bass / 808' },
] as const;

/** Where each track's roll opens: the lowest visible pitch (the window is two octaves and a note). */
export const TRACK_VIEW_LOW = [48, 60, 24] as const;
export const VIEW_ROWS = 25;

/* ---- keys and scales ------------------------------------------------------------ */

export const ROOTS = [
  { id: 0, label: 'C' },
  { id: 1, label: 'C♯' },
  { id: 2, label: 'D' },
  { id: 3, label: 'E♭' },
  { id: 4, label: 'E' },
  { id: 5, label: 'F' },
  { id: 6, label: 'F♯' },
  { id: 7, label: 'G' },
  { id: 8, label: 'A♭' },
  { id: 9, label: 'A' },
  { id: 10, label: 'B♭' },
  { id: 11, label: 'B' },
] as const;

/** Must match studioScales in backend-go/studio_notes.go (scripts/check-theory-parity.mjs compares them). */
export const SCALES: Record<string, { label: string; steps: number[] }> = {
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic_minor: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  pent_minor: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  pent_major: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
};
export const SCALE_IDS = Object.keys(SCALES);

export interface Key {
  root: number;
  scale: string;
  lock: boolean;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function scaleSteps(scale: string): number[] {
  return (SCALES[scale] ?? SCALES.minor!).steps;
}

/** True when the pitch belongs to the key's scale (ignores the lock: the caller decides whether it matters). */
export function inScale(root: number, scale: string, p: number): boolean {
  return scaleSteps(scale).includes(mod12(p - root));
}

/** The nearest pitch inside the scale (ties go down), kept inside the allowed range. */
export function snapToScale(root: number, scale: string, p: number): number {
  const clamped = Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(p)));
  if (inScale(root, scale, clamped)) return clamped;
  for (let d = 1; d <= 6; d++) {
    const down = clamped - d;
    const up = clamped + d;
    if (down >= PITCH_MIN && inScale(root, scale, down)) return down;
    if (up <= PITCH_MAX && inScale(root, scale, up)) return up;
  }
  return clamped;
}

/** What a click on this pitch should write, given the key and its lock. */
export const lockPitch = (key: Key, p: number) => (key.lock ? snapToScale(key.root, key.scale, p) : Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(p))));

/* ---- names -------------------------------------------------------------------- */

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const FLAT_MAJOR_ROOTS = new Set([5, 10, 3, 8, 1]); // F B♭ E♭ A♭ D♭ (F♯ stays sharp)

/** Flat or sharp spelling for a key: follows the relative major, so D minor reads B♭ and G minor reads E♭. */
export function usesFlats(root: number, scale: string): boolean {
  return FLAT_MAJOR_ROOTS.has(familyOf(scale) === 'minor' ? mod12(root + 3) : root);
}

export const pitchClassName = (pc: number, flats: boolean) => (flats ? FLAT : SHARP)[mod12(pc)]!;
export const noteName = (p: number, flats = false) => `${pitchClassName(p, flats)}${Math.floor(p / 12) - 1}`;
export const isBlackKey = (p: number) => [1, 3, 6, 8, 10].includes(mod12(p));

export const keyLabel = (k: Key) => `${pitchClassName(k.root, usesFlats(k.root, k.scale))} ${SCALES[k.scale]?.label.toLowerCase() ?? k.scale}`;

/* ---- chords -------------------------------------------------------------------- */

export type ChordMode = 'block' | 'strum' | 'arp-up' | 'arp-down';

/** Seven-note scale that chords are stacked from. Pentatonic and blues borrow their parent. */
export function parentScale(scale: string): string {
  switch (scale) {
    case 'pent_minor':
    case 'blues':
      return 'minor';
    case 'pent_major':
      return 'major';
    default:
      return scale;
  }
}

/** Does the key sound minor (a minor third above its tonic) or major? Decides which progression presets to offer. */
export function familyOf(scale: string): 'minor' | 'major' {
  return scaleSteps(parentScale(scale))[2] === 3 ? 'minor' : 'major';
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const QUALITIES: [string, string][] = [
  ['0,4,7', ''],
  ['0,3,7', 'm'],
  ['0,3,6', 'dim'],
  ['0,4,8', 'aug'],
  ['0,4,7,11', 'maj7'],
  ['0,3,7,10', 'm7'],
  ['0,4,7,10', '7'],
  ['0,3,6,10', 'm7♭5'],
  ['0,3,6,9', 'dim7'],
  ['0,3,7,11', 'm(maj7)'],
  ['0,4,8,11', 'maj7♯5'],
];

export interface Chord {
  degree: number; // 0..6
  pitches: number[]; // low to high, before any inversion
  name: string; // "Am", "F", "G7"
  numeral: string; // "i", "VI", "vii°"
}

/** The pitch of scale degree `index` (0 = tonic) counting upward through octaves, tonic placed at `base`. */
function scalePitch(steps: number[], base: number, index: number): number {
  const n = steps.length;
  return base + 12 * Math.floor(index / n) + steps[((index % n) + n) % n]!;
}

/** The chord built on one degree of the key's seven-note scale. Every note comes from the scale, so it is always in key. */
export function chordAt(key: Key, degree: number, seventh: boolean): Chord {
  const steps = scaleSteps(parentScale(key.scale));
  const base = 48 + key.root; // chords live around C3..C5
  const idx = seventh ? [0, 2, 4, 6] : [0, 2, 4];
  const pitches = idx.map((i) => scalePitch(steps, base, degree + i));
  const rootPc = mod12(pitches[0]!);
  const shape = pitches.map((p) => mod12(p - rootPc)).join(',');
  const quality = QUALITIES.find((q) => q[0] === shape)?.[1] ?? '';
  const flats = usesFlats(key.root, key.scale);
  const minorish = /^(m|dim)/.test(quality) && !quality.startsWith('maj');
  let numeral = NUMERALS[degree]!;
  if (minorish) numeral = numeral.toLowerCase();
  if (quality.startsWith('dim') || quality === 'm7♭5') numeral += '°';
  if (quality === 'aug') numeral += '+';
  return { degree, pitches, name: `${pitchClassName(rootPc, flats)}${quality}`, numeral };
}

/** The palette for a key: one chord per scale degree. */
export const chordPalette = (key: Key, seventh: boolean): Chord[] => Array.from({ length: 7 }, (_, d) => chordAt(key, d, seventh));

/** Inversion n lifts the n lowest notes an octave. Notes that would leave the range come back down. */
export function invert(pitches: number[], n: number): number[] {
  let out = [...pitches].sort((a, b) => a - b);
  const times = ((n % out.length) + out.length) % out.length;
  for (let i = 0; i < times; i++) out = [...out.slice(1), out[0]! + 12];
  while (Math.max(...out) > PITCH_MAX) out = out.map((p) => p - 12);
  while (Math.min(...out) < PITCH_MIN) out = out.map((p) => p + 12);
  return out;
}

/** Pick, for each chord in a progression, the inversion that sits closest to the one before it (smooth voice leading). */
export function smoothVoicing(chords: number[][]): number[][] {
  const out: number[][] = [];
  const centre = (ps: number[]) => ps.reduce((a, b) => a + b, 0) / ps.length;
  for (const c of chords) {
    if (!out.length) {
      out.push(invert(c, 0));
      continue;
    }
    const prev = centre(out[out.length - 1]!);
    let best = invert(c, 0);
    let bestD = Infinity;
    for (let inv = 0; inv < c.length; inv++) {
      for (const shift of [-12, 0, 12]) {
        const cand = invert(c, inv).map((p) => p + shift);
        if (Math.min(...cand) < PITCH_MIN || Math.max(...cand) > PITCH_MAX) continue;
        const d = Math.abs(centre(cand) - prev);
        if (d < bestD) {
          bestD = d;
          best = cand;
        }
      }
    }
    out.push(best);
  }
  return out;
}

/**
 * Turns a set of pitches into notes at `start` lasting `len` steps.
 *  block      all at once
 *  strum      one step between notes, low to high (each still ends with the chord)
 *  arp-up     eighth notes cycling up through the chord until `len` is used
 *  arp-down   the same, downward
 */
export function voiceChord(pitches: number[], mode: ChordMode, start: number, len: number, vel = 100): NoteDraft[] {
  const ps = [...pitches].sort((a, b) => a - b);
  if (mode === 'block' || len < 2) return ps.map((p) => ({ p, s: start, l: len, v: vel }));
  if (mode === 'strum') {
    return ps.map((p, i) => ({ p, s: start + Math.min(i, len - 1), l: Math.max(1, len - Math.min(i, len - 1)), v: Math.max(1, vel - i * 3) }));
  }
  const seq = mode === 'arp-up' ? ps : [...ps].reverse();
  const out: NoteDraft[] = [];
  for (let k = 0; k * 2 < len && out.length < MAX_BATCH; k++) {
    out.push({ p: seq[k % seq.length]!, s: start + k * 2, l: Math.min(2, len - k * 2), v: k % seq.length === 0 ? vel : Math.max(1, vel - 12) });
  }
  return out;
}

/* ---- progression presets ----------------------------------------------------- */

export interface Progression {
  id: string;
  label: string;
  family: 'minor' | 'major';
  degrees: number[]; // 0-based scale degrees, one chord per bar
  numerals: string; // for the button
}

export const PROGRESSIONS: Progression[] = [
  { id: 'sad-loop', label: 'Sad minor loop', family: 'minor', degrees: [0, 5, 2, 6], numerals: 'i – VI – III – VII' },
  { id: 'heartbreak', label: 'Heartbreak', family: 'minor', degrees: [0, 3, 6, 2], numerals: 'i – iv – VII – III' },
  { id: 'rainy', label: 'Rainy day', family: 'minor', degrees: [0, 2, 5, 6], numerals: 'i – III – VI – VII' },
  { id: 'trap-dark', label: 'Dark trap', family: 'minor', degrees: [0, 6, 5, 6], numerals: 'i – VII – VI – VII' },
  { id: 'late-night', label: 'Late night', family: 'minor', degrees: [5, 6, 0, 0], numerals: 'VI – VII – i – i' },
  { id: 'pop', label: 'Common pop', family: 'major', degrees: [0, 4, 5, 3], numerals: 'I – V – vi – IV' },
  { id: 'sing-along', label: 'Sing-along', family: 'major', degrees: [5, 3, 0, 4], numerals: 'vi – IV – I – V' },
  { id: 'fifties', label: '50s', family: 'major', degrees: [0, 5, 3, 4], numerals: 'I – vi – IV – V' },
  { id: 'hopeful', label: 'Hopeful', family: 'major', degrees: [0, 3, 5, 4], numerals: 'I – IV – vi – V' },
];

export const progressionsFor = (scale: string) => PROGRESSIONS.filter((p) => p.family === familyOf(scale));

export interface DropOptions {
  seventh: boolean;
  inversion: number; // used for single chords; progressions use smooth voice leading
  mode: ChordMode;
  length: number; // steps per chord
  vel: number;
}

/** A whole progression as one batch of notes per chord, starting at `start` and a chord every `length` steps. */
export function progressionNotes(key: Key, prog: Progression, opts: DropOptions, start = 0): NoteDraft[][] {
  const chords = prog.degrees.map((d) => chordAt(key, d, opts.seventh).pitches);
  const voiced = smoothVoicing(chords);
  return voiced.map((ps, i) => voiceChord(ps, opts.mode, start + i * opts.length, opts.length, opts.vel));
}

/** Bars a progression needs at the given chord length. */
export const barsNeeded = (chords: number, lengthSteps: number, start = 0) => Math.ceil((start + chords * lengthSteps) / STEPS_PER_BAR);

/* ---- 808 helper: tune the sub to the chords ------------------------------------- */

const BASS_LOW = 28; // E1: the lowest pitch an 808 can still be heard on small speakers

/** The bass note for a chord: its lowest pitch class, brought down into the 808's usable octave. */
export const subPitch = (chordLow: number) => BASS_LOW + mod12(chordLow - BASS_LOW);

/** The root of a set of chord pitches, found from the stack-of-thirds shape, so an inverted F/A still gives F. */
export function chordRootPc(pitches: number[]): number {
  const lowest = mod12(Math.min(...pitches));
  const pcs = [...new Set(pitches.map(mod12))];
  const shapes = new Set(QUALITIES.map((q) => q[0]));
  for (const r of [lowest, ...pcs.filter((pc) => pc !== lowest)]) {
    if (shapes.has(pcs.map((pc) => mod12(pc - r)).sort((x, y) => x - y).join(','))) return r;
  }
  return lowest;
}

/**
 * Splits the chord track into chords. Where chords land as blocks or strums (three or more notes starting
 * within a few steps of each other) those onsets are the chord starts. Where they are arpeggios there are no
 * such onsets, so each bar that has notes is one chord.
 */
export function chordSegments(chordNotes: Note[], loopSteps: number): { start: number; end: number; notes: Note[] }[] {
  if (!chordNotes.length) return [];
  const sorted = [...chordNotes].sort((a, b) => a.s - b.s);
  const onsets: number[] = [];
  for (const n of sorted) {
    if (onsets.some((o) => n.s >= o && n.s - o < 3)) continue;
    if (sorted.filter((m) => m.s >= n.s && m.s - n.s < 3).length >= 3) onsets.push(n.s);
  }
  const starts = onsets.length ? onsets : [...new Set(sorted.map((n) => Math.floor(n.s / STEPS_PER_BAR) * STEPS_PER_BAR))].sort((a, b) => a - b);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? loopSteps;
    return { start, end, notes: sorted.filter((n) => n.s >= start && n.s < end) };
  });
}

/** One sub note per chord, on its root, held as long as the chord rings. Always a chord root, so always in key. */
export function bassFromChords(chordNotes: Note[], loopSteps: number): NoteDraft[] {
  const out: NoteDraft[] = [];
  for (const seg of chordSegments(chordNotes, loopSteps)) {
    if (!seg.notes.length) continue;
    const root = chordRootPc(seg.notes.map((n) => n.p));
    const ring = Math.max(...seg.notes.map((n) => n.s + n.l));
    const l = Math.max(1, Math.min(seg.end, ring, loopSteps) - seg.start);
    out.push({ p: subPitch(root), s: seg.start, l, v: 110 });
  }
  return out;
}

/* ---- delay times, tempo-synced -------------------------------------------------- */

/** Must match studioDelayDivs on the server. Values are in beats. */
export const DELAY_DIVS = [
  { id: '1/4', label: '¼ note', beats: 1 },
  { id: '1/8', label: '⅛ note', beats: 0.5 },
  { id: '1/8d', label: 'Dotted ⅛', beats: 0.75 },
  { id: '1/16', label: '1⁄16 note', beats: 0.25 },
] as const;

export const delaySeconds = (div: string, bpm: number) => ((DELAY_DIVS.find((d) => d.id === div)?.beats ?? 0.75) * 60) / bpm;

/* ---- instruments ---------------------------------------------------------------- */

/** Must match studioInstruments on the server. */
export const INSTRUMENTS = [
  { id: 'piano', label: 'Piano' },
  { id: 'epiano', label: 'Electric piano' },
  { id: 'pad', label: 'Soft pad' },
  { id: 'pluck', label: 'Pluck / guitar' },
  { id: 'bell', label: 'Bell' },
  { id: 'lead', label: 'Synth lead' },
  { id: 'sub808', label: '808 sub' },
] as const;
export const instrumentsForTrack = (t: number) => INSTRUMENTS.filter((i) => i.id !== 'sub808' || t === 2);
