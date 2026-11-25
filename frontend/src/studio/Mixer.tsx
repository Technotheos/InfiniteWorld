import { useEffect, useRef, useState } from 'react';
import { LOOP_BEATS, type StudioClock } from './audio';
import { PRODUCER_COLORS, type StudioMember, type StudioSend, type StudioTake } from './studioApi';

interface Props {
  takes: StudioTake[];
  members: StudioMember[];
  you: string;
  isHost: boolean;
  clock: StudioClock;
  peaks: Record<string, number[]>;
  muted: Set<string>;
  onMute: (id: string) => void;
  onReport: (t: StudioTake) => void;
  send: StudioSend;
  animate: boolean;
}

/** Mixer Timeline: one lane per producer, each take a ribbon of light snapped to the beat. */
export function Mixer({ takes, members, you, isHost, clock, peaks, muted, onMute, onReport, send, animate }: Props) {
  const head = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState<Record<string, true>>({});
  const seen = useRef(new Set<string>());

  // Newly landed takes get a one-time "slide into the lane" animation.
  useEffect(() => {
    const add: Record<string, true> = {};
    for (const t of takes) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      add[t.id] = true;
    }
    if (Object.keys(add).length) {
      setFresh((f) => ({ ...f, ...add }));
      const id = window.setTimeout(() => setFresh({}), 1400);
      return () => window.clearTimeout(id);
    }
  }, [takes]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const b = ((clock.beat() % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
      if (head.current) head.current.style.left = `${(b / LOOP_BEATS) * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  const recordings = takes.filter((t) => t.kind === 'take');
  const lanes = members.filter((m) => recordings.some((t) => t.by === m.name) || m.role !== 'listener');
  const extra = [...new Set(recordings.map((t) => t.by))].filter((n) => !lanes.some((m) => m.name === n));

  return (
    <section className="sp-panel sp-mixer" aria-label="Mixer Timeline">
      <header className="sp-panel-h">
        <h2>Mixer Timeline</h2>
        <span className="sp-sub">4 bars, looping. Takes snap to the beat they were recorded on.</span>
      </header>
      <div className="sp-lanes">
        <div className="sp-bars" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        {[...lanes.map((m) => ({ name: m.name, color: m.color })), ...extra.map((n) => ({ name: n, color: 0 }))].map((l) => (
          <div className="sp-lane" key={l.name}>
            <span className="sp-lane-name">{l.name}</span>
            <div className="sp-lane-track">
              {recordings
                .filter((t) => t.by === l.name)
                .map((t) => {
                  const pos = ((t.start_beat % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
                  const len = Math.min(t.len_beats, LOOP_BEATS - pos);
                  const pk = peaks[t.id];
                  return (
                    <div
                      key={t.id}
                      className={`sp-ribbon${fresh[t.id] && animate ? ' landing' : ''}${muted.has(t.id) ? ' off' : ''}`}
                      style={{ left: `${(pos / LOOP_BEATS) * 100}%`, width: `${(len / LOOP_BEATS) * 100}%`, ['--pc' as string]: PRODUCER_COLORS[l.color % 8] }}
                    >
                      <svg viewBox="0 0 48 20" preserveAspectRatio="none" aria-hidden="true">
                        {(pk ?? Array(48).fill(0.15)).map((p, i) => (
                          <rect key={i} x={i} y={10 - p * 9} width="0.7" height={Math.max(0.6, p * 18)} />
                        ))}
                      </svg>
                      <span className="sp-ribbon-t">{t.title}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
        <div className="sp-ph-wrap" aria-hidden="true"><div className="sp-playhead" ref={head} /></div>
      </div>
      {recordings.length > 0 && (
        <ul className="sp-takes">
          {recordings.map((t) => {
            const mine = t.by === you;
            const need = t.need ?? [];
            return (
              <li key={t.id}>
                <b>{t.title}</b> <span className="sp-sub">by {t.by} · {(t.dur_ms / 1000).toFixed(1)}s · beat {t.start_beat}</span>
                <span className="sp-actions">
                  <button type="button" className="sp-link" onClick={() => onMute(t.id)}>{muted.has(t.id) ? 'Unmute for me' : 'Mute for me'}</button>
                  {mine && !t.published && need.length === 0 && !(t.agreed?.length) && (
                    <button type="button" className="sp-link" onClick={() => send('publish', { id: t.id })}>Publish…</button>
                  )}
                  {(mine || isHost) && <button type="button" className="sp-link" onClick={() => send('take', { op: 'remove', id: t.id })}>Delete</button>}
                  {!mine && <button type="button" className="sp-link" onClick={() => onReport(t)}>Report</button>}
                </span>
                {!t.published && (t.agreed?.length ?? 0) > 0 && (
                  <p className="sp-consent" role="status">
                    Publishing needs everyone who contributed to say yes. Waiting for: {need.length ? need.join(', ') : 'nobody'}.
                    {need.includes(you) && (
                      <>
                        {' '}
                        <button type="button" className="sp-btn small" onClick={() => send('consent', { id: t.id, ok: true })}>I agree</button>{' '}
                        <button type="button" className="sp-btn small ghost" onClick={() => send('consent', { id: t.id, ok: false })}>No</button>
                      </>
                    )}
                  </p>
                )}
                {t.published && (
                  <p className="sp-consent" role="status">
                    Published with everyone's consent. <button type="button" className="sp-link" onClick={() => send('consent', { id: t.id, ok: false })}>Withdraw my consent</button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
