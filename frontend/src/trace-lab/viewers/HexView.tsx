import { useMemo, useState } from 'react';
import type { HexArt } from '../types';
import { ref } from '../types';
import { asciiOf } from '../gen';
import { PinBtn, QueryBar, type VP } from './shared';

export function HexView({ art, pins, onPin }: VP<HexArt>) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => art.rows.map((r) => ({ r, a: asciiOf(r.bytes) })), [art.rows]);
  const needle = q.trim().toLowerCase();
  const hit = (a: string, b: string) => needle && (a.toLowerCase().includes(needle) || b.includes(needle.replace(/\s/g, '')));
  const n = rows.filter(({ r, a }) => hit(a, r.bytes)).length;
  return (
    <div className="tl-viewer">
      <QueryBar value={q} onChange={setQ} count={n || rows.length} total={rows.length} placeholder="find ASCII text or hex bytes, e.g.  MZ   or   4d5a" />
      <div className="tl-tablewrap tall">
        <div className="tl-hexrows">
          {rows.map(({ r, a }) => {
            const rf = ref(art.id, r.id), on = rf in pins;
            return (
              <div key={r.id} className={`tl-hexrow${on ? ' pinned' : ''}${hit(a, r.bytes) ? ' hit' : ''}`}>
                <PinBtn on={on} onClick={() => onPin(rf)} />
                <span className="o">{r.off.toString(16).padStart(8, '0')}</span>
                <span className="b">{r.bytes.replace(/(..)/g, '$1 ').trim()}</span>
                <span className="a">{a}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
