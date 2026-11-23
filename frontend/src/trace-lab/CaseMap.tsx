import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, Cpu, HardDrive, KeyRound, Layers, Link2, Lock, Radio, Play, RotateCcw } from 'lucide-react';
import { CASES } from './cases';
import type { Case } from './types';
import type { TraceProgress } from './store';

const ICON: Record<string, typeof HardDrive> = { disk: HardDrive, pcap: Radio, proc: Cpu, log: KeyRound, cloud: Cloud, chain: Link2, all: Layers };
const ROW = 168;

export const isUnlocked = (c: Case, p: TraceProgress) => c.no === 1 || Boolean(p[CASES[c.no - 2]!.id]);

/** The wall of case files. A red string pulls tight from each closed case to the next. */
export function CaseMap({ progress, onOpen, reduce }: { progress: TraceProgress; onOpen: (id: string) => void; reduce: boolean }) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => { const m = window.matchMedia('(min-width: 768px)'); const f = () => setWide(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const x = (i: number) => (wide ? (i % 2 ? 59 : 41) : 9.5);
  const H = CASES.length * ROW;
  const y = (i: number) => i * ROW + ROW / 2;
  return (
    <div className="tl-casemap" style={{ height: H }}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="strings" aria-hidden="true">
        {CASES.slice(0, -1).map((c, i) => {
          const done = Boolean(progress[c.id]);
          const d = `M ${x(i)} ${y(i)} C ${x(i)} ${y(i) + 70}, ${x(i + 1)} ${y(i + 1) - 70}, ${x(i + 1)} ${y(i + 1)}`;
          return <path key={c.id} d={d} className={`str${done ? ' tight' : ''}`} pathLength={1} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {CASES.map((c, i) => {
        const open = isUnlocked(c, progress), res = progress[c.id], Icon = ICON[c.icon] ?? HardDrive;
        const left = wide && i % 2 === 0;
        return (
          <motion.div key={c.id} className={`tl-file${open ? '' : ' locked'}${res ? ' done' : ''}${left ? ' left' : ''}`}
            style={{ top: y(i) - ROW / 2 + 8, height: ROW - 16, ...(wide ? (left ? { left: 0, right: `${100 - x(i)}%` } : { left: `${x(i)}%`, right: 0 }) : { left: '17%', right: 0 }) }}
            initial={reduce ? false : { opacity: 0, y: 18, rotate: i % 2 ? 1.2 : -1.2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.45, delay: i * 0.07 }}>
            <span className="pinhead" style={{ left: wide ? (left ? '100%' : '0%') : '-9%' }} />
            <button type="button" disabled={!open} onClick={() => onOpen(c.id)} aria-label={`${c.title}${open ? '' : ' (locked)'}`}>
              <div className="tab">CASE {String(c.no).padStart(2, '0')}</div>
              <div className="body">
                <div className="ic">{open ? <Icon size={22} /> : <Lock size={20} />}</div>
                <div className="tx">
                  <span className="kind">{c.kind}</span>
                  <h3>{c.title}</h3>
                  <p>{open ? c.tagline : `Close case ${c.no - 1} to unlock.`}</p>
                </div>
                <div className="st">
                  {res ? <><span className="stars">{[1, 2, 3].map((n) => <i key={n} className={n <= res.stars ? 'on' : ''}>★</i>)}</span><small>{res.xp} XP</small><span className="act"><RotateCcw size={13} /> Replay</span></> : open ? <span className="act go"><Play size={13} /> Open file</span> : null}
                </div>
              </div>
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
