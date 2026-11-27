/* Starship Studio instruments.
 *
 * Works like the drum kits: the SERVER stores one instrument id per melodic track (from an allowlist), and each
 * client loads and caches the sounds itself. For every instrument there are two ways to make a note:
 *
 *   1. a SAMPLE PACK at public/studio-instruments/<id>/manifest.json (+ the audio files it lists), if one is
 *      installed and loads. Recorded piano and guitar need this to sound convincing. See
 *      public/studio-instruments/README.md for the licence rules and scripts/make-instrument-pack.py to build one.
 *   2. a built-in SYNTH voice, used when there is no pack, a file fails to load, or the pack is still loading.
 *
 * Nothing here touches the live audio context's graph except through the `dest` node it is given, and every voice
 * works on any BaseAudioContext, so the same code renders live playback and (later) an offline WAV export. */

export type InstrumentStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Must match studioInstruments in backend-go/studio_notes.go (scripts/check-theory-parity.mjs compares them). */
export const INSTRUMENT_IDS = ['piano', 'epiano', 'pad', 'pluck', 'bell', 'lead', 'sub808'] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];
export const isInstrumentId = (id: string): id is InstrumentId => (INSTRUMENT_IDS as readonly string[]).includes(id);

export const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Velocity (1..127) to gain. Same curve the drums use, so a ghost note is quiet and an accent really speaks. */
export const noteAmp = (v: number) => Math.pow(Math.min(127, Math.max(1, v)) / 127, 1.2);

/* ---- sample packs ------------------------------------------------------------------- */

interface Zone {
  note: number;
  buf: AudioBuffer;
}
interface Pack {
  zones: Zone[]; // sorted by note
  release: number;
  license: string;
  credit: string;
}

const packs = new Map<string, Pack>();
const state = new Map<string, InstrumentStatus>();
const failedAt = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const instrumentStatus = (id: string): InstrumentStatus => state.get(id) ?? 'idle';
/** Whether this instrument is currently playing from recorded samples (otherwise it is the built-in synth). */
export const instrumentIsSampled = (id: string) => packs.has(id);
export const instrumentCredit = (id: string): { license: string; credit: string } | null => {
  const p = packs.get(id);
  return p ? { license: p.license, credit: p.credit } : null;
};
export function onInstrumentChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(wav|ogg|mp3|flac)$/;
const MAX_ZONES = 48;
const RETRY_MS = 60_000;

interface Manifest {
  id: string;
  license: string;
  credit?: string;
  release?: number;
  samples: { note: number; file: string }[];
}

/** Checks a manifest the server of this site hands out. The file names become URLs, so they are held to a strict pattern. */
export function parseManifest(raw: unknown, id: string): Manifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.id !== id || typeof m.license !== 'string' || !m.license.trim() || !Array.isArray(m.samples)) return null;
  if (m.samples.length < 1 || m.samples.length > MAX_ZONES) return null;
  const samples: Manifest['samples'] = [];
  for (const s of m.samples) {
    const z = s as { note?: unknown; file?: unknown };
    if (!Number.isInteger(z.note) || (z.note as number) < 0 || (z.note as number) > 127) return null;
    if (typeof z.file !== 'string' || !FILE_RE.test(z.file)) return null;
    samples.push({ note: z.note as number, file: z.file });
  }
  const release = typeof m.release === 'number' ? Math.min(2, Math.max(0.05, m.release)) : 0.35;
  return { id, license: m.license.slice(0, 80), credit: typeof m.credit === 'string' ? m.credit.slice(0, 200) : '', release, samples };
}

/**
 * Fetches and decodes one instrument's pack. A missing pack is normal (the synth plays instead), and a missing
 * FILE just leaves a gap the nearest other sample covers. Retried after a minute if it failed.
 */
