import { useEffect, useRef, useState, type KeyboardEvent as RKeyEvent, type PointerEvent as RPointerEvent } from 'react';
import { channelOfMelodic, type MusicState, type StudioClock } from './audio';
import { ChordTools } from './ChordTools';
import { instrumentIsSampled, instrumentStatus } from './instruments';
import { PRODUCER_COLORS, type StudioMember, type StudioSend } from './studioApi';
import {
  inScale,
  instrumentsForTrack,
  isBlackKey,
  keyLabel,
  lockPitch,
  MELODIC_TRACKS,
  noteName,
  PITCH_MAX,
  PITCH_MIN,
  ROOTS,
  SCALES,
  SCALE_IDS,
  STEPS_PER_BAR,
  TRACK_VIEW_LOW,
  usesFlats,
  VIEW_ROWS,
  MAX_BARS,
  type Key,
  type Note,
} from './theory';

const STEP_W = 22; // px per sixteenth
const ROW_H = 16; // px per semitone
const KEYS_W = 58; // px for the keyboard column
const VIEW_LOW_MAX = PITCH_MAX - VIEW_ROWS + 1;
const DEFAULT_LEN = [4, 2, 4]; // a new note's length in sixteenths, per track, until you stretch one

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hashName = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;

interface Props {
  music: MusicState;
  roomKey: Key;
  members: StudioMember[];
  you: string;
  canEdit: boolean;
  isHost: boolean;
  clock: StudioClock;
  send: StudioSend;
  solo: ReadonlySet<number>;
  onSolo: (channel: number) => void;
  onPreview: (track: number, midi: number, vel?: number) => void;
}

interface Drag {
  id: number;
  kind: 'move' | 'resize';
  x0: number;
  y0: number;
  ds: number;
  dp: number;
  dl: number;
}
interface Making {
  p: number;
  s: number;
  l: number;
  dragged: boolean;
}

