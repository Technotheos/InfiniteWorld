import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Pause, Play, ShieldAlert, X } from 'lucide-react';
import type { Case, Host, Step } from './types';
import { findRow, rowText, type CaseState, type Score } from './store';

const STEP_MS = 3400;
const GLYPH: Record<Host['kind'], string> = { ws: 'PC', server: 'SRV', dc: 'DC', cloud: 'CLD', usb: 'USB', net: 'NET', wallet: '0x', attacker: 'ATK' };
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function Replay({ c, s, score, reduce, onExit }: { c: Case; s: CaseState; score: Score; reduce: boolean; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const [fast, setFast] = useState(false);
  const raf = useRef(0);
  const step = c.steps[i]!;
  const found = new Set(score.covered);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * (fast ? 2 : 1); last = now;
      setProg((p) => {
        const n = p + dt / STEP_MS;
        if (n >= 1) {
          setI((k) => { if (k >= c.steps.length - 1) { setPlaying(false); return k; } return k + 1; });
          return 0;
        }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, fast, c.steps.length]);

  const go = (k: number) => { setI(Math.max(0, Math.min(c.steps.length - 1, k))); setProg(0); };
  const host = (id: string) => c.hosts.find((h) => h.id === id)!;
  const P = (h: Host) => ({ x: h.x, y: h.y * 0.62 + 4 });
  const a = P(host(step.from)), b = P(host(step.to));
  const e = reduce ? 1 : ease(Math.min(1, prog * 1.15));
  const dot = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
  const reached = new Set(c.steps.slice(0, i + 1).flatMap((st) => [st.from, st.to]));
  const proofs = useMemo(() => c.artifacts.flatMap((art) => (art.rows as { id: string; step?: string; role?: string }[]).filter((r) => r.role === 'key' && r.step === step.id).map((r) => ({ art, r }))), [c, step.id]);
  const techniques = useMemo(() => { const m = new Map<string, Step['attack']>(); c.steps.forEach((st) => m.set(st.attack.id, st.attack)); return [...m.values()]; }, [c]);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="tl-reveal">
      <section className="tl-report">
        <div className="stampbox"><span className="stamp big">CASE CLOSED</span></div>
        <div className="head">
          <h2>{c.title}</h2>
          <div className="stars" aria-label={`${score.stars} of 3 stars`}>{[1, 2, 3].map((n) => <span key={n} className={n <= score.stars ? 'on' : ''}>★</span>)}</div>
          <div className="xp">+{score.xp} XP</div>
        </div>
        <div className="bars">
          {([['Answers (with proof)', score.questions], ['Completeness', score.completeness], ['Accuracy', score.accuracy], ['Timeline', score.timeline]] as const).map(([l, v]) => (
            <div key={l}><span>{l}</span><div className="bar"><i style={{ width: pct(v) }} /></div><b>{pct(v)}</b></div>
          ))}
        </div>
      </section>

      <section className="tl-stage-wrap" aria-label="Replay of what actually happened">
        <div className="tl-sec-h"><span>The reveal · what actually happened</span><span className="tl-dimtxt">step {i + 1} of {c.steps.length}</span></div>
        <svg viewBox="0 0 100 68" className="tl-stage">
          {c.edges.map(([x, y]) => { const A = P(host(x)), B = P(host(y)); return <line key={`${x}${y}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="e" />; })}
          {c.steps.slice(0, i).map((st) => { const A = P(host(st.from)), B = P(host(st.to)); return st.from !== st.to && <line key={st.id} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={`e done${found.has(st.id) ? ' got' : ''}`} />; })}
          {step.from !== step.to && <line x1={a.x} y1={a.y} x2={dot.x} y2={dot.y} className="e live" />}
          {c.hosts.map((h) => { const p = P(h); const on = reached.has(h.id); return (
            <g key={h.id} transform={`translate(${p.x} ${p.y})`} className={`host ${h.kind}${on ? ' on' : ''}${h.id === step.to || h.id === step.from ? ' cur' : ''}`}>
              <rect x="-5.2" y="-3.8" width="10.4" height="7.6" rx="1.4" className="body" />
              <text y="1.1" className="glyph">{GLYPH[h.kind]}</text>
              <text y="8.6" className="name">{h.label}</text>
            </g>
          ); })}
          {step.from !== step.to ? <circle cx={dot.x} cy={dot.y} r="1.6" className="pkt" /> : <circle cx={a.x} cy={a.y} r={3 + prog * 6} className="pulse" style={{ opacity: 1 - prog }} />}
        </svg>

        <div className="tl-stepcard" key={step.id}>
          <div className="t">{step.t}</div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <div className="mitre"><b>{step.attack.id}</b><span>{step.attack.name}</span><em>{step.attack.tactic}</em></div>
          <div className={`verdict ${found.has(step.id) ? 'got' : 'miss'}`}>
            {found.has(step.id) ? <><Check size={14} /> You proved this step.</> : <><X size={14} /> You did not prove this step.</>}
          </div>
          <ul className="proofs">{proofs.slice(0, 3).map(({ art, r }) => { const f = findRow(c, `${art.id}:${r.id}`); const mine = `${art.id}:${r.id}` in s.pins; return f && <li key={r.id} className={mine ? 'mine' : ''}>{mine ? <Check size={12} /> : <span className="o" />}<span><b>{art.label}</b> {rowText(f.art, f.row)}</span></li>; })}</ul>
        </div>

        <div className="tl-lanes">
          <div className="lane"><span className="lbl">Actual</span>{c.steps.map((st, k) => <button key={st.id} type="button" className={`m${k === i ? ' cur' : ''}${k < i ? ' past' : ''}`} onClick={() => go(k)} aria-label={`Step ${k + 1}: ${st.title}`}>{k + 1}</button>)}</div>
          <div className="lane"><span className="lbl">You</span>{c.steps.map((st, k) => <span key={st.id} className={`m you${found.has(st.id) ? ' got' : ' miss'}${k <= i ? ' show' : ''}`}>{found.has(st.id) ? '✓' : '·'}</span>)}</div>
        </div>
        <div className="tl-ctl">
          <button type="button" onClick={() => go(i - 1)} aria-label="Previous step"><ChevronLeft size={18} /></button>
          <button type="button" className="play" onClick={() => { if (!playing && i >= c.steps.length - 1) go(0); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button type="button" onClick={() => go(i + 1)} aria-label="Next step"><ChevronRight size={18} /></button>
          <button type="button" className={`spd${fast ? ' on' : ''}`} onClick={() => setFast(!fast)} aria-pressed={fast}>2×</button>
          <div className="scrub"><i style={{ width: `${((i + prog) / c.steps.length) * 100}%` }} /></div>
        </div>
      </section>

      {!!score.falsePositives.length && (
        <section className="tl-fp">
          <div className="tl-sec-h"><span><ShieldAlert size={14} /> False leads you pinned</span></div>
          {score.falsePositives.map((r) => { const f = findRow(c, r); return f && <article key={r}><b>{rowText(f.art, f.row)}</b><p>{f.row.why}</p></article>; })}
        </section>
      )}
      {!!score.missed.length && (
        <section className="tl-fp miss">
          <div className="tl-sec-h"><span>Steps you did not prove</span></div>
          {score.missed.map((id) => { const st = c.steps.find((x) => x.id === id)!; return <article key={id}><b>{st.t} · {st.title}</b><p>{st.text}</p></article>; })}
        </section>
      )}
      <section className="tl-vocab">
        <div className="tl-sec-h"><span>MITRE ATT&amp;CK you just met</span></div>
        <div className="chips">{techniques.map((t) => <a key={t.id} href={`https://attack.mitre.org/techniques/${t.id.replace('.', '/')}/`} target="_blank" rel="noreferrer noopener"><b>{t.id}</b> {t.name}<em>{t.tactic}</em></a>)}</div>
      </section>
      <div className="tl-reveal-actions"><button type="button" className="tl-btn primary" onClick={onExit}>Back to the case map</button></div>
    </div>
  );
}