export async function loadInstrument(c: BaseAudioContext | null, id: string): Promise<void> {
  if (!c || !isInstrumentId(id)) return; // ids come from the server: only ever load a known one
  const st = state.get(id);
  if (st === 'loading' || st === 'ready') return;
  if (st === 'failed' && Date.now() - (failedAt.get(id) ?? 0) < RETRY_MS) return;
  state.set(id, 'loading');
  emit();
  const base = `${import.meta.env.BASE_URL}studio-instruments/${id}/`;
  try {
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) throw new Error('no pack');
    const man = parseManifest(await res.json(), id);
    if (!man) throw new Error('bad manifest');
    const zones: Zone[] = [];
    await Promise.all(
      man.samples.map(async (s) => {
        try {
          const r = await fetch(`${base}${s.file}`);
          if (!r.ok) return;
          const data = await r.arrayBuffer();
          zones.push({ note: s.note, buf: await new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(data, ok, bad)) });
        } catch {
          /* this zone is skipped */
        }
      }),
    );
    if (!zones.length) throw new Error('no samples decoded');
    zones.sort((a, b) => a.note - b.note);
    packs.set(id, { zones, release: man.release ?? 0.35, license: man.license, credit: man.credit ?? '' });
    state.set(id, 'ready');
  } catch {
    state.set(id, 'failed');
    failedAt.set(id, Date.now());
  }
  emit();
}

/* ---- tiny helpers ------------------------------------------------------------------- */

const MIN = 0.0001;

function gainNode(c: BaseAudioContext, dest: AudioNode, level = 1): GainNode {
  const g = c.createGain();
  g.gain.value = level;
  g.connect(dest);
  return g;
}

/** Attack to `peak`, hold until `t+dur`, then release. Everything is scheduled at once, so it is sample-accurate. */
function sustainEnv(g: AudioParam, t: number, dur: number, peak: number, attack: number, release: number, sustain = 1) {
  g.setValueAtTime(MIN, t);
  g.exponentialRampToValueAtTime(Math.max(peak, MIN * 2), t + attack);
  if (sustain < 1) g.exponentialRampToValueAtTime(Math.max(peak * sustain, MIN * 2), t + Math.max(attack + 0.01, Math.min(dur, 0.6)));
  g.setValueAtTime(Math.max(peak * sustain, MIN * 2), t + Math.max(dur, attack + 0.011));
  g.exponentialRampToValueAtTime(MIN, t + Math.max(dur, attack + 0.011) + release);
}

function stopAt(o: AudioScheduledSourceNode, when: number) {
  o.stop(when);
}

const satCurve = (() => {
  const n = 1024;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    a[i] = Math.tanh(2.4 * x);
  }
  return a;
})();

/* ---- the voices ----------------------------------------------------------------------- */

export interface NoteOpts {
  /** For the 808: the pitch the previous (touching) note ended on, so this note glides up or down from it. */
  glideFrom?: number;
  /** Seconds the glide takes. */
  glideSec?: number;
  /** A touching note follows: end this one quickly so the two do not stack. */
  legatoNext?: boolean;
}

/** Sampled playback: the nearest zone, repitched. Returns false when there is no pack so the synth can take over. */
function playSampled(c: BaseAudioContext, dest: AudioNode, id: string, t: number, dur: number, midi: number, amp: number, o: NoteOpts): boolean {
  const pack = packs.get(id);
  if (!pack || !pack.zones.length) return false;
  let z = pack.zones[0]!;
  for (const cand of pack.zones) if (Math.abs(cand.note - midi) < Math.abs(z.note - midi)) z = cand;
  const src = c.createBufferSource();
  src.buffer = z.buf;
  src.playbackRate.value = Math.pow(2, (midi - z.note) / 12);
  const g = c.createGain();
  const rel = o.legatoNext ? 0.03 : pack.release;
  sustainEnv(g.gain, t, dur, amp, 0.003, rel);
  src.connect(g).connect(dest);
  src.start(t);
  stopAt(src, t + Math.max(dur, 0.01) + rel + 0.05);
  return true;
}