/** Piano Roll: the shared melody editor. Notes take the colour of whoever placed them and appear for everyone live. */
export function PianoRoll({ music, roomKey, members, you, canEdit, isHost, clock, send, solo, onSolo, onPreview }: Props) {
  const [track, setTrack] = useState(0);
  const [tool, setTool] = useState<'draw' | 'erase'>('draw');
  const [viewLow, setViewLow] = useState<number[]>([...TRACK_VIEW_LOW]);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [making, setMaking] = useState<Making | null>(null);
  const [cursor, setCursor] = useState(0); // where the chord tools drop the next chord, in steps
  const [follow, setFollow] = useState(true);
  const [kc, setKc] = useState<{ p: number; s: number } | null>(null); // keyboard cursor, shown while the grid has focus
  const [lastLen, setLastLen] = useState<number[]>(DEFAULT_LEN);
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<number> | null>(null);
  const busy = useRef(false);
  busy.current = drag !== null || making !== null;

  const loopSteps = music.bars * STEPS_PER_BAR;
  const low = viewLow[track]!;
  const rows = Array.from({ length: VIEW_ROWS }, (_, i) => low + VIEW_ROWS - 1 - i); // top row = highest pitch
  const flats = usesFlats(roomKey.root, roomKey.scale);
  const mine = music.notes.filter((n) => n.t === track);
  const others = music.notes.filter((n) => n.t !== track);
  const ch = channelOfMelodic(track);
  const instr = music.instr[track] ?? 'piano';
  const iStatus = instrumentStatus(instr);

  const colorOf = (owner: string) => {
    const m = members.find((x) => x.name === owner);
    return PRODUCER_COLORS[m ? m.color % 8 : hashName(owner)]!;
  };

  /* notes that arrive after you joined pop in, so you can see who just played something */
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(music.notes.map((n) => n.id));
      return;
    }
    const add = music.notes.filter((n) => !seen.current!.has(n.id));
    if (!add.length) return;
    add.forEach((n) => seen.current!.add(n.id));
    setFresh((f) => new Set([...f, ...add.map((n) => n.id)]));
    const t = window.setTimeout(() => setFresh(new Set()), 900);
    return () => window.clearTimeout(t);
  }, [music.notes]);

  /* the selection and the drag go away when their note does */
  useEffect(() => {
    if (selected !== null && !music.notes.some((n) => n.id === selected)) setSelected(null);
  }, [music.notes, selected]);

  /* the playhead follows the room's clock; the view follows the playhead */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const k = (((clock.beat() * 4) % loopSteps) + loopSteps) % loopSteps;
      const x = k * STEP_W;
      if (headRef.current) headRef.current.style.transform = `translateX(${x}px)`;
      const sc = scrollRef.current;
      if (follow && clock.playing && sc && !busy.current) {
        const left = sc.scrollLeft;
        if (x + KEYS_W < left + KEYS_W || x + KEYS_W > left + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - 60);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, loopSteps, follow]);

  /* ---- geometry -------------------------------------------------------------------- */

  const at = (e: { clientX: number; clientY: number }) => {
    const r = gridRef.current!.getBoundingClientRect();
    const s = clamp(Math.floor((e.clientX - r.left) / STEP_W), 0, loopSteps - 1);
    const row = clamp(Math.floor((e.clientY - r.top) / ROW_H), 0, VIEW_ROWS - 1);
    return { s, p: low + VIEW_ROWS - 1 - row };
  };

  /** Longest length (up to `want`) a note at (p, s) can have without running into the next note of that pitch. */
  const fitLen = (p: number, s: number, want: number) => {
    const next = Math.min(loopSteps, ...mine.filter((n) => n.p === p && n.s > s).map((n) => n.s));
    return Math.max(1, Math.min(want, next - s));
  };
  const occupied = (p: number, s: number) => mine.some((n) => n.p === p && n.s <= s && s < n.s + n.l);

  const addNote = (p: number, s: number, l: number) => {
    send('note_add', { t: track, notes: [{ p, s, l }] });
  };

  /* ---- drawing on empty grid ----------------------------------------------------- */

  const gridDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    gridRef.current?.focus({ preventScroll: true });
    const { s, p } = at(e);
    const pp = lockPitch(roomKey, p);
    onPreview(track, pp);
    if (!canEdit || tool === 'erase' || occupied(pp, s)) return;
    setSelected(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    setMaking({ p: pp, s, l: fitLen(pp, s, lastLen[track]!), dragged: false });
  };
  const gridMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!making) return;
    const { s } = at(e);
    const l = clamp(s - making.s + 1, 1, fitLen(making.p, making.s, loopSteps));
    if (making.dragged || s !== making.s) setMaking({ ...making, l, dragged: true }); // a plain click keeps the remembered length
  };
  const gridUp = () => {
    if (!making) return;
    addNote(making.p, making.s, making.l);
    if (making.dragged) setLastLen((a) => a.map((v, i) => (i === track ? making.l : v)));
    setMaking(null);
  };

  /* ---- moving, resizing, erasing a note --------------------------------------------- */

  const noteDown = (e: RPointerEvent<HTMLDivElement>, n: Note) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onPreview(track, n.p, n.v);
    if (!canEdit) return;
    if (tool === 'erase') {
      send('note_del', { ids: [n.id] });
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const kind = e.clientX > r.right - 7 ? 'resize' : 'move'; // the right edge is the handle
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(n.id);
    setDrag({ id: n.id, kind, x0: e.clientX, y0: e.clientY, ds: 0, dp: 0, dl: 0 });
  };
  const noteMove = (e: RPointerEvent<HTMLDivElement>, n: Note) => {
    if (!drag || drag.id !== n.id) return;
    const dx = Math.round((e.clientX - drag.x0) / STEP_W);
    const dy = -Math.round((e.clientY - drag.y0) / ROW_H);
    setDrag(drag.kind === 'resize' ? { ...drag, dl: dx } : { ...drag, ds: dx, dp: dy });
  };
  const noteUp = (n: Note) => {
    if (!drag || drag.id !== n.id) return;
    const d = drag;
    setDrag(null);
    if (d.kind === 'resize') {
      const l = clamp(n.l + d.dl, 1, loopSteps - n.s);
      if (l !== n.l) {
        send('note_resize', { id: n.id, l });
        setLastLen((a) => a.map((v, i) => (i === track ? l : v)));
      }
      return;
    }
    const s = clamp(n.s + d.ds, 0, loopSteps - n.l);
    const p = d.dp === 0 ? n.p : lockPitch(roomKey, n.p + d.dp); // a note moved up or down snaps to the key
    if (s !== n.s || p !== n.p) {
      send('note_move', { id: n.id, p, s });
      if (p !== n.p) onPreview(track, p, n.v);
    }
  };

  /** The next pitch up or down that the lock allows (any semitone when the lock is off). */
  const stepPitch = (p: number, dir: 1 | -1) => {
    let q = p + dir;
    while (q >= PITCH_MIN && q <= PITCH_MAX && roomKey.lock && !inScale(roomKey.root, roomKey.scale, q)) q += dir;
    return q >= PITCH_MIN && q <= PITCH_MAX ? q : p;
  };

  const noteKey = (e: RKeyEvent<HTMLDivElement>, n: Note) => {
    if (!canEdit) return;
    const shift = e.shiftKey;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        send('note_del', { ids: [n.id] });
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const p = stepPitch(n.p, e.key === 'ArrowUp' ? 1 : -1);
        if (p !== n.p) {
          send('note_move', { id: n.id, p, s: n.s });
          onPreview(track, p, n.v);
        }
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (shift) {
          const l = clamp(n.l + d, 1, loopSteps - n.s);
          if (l !== n.l) send('note_resize', { id: n.id, l });
        } else {
          const s = clamp(n.s + d, 0, loopSteps - n.l);
          if (s !== n.s) send('note_move', { id: n.id, p: n.p, s });
        }
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        onPreview(track, n.p, n.v);
        break;
    }
  };

  /* ---- keyboard cursor on the empty grid -------------------------------------------- */

  const gridKey = (e: RKeyEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // keys on a note belong to the note
    const cur = kc ?? { p: lockPitch(roomKey, low + 12), s: 0 };
    let { p, s } = cur;
    switch (e.key) {
      case 'ArrowUp':
        p = stepPitch(p, 1);
        break;
      case 'ArrowDown':
        p = stepPitch(p, -1);
        break;
      case 'ArrowLeft':
        s = clamp(s - (e.shiftKey ? 4 : 1), 0, loopSteps - 1);
        break;
      case 'ArrowRight':
        s = clamp(s + (e.shiftKey ? 4 : 1), 0, loopSteps - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (canEdit && !occupied(p, s)) addNote(p, s, fitLen(p, s, lastLen[track]!));
        onPreview(track, p);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (p < low) setViewLow((v) => v.map((x, i) => (i === track ? clamp(p - 2, PITCH_MIN, VIEW_LOW_MAX) : x)));
    if (p > low + VIEW_ROWS - 1) setViewLow((v) => v.map((x, i) => (i === track ? clamp(p - VIEW_ROWS + 3, PITCH_MIN, VIEW_LOW_MAX) : x)));
    setKc({ p, s });
    onPreview(track, p);
    const sc = scrollRef.current;
    if (sc) {
      const x = s * STEP_W;
      if (x < sc.scrollLeft) sc.scrollLeft = x;
      else if (x + KEYS_W + STEP_W > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x + KEYS_W + STEP_W * 2 - sc.clientWidth;
    }
  };

  const shiftView = (dir: 1 | -1) => setViewLow((v) => v.map((x, i) => (i === track ? clamp(x + dir * 12, PITCH_MIN, VIEW_LOW_MAX) : x)));
  const above = mine.filter((n) => n.p > low + VIEW_ROWS - 1).length;
  const below = mine.filter((n) => n.p < low).length;

  const rulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = clamp(Math.floor((e.clientX - r.left) / STEP_W), 0, loopSteps - 1);
    setCursor(Math.floor(s / 4) * 4); // the chord cursor snaps to the beat
  };

  /* ---- render ------------------------------------------------------------------------ */

  const place = (n: Note) => {
    const d = drag && drag.id === n.id ? drag : null;
    let s = n.s;
    let p = n.p;
    let l = n.l;
    if (d?.kind === 'move') {
      s = clamp(n.s + d.ds, 0, loopSteps - n.l);
      p = d.dp === 0 ? n.p : lockPitch(roomKey, n.p + d.dp);
    }
    if (d?.kind === 'resize') l = clamp(n.l + d.dl, 1, loopSteps - n.s);
    return { s, p, l };
  };
  const rowOf = (p: number) => low + VIEW_ROWS - 1 - p;
  const visible = (p: number) => p >= low && p <= low + VIEW_ROWS - 1;

  const sendKey = (k: Partial<Key>) => send('key', { root: roomKey.root, scale: roomKey.scale, lock: roomKey.lock, ...k });

  return (
    <section className="sp-panel sp-roll" aria-label="Piano roll">
      <header className="sp-panel-h">
        <h2>Piano Roll</h2>
        <span className="sp-sub">
          {canEdit ? 'Click to draw, drag to move, drag the right edge to stretch. Everyone sees notes appear live.' : 'Listeners can watch the roll; producers edit it.'}
        </span>
      </header>

      <div className="sp-tools" role="group" aria-label="Piano roll track">
        <div className="sp-seg" role="group" aria-label="Track">
          {MELODIC_TRACKS.map((t, i) => (
            <button key={t.id} type="button" className={track === i ? 'on' : ''} aria-pressed={track === i} onClick={() => setTrack(i)}>
              {t.label}
              {music.notes.some((n) => n.t === i) ? ` · ${music.notes.filter((n) => n.t === i).length}` : ''}
            </button>
          ))}
        </div>
        <div className="sp-seg" role="group" aria-label="Tool">
          <button type="button" className={tool === 'draw' ? 'on' : ''} aria-pressed={tool === 'draw'} onClick={() => setTool('draw')} title="Click empty space to add a note. Double-click a note, or press Delete on it, to remove it.">Draw</button>
          <button type="button" className={tool === 'erase' ? 'on' : ''} aria-pressed={tool === 'erase'} onClick={() => setTool('erase')} title="Click a note to delete it">Erase</button>
        </div>
        <div className="sp-seg" role="group" aria-label="Octave view">
          <button type="button" onClick={() => shiftView(1)} disabled={low >= VIEW_LOW_MAX} aria-label={`Show higher notes${above ? `, ${above} note${above > 1 ? 's' : ''} up there` : ''}`}>▲ Octave{above ? ` (${above})` : ''}</button>
          <button type="button" onClick={() => shiftView(-1)} disabled={low <= PITCH_MIN} aria-label={`Show lower notes${below ? `, ${below} note${below > 1 ? 's' : ''} down there` : ''}`}>▼ Octave{below ? ` (${below})` : ''}</button>
        </div>
        <label className="sp-check sp-inline">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow playhead
        </label>
      </div>

      <div className="sp-tools" role="group" aria-label="Key and pattern length">
        <label className="sp-field">
          Key
          <select className="sp-kit sp-wide" value={roomKey.root} disabled={!canEdit} onChange={(e) => sendKey({ root: Number(e.target.value) })} aria-label="Key">
            {ROOTS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <select className="sp-kit sp-wide" value={roomKey.scale} disabled={!canEdit} onChange={(e) => sendKey({ scale: e.target.value })} aria-label="Scale">
            {SCALE_IDS.map((s) => (
              <option key={s} value={s}>{SCALES[s]!.label}</option>
            ))}
          </select>
        </label>
        <label className="sp-check sp-inline">
          <input type="checkbox" checked={roomKey.lock} disabled={!canEdit} onChange={(e) => sendKey({ lock: e.target.checked })} />
          Key lock
        </label>
        <span className="sp-sub" role="status">
          {keyLabel(roomKey)} · {roomKey.lock ? 'notes snap to the key' : 'lock off: any note, out-of-key rows are only dimmed'}
        </span>
        <label className="sp-field">
          Length
          {isHost ? (
            <select className="sp-kit sp-wide" value={music.bars} onChange={(e) => send('bars', { n: Number(e.target.value) })} aria-label="Pattern length in bars">
              {Array.from({ length: MAX_BARS }, (_, i) => i + 1).map((b) => (
                <option key={b} value={b}>{b} bar{b > 1 ? 's' : ''}</option>
              ))}
            </select>
          ) : (
            <b title="Only the host changes the pattern length">{music.bars} bar{music.bars > 1 ? 's' : ''}</b>
          )}
        </label>
        {isHost && (
          <button type="button" className="sp-link danger" onClick={() => send('note_clear', { t: track })} disabled={!mine.length}>
            Clear {MELODIC_TRACKS[track]!.label.toLowerCase()}
          </button>
        )}
      </div>

      <div className="sp-tools sp-strip" role="group" aria-label={`${MELODIC_TRACKS[track]!.label} channel`}>
        <label className="sp-field">
          Instrument
          <select className="sp-kit sp-wide" value={instr} disabled={!canEdit} onChange={(e) => send('instr', { t: track, id: e.target.value })} aria-label={`${MELODIC_TRACKS[track]!.label} instrument`}>
            {instrumentsForTrack(track).map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </label>
        <span className="sp-sub sp-instr-status" role="status">
          {instrumentIsSampled(instr) ? 'recorded samples' : iStatus === 'loading' ? 'loading…' : 'built-in synth'}
        </span>
        <label className="sp-vol">
          Vol
          <input type="range" className="sp-fader" min={0} max={100} value={music.nvol[track] ?? 80} disabled={!canEdit} onChange={(e) => send('nmix', { t: track, vol: Number(e.target.value) })} aria-label={`${MELODIC_TRACKS[track]!.label} volume`} />
        </label>
        <button type="button" className={`sp-ms${music.nmute[track] ? ' on' : ''}`} aria-pressed={music.nmute[track]} aria-label={`Mute ${MELODIC_TRACKS[track]!.label} for everyone`} title="Mute for everyone" disabled={!canEdit} onClick={() => send('nmix', { t: track, mute: !music.nmute[track] })}>M</button>
        <button type="button" className={`sp-ms solo${solo.has(ch) ? ' on' : ''}`} aria-pressed={solo.has(ch)} aria-label={`Solo ${MELODIC_TRACKS[track]!.label} (only you hear this)`} title="Solo for you only" onClick={() => onSolo(ch)}>S</button>
        <label className="sp-vol">
          Reverb
          <input type="range" className="sp-fader" min={0} max={100} value={music.send[ch]?.[0] ?? 0} disabled={!canEdit} onChange={(e) => send('send', { c: ch, rev: Number(e.target.value) })} aria-label={`${MELODIC_TRACKS[track]!.label} reverb send`} />
        </label>
        <label className="sp-vol">
          Delay
          <input type="range" className="sp-fader" min={0} max={100} value={music.send[ch]?.[1] ?? 0} disabled={!canEdit} onChange={(e) => send('send', { c: ch, dly: Number(e.target.value) })} aria-label={`${MELODIC_TRACKS[track]!.label} delay send`} />
        </label>
      </div>

      <div className="sp-roll-scroll" ref={scrollRef}>
        <div className="sp-roll-inner" style={{ width: KEYS_W + loopSteps * STEP_W, ['--sw' as string]: `${STEP_W}px`, ['--rh' as string]: `${ROW_H}px`, ['--kw' as string]: `${KEYS_W}px` }}>
          {/* ruler: bar and beat numbers. Click to set where the next chord lands. */}
          <div className="sp-roll-ruler" style={{ paddingLeft: KEYS_W }}>
            <div className="sp-roll-ruler-in" style={{ width: loopSteps * STEP_W }} onPointerDown={rulerDown} title="Click to set where the next chord is dropped">
              {Array.from({ length: music.bars * 4 }, (_, b) => (
                <span key={b} className={b % 4 === 0 ? 'bar' : ''} style={{ left: b * 4 * STEP_W }}>
                  {b % 4 === 0 ? b / 4 + 1 : `${(b % 4) + 1}`}
                </span>
              ))}
              <i className="sp-roll-cursor-flag" style={{ left: cursor * STEP_W }} aria-hidden="true" />
            </div>
          </div>

          <div className="sp-roll-body">
            <div className="sp-roll-keys" aria-hidden="true">
              {rows.map((p) => (
                <button
                  key={p}
                  type="button"
                  tabIndex={-1}
                  className={`sp-roll-key${isBlackKey(p) ? ' blk' : ''}${inScale(roomKey.root, roomKey.scale, p) ? '' : ' out'}${(p - roomKey.root) % 12 === 0 ? ' root' : ''}`}
                  onPointerDown={() => onPreview(track, p)}
                >
                  {p % 12 === 0 || (p - roomKey.root) % 12 === 0 ? noteName(p, flats) : ''}
                </button>
              ))}
            </div>

            <div
              className="sp-roll-grid"
              ref={gridRef}
              style={{ width: loopSteps * STEP_W, height: VIEW_ROWS * ROW_H }}
              tabIndex={0}
              role="group"
              aria-label={`${MELODIC_TRACKS[track]!.label} notes. Arrow keys move the cursor, Enter adds a note. Select a note and press Delete to remove it.`}
              onPointerDown={gridDown}
              onPointerMove={gridMove}
              onPointerUp={gridUp}
              onPointerCancel={() => setMaking(null)}
              onKeyDown={gridKey}
              onBlur={() => setKc(null)}
            >
              {rows.map((p, i) => (
                <div key={p} className={`sp-roll-row${isBlackKey(p) ? ' blk' : ''}${inScale(roomKey.root, roomKey.scale, p) ? '' : roomKey.lock ? ' out' : ' out free'}${(p - roomKey.root) % 12 === 0 ? ' root' : ''}`} style={{ top: i * ROW_H }} />
              ))}
              {/* the other tracks, faint, so you can write a melody against the chords */}
              {others.filter((n) => visible(n.p)).map((n) => (
                <div key={n.id} className="sp-note ghost" style={{ left: n.s * STEP_W, top: rowOf(n.p) * ROW_H, width: n.l * STEP_W - 2, ['--c' as string]: colorOf(n.by) }} aria-hidden="true" />
              ))}
              {mine.filter((n) => visible(place(n).p)).map((n) => {
                const pl = place(n);
                const oot = !inScale(roomKey.root, roomKey.scale, pl.p);
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${noteName(n.p, flats)}, step ${n.s + 1}, length ${n.l}, velocity ${n.v}, placed by ${n.by}${oot ? ', outside the key' : ''}`}
                    className={`sp-note${selected === n.id ? ' sel' : ''}${oot ? ' oot' : ''}${fresh.has(n.id) ? ' fresh' : ''}${drag?.id === n.id ? ' dragging' : ''}${n.by === you ? ' mine' : ''}`}
                    style={{ left: pl.s * STEP_W, top: rowOf(pl.p) * ROW_H, width: pl.l * STEP_W - 2, ['--c' as string]: colorOf(n.by), ['--vel' as string]: n.v / 127 }}
                    onPointerDown={(e) => noteDown(e, n)}
                    onPointerMove={(e) => noteMove(e, n)}
                    onPointerUp={() => noteUp(n)}
                    onPointerCancel={() => setDrag(null)}
                    onDoubleClick={() => canEdit && tool === 'draw' && send('note_del', { ids: [n.id] })}
                    onKeyDown={(e) => noteKey(e, n)}
                    onFocus={() => setSelected(n.id)}
                    title={`${noteName(n.p, flats)} · ${n.by}`}
                  >
                    {pl.l * STEP_W > 34 && <span className="sp-note-l">{noteName(pl.p, flats)}</span>}
                    <i className="sp-note-h" aria-hidden="true" />
                  </div>
                );
              })}
              {making && visible(making.p) && (
                <div className="sp-note making" style={{ left: making.s * STEP_W, top: rowOf(making.p) * ROW_H, width: making.l * STEP_W - 2, ['--c' as string]: colorOf(you) }} aria-hidden="true" />
              )}
              {kc && visible(kc.p) && <div className="sp-roll-kc" style={{ left: kc.s * STEP_W, top: rowOf(kc.p) * ROW_H, width: STEP_W, height: ROW_H }} aria-hidden="true" />}
              <i className="sp-roll-cursor" style={{ left: cursor * STEP_W }} aria-hidden="true" />
              <div className="sp-roll-head" ref={headRef} aria-hidden="true" />
            </div>
          </div>

          {/* velocity lane for the track being edited */}
          <div className="sp-roll-vel" style={{ paddingLeft: KEYS_W }}>
            <span className="sp-roll-vel-l" aria-hidden="true">Vel</span>
            <div className="sp-roll-vel-in" style={{ width: loopSteps * STEP_W }}>
              {mine.map((n) => (
                <VelBar key={n.id} note={n} color={colorOf(n.by)} canEdit={canEdit} onVel={(v) => send('note_vel', { id: n.id, v })} label={`${noteName(n.p, flats)} at step ${n.s + 1}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <ChordTools
        roomKey={roomKey}
        music={music}
        track={track}
        cursor={cursor}
        setCursor={setCursor}
        canEdit={canEdit}
        isHost={isHost}
        send={send}
        onPreview={onPreview}
        onShowTrack={setTrack}
      />

      <ul className="sp-legend" aria-label="Producers">
        {members.filter((m) => m.role !== 'listener').map((m) => (
          <li key={m.name}>
            <i style={{ background: PRODUCER_COLORS[m.color % 8] }} />
            {m.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One note's velocity: drag up for harder, down for softer, or use the arrow keys. */
function VelBar({ note, color, canEdit, onVel, label }: { note: Note; color: string; canEdit: boolean; onVel: (v: number) => void; label: string }) {
  const [live, setLive] = useState<number | null>(null);
  const last = useRef({ at: 0, v: 0 });
  const v = live ?? note.v;
  const fromPointer = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 127), 1, 127);
  };
  const push = (val: number, force: boolean) => {
    const now = performance.now();
    if (!force && (now - last.current.at < 45 || Math.abs(val - last.current.v) < 2)) return; // stay under the server's rate limit
    last.current = { at: now, v: val };
    onVel(val);
  };
  return (
    <div
      className="sp-vbar"
      role="slider"
      tabIndex={0}
      aria-label={`Velocity of ${label}`}
      aria-valuemin={1}
      aria-valuemax={127}
      aria-valuenow={note.v}
      style={{ left: note.s * STEP_W, width: Math.min(14, Math.max(6, note.l * STEP_W - 2)), ['--c' as string]: color }}
      onPointerDown={(e) => {
        if (!canEdit) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const val = fromPointer(e);
        setLive(val);
        push(val, true);
      }}
      onPointerMove={(e) => {
        if (live === null) return;
        const val = fromPointer(e);
        setLive(val);
        push(val, false);
      }}
      onPointerUp={(e) => {
        if (live === null) return;
        push(fromPointer(e), true);
        setLive(null);
      }}
      onPointerCancel={() => setLive(null)}
      onKeyDown={(e) => {
        if (!canEdit || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        onVel(clamp(note.v + (e.key === 'ArrowUp' ? 8 : -8), 1, 127));
      }}
    >
      <i style={{ height: `${(v / 127) * 100}%` }} />
    </div>
  );
}
