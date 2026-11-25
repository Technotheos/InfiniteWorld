/* Starship Studio audio. Everything here is local; the SERVER owns the tempo and the pattern.
 * Every client derives the same beat from (epoch, offset, bpm) plus its own measured offset to the
 * server clock, so all rooms' lights and sounds land together. */

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

export const LOOP_BEATS = 16; // the Mixer loops 4 bars

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
let loungeBus: GainNode;
let noise: AudioBuffer;

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
    loungeBus = ctx.createGain();
    loungeBus.gain.value = 0.7;
    seqBus.connect(comp);
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
  setGrid: (g: boolean[][]) => void;
  setTakeBuffer: (id: string, b: AudioBuffer) => void;
  dropTake: (id: string) => void;
  setTakeMuted: (id: string, m: boolean) => void;
  setTakes: (t: { id: string; start_beat: number; kind: string }[]) => void;
  preview: (track: number, step: number) => void;
}

export function createEngine(clock: StudioClock): Engine {
  let grid: boolean[][] = [];
  let timer: number | undefined;
  let cursorBeat = 0; // beats up to here have been scheduled
  let seenVersion = -1;
  const buffers = new Map<string, AudioBuffer>();
  const muted = new Set<string>();
  let takes: { id: string; start_beat: number; kind: string }[] = [];
  const LOOK = 0.15;

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
    }
    const endBeat = now + LOOK / spb;
    while (cursorBeat < endBeat) {
      const b = Math.max(cursorBeat + 0.0001, now);
      const stepBeat = Math.ceil(b * 4 - 1e-6) / 4;
      if (stepBeat >= endBeat) break;
      const t = ctx.currentTime + Math.max(0, (stepBeat - now) * spb);
      const step = ((Math.round(stepBeat * 4) % 16) + 16) % 16;
      for (let tr = 0; tr < grid.length; tr++) if (grid[tr]?.[step]) voice(ctx, noise, seqBus, tr, step, t, tr === 3 && step % 4 ? 0.7 : 1);
      // takes whose loop position falls on this beat boundary
      if (Number.isInteger(stepBeat)) {
        const pos = ((stepBeat % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
        for (const tk of takes) {
          if (tk.kind !== 'take' || muted.has(tk.id)) continue;
          const buf = buffers.get(tk.id);
          if (!buf || ((tk.start_beat % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS !== pos) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(seqBus);
          src.start(t);
          src.stop(t + Math.min(buf.duration, (LOOP_BEATS - pos) * spb)); // the loop restarts: cut at the bar line
        }
      }
      cursorBeat = stepBeat;
    }
  };

  return {
    start: () => {
      ensureAudio();
      if (timer === undefined) timer = window.setInterval(tick, 25);
    },
    stop: () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    },
    setGrid: (g) => {
      grid = g;
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
    preview: (track, step) => {
      const c = ensureAudio();
      voice(c, noise, seqBus, track, step, c.currentTime + 0.005, 0.8);
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
