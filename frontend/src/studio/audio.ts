/* Starship Studio audio. Everything here is local; the SERVER owns the tempo and the pattern.
 * Every client derives the same beat from (epoch, offset, bpm) plus its own measured offset to the
 * server clock, so all rooms' lights and sounds land together. */

import { delaySeconds, type Note } from './theory';
import { loadInstrument, playNote, type NoteOpts } from './instruments';

export const TRACKS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'clap', label: 'Clap' },
  { id: 'hat', label: 'Hat' },
  { id: 'ohat', label: 'Open hat' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Lead' },
  { id: 'perc', label: 'Perc' },
] as const;

/** Channels on the mixer: the 8 grid tracks, then chords, melody and bass/808 (see theory.ts MELODIC_TRACKS). */
export const MELODIC_COUNT = 3;
export const CHANNELS = TRACKS.length + MELODIC_COUNT;
/** The channel index of a melodic track. Solo and the shared sends use channel numbers. */
export const channelOfMelodic = (t: number) => TRACKS.length + t;

export const DEFAULT_BARS = 4;
/** Beats in a pattern of `bars` bars (4/4). Drums repeat every bar underneath; notes and takes loop at this length. */
export const loopBeatsFor = (bars: number) => bars * 4;
/** The old fixed 4-bar loop, kept for code that has no pattern length to hand. */
export const LOOP_BEATS = loopBeatsFor(DEFAULT_BARS);

/** The melodic half of the room: everything the engine needs to play the piano roll and shape the space around it. */
export interface MusicState {
  notes: Note[];
  bars: number;
  instr: string[];
  /** per channel: [reverb send, delay send], 0..100 */
  send: number[][];
  nvol: number[];
  nmute: boolean[];
  /** master filter, 100 = wide open */
  filter: number;
  dlyDiv: string;
  dlyFB: number;
}

export const EMPTY_MUSIC: MusicState = {
  notes: [],
  bars: DEFAULT_BARS,
  instr: ['piano', 'bell', 'sub808'],
  send: Array.from({ length: CHANNELS }, () => [0, 0]),
  nvol: [80, 80, 80],
  nmute: [false, false, false],
  filter: 100,
  dlyDiv: '1/8d',
  dlyFB: 40,
};

/** Filter knob (0..100) to cutoff in Hz: 100 is wide open, and it sweeps down exponentially, the way a filter sweep should feel. */
export const filterHz = (v: number) => (v >= 100 ? 20000 : 120 * Math.pow(20000 / 120, Math.max(0, v) / 100));
/** Send knob (0..100) to gain. */
export const sendGain = (v: number) => Math.pow(Math.min(100, Math.max(0, v)) / 100, 1.4);

/* ---- drum kits ------------------------------------------------------------- */

/** Must match studioKitIDs in backend-go/studio_room.go. The files are rendered by scripts/make-kits.py. */
export const KITS = [
  { id: 'boombap', label: 'Boom Bap' },
  { id: 'trap', label: '808 Trap' },
  { id: 'house', label: 'Tight House' },
  { id: 'lofi', label: 'Dusty Lo-Fi' },
] as const;

/** Which sample file each track plays. null = a live synth voice (bass, lead). Same order as TRACKS. */
export const KIT_VOICE: readonly (string | null)[] = ['kick', 'snare', 'clap', 'hat', 'ohat', null, null, 'perc'];
export const isDrumTrack = (t: number) => KIT_VOICE[t] != null;

export const VEL_MIN = 1;
export const VEL_MAX = 127;
export const VEL_GHOST = 40;
export const VEL_NORMAL = 100;
export const VEL_ACCENT = 124;
/** Swing as the server stores it: percent, 50 = straight 16ths, 66 = triplet feel. */
export const SWING_MIN = 50;
export const SWING_MAX = 75;

/** The velocity a pad gets when placed without one. Mirrors studioDefaultVel on the server. */
export const defaultVel = (track: number, step: number) => (track === 3 && step % 4 !== 0 ? 72 : VEL_NORMAL);

/** Everything the sequencer needs from the room, in one object. */
export interface EnginePattern {
  on: boolean[][];
  vel: number[][];
  kits: string[];
  vol: number[];
  mute: boolean[];
  swing: number;
}

