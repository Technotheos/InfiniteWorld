/**
 * The sound engine. Every sound is synthesized here with the Web Audio API, so
 * there are no audio files to download. Nothing makes a noise until the first
 * tap or key press (browsers block autoplay anyway): until then every call is a
 * silent no-op.
 *
 *   effects bus  -> clicks, tones, whoosh, slug voices
 *   ambience bus -> one quiet loop per room, crossfaded when you move
 */
import { getSoundPrefs, subscribeSound } from './prefs';

export type Sfx = 'click' | 'tick' | 'go' | 'success' | 'fail' | 'whoosh' | 'win' | 'ping';
export type SlugVoiceId = 'embo' | 'jolt' | 'sprig';
export type SlugSound = 'chirp' | 'squelch' | 'cheer' | 'snore' | 'dizzy';

let ctx: AudioContext | null = null;
let master: GainNode;
let fxBus: GainNode;
let ambBus: GainNode;
let noiseBuf: AudioBuffer;

/* ------------------------------------------------------------------ setup */

/** Call from a user gesture. Safe to call as often as you like. */
export function unlockSound() {
  if (!ctx) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    } catch {
      return;
    }
    master = ctx.createGain();
    fxBus = ctx.createGain();
    ambBus = ctx.createGain();
    // A gentle limiter so several sounds at once never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 8;
    fxBus.connect(master);
    ambBus.connect(master);
    master.connect(limiter).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    subscribeSound(applyPrefs);
    document.addEventListener('visibilitychange', syncRunState);
    applyPrefs();
    refreshAmbience();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function applyPrefs() {
  if (!ctx) return;
  const p = getSoundPrefs();
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(p.muted ? 0 : 1, t, 0.04);
  fxBus.gain.setTargetAtTime(p.effects, t, 0.03);
  ambBus.gain.setTargetAtTime(p.ambience * 0.55, t, 0.08);
  syncRunState();
}

/** Pause the audio clock while muted or while the tab is hidden: no CPU, no noise. */
function syncRunState() {
  if (!ctx) return;
  const shouldRun = !document.hidden && !getSoundPrefs().muted;
  if (shouldRun && ctx.state === 'suspended') void ctx.resume();
  if (!shouldRun && ctx.state === 'running') {
    // let the fade-out finish before pausing
    window.setTimeout(() => {
      if (ctx && (document.hidden || getSoundPrefs().muted)) void ctx.suspend();
    }, 150);
  }
}

const live = () => ctx !== null && ctx.state === 'running' && !getSoundPrefs().muted;

/* ------------------------------------------------------------ synth parts */

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** end frequency: glides from `freq` to this over the note */
  to?: number;
  lp?: number;
  vibrato?: [rate: number, depth: number];
  dest?: AudioNode;
}

function tone(freq: number, start: number, dur: number, o: ToneOpts = {}) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, start);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), start + dur);
  const peak = o.gain ?? 0.1;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    osc.connect(f);
    node = f;
  }
  node.connect(g).connect(o.dest ?? fxBus);
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.vibrato[0];
    depth.gain.value = o.vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + dur + 0.05);
  }
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

interface NoiseOpts {
  type?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  gain?: number;
  attack?: number;
  dest?: AudioNode;
}

function noise(start: number, dur: number, o: NoiseOpts = {}) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq ?? 1000, start);
  if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.1, start + (o.attack ?? dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(o.dest ?? fxBus);
  src.start(start, Math.random());
  src.stop(start + dur + 0.05);
}

/* ---------------------------------------------------------------- effects */

const lastPlayed = new Map<string, number>();
/** True when `key` fired less than `ms` ago, so a flood of events stays pleasant. */
function throttled(key: string, ms: number) {
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? -1e9) < ms) return true;
  lastPlayed.set(key, now);
  return false;
}

