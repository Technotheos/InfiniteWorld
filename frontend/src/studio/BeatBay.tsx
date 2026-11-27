import { memo, useRef, useState } from 'react';
import { defaultVel, isDrumTrack, KITS, SWING_MAX, SWING_MIN, TRACKS, VEL_ACCENT, VEL_GHOST, VEL_MAX, VEL_MIN, VEL_NORMAL, type KitStatus } from './audio';
import { PRODUCER_COLORS, type StudioMember, type StudioSend } from './studioApi';
import type { PatternState } from './useStudio';

type Brush = 'auto' | 'ghost' | 'normal' | 'accent';
const BRUSH_VEL: Record<Exclude<Brush, 'auto'>, number> = { ghost: VEL_GHOST, normal: VEL_NORMAL, accent: VEL_ACCENT };
const clampVel = (v: number) => Math.max(VEL_MIN, Math.min(VEL_MAX, Math.round(v)));

interface PadProps {
  t: number;
  s: number;
  owner: string;
  vel: number;
  color: string;
  hit: boolean;
  trailAt: number;
  canEdit: boolean;
  velMode: boolean;
  onToggle: (t: number, s: number, on: boolean) => void;
  onVel: (t: number, s: number, v: number) => void;
}

const Pad = memo(function Pad({ t, s, owner, vel, color, hit, trailAt, canEdit, velMode, onToggle, onVel }: PadProps) {
  const on = owner !== '';
  const [drag, setDrag] = useState<number | null>(null); // the velocity while a finger or mouse is dragging
  const lastSent = useRef({ at: 0, v: 0 });
  const shown = drag ?? vel;
  const label = `${TRACKS[t]?.label ?? 'Track'}, step ${s + 1}, ${on ? (owner === '·' ? 'on' : `on, placed by ${owner}`) + `, velocity ${vel}` : 'off'}`;

  // Velocity mode: press an active pad and drag up for harder, down for softer.
  const fromPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clampVel((1 - (e.clientY - r.top) / r.height) * VEL_MAX);
  };
  const sendNow = (v: number, force: boolean) => {
    const now = performance.now();
    if (!force && (now - lastSent.current.at < 45 || Math.abs(v - lastSent.current.v) < 2)) return; // stay under the server's rate limit
    lastSent.current = { at: now, v };
    onVel(t, s, v);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!canEdit}
      className={`sp-pad${on ? ' on' : ''}${hit && on ? ' hit' : ''}${s % 4 === 0 ? ' down' : ''}${velMode && on ? ' vedit' : ''}`}
      style={{ ['--c' as string]: color }}
      onClick={() => {
        if (!velMode) onToggle(t, s, !on);
      }}
      onKeyDown={(e) => {
        // Arrow keys nudge velocity on a lit pad in either mode: the keyboard route to everything the drag does.
        if (!on || !canEdit || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        onVel(t, s, clampVel(vel + (e.key === 'ArrowUp' ? 8 : -8)));
      }}
      onPointerDown={(e) => {
        if (!velMode || !on || !canEdit) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = fromPointer(e);
        setDrag(v);
        sendNow(v, true);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = fromPointer(e);
        setDrag(v);
        sendNow(v, false);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        sendNow(fromPointer(e), true);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {on && <span className="sp-vel" style={{ height: `${(shown / VEL_MAX) * 100}%` }} aria-hidden="true" />}
      {trailAt > 0 && <span key={trailAt} className="sp-trail" aria-hidden="true" />}
    </button>
  );
});

const hash = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;

interface Props {
  cells: string[][];
  pattern: PatternState;
  trail: Record<string, { by: string; at: number }>;
  members: StudioMember[];
  step: number;
  canEdit: boolean;
  send: StudioSend;
  solo: ReadonlySet<number>;
  onSolo: (t: number) => void;
  kitStatus: (id: string) => KitStatus;
  onPreview: (t: number, s: number, vel: number) => void;
}

/** Beat Bay: the shared step sequencer. Pads take the colour of whoever placed them. */
export function BeatBay({ cells, pattern, trail, members, step, canEdit, send, solo, onSolo, kitStatus, onPreview }: Props) {
  const [velMode, setVelMode] = useState(false);
  const [brush, setBrush] = useState<Brush>('auto');

  const colorOf = (owner: string) => {
    if (owner === '·') return '#e9b872';
    const m = members.find((x) => x.name === owner);
    return PRODUCER_COLORS[m ? m.color % 8 : hash(owner)]!;
  };
  const toggle = (t: number, s: number, on: boolean) => {
    const v = brush === 'auto' ? defaultVel(t, s) : BRUSH_VEL[brush];
    if (on) onPreview(t, s, v);
    send('step', on ? { t, s, on, v } : { t, s, on });
  };
  const setVel = (t: number, s: number, v: number) => send('vel', { t, s, v });

  const usedKits = [...new Set(pattern.kits.filter(Boolean))];
  const failed = usedKits.filter((k) => kitStatus(k) === 'failed');
  const loading = usedKits.some((k) => kitStatus(k) === 'loading');
  const swing = pattern.swing;

  return (
    <section className="sp-panel sp-bay" aria-label="Beat Bay">
      <header className="sp-panel-h">
        <h2>Beat Bay</h2>
        <span className="sp-sub">{canEdit ? 'Click pads. Everyone hears it on the beat.' : 'Listeners can watch the grid; producers edit it.'}</span>
      </header>

      <div className="sp-tools" role="group" aria-label="Beat Bay tools">
        <div className="sp-seg" role="group" aria-label="Pad mode">
          <button type="button" className={!velMode ? 'on' : ''} aria-pressed={!velMode} onClick={() => setVelMode(false)}>Place</button>
          <button type="button" className={velMode ? 'on' : ''} aria-pressed={velMode} onClick={() => setVelMode(true)} title="Drag a lit pad up or down to set how hard it hits. Arrow keys work on a focused pad.">Velocity</button>
        </div>
        {!velMode && (
          <div className="sp-seg" role="group" aria-label="New pad strength">
            {(['auto', 'ghost', 'normal', 'accent'] as const).map((b) => (
              <button key={b} type="button" className={brush === b ? 'on' : ''} aria-pressed={brush === b} onClick={() => setBrush(b)}>
                {b === 'auto' ? 'Auto' : b === 'ghost' ? 'Ghost' : b === 'normal' ? 'Normal' : 'Accent'}
              </button>
            ))}
          </div>
        )}
        <label className="sp-vol sp-swing">
          Swing {swing <= SWING_MIN ? 'off' : `${swing}%`}
          <input
            type="range"
            min={SWING_MIN}
            max={SWING_MAX}
            value={swing}
            disabled={!canEdit}
            onChange={(e) => send('swing', { v: Number(e.target.value) })}
            aria-label="Swing, percent. 50 is straight sixteenths, 66 is triplet feel."
          />
        </label>
        {loading && <span className="sp-sub" role="status">Loading kit…</span>}
        {failed.length > 0 && (
          <span className="sp-sub sp-kitwarn" role="status">
            Some kit files did not load; the built-in sounds are playing instead.
          </span>
        )}
      </div>

      <div className="sp-grid" role="group" aria-label="Step sequencer, 8 tracks by 16 steps">
        {TRACKS.map((tr, t) => {
          const kit = pattern.kits[t] ?? '';
          const muted = pattern.mute[t] ?? false;
          const soloed = solo.has(t);
          return (
            <div className={`sp-row${muted ? ' muted' : ''}${solo.size > 0 && !soloed ? ' dim' : ''}`} key={tr.id}>
              <span className="sp-rowhead">
                <span className="sp-rowlabel">{tr.label}</span>
                <button type="button" className={`sp-ms${muted ? ' on' : ''}`} aria-pressed={muted} aria-label={`Mute ${tr.label} for everyone`} title="Mute for everyone" disabled={!canEdit} onClick={() => send('mix', { t, mute: !muted })}>M</button>
                <button type="button" className={`sp-ms solo${soloed ? ' on' : ''}`} aria-pressed={soloed} aria-label={`Solo ${tr.label} (only you hear this)`} title="Solo for you only" onClick={() => onSolo(t)}>S</button>
              </span>
              <div className="sp-pads">
                {Array.from({ length: 16 }, (_, s) => {
                  const owner = cells[t]?.[s] ?? '';
                  const tl = trail[`${t}-${s}`];
                  return (
                    <Pad
                      key={s}
                      t={t}
                      s={s}
                      owner={owner}
                      vel={pattern.vel[t]?.[s] || (owner ? defaultVel(t, s) : 0)}
                      color={colorOf(owner)}
                      hit={step === s}
                      trailAt={tl && owner ? tl.at : 0}
                      canEdit={canEdit}
                      velMode={velMode}
                      onToggle={toggle}
                      onVel={setVel}
                    />
                  );
                })}
              </div>
              <span className="sp-rowmix">
                <input
                  type="range"
                  className="sp-fader"
                  min={0}
                  max={100}
                  value={pattern.vol[t] ?? 80}
                  disabled={!canEdit}
                  onChange={(e) => send('mix', { t, vol: Number(e.target.value) })}
                  aria-label={`${tr.label} volume`}
                />
                {isDrumTrack(t) ? (
                  <select className="sp-kit" value={kit} disabled={!canEdit} onChange={(e) => send('kit', { t, id: e.target.value })} aria-label={`${tr.label} kit`}>
                    {!KITS.some((k) => k.id === kit) && <option value={kit}>{kit || 'Kit'}</option>}
                    {KITS.map((k) => (
                      <option key={k.id} value={k.id}>{k.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="sp-kit synth">Synth</span>
                )}
              </span>
            </div>
          );
        })}
        <div className="sp-row sp-playhead-row" aria-hidden="true">
          <span className="sp-rowhead" />
          <div className="sp-pads">
            {Array.from({ length: 16 }, (_, s) => (
              <i key={s} className={s === step ? 'cur' : ''} />
            ))}
          </div>
          <span className="sp-rowmix" />
        </div>
      </div>
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