/** MIDI-ish velocity (1..127) to gain. A curve, so a ghost note is really quiet and an accent really pops. */
export const velAmp = (v: number) => Math.pow(Math.min(VEL_MAX, Math.max(VEL_MIN, v)) / VEL_MAX, 1.2);
/** Fader (0..100) to gain. 80 is the default and sits at about 0.94. */
export const faderGain = (v: number) => Math.pow(Math.min(100, Math.max(0, v)) / 100, 1.8) * 1.4;

/* ---- shared clock --------------------------------------------------------- */

export class StudioClock {
  skew = 0; // server ms minus local ms
  epoch = Date.now();
  offset = 0;
  bpm = 90;
  playing = true;
  version = 0;

  apply(t: { epoch: number; offset: number; bpm: number; playing: boolean }) {
    if (t.epoch !== this.epoch || t.offset !== this.offset || t.bpm !== this.bpm || t.playing !== this.playing) this.version++;
    this.epoch = t.epoch;
    this.offset = t.offset;
    this.bpm = t.bpm;
    this.playing = t.playing;
  }
  serverNow() {
    return Date.now() + this.skew;
  }
  beat(): number {
    if (!this.playing) return this.offset;
    return this.offset + ((this.serverNow() - this.epoch) * this.bpm) / 60000;
  }
}

/* ---- context -------------------------------------------------------------- */

let ctx: AudioContext | null = null;
let master: GainNode;
let comp: DynamicsCompressorNode;
let analyser: AnalyserNode;
let seqBus: GainNode;
let channelGain: GainNode[] = [];
let sendRev: GainNode[] = [];
let sendDly: GainNode[] = [];
let masterFilter: BiquadFilterNode;
let dlyDelay: DelayNode;
let dlyFb: GainNode;
let loungeBus: GainNode;
let noise: AudioBuffer;

/** A synthetic room: stereo noise that fades out and gets darker as it dies, with a 20 ms pre-delay. */
function makeImpulse(c: BaseAudioContext, sec = 2.8): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * sec);
  const pre = Math.floor(sr * 0.02);
  const b = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      lp += ((Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) - lp) * (0.75 - 0.6 * t);
      d[i] = lp;
    }
  }
  return b;
}

/** The shared effects: one reverb and one tempo-synced echo that every channel can send to, then a master filter. */
function buildFx(c: AudioContext) {
  const revIn = c.createGain();
  const conv = c.createConvolver();
  conv.buffer = makeImpulse(c);
  const revOut = c.createGain();
  revOut.gain.value = 0.9;
  revIn.connect(conv).connect(revOut).connect(seqBus);

  const dlyIn = c.createGain();
  dlyDelay = c.createDelay(2);
  dlyDelay.delayTime.value = delaySeconds(EMPTY_MUSIC.dlyDiv, 90);
  dlyFb = c.createGain();
  dlyFb.gain.value = EMPTY_MUSIC.dlyFB / 100;
  const tone = c.createBiquadFilter(); // each repeat is a little darker
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  const dlyOut = c.createGain();
  dlyOut.gain.value = 0.85;
  dlyIn.connect(dlyDelay);
  dlyDelay.connect(tone);
  tone.connect(dlyFb).connect(dlyDelay);
  tone.connect(dlyOut).connect(seqBus);
  const dlyToRev = c.createGain(); // the echoes also sit in the room
  dlyToRev.gain.value = 0.25;
  tone.connect(dlyToRev).connect(revIn);

  sendRev = channelGain.map((g) => {
    const s = c.createGain();
    s.gain.value = 0;
    g.connect(s).connect(revIn);
    return s;
  });
  sendDly = channelGain.map((g) => {
    const s = c.createGain();
    s.gain.value = 0;
    g.connect(s).connect(dlyIn);
    return s;
  });
}

