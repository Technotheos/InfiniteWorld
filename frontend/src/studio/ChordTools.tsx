import { useState } from 'react';
import type { MusicState } from './audio';
import type { StudioSend } from './studioApi';
import {
  barsNeeded,
  bassFromChords,
  chordPalette,
  inScale,
  invert,
  keyLabel,
  MAX_BARS,
  MELODIC_TRACKS,
  progressionNotes,
  progressionsFor,
  STEPS_PER_BAR,
  voiceChord,
  type Chord,
  type ChordMode,
  type Key,
  type NoteDraft,
  type Progression,
} from './theory';

interface Props {
  roomKey: Key;
  music: MusicState;
  track: number;
  cursor: number;
  setCursor: (s: number) => void;
  canEdit: boolean;
  isHost: boolean;
  send: StudioSend;
  onPreview: (track: number, midi: number, vel?: number) => void;
  onShowTrack: (t: number) => void;
}

const LENGTHS = [
  { steps: 4, label: '1 beat' },
  { steps: 8, label: '2 beats' },
  { steps: 16, label: '1 bar' },
  { steps: 32, label: '2 bars' },
];
const MODES: { id: ChordMode; label: string }[] = [
  { id: 'block', label: 'Block' },
  { id: 'strum', label: 'Strum' },
  { id: 'arp-up', label: 'Arp ↑' },
  { id: 'arp-down', label: 'Arp ↓' },
];

/** Chord tools: a palette built from the room's key, progression presets, inversions, strum and arpeggio. One click drops editable notes. */
export function ChordTools({ roomKey, music, track, cursor, setCursor, canEdit, isHost, send, onPreview, onShowTrack }: Props) {
  const [seventh, setSeventh] = useState(false);
  const [inv, setInv] = useState(0);
  const [mode, setMode] = useState<ChordMode>('block');
  const [len, setLen] = useState(16);

  const target = track === 2 ? 0 : track; // chords go on the chord or melody track; the bass has its own button
  const loopSteps = music.bars * STEPS_PER_BAR;
  const palette = chordPalette(roomKey, seventh);
  const progs = progressionsFor(roomKey.scale);
  // With the lock on, a chord with a note outside the scale (pentatonic and blues keys) would be refused by the room.
  const usable = (c: Chord) => !roomKey.lock || c.pitches.every((p) => inScale(roomKey.root, roomKey.scale, p));
  const cur = cursor + len > loopSteps ? 0 : cursor;

  /** Clears whatever the target track has in a time range, then writes the new notes: dropping a chord replaces the one under it. */
  const replace = (t: number, from: number, to: number, batches: NoteDraft[][]) => {
    const ids = music.notes.filter((n) => n.t === t && n.s < to && n.s + n.l > from).map((n) => n.id);
    for (let i = 0; i < ids.length; i += 64) send('note_del', { ids: ids.slice(i, i + 64) });
    for (const notes of batches) if (notes.length) send('note_add', { t, notes });
  };

  const drop = (c: Chord) => {
    const l = Math.min(len, loopSteps - cur);
    const pitches = invert(c.pitches, inv % c.pitches.length);
    replace(target, cur, cur + l, [voiceChord(pitches, mode, cur, l)]);
    pitches.forEach((p) => onPreview(target, p, 90));
    onShowTrack(target);
    setCursor(cur + l >= loopSteps ? 0 : cur + l);
  };

  const needBars = (p: Progression) => barsNeeded(p.degrees.length, len);
  const dropProgression = (p: Progression) => {
    const need = needBars(p);
    if (need > music.bars) {
      if (!isHost) return;
      send('bars', { n: need }); // the host's click lengthens the pattern to fit
    }
    const batches = progressionNotes(roomKey, p, { seventh, inversion: inv, mode, length: len, vel: 100 }, 0);
    replace(target, 0, p.degrees.length * len, batches);
    onShowTrack(target);
    setCursor(0);
  };

  const chordNotes = music.notes.filter((n) => n.t === 0);
  const sub = () => {
    const drafts = bassFromChords(chordNotes, loopSteps);
    const old = music.notes.filter((n) => n.t === 2).map((n) => n.id);
    for (let i = 0; i < old.length; i += 64) send('note_del', { ids: old.slice(i, i + 64) });
    if (drafts.length) send('note_add', { t: 2, notes: drafts });
    onShowTrack(2);
  };

  const bar = Math.floor(cur / STEPS_PER_BAR) + 1;
  const beat = Math.floor((cur % STEPS_PER_BAR) / 4) + 1;

  return (
    <details className="sp-chords" open>
      <summary>Chord tools <span className="sp-sub">· {keyLabel(roomKey)}</span></summary>

      <div className="sp-tools">
        <label className="sp-field">
          Length
          <select className="sp-kit sp-wide" value={len} onChange={(e) => setLen(Number(e.target.value))} aria-label="Chord length">
            {LENGTHS.map((l) => (
              <option key={l.steps} value={l.steps}>{l.label}</option>
            ))}
          </select>
        </label>
        <div className="sp-seg" role="group" aria-label="Chord style">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <label className="sp-field">
          Inversion
          <select className="sp-kit sp-wide" value={inv} onChange={(e) => setInv(Number(e.target.value))} aria-label="Inversion">
            <option value={0}>Root</option>
            <option value={1}>1st</option>
            <option value={2}>2nd</option>
            {seventh && <option value={3}>3rd</option>}
          </select>
        </label>
        <label className="sp-check sp-inline">
          <input type="checkbox" checked={seventh} onChange={(e) => { setSeventh(e.target.checked); if (!e.target.checked && inv > 2) setInv(0); }} />
          7ths
        </label>
      </div>

      <div className="sp-chordrow" role="group" aria-label="Chords in this key">
        {palette.map((c) => (
          <button key={c.degree} type="button" className="sp-chord" disabled={!canEdit || !usable(c)} onClick={() => drop(c)} title={usable(c) ? `Drop ${c.name} at bar ${bar}, beat ${beat}` : 'Has notes outside this scale. Turn the key lock off, or pick a seven-note scale.'}>
            <b>{c.name}</b>
            <span>{c.numeral}</span>
          </button>
        ))}
      </div>
      <p className="sp-sub" role="status">
        Drops on {MELODIC_TRACKS[target]!.label} at bar {bar}, beat {beat}, then the cursor moves along so you can click the next chord.{' '}
        <button type="button" className="sp-link" onClick={() => setCursor(0)}>Back to start</button> (or click the ruler)
      </p>

      <h3 className="sp-h3">Progressions</h3>
      <div className="sp-chordrow" role="group" aria-label="Progression presets">
        {progs.map((p) => {
          const need = needBars(p);
          const blocked = !canEdit || need > MAX_BARS || (need > music.bars && !isHost);
          return (
            <button key={p.id} type="button" className="sp-prog" disabled={blocked} onClick={() => dropProgression(p)} title={need > music.bars ? (isHost ? `Lengthens the pattern to ${need} bars` : `Needs ${need} bars: ask the host to lengthen the pattern`) : 'Replaces the chords at the start of the pattern'}>
              <b>{p.label}</b>
              <span>{p.numerals}</span>
            </button>
          );
        })}
      </div>

      <h3 className="sp-h3">808</h3>
      <div className="sp-rec-row">
        <button type="button" className="sp-btn" disabled={!canEdit || chordNotes.length === 0} onClick={sub}>Bass follows the chords</button>
        <span className="sp-sub">One 808 note on each chord's root, always in the key. Replaces the bass notes. Touching notes glide.</span>
      </div>
    </details>
  );
}