function piano(c: BaseAudioContext, dest: AudioNode, nb: AudioBuffer, t: number, dur: number, midi: number, amp: number) {
  const f = hz(midi);
  const out = gainNode(c, dest, 1);
  const tone = c.createBiquadFilter(); // soft strikes are darker, high notes are brighter
  tone.type = 'lowpass';
  tone.frequency.value = Math.min(12000, 1400 + amp * 5200 + (midi - 48) * 40);
  tone.Q.value = 0.4;
  tone.connect(out);
  const tau0 = Math.min(4, Math.max(0.7, 2.6 * Math.pow(2, -(midi - 60) / 22))); // low strings ring longer
  const partials = [1, 2, 3, 4, 5, 7];
  const B = 0.00035; // a touch of string stiffness: the upper partials run slightly sharp
  const noteEnd = t + Math.max(dur, 0.05);
  partials.forEach((k, i) => {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > 15000) return;
    for (const detune of i < 3 ? [-1.6, 1.6] : [0]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = fk;
      o.detune.value = detune;
      const g = c.createGain();
      const a = (amp * (i < 3 ? 0.5 : 1) * 0.55) / Math.pow(k, 1.15);
      const tau = tau0 / (1 + 0.55 * i);
      g.gain.setValueAtTime(MIN, t);
      g.gain.exponentialRampToValueAtTime(Math.max(a, MIN * 2), t + 0.003);
      g.gain.setTargetAtTime(0.0002, t + 0.003, tau); // the string dies away on its own...
      g.gain.setTargetAtTime(0.0001, noteEnd, 0.09); // ...and the damper falls when the key is let go
      o.connect(g).connect(tone);
      o.start(t);
      stopAt(o, noteEnd + 0.7);
    }
  });
  // hammer: a short band-passed tick
  const n = c.createBufferSource();
  n.buffer = nb;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, f * 4 + 800);
  bp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.16 * amp, t);
  ng.gain.exponentialRampToValueAtTime(MIN, t + 0.03);
  n.connect(bp).connect(ng).connect(out);
  n.start(t, Math.random() * 0.5);
  stopAt(n, t + 0.05);
}

function epiano(c: BaseAudioContext, dest: AudioNode, t: number, dur: number, midi: number, amp: number) {
  const f = hz(midi);
  const out = gainNode(c, dest, 1);
  const env = c.createGain();
  sustainEnv(env.gain, t, dur, amp * 0.5, 0.004, 0.35, 0.55);
  env.connect(out);
  const car = c.createOscillator();
  car.type = 'sine';
  car.frequency.value = f;
  // body: modulator at the same pitch, whose depth dies away
  const mod = c.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = f;
  const modG = c.createGain();
  modG.gain.setValueAtTime(f * (0.6 + amp * 2.2), t);
  modG.gain.exponentialRampToValueAtTime(f * 0.18, t + 0.7);
  mod.connect(modG).connect(car.frequency);
  // tine: a very short bright ping at 14x
  const tine = c.createOscillator();
  tine.type = 'sine';
  tine.frequency.value = f * 14;
  const tineG = c.createGain();
  tineG.gain.setValueAtTime(amp * 0.07, t);
  tineG.gain.exponentialRampToValueAtTime(MIN, t + 0.09);
  tine.connect(tineG).connect(env);
  car.connect(env);
  const end = t + Math.max(dur, 0.05) + 0.5;
  for (const o of [car, mod, tine]) {
    o.start(t);
    stopAt(o, end);
  }
}

