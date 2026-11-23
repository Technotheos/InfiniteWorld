import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { Case, Ref } from './types';
import { findRow, pinsOf, rowText, rowTs, type CaseState } from './store';
import { sfx } from '../sound';

type Setter = (fn: (s: CaseState) => CaseState) => void;

/** Drop pinned evidence in order and rebuild the attack, minute by minute. Drag on a laptop, or use the arrows on a phone. */
export function Timeline({ c, s, setS, readOnly }: { c: Case; s: CaseState; setS: Setter; readOnly?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null);
  const tray = pinsOf(s).filter((r) => !s.timeline.includes(r));
  const move = (from: number, to: number) => setS((st) => {
    if (to < 0 || to >= st.timeline.length) return st;
    const t = [...st.timeline]; const [x] = t.splice(from, 1); t.splice(to, 0, x!);
    return { ...st, timeline: t };
  });
  const add = (r: Ref) => { sfx('tick'); setS((st) => ({ ...st, timeline: [...st.timeline, r] })); };
  const item = (r: Ref) => { const f = findRow(c, r); return f ? { ts: rowTs(f.art, f.row), text: rowText(f.art, f.row), tag: f.art.label } : null; };
  return (
    <div className="tl-timeline">
      <div className="tl-netmap-h"><span>Attack timeline</span><b>{s.timeline.length} placed</b></div>
      <ol className="lane" aria-label="Timeline, earliest first">
        {s.timeline.map((r, i) => {
          const it = item(r); if (!it) return null;
          return (
            <li key={r} draggable={!readOnly} onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} className={drag === i ? 'drag' : ''}>
              <span className="dot">{i + 1}</span>
              <div className="card"><span className="ts">{it.ts || it.tag}</span><p>{it.text}</p></div>
              {!readOnly && (
                <div className="ctl">
                  <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, i - 1)}><ChevronLeft size={14} /></button>
                  <button type="button" aria-label="Move later" disabled={i === s.timeline.length - 1} onClick={() => move(i, i + 1)}><ChevronRight size={14} /></button>
                  <button type="button" aria-label="Remove from timeline" onClick={() => setS((st) => ({ ...st, timeline: st.timeline.filter((x) => x !== r) }))}><X size={14} /></button>
                </div>
              )}
            </li>
          );
        })}
        {!s.timeline.length && <li className="empty">Add pinned evidence below, then put it in the order the attacker did it. The timestamps printed in the evidence are your guide, but evidence from different machines needs care.</li>}
      </ol>
      {!readOnly && !!tray.length && (
        <>
          <div className="tl-sec-h"><span>Pinned, not yet placed</span></div>
          <ul className="tray">
            {tray.map((r) => { const it = item(r); return it && (
              <li key={r}><button type="button" onClick={() => add(r)}><Plus size={13} /><span className="ts">{it.ts}</span> {it.text}</button></li>
            ); })}
          </ul>
        </>
      )}
    </div>
  );
}
