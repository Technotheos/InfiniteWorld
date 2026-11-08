import React, { useMemo, useRef, useState } from 'react';
import { Check, Lock, ShieldAlert } from 'lucide-react';
import { MAP_ORDER, MISSIONS, NODE_POS, TEASERS } from './missions';
import { FOCUS } from './ui';

/* ========================================================================== */
/*  Sector map                                                                */
/* ========================================================================== */

export function SectorMap({
  done,
  onLaunch,
}: {
  done: Record<string, number>;
  onLaunch: (id: string) => void;
}) {
  const firstOpen = MISSIONS.find((m) => !(m.id in done))?.id ?? MISSIONS[0].id;
  const [focusId, setFocusId] = useState(firstOpen);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Parallax: writes CSS vars directly, so the pointer never triggers a re-render.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  const mission = MISSIONS.find((m) => m.id === focusId);
  const teaser = TEASERS.find((x) => x.id === focusId);

  const ticks = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        const a = (i / 72) * Math.PI * 2;
        const r1 = 292;
        const r2 = i % 6 === 0 ? 308 : 300;
        return { x1: 500 + Math.cos(a) * r1, y1: 300 + Math.sin(a) * r1, x2: 500 + Math.cos(a) * r2, y2: 300 + Math.sin(a) * r2 };
      }),
    [],
  );

  return (
    <div
      ref={boxRef}
      onPointerMove={onMove}
      className="relative h-[560px] rounded-3xl overflow-hidden border border-white/10 bg-[#08060f]/70 backdrop-blur-md"
    >
      {/* Layer 1: astrolabe */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * -14px), calc(var(--py,0) * -10px), 0)', transition: 'transform .3s ease-out' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          {[120, 200, 280, 360].map((r) => (
            <circle key={r} cx="500" cy="300" r={r} fill="none" stroke="rgba(238,233,220,0.07)" />
          ))}
          <line x1="0" y1="300" x2="1000" y2="300" stroke="rgba(238,233,220,0.05)" />
          <line x1="500" y1="0" x2="500" y2="600" stroke="rgba(238,233,220,0.05)" />
          <g className="iw-spin-slow" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <circle cx="500" cy="300" r="292" fill="none" stroke="rgba(233,184,114,0.22)" strokeDasharray="1 6" />
            {ticks.map((tk, i) => (
              <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} stroke="rgba(233,184,114,0.35)" />
            ))}
          </g>
        </svg>
      </div>

      {/* Layer 2: constellation lines */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * 8px), calc(var(--py,0) * 6px), 0)', transition: 'transform .3s ease-out' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          {MAP_ORDER.slice(0, -1).map((id, i) => {
            const a = NODE_POS[id];
            const b = NODE_POS[MAP_ORDER[i + 1]];
            const lit = id in done;
            return (
              <line
                key={id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={lit ? 'rgba(233,184,114,0.8)' : 'rgba(238,233,220,0.22)'}
                strokeDasharray={lit ? undefined : '1.2 1.6'}
                vectorEffect="non-scaling-stroke"
                strokeWidth="1.2"
              />
            );
          })}
        </svg>
      </div>

      {/* Layer 3: nodes */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * 18px), calc(var(--py,0) * 12px), 0)', transition: 'transform .3s ease-out' }}
      >
        {MAP_ORDER.map((id) => {
          const pos = NODE_POS[id];
          const m = MISSIONS.find((x) => x.id === id);
          const tz = TEASERS.find((x) => x.id === id);
          const locked = !m;
          const completed = id in done;
          const title = m?.title ?? tz?.title ?? id;
          const meta = m ? `${m.date.replace('Reported ', '')} · ${m.loss}` : `${tz?.date} · ${tz?.loss}`;
          const focused = focusId === id;
          return (
            <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <button
                onClick={() => setFocusId(id)}
                aria-pressed={focused}
                aria-label={`${title}${locked ? ', coming soon' : completed ? ', completed' : ''}`}
                className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-300 hover:scale-110 ${FOCUS} ${
                  locked
                    ? 'border border-dashed border-white/25 bg-black/50 text-[#6d6880]'
                    : completed
                      ? 'bg-[#e9b872] text-[#1a1208] shadow-[0_0_40px_rgba(233,184,114,0.55)]'
                      : 'border border-[#9b8cff]/70 bg-[#9b8cff]/15 text-[#d6d0ff] shadow-[0_0_40px_rgba(155,140,255,0.4)]'
                }`}
              >
                {!locked && !completed && !focused && (
                  <span className="absolute inset-0 rounded-full border border-[#9b8cff]/60 iw-ping" aria-hidden="true" />
                )}
                {focused && <span className="absolute -inset-2 rounded-full border border-[#e9b872]/60" aria-hidden="true" />}
                {locked ? <Lock size={18} /> : completed ? <Check size={22} /> : <ShieldAlert size={22} />}
              </button>
              <div className="mt-3 text-center pointer-events-none">
                <div className="iw-display text-xl leading-tight text-[#eee9dc]">{title}</div>
                <div className="text-[11px] text-[#a49fb0] mt-0.5">{meta}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Focus card */}
      <div className="absolute left-4 bottom-4 right-4 sm:right-auto sm:w-[380px] rounded-2xl border border-white/10 bg-[#06050b]/85 backdrop-blur-xl p-4">
        {mission ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="iw-display text-2xl leading-tight">{mission.title}</div>
              {mission.id in done && (
                <span className="text-[11px] px-2.5 py-1 rounded-full border border-[#e9b872]/40 text-[#e9b872]">
                  Charted · {done[mission.id]} XP
                </span>
              )}
            </div>
            <p className="text-xs text-[#a49fb0] mt-1">{mission.tagline}</p>
            <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-[#c9c4d2]">
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">{mission.difficulty}</span>
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">{mission.chain}</span>
            </div>
            <button
              onClick={() => onLaunch(mission.id)}
              className={`mt-4 w-full py-2.5 rounded-xl bg-[#e9b872] text-[#1a1208] font-bold text-sm hover:brightness-110 transition ${FOCUS}`}
            >
              {mission.id in done ? 'Replay mission' : 'Launch mission'}
            </button>
          </>
        ) : (
          teaser && (
            <>
              <div className="iw-display text-2xl leading-tight">{teaser.title}</div>
              <p className="text-xs text-[#a49fb0] mt-1">{teaser.tagline}</p>
              <button disabled className="mt-4 w-full py-2.5 rounded-xl border border-white/10 text-sm text-[#6d6880] cursor-not-allowed">
                Coming soon
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}