function pad(c: BaseAudioContext, dest: AudioNode, t: number, dur: number, midi: number, amp: number) {
  const f = hz(midi);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(1200 + amp * 1400, t + 0.6);
  lp.Q.value = 0.5;
  const env = c.createGain();
  const atk = Math.min(0.4, Math.max(0.08, dur * 0.35));
  const rel = 0.9;
  sustainEnv(env.gain, t, dur, amp * 0.2, atk, rel);
  lp.connect(env).connect(dest);
  for (const cents of [-10, 0, 10]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = cents;
    o.connect(lp);
    o.start(t);
    stopAt(o, t + Math.max(dur, 0.05) + rel + 0.1);
  }
  const sub = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f / 2;
  const sg = c.createGain();
  sg.gain.value = 0.5;
  sub.connect(sg).connect(lp);
  sub.start(t);
  stopAt(sub, t + Math.max(dur, 0.05) + rel + 0.1);
}

const pluckCache = new Map<string, AudioBuffer>();

/** Karplus-Strong string, rendered once per pitch and cached. It is retuned exactly with playbackRate. */
function pluckBuffer(c: BaseAudioContext, midi: number): { buf: AudioBuffer; rate: number } {
  const sr = c.sampleRate;
  const f = hz(midi);
  const N = Math.max(2, Math.round(sr / f - 0.5));
  const key = `${sr}:${N}`;
  let buf = pluckCache.get(key);
  if (!buf) {
    const len = Math.floor(sr * 2.4);
    buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.55; // a softened pick
      ring[i] = lp;
    }
    const decay = 0.9965;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % N;
      d[i] = ring[idx]!;
      ring[idx] = decay * 0.5 * (ring[idx]! + ring[next]!);
      idx = next;
    }
    pluckCache.set(key, buf);
  }
  const effective = sr / (N + 0.5);
  return { buf, rate: f / effective };
}

function pluck(c: BaseAudioContext, dest: AudioNode, t: number, dur: number, midi: number, amp: number) {
  const { buf, rate } = pluckBuffer(c, midi);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2500 + amp * 5000;
  const g = c.createGain();
  const hold = Math.max(dur, 0.15);
  g.gain.setValueAtTime(amp * 1.5, t);
  g.gain.setValueAtTime(amp * 1.5, t + hold);
  g.gain.exponentialRampToValueAtTime(MIN, t + hold + 0.25);
  src.connect(tone).connect(g).connect(dest);
  src.start(t);
  stopAt(src, t + hold + 0.3);
}

function bell(c: BaseAudioContext, dest: AudioNode, nb: AudioBuffer, t: number, dur: number, midi: number, amp: number) {
  const f = hz(midi);
  const out = gainNode(c, dest, 1);
  const hold = Math.max(dur, 0.1);
  // inharmonic partials, each with its own decay: the high ones ping and vanish, the low ones ring
  const parts: [number, number, number][] = [
    [1, 0.55, 3.2],
    [2.76, 0.3, 1.9],
    [5.4, 0.16, 1.0],
    [8.93, 0.08, 0.55],
  ];
  for (const [ratio, a, tau] of parts) {
    if (f * ratio > 16000) continue;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * ratio;
    const g = c.createGain();
    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(Math.max(a * amp, MIN * 2), t + 0.003);
    g.gain.setTargetAtTime(0.0002, t + 0.003, tau / 3);
    g.gain.setTargetAtTime(0.0001, t + hold + 0.4, 0.5); // a very long note is allowed to fade
    o.connect(g).connect(out);
    o.start(t);
    stopAt(o, t + hold + 3);
  }
  const n = c.createBufferSource();
  n.buffer = nb;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.05 * amp, t);
  ng.gain.exponentialRampToValueAtTime(MIN, t + 0.02);
  n.connect(hp).connect(ng).connect(out);
  n.start(t, Math.random() * 0.5);
  stopAt(n, t + 0.04);
}