export function sfx(name: Sfx) {
  if (!live() || !ctx || throttled(`sfx:${name}`, name === 'click' ? 45 : 90)) return;
  const t = ctx.currentTime + 0.005;
  switch (name) {
    case 'click': // a soft wooden tick
      tone(1500, t, 0.045, { type: 'triangle', gain: 0.07, to: 900 });
      break;
    case 'tick': // countdown
      tone(660, t, 0.09, { gain: 0.11 });
      break;
    case 'go':
      tone(880, t, 0.1, { type: 'triangle', gain: 0.12 });
      tone(1320, t + 0.09, 0.22, { type: 'triangle', gain: 0.13 });
      break;
    case 'success':
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.085, 0.3, { type: 'triangle', gain: 0.1 }));
      tone(1567.98, t + 0.26, 0.4, { gain: 0.04 }); // sparkle
      break;
    case 'fail': // two soft falling notes, not harsh
      tone(260, t, 0.22, { type: 'sawtooth', gain: 0.07, lp: 700, to: 200 });
      tone(196, t + 0.16, 0.34, { type: 'sawtooth', gain: 0.07, lp: 600, to: 130 });
      break;
    case 'whoosh': // the warp jump: rising then falling rush of air
      noise(t, 1.05, { type: 'bandpass', freq: 250, to: 3400, q: 0.9, gain: 0.22, attack: 0.55 });
      noise(t + 0.5, 0.7, { type: 'lowpass', freq: 3200, to: 200, q: 0.6, gain: 0.12, attack: 0.1 });
      tone(110, t, 0.9, { type: 'sine', gain: 0.1, to: 720, attack: 0.5 });
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.11, 0.55, { type: 'triangle', gain: 0.1 }));
      [523.25, 659.25, 783.99].forEach((f) => tone(f, t + 0.5, 0.9, { type: 'sine', gain: 0.06 }));
      tone(2093, t + 0.55, 0.6, { gain: 0.03 });
      break;
    case 'ping': // a friendly "someone wants you"
      tone(988, t, 0.25, { gain: 0.09 });
      tone(1319, t + 0.11, 0.4, { gain: 0.09 });
      break;
  }
}

/* ------------------------------------------------------------ slug voices */

// Each slug has its own pitch and timbre so you can tell them apart by ear.
const VOICE: Record<SlugVoiceId, { base: number; wave: OscillatorType; lp: number }> = {
  embo: { base: 330, wave: 'triangle', lp: 2600 }, // warm and round
  jolt: { base: 620, wave: 'square', lp: 3200 }, // bright and zappy
  sprig: { base: 470, wave: 'sine', lp: 3600 }, // soft and airy
};

export function slugSound(id: SlugVoiceId, kind: SlugSound) {
  if (!live() || !ctx || throttled(`slug:${id}`, 220)) return;
  const v = VOICE[id];
  const t = ctx.currentTime + 0.005;
  const b = v.base * (0.96 + Math.random() * 0.08); // never the exact same sound twice
  const o = { type: v.wave, lp: v.lp };
  switch (kind) {
    case 'chirp': // two quick rising notes
      tone(b, t, 0.1, { ...o, gain: 0.08, to: b * 1.5 });
      tone(b * 1.25, t + 0.12, 0.13, { ...o, gain: 0.08, to: b * 1.9 });
      break;
    case 'squelch': { // a wet glide down through a wobbling filter
      const osc = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(b * 0.75, t);
      osc.frequency.exponentialRampToValueAtTime(b * 0.22, t + 0.26);
      f.type = 'lowpass';
      f.Q.value = 9;
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(180, t + 0.26);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(f).connect(g).connect(fxBus);
      osc.start(t);
      osc.stop(t + 0.35);
      tone(b * 1.4, t + 0.27, 0.06, { type: 'sine', gain: 0.05, to: b * 2 }); // the little "plop"
      break;
    }
    case 'cheer': // a happy run up the scale with a bit of vibrato
      [1, 1.25, 1.5, 2].forEach((m, i) => tone(b * m, t + i * 0.075, 0.18, { ...o, gain: 0.075, vibrato: [14, b * 0.02] }));
      break;
    case 'snore': { // a slow breath in and out
      tone(95 * (b / 400), t, 1.5, { type: 'triangle', gain: 0.05, attack: 0.7, to: 82 * (b / 400), lp: 400 });
      noise(t, 1.5, { type: 'lowpass', freq: 500, q: 0.4, gain: 0.025, attack: 0.7 });
      break;
    }
    case 'dizzy': // wobbling downward
      for (let i = 0; i < 6; i++) tone(b * (i % 2 ? 1.2 : 0.9) * (1 - i * 0.06), t + i * 0.09, 0.12, { ...o, gain: 0.06 });
      break;
  }
}

/* -------------------------------------------------------------- ambience */

interface Scene {
  /** sustained chord */
  pad?: { freqs: number[]; type: OscillatorType; lp: number; gain: number; sway?: number };
  /** slow throbbing low note */
  pulse?: { freq: number; rate: number; gain: number };
  /** airy or crowd-like noise bed */
  air?: { type: BiquadFilterType; freq: number; q: number; gain: number; sway?: number };
  /** sparse random notes: chimes, blips, plucks, bells */
  notes?: {
    pitches: number[];
    wave: OscillatorType;
    dur: number;
    gain: number;
    every: [minSec: number, maxSec: number];
    burst?: [min: number, max: number];
    overtone?: number;
  };
}

