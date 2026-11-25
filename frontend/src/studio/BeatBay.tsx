import { memo } from 'react';
import { TRACKS } from './audio';
import { PRODUCER_COLORS, type StudioMember, type StudioSend } from './studioApi';

interface PadProps {
  t: number;
  s: number;
  owner: string;
  color: string;
  hit: boolean;
  trailAt: number;
  canEdit: boolean;
  onToggle: (t: number, s: number, on: boolean) => void;
}

const Pad = memo(function Pad({ t, s, owner, color, hit, trailAt, canEdit, onToggle }: PadProps) {
  const on = owner !== '';
  const label = `${TRACKS[t]?.label ?? 'Track'}, step ${s + 1}, ${on ? (owner === '·' ? 'on' : `on, placed by ${owner}`) : 'off'}`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!canEdit}
      className={`sp-pad${on ? ' on' : ''}${hit && on ? ' hit' : ''}${s % 4 === 0 ? ' down' : ''}`}
      style={{ ['--c' as string]: color }}
      onClick={() => onToggle(t, s, !on)}
    >
      {trailAt > 0 && <span key={trailAt} className="sp-trail" aria-hidden="true" />}
    </button>
  );
});

const hash = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 8;

interface Props {
  cells: string[][];
  trail: Record<string, { by: string; at: number }>;
  members: StudioMember[];
  step: number;
  canEdit: boolean;
  send: StudioSend;
  onPreview: (t: number, s: number) => void;
}

/** Beat Bay: the shared step sequencer. Pads take the colour of whoever placed them. */
export function BeatBay({ cells, trail, members, step, canEdit, send, onPreview }: Props) {
  const colorOf = (owner: string) => {
    if (owner === '·') return '#e9b872';
    const m = members.find((x) => x.name === owner);
    return PRODUCER_COLORS[m ? m.color % 8 : hash(owner)]!;
  };
  const toggle = (t: number, s: number, on: boolean) => {
    if (on) onPreview(t, s);
    send('step', { t, s, on });
  };
  return (
    <section className="sp-panel sp-bay" aria-label="Beat Bay">
      <header className="sp-panel-h">
        <h2>Beat Bay</h2>
        <span className="sp-sub">{canEdit ? 'Click pads. Everyone hears it on the beat.' : 'Listeners can watch the grid; producers edit it.'}</span>
      </header>
      <div className="sp-grid" role="group" aria-label="Step sequencer, 8 tracks by 16 steps">
        {TRACKS.map((tr, t) => (
          <div className="sp-row" key={tr.id}>
            <span className="sp-rowlabel">{tr.label}</span>
            <div className="sp-pads">
              {Array.from({ length: 16 }, (_, s) => {
                const owner = cells[t]?.[s] ?? '';
                const tl = trail[`${t}-${s}`];
                return (
                  <Pad key={s} t={t} s={s} owner={owner} color={colorOf(owner)} hit={step === s} trailAt={tl && owner ? tl.at : 0} canEdit={canEdit} onToggle={toggle} />
                );
              })}
            </div>
          </div>
        ))}
        <div className="sp-row sp-playhead-row" aria-hidden="true">
          <span className="sp-rowlabel" />
          <div className="sp-pads">
            {Array.from({ length: 16 }, (_, s) => (
              <i key={s} className={s === step ? 'cur' : ''} />
            ))}
          </div>
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