function lead(c: BaseAudioContext, dest: AudioNode, t: number, dur: number, midi: number, amp: number) {
  const f = hz(midi);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(900 + amp * 4000, t);
  lp.frequency.exponentialRampToValueAtTime(1800 + amp * 1200, t + 0.25);
  const env = c.createGain();
  const rel = 0.18;
  sustainEnv(env.gain, t, dur, amp * 0.22, 0.012, rel, 0.75);
  lp.connect(env).connect(dest);
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.6;
  const lfoG = c.createGain();
  lfoG.gain.setValueAtTime(0, t);
  lfoG.gain.linearRampToValueAtTime(7, t + 0.4); // vibrato fades in
  lfo.connect(lfoG);
  const end = t + Math.max(dur, 0.05) + rel + 0.1;
  for (const cents of [-7, 7]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = cents;
    lfoG.connect(o.detune);
    o.connect(lp);
    o.start(t);
    stopAt(o, end);
  }
  const sq = c.createOscillator();
  sq.type = 'square';
  sq.frequency.value = f / 2;
  const sqg = c.createGain();
  sqg.gain.value = 0.35;
  sq.connect(sqg).connect(lp);
  sq.start(t);
  stopAt(sq, end);
  lfo.start(t);
  stopAt(lfo, end);
}

/**
 * The 808: a long, held sine sub with a little saturation so it still speaks on small speakers.
 * When a note touches the one before it, the pitch GLIDES from the old note instead of restarting. The
 * frequencies are exact equal temperament, so with the key lock on it can never be out of tune with the chords.
 */
function sub808(c: BaseAudioContext, dest: AudioNode, t: number, dur: number, midi: number, amp: number, o: NoteOpts) {
  const f = hz(midi);
  const gliding = o.glideFrom !== undefined && o.glideFrom !== midi;
  const osc = c.createOscillator();
  osc.type = 'sine';
  if (gliding) {
    const g0 = hz(o.glideFrom!);
    osc.frequency.setValueAtTime(g0, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + Math.max(0.02, Math.min(o.glideSec ?? 0.09, dur * 0.8)));
  } else {
    // a quick pitch drop on a fresh hit is what makes it thump like an 808 rather than hum
    osc.frequency.setValueAtTime(f * 1.9, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.035);
  }
  const env = c.createGain();
  const rel = o.legatoNext ? 0.03 : 0.16;
  const hold = Math.max(dur, 0.06);
  env.gain.setValueAtTime(MIN, t);
  env.gain.exponentialRampToValueAtTime(Math.max(amp * 0.95, MIN * 2), t + 0.006);
  env.gain.setTargetAtTime(amp * 0.72, t + 0.006, 0.35); // the body relaxes a little, then holds
  env.gain.setTargetAtTime(0.0001, t + hold, rel / 3); // lets go from wherever the body has settled: no step, no click
  const shaper = c.createWaveShaper();
  shaper.curve = satCurve;
  const wet = gainNode(c, env, 0.5);
  const dry = gainNode(c, env, 0.55);
  osc.connect(shaper).connect(wet);
  osc.connect(dry);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  env.connect(lp).connect(dest);
  osc.start(t);
  stopAt(osc, t + hold + rel + 0.1);
}

/** Plays one note on one instrument. `nb` is a buffer of white noise for the percussive transients. */
export function playNote(c: BaseAudioContext, nb: AudioBuffer, dest: AudioNode, id: string, t: number, dur: number, midi: number, vel: number, o: NoteOpts = {}) {
  const amp = noteAmp(vel);
  if (playSampled(c, dest, id, t, dur, midi, amp, o)) return; // recorded samples, when a pack is installed and loaded
  switch (id) {
    case 'piano':
      return piano(c, dest, nb, t, dur, midi, amp);
    case 'epiano':
      return epiano(c, dest, t, dur, midi, amp);
    case 'pad':
      return pad(c, dest, t, dur, midi, amp);
    case 'pluck':
      return pluck(c, dest, t, dur, midi, amp);
    case 'bell':
      return bell(c, dest, nb, t, dur, midi, amp);
    case 'lead':
      return lead(c, dest, t, dur, midi, amp);
    case 'sub808':
      return sub808(c, dest, t, dur, midi, amp, o);
    default:
      return epiano(c, dest, t, dur, midi, amp);
  }
}