function mkNoise(c: BaseAudioContext): AudioBuffer {
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Call from a click: browsers only start audio after a gesture. */
export function ensureAudio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    comp = ctx.createDynamicsCompressor();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    seqBus = ctx.createGain();
    masterFilter = ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 20000;
    masterFilter.Q.value = 0.8;
    loungeBus = ctx.createGain();
    loungeBus.gain.value = 0.7;
    channelGain = Array.from({ length: CHANNELS }, () => {
      const g = ctx!.createGain();
      g.connect(seqBus);
      return g;
    });
    buildFx(ctx);
    seqBus.connect(masterFilter);
    masterFilter.connect(comp);
    loungeBus.connect(comp);
    comp.connect(master);
    master.connect(analyser);
    master.connect(ctx.destination);
    noise = mkNoise(ctx);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const setMasterVolume = (v: number) => {
  if (master) master.gain.value = v;
};
export const setLoungeVolume = (v: number) => {
  if (loungeBus) loungeBus.gain.value = v;
};
/** 0..1 overall loudness, for meters. */
export function masterLevel(): number {
  if (!analyser) return 0;
  const a = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s = Math.max(s, Math.abs(a[i]! - 128));
  return s / 128;
}

/* ---- kit loader ------------------------------------------------------------- */

export type KitStatus = 'idle' | 'loading' | 'ready' | 'failed';
const kitBuffers = new Map<string, Map<string, AudioBuffer>>();
const kitState = new Map<string, KitStatus>();
const kitFailedAt = new Map<string, number>();
const kitListeners = new Set<() => void>();
const emitKits = () => kitListeners.forEach((f) => f());

export const kitStatus = (id: string): KitStatus => kitState.get(id) ?? 'idle';
export function onKitChange(fn: () => void): () => void {
  kitListeners.add(fn);
  return () => void kitListeners.delete(fn);
}

/**
 * Fetches and decodes one kit (every voice in parallel). A voice that fails to load simply falls back to
 * the built-in synth for that voice, so a missing file never makes a track silent. A failed kit is retried
 * after 15 s. Needs the audio context, so it is a no-op until the person has boarded (a click).
 */
export async function loadKit(id: string): Promise<void> {
  const c = ctx;
  if (!c || !KITS.some((k) => k.id === id)) return; // ids come from the server: only ever load a known one
  const st = kitState.get(id);
  if (st === 'loading' || st === 'ready') return;
  if (st === 'failed' && Date.now() - (kitFailedAt.get(id) ?? 0) < 15000) return;
  kitState.set(id, 'loading');
  emitKits();
  const names = [...new Set(KIT_VOICE.filter((v): v is string => v != null))];
  const got = new Map<string, AudioBuffer>();
  await Promise.all(
    names.map(async (n) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}studio-kits/${id}/${n}.wav`);
        if (!res.ok) return;
        got.set(n, await decode(await res.arrayBuffer()));
      } catch {
        /* this voice falls back to the synth */
      }
    }),
  );
  if (got.size) {
    kitBuffers.set(id, got);
    kitState.set(id, 'ready');
  } else {
    kitState.set(id, 'failed');
    kitFailedAt.set(id, Date.now());
  }
  emitKits();
}

/* ---- synth voices (work on a live or an offline context) ------------------- */

const A_MINOR = [0, 3, 5, 7, 10]; // pentatonic offsets
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

type Dest = AudioNode;
type NoiseSrc = AudioBuffer;

function env(c: BaseAudioContext, dest: Dest, t: number, peak: number, dur: number, attack = 0.002): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  return g;
}

function noiseHit(c: BaseAudioContext, nb: NoiseSrc, dest: Dest, t: number, dur: number, type: BiquadFilterType, freq: number, peak: number) {
  const s = c.createBufferSource();
  s.buffer = nb;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  s.connect(f).connect(env(c, dest, t, peak, dur));
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

function osc(c: BaseAudioContext, dest: Dest, t: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  o.connect(env(c, dest, t, peak, dur));
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Plays one step of one track. `step` picks the note for the pitched tracks. */
export function voice(c: BaseAudioContext, nb: NoiseSrc, dest: Dest, track: number, step: number, t: number, vel = 1, root = 45) {
  switch (track) {
    case 0:
      osc(c, dest, t, 0.32, 'sine', 150, 42, 0.9 * vel);
      break;
    case 1:
      noiseHit(c, nb, dest, t, 0.18, 'highpass', 1800, 0.5 * vel);
      osc(c, dest, t, 0.12, 'triangle', 230, 140, 0.35 * vel);
      break;
    case 2:
      for (let i = 0; i < 3; i++) noiseHit(c, nb, dest, t + i * 0.011, 0.09, 'bandpass', 1500, 0.4 * vel);
      noiseHit(c, nb, dest, t + 0.033, 0.18, 'bandpass', 1400, 0.35 * vel);
      break;
    case 3:
      noiseHit(c, nb, dest, t, 0.05, 'highpass', 7500, 0.28 * vel);
      break;
    case 4:
      noiseHit(c, nb, dest, t, 0.3, 'highpass', 6500, 0.24 * vel);
      break;
    case 5: {
      const n = root + A_MINOR[(step >> 1) % A_MINOR.length]!;
      osc(c, dest, t, 0.28, 'sawtooth', hz(n), hz(n), 0.3 * vel);
      osc(c, dest, t, 0.28, 'sine', hz(n - 12), hz(n - 12), 0.4 * vel);
      break;
    }
    case 6: {
      const n = root + 24 + A_MINOR[(step * 3) % A_MINOR.length]!;
      osc(c, dest, t, 0.22, 'square', hz(n), hz(n), 0.12 * vel);
      osc(c, dest, t, 0.4, 'triangle', hz(n + 12), hz(n + 12), 0.1 * vel);
      break;
    }
    default:
      osc(c, dest, t, 0.09, 'sine', 900 + (step % 4) * 180, 500, 0.3 * vel);
  }
}

/* ---- the live sequencer + take looper -------------------------------------- */

export interface Engine {
  start: () => void;
  stop: () => void;
  setPattern: (p: EnginePattern) => void;
  /** The piano roll's notes, instruments, sends, filter and pattern length. */
  setMusic: (m: MusicState) => void;
  /** Solo is a monitoring choice: it changes only what THIS listener hears. Channel numbers: 0..7 grid, 8..10 melodic. */
  setSolo: (s: ReadonlySet<number>) => void;
  setTakeBuffer: (id: string, b: AudioBuffer) => void;
  dropTake: (id: string) => void;
  setTakeMuted: (id: string, m: boolean) => void;
  setTakes: (t: { id: string; start_beat: number; kind: string }[]) => void;
  preview: (track: number, step: number, vel?: number) => void;
  /** Audition one pitch on a melodic track's instrument (clicking the roll or its piano keys). */
  previewNote: (track: number, midi: number, vel?: number) => void;
}

/** How long an 808 glide takes, in seconds. */
const GLIDE_SEC = 0.09;

interface Queued {
  note: Note;
  opts: NoteOpts;
}

export function createEngine(clock: StudioClock): Engine {
  let pat: EnginePattern = { on: [], vel: [], kits: [], vol: [], mute: [], swing: SWING_MIN };
  let music: MusicState = EMPTY_MUSIC;
  let byStart = new Map<number, Queued[]>();
  let solo: ReadonlySet<number> = new Set();
  let lastOpen: { g: GainNode; src: AudioBufferSourceNode } | null = null; // a closed hat chokes it
  let timer: number | undefined;
  let cursorBeat = 0; // beats up to here have been scheduled
  let seenVersion = -1;
  let lastDelaySec = -1;
  const buffers = new Map<string, AudioBuffer>();
  const muted = new Set<string>();
  let takes: { id: string; start_beat: number; kind: string }[] = [];
  const LOOK = 0.15;

  /** Is this channel heard right now? Solo wins over mute, as on a console. */
  const audible = (ch: number) => {
    if (solo.size > 0) return solo.has(ch);
    return ch < TRACKS.length ? !pat.mute[ch] : !music.nmute[ch - TRACKS.length];
  };

  /** Fader, mute, solo and the two effect sends for every channel. Smoothed, so moving a knob never clicks. */
  const applyMix = () => {
    if (!ctx) return;
    const now = ctx.currentTime;
    channelGain.forEach((g, ch) => {
      const vol = ch < TRACKS.length ? pat.vol[ch] ?? 80 : music.nvol[ch - TRACKS.length] ?? 80;
      g.gain.setTargetAtTime(audible(ch) ? faderGain(vol) : 0, now, 0.015);
      sendRev[ch]?.gain.setTargetAtTime(sendGain(music.send[ch]?.[0] ?? 0), now, 0.03);
      sendDly[ch]?.gain.setTargetAtTime(sendGain(music.send[ch]?.[1] ?? 0) * 0.9, now, 0.03);
    });
  };

  /** The master filter, the echo's feedback and its tempo-synced time. */
  const applyFx = () => {
    if (!ctx || !masterFilter) return;
    const now = ctx.currentTime;
    masterFilter.frequency.setTargetAtTime(filterHz(music.filter), now, 0.05);
    dlyFb.gain.setTargetAtTime(Math.min(0.9, music.dlyFB / 100), now, 0.05);
    const sec = delaySeconds(music.dlyDiv, clock.bpm);
    if (sec !== lastDelaySec) {
      lastDelaySec = sec;
      dlyDelay.delayTime.setTargetAtTime(sec, now, 0.08); // a tempo change slides the echo rather than clicking it
    }
  };

  /** Groups notes by their start step, and works out which 808 notes glide into each other. */
  const buildIndex = () => {
    byStart = new Map();
    const bass = music.notes.filter((n) => n.t === 2).sort((a, b) => a.s - b.s || a.p - b.p);
    const opts = new Map<number, NoteOpts>();
    bass.forEach((n, i) => {
      const prev = i > 0 ? bass[i - 1] : undefined;
      const next = bass[i + 1];
      const o: NoteOpts = { glideSec: GLIDE_SEC };
      if (prev && prev.s + prev.l >= n.s && prev.p !== n.p) o.glideFrom = prev.p; // touching: slide from the last note
      if (next && n.s + n.l >= next.s && next.p !== n.p) o.legatoNext = true; // ...and let the last one go quickly
      opts.set(n.id, o);
    });
    for (const n of music.notes) {
      const list = byStart.get(n.s) ?? [];
      list.push({ note: n, opts: opts.get(n.id) ?? {} });
      byStart.set(n.s, list);
    }
  };

  const loadInstruments = () => {
    if (ctx) for (const id of new Set(music.instr)) void loadInstrument(ctx, id);
  };

  /** One hit on one track: the kit's sample if it is loaded, otherwise the synth voice. */
  const hit = (track: number, step: number, t: number, vel: number) => {
    if (!ctx) return;
    const c = ctx;
    const amp = velAmp(vel);
    const dest = channelGain[track] ?? seqBus;
    const name = KIT_VOICE[track];
    const buf = name ? kitBuffers.get(pat.kits[track] ?? '')?.get(name) : undefined;
    if (!buf) {
      voice(c, noise, dest, track, step, t, amp);
      return;
    }
    if (track === 3 && lastOpen) {
      // a closed hat shuts the open one, like a real hi-hat pedal
      lastOpen.g.gain.setTargetAtTime(0, t, 0.006);
      try {
        lastOpen.src.stop(t + 0.06);
      } catch {
        /* already ended */
      }
      lastOpen = null;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = amp;
    src.connect(g).connect(dest);
    src.start(t);
    if (track === 4) lastOpen = { g, src };
  };

  /** How late an off-beat 16th lands, in beats. Swing 50 = 0, 66 = triplet feel, 75 = dotted. */
  const swingDelay = (step: number) => (step % 2 === 1 ? (pat.swing / 100 - 0.5) * 0.5 : 0);

  const tick = () => {
    if (!ctx || ctx.state !== 'running') return;
    if (!clock.playing) {
      seenVersion = -1;
      return;
    }
    const now = clock.beat();
    const spb = 60 / clock.bpm;
    if (seenVersion !== clock.version) {
      seenVersion = clock.version;
      cursorBeat = Math.ceil(now * 4) / 4 - 0.0001; // restart on the next 16th after a tempo change or join
      applyFx(); // the echo's time follows the tempo
    }
    const loopBeats = loopBeatsFor(music.bars);
    const loopSteps = music.bars * 16;
    const endBeat = now + LOOK / spb;
    while (cursorBeat < endBeat) {
      const b = Math.max(cursorBeat + 0.0001, now);
      const stepBeat = Math.ceil(b * 4 - 1e-6) / 4;
      if (stepBeat >= endBeat) break;
      const k = Math.round(stepBeat * 4); // the 16th note's number on the room's timeline
      const step = ((k % 16) + 16) % 16; // drums repeat every bar underneath a longer melody
      const t = ctx.currentTime + Math.max(0, (stepBeat + swingDelay(step) - now) * spb);
      for (let tr = 0; tr < pat.on.length; tr++) if (pat.on[tr]?.[step]) hit(tr, step, t, pat.vel[tr]?.[step] || defaultVel(tr, step));
      // piano-roll notes whose start falls on this 16th of the (possibly longer) pattern
      const here = byStart.get(((k % loopSteps) + loopSteps) % loopSteps);
      if (here) {
        for (const { note, opts } of here) {
          const ch = channelOfMelodic(note.t);
          if (!audible(ch)) continue;
          playNote(ctx, noise, channelGain[ch] ?? seqBus, music.instr[note.t] ?? 'piano', t, (note.l * spb) / 4, note.p, note.v, opts);
        }
      }
      // takes whose loop position falls on this beat boundary
      if (Number.isInteger(stepBeat)) {
        const pos = ((stepBeat % loopBeats) + loopBeats) % loopBeats;
        for (const tk of takes) {
          if (tk.kind !== 'take' || muted.has(tk.id)) continue;
          const buf = buffers.get(tk.id);
          if (!buf || ((tk.start_beat % loopBeats) + loopBeats) % loopBeats !== pos) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(seqBus);
          src.start(t);
          src.stop(t + Math.min(buf.duration, (loopBeats - pos) * spb)); // the loop restarts: cut at the end of the pattern
        }
      }
      cursorBeat = stepBeat;
    }
  };

  return {
    start: () => {
      ensureAudio();
      for (const k of new Set(pat.kits)) if (k) void loadKit(k);
      loadInstruments();
      applyMix();
      applyFx();
      if (timer === undefined) timer = window.setInterval(tick, 25);
    },
    stop: () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    },
    setPattern: (p) => {
      pat = p;
      if (ctx) for (const k of new Set(p.kits)) if (k) void loadKit(k);
      applyMix();
    },
    setMusic: (m) => {
      music = m;
      buildIndex();
      loadInstruments();
      applyMix();
      applyFx();
    },
    setSolo: (s) => {
      solo = s;
      applyMix();
    },
    setTakeBuffer: (id, b) => void buffers.set(id, b),
    dropTake: (id) => {
      buffers.delete(id);
      muted.delete(id);
    },
    setTakeMuted: (id, m) => void (m ? muted.add(id) : muted.delete(id)),
    setTakes: (t) => {
      takes = t;
    },
    preview: (track, step, vel) => {
      const c = ensureAudio();
      applyMix();
      hit(track, step, c.currentTime + 0.005, vel ?? defaultVel(track, step));
    },
    previewNote: (track, midi, vel) => {
      const c = ensureAudio();
      applyMix();
      loadInstruments();
      playNote(c, noise, channelGain[channelOfMelodic(track)] ?? seqBus, music.instr[track] ?? 'piano', c.currentTime + 0.005, 0.6, midi, vel ?? 100);
    },
  };
}

export async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const c = ensureAudio();
  return new Promise((res, rej) => c.decodeAudioData(data, res, rej));
}

/** 48 peaks for the ribbon waveform. */
export function peaks(b: AudioBuffer, n = 48): number[] {
  const d = b.getChannelData(0);
  const size = Math.max(1, Math.floor(d.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * size; j < Math.min(d.length, (i + 1) * size); j += 8) m = Math.max(m, Math.abs(d[j]!));
    out.push(m);
  }
  return out;
}

/* ---- Listening Lounge: generated house loops and uploaded tracks ------------ */

interface House {
  bpm: number;
  root: number;
  kick: string;
  snare: string;
  hat: string;
  bass: string;
  lead: string;
}
// Original loops, generated here. No samples, so nothing to license: royalty-free by construction.
const HOUSE: Record<string, House> = {
  'nebula-drift': { bpm: 100, root: 45, kick: '1000100010001000', snare: '0000100000001000', hat: '0010001000100010', bass: '1001001010010010', lead: '0000100000100000' },
  'ion-storm': { bpm: 128, root: 43, kick: '1000100010001000', snare: '0000100000001001', hat: '1111111111111111', bass: '0110011001100110', lead: '1010001010100010' },
  'orbital-lounge': { bpm: 84, root: 48, kick: '1000001010000010', snare: '0000100000001000', hat: '1010101010101010', bass: '1000000100100000', lead: '0001000000010010' },
  'cargo-bay-funk': { bpm: 108, root: 40, kick: '1001001000100100', snare: '0000100100001000', hat: '1011101110111011', bass: '1010010110100101', lead: '0000010000000100' },
  'pulsar-run': { bpm: 140, root: 46, kick: '1010101010101010', snare: '0000100000001000', hat: '0101010101010101', bass: '1101110111011101', lead: '1000100110001001' },
  'deep-field': { bpm: 92, root: 41, kick: '1000000010000000', snare: '0000000010000000', hat: '0000100000001000', bass: '1000000000100000', lead: '0010000100000000' },
};

const houseCache = new Map<string, AudioBuffer>();

export async function renderHouse(id: string): Promise<AudioBuffer | null> {
  const def = HOUSE[id];
  if (!def) return null;
  const hit = houseCache.get(id);
  if (hit) return hit;
  const sr = 44100;
  const bars = 8;
  const spStep = 60 / def.bpm / 4;
  const len = Math.ceil(bars * 16 * spStep * sr);
  const oc = new OfflineAudioContext(2, len, sr);
  const nb = mkNoise(oc);
  const bus = oc.createGain();
  bus.gain.value = 0.8;
  bus.connect(oc.destination);
  const pat = [def.kick, def.snare, def.hat, def.bass, def.lead];
  const map = [0, 1, 3, 5, 6];
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < 16; s++) {
      const t = (bar * 16 + s) * spStep;
      pat.forEach((p, i) => {
        if (p[s] !== '1') return;
        if (i === 4 && bar % 2 === 0 && s > 8) return; // the lead breathes every other bar
        voice(oc, nb, bus, map[i]!, s + bar, t, 0.9, def.root);
      });
    }
  }
  const out = await oc.startRendering();
  houseCache.set(id, out);
  return out;
}

export interface Lounge {
  play: (buf: AudioBuffer, offsetSec: number, loop: boolean) => void;
  stop: () => void;
}

export function createLounge(): Lounge {
  let cur: AudioBufferSourceNode | null = null;
  return {
    play: (buf, offsetSec, loop) => {
      const c = ensureAudio();
      cur?.stop();
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = loop;
      s.connect(loungeBus);
      const off = loop ? offsetSec % buf.duration : Math.min(Math.max(0, offsetSec), Math.max(0, buf.duration - 0.05));
      s.start(0, off);
      cur = s;
    },
    stop: () => {
      try {
        cur?.stop();
      } catch {
        /* already stopped */
      }
      cur = null;
    },
  };
}

/* ---- recording (the person pressed Record; nothing is ever captured remotely) -- */

export interface Recording {
  level: () => number;
  stop: () => Promise<{ blob: Blob; durMs: number }>;
  cancel: () => void;
}

function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i]!)) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export const MAX_TAKE_SECONDS = 180;

/** Asks for the microphone (the browser shows its own permission prompt) and starts capturing. */
export async function startRecording(onAutoStop: () => void): Promise<Recording> {
  const c = ensureAudio();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const t0 = performance.now();
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 256;
  src.connect(an);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  const level = () => {
    const a = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(a);
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - 128));
    return Math.min(1, m / 90);
  };
  const auto = window.setTimeout(onAutoStop, MAX_TAKE_SECONDS * 1000 - 500);

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
  if (mime) {
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.start(500);
    return {
      level,
      cancel: () => {
        window.clearTimeout(auto);
        if (rec.state !== 'inactive') rec.stop();
        src.disconnect();
        stopTracks();
      },
      stop: () =>
        new Promise((res) => {
          rec.onstop = () => {
            window.clearTimeout(auto);
            src.disconnect();
            stopTracks();
            res({ blob: new Blob(parts, { type: mime }), durMs: performance.now() - t0 });
          };
          rec.stop();
        }),
    };
  }

  // Safari: no WebM/Ogg recorder, so capture raw samples and write a WAV (an accepted format).
  const proc = c.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  const mute = c.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute).connect(c.destination);
  const done = () => {
    window.clearTimeout(auto);
    proc.disconnect();
    src.disconnect();
    stopTracks();
  };
  return {
    level,
    cancel: done,
    stop: async () => {
      done();
      return { blob: encodeWav(chunks, c.sampleRate), durMs: performance.now() - t0 };
    },
  };
}