const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
const scale = (root: number, mults = PENTA) => mults.map((m) => root * m);

const SCENES: Record<string, Scene> = {
  // the lobby: calm, spacious, a little starry
  home: {
    pad: { freqs: [110, 164.8, 220, 261.6], type: 'sine', lp: 900, gain: 0.05, sway: 0.05 },
    air: { type: 'lowpass', freq: 500, q: 0.5, gain: 0.02, sway: 0.04 },
    notes: { pitches: scale(523.25), wave: 'sine', dur: 2.6, gain: 0.04, every: [4, 9], overtone: 2 },
  },
  // Quick Arena: a steady heartbeat of energy
  arena: {
    pulse: { freq: 55, rate: 1.7, gain: 0.12 },
    pad: { freqs: [110, 165], type: 'sawtooth', lp: 480, gain: 0.025, sway: 0.08 },
    air: { type: 'highpass', freq: 5000, q: 0.4, gain: 0.008 },
    notes: { pitches: scale(660), wave: 'sine', dur: 0.5, gain: 0.03, every: [3, 6] },
  },
  // Cipher Lab: machine hum and sparse digital blips
  'cipher-lab': {
    pad: { freqs: [60, 120, 180], type: 'sine', lp: 600, gain: 0.04 },
    air: { type: 'lowpass', freq: 300, q: 0.5, gain: 0.015 },
    notes: { pitches: [1200, 1600, 1800, 2400, 3200], wave: 'square', dur: 0.05, gain: 0.014, every: [0.8, 2.6], burst: [1, 4] },
  },
  // Social Spark (co-op): warm, friendly, bell-like
  spark: {
    pad: { freqs: [130.8, 164.8, 196, 261.6], type: 'triangle', lp: 1200, gain: 0.04, sway: 0.06 },
    notes: { pitches: scale(523.25, [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]), wave: 'sine', dur: 1.8, gain: 0.04, every: [3, 6], burst: [2, 3], overtone: 3 },
  },
  // Brain Bazaar: market murmur and marimba plucks
  'brain-bazaar': {
    pad: { freqs: [146.8, 220], type: 'triangle', lp: 700, gain: 0.025 },
    air: { type: 'bandpass', freq: 650, q: 0.7, gain: 0.03, sway: 0.3 },
    notes: { pitches: scale(392), wave: 'sine', dur: 0.45, gain: 0.05, every: [1.4, 4], overtone: 4 },
  },
  // Midnight Mystery: low drone, wind, a distant bell
  'midnight-mystery': {
    pad: { freqs: [55, 55.6, 82.4], type: 'sawtooth', lp: 220, gain: 0.05, sway: 0.04 },
    air: { type: 'bandpass', freq: 420, q: 1.2, gain: 0.025, sway: 0.1 },
    notes: { pitches: [196, 233.1], wave: 'sine', dur: 4.5, gain: 0.05, every: [7, 14], overtone: 2.4 },
  },
  // the two labs
  'chain-lab': {
    pad: { freqs: [98, 147, 196], type: 'sine', lp: 700, gain: 0.04, sway: 0.05 },
    notes: { pitches: [440, 660, 880, 1320], wave: 'triangle', dur: 0.3, gain: 0.03, every: [1.5, 4], burst: [1, 3] },
  },
  'ai-lab': {
    pad: { freqs: [130.8, 196, 293.7], type: 'sine', lp: 1000, gain: 0.04, sway: 0.1 },
    air: { type: 'lowpass', freq: 800, q: 0.5, gain: 0.012, sway: 0.2 },
    notes: { pitches: scale(784), wave: 'sine', dur: 0.4, gain: 0.03, every: [1.2, 3.5], burst: [2, 4] },
  },
};

interface Running {
  scene: string;
  out: GainNode;
  stop: () => void;
}

let running: Running | null = null;
const stack: { scene: string }[] = [];

function buildScene(name: string): Running | null {
  if (!ctx) return null;
  const def = SCENES[name] ?? SCENES.home!;
  const out = ctx.createGain();
  out.gain.value = 0.0001;
  out.connect(ambBus);
  const sources: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];
  const t0 = ctx.currentTime;

  const sway = (param: AudioParam, rate: number, depth: number) => {
    const lfo = ctx!.createOscillator();
    const d = ctx!.createGain();
    lfo.frequency.value = rate;
    d.gain.value = depth;
    lfo.connect(d).connect(param);
    lfo.start(t0);
    sources.push(lfo);
  };

  if (def.pad) {
    const { freqs, type, lp, gain, sway: sw } = def.pad;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.value = gain;
    f.connect(g).connect(out);
    for (const hz of freqs) {
      for (const detune of [-6, 6]) { // two slightly detuned voices make it shimmer
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz;
        o.detune.value = detune;
        o.connect(f);
        o.start(t0);
        sources.push(o);
      }
    }
    if (sw) sway(f.frequency, 0.07, lp * sw * 3);
  }

  if (def.pulse) {
    const o = ctx.createOscillator();
    o.frequency.value = def.pulse.freq;
    const g = ctx.createGain();
    g.gain.value = def.pulse.gain / 2;
    sway(g.gain, def.pulse.rate, def.pulse.gain / 2); // gain wobbles between 0 and the full level
    o.connect(g).connect(out);
    o.start(t0);
    sources.push(o);
  }

  if (def.air) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = def.air.type;
    f.frequency.value = def.air.freq;
    f.Q.value = def.air.q;
    const g = ctx.createGain();
    g.gain.value = def.air.gain;
    src.connect(f).connect(g).connect(out);
    src.start(t0);
    sources.push(src);
    if (def.air.sway) sway(f.frequency, 0.11, def.air.freq * def.air.sway * 3);
  }

  if (def.notes) {
    const n = def.notes;
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
    const fire = () => {
      if (!ctx) return;
      if (ctx.state !== 'running') { // paused (muted / hidden tab): skip, don't queue a burst
        timers.push(window.setTimeout(fire, 3000));
        return;
      }
      const count = n.burst ? n.burst[0] + Math.floor(Math.random() * (n.burst[1] - n.burst[0] + 1)) : 1;
      for (let i = 0; i < count; i++) {
        const hz = pick(n.pitches);
        const at = ctx.currentTime + 0.02 + i * (n.burst ? 0.09 : 0);
        tone(hz, at, n.dur, { type: n.wave, gain: n.gain, attack: 0.01, dest: out });
        if (n.overtone) tone(hz * n.overtone, at, n.dur * 0.6, { gain: n.gain * 0.35, dest: out });
      }
      timers.push(window.setTimeout(fire, (n.every[0] + Math.random() * (n.every[1] - n.every[0])) * 1000));
    };
    timers.push(window.setTimeout(fire, 800 + Math.random() * 1500));
  }

  return {
    scene: name,
    out,
    stop: () => {
      timers.forEach(clearTimeout);
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      out.disconnect();
    },
  };
}

function refreshAmbience() {
  if (!ctx) return;
  const wanted = stack.length ? stack[stack.length - 1]!.scene : null;
  if (running?.scene === wanted) return;

  const old = running;
  running = null;
  const t = ctx.currentTime;
  if (old) {
    old.out.gain.cancelScheduledValues(t);
    old.out.gain.setValueAtTime(old.out.gain.value, t);
    old.out.gain.linearRampToValueAtTime(0.0001, t + 2.2);
    window.setTimeout(old.stop, 2500);
  }
  if (wanted) {
    const next = buildScene(wanted);
    if (next) {
      next.out.gain.setValueAtTime(0.0001, t);
      next.out.gain.linearRampToValueAtTime(1, t + 2.5); // a slow crossfade between rooms
      running = next;
    }
  }
}

/**
 * Ask for an ambience loop for as long as the caller exists. The most recent
 * request wins, and when it is released the previous one comes back, so a game
 * room can play over the lobby and hand it back on leaving.
 */
export function requestAmbience(scene: string): () => void {
  const entry = { scene };
  stack.push(entry);
  refreshAmbience();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    refreshAmbience();
  };
}

/* ----------------------------------------------------------- page wiring */

const CLICKABLE = 'button, a[href], [role="button"], summary, select, input[type="checkbox"], [role="switch"]';
const OWN_SOUND = '.sb-slug, .em-body, .em-hide, .em-show'; // slugs make their own noises

/** Call once at startup: unlocks audio on the first tap and adds soft UI clicks. */
export function initSound() {
  const onDown = (e: Event) => {
    unlockSound();
    const el = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
    if (!el || el.closest(OWN_SOUND) || (el as HTMLButtonElement).disabled) return;
    sfx('click');
  };
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  window.addEventListener('keydown', () => unlockSound(), { capture: true, passive: true });
}
