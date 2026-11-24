import { useState, type ReactNode } from 'react';
import { Pin, PinOff, Search, X } from 'lucide-react';
import type { Ref } from '../types';
import { asciiOf } from '../gen';

export interface VP<A> {
  art: A;
  pins: Record<Ref, number>;
  onPin: (r: Ref) => void;
  /** run-once tools (UV scan, deep scan) remember that they were run */
  scanned: boolean;
  onScanned: () => void;
  reduce: boolean;
}

export function PinBtn({ on, onClick, label = 'evidence' }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" className={`tl-pinbtn${on ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(); }} aria-pressed={on} aria-label={on ? `Unpin ${label}` : `Pin ${label}`} title={on ? 'Unpin' : 'Pin as evidence'}>
      {on ? <PinOff size={15} /> : <Pin size={15} />}
    </button>
  );
}

export function QueryBar({ value, onChange, placeholder, count, total, extra }: { value: string; onChange: (v: string) => void; placeholder?: string; count: number; total: number; extra?: ReactNode }) {
  return (
    <div className="tl-query">
      <Search size={15} aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'filter:  word   field:value   -exclude   "phrase"'} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Query" />
      {value && <button type="button" className="tl-x" onClick={() => onChange('')} aria-label="Clear query"><X size={14} /></button>}
      <span className="tl-count">{count === total ? total : `${count}/${total}`}</span>
      {extra}
    </div>
  );
}

/** offset / hex / ascii, the way every hex editor draws it. */
export function HexDump({ bytes, off = 0, hl }: { bytes: string; off?: number; hl?: string }) {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) rows.push(bytes.slice(i, i + 32));
  return (
    <pre className="tl-hex" aria-label="Hex dump">
      {rows.map((r, i) => {
        const a = asciiOf(r);
        const hit = hl && a.toLowerCase().includes(hl.toLowerCase());
        return (
          <div key={i} className={hit ? 'hit' : undefined}>
            <span className="o">{(off + i * 16).toString(16).padStart(8, '0')}</span>
            <span className="b">{r.replace(/(..)/g, '$1 ').trim().padEnd(47, ' ')}</span>
            <span className="a">{a}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function Sec({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="tl-sec">
      <div className="tl-sec-h"><span>{title}</span>{right}</div>
      {children}
    </div>
  );
}

export function useSort(initial?: string) {
  const [key, setKey] = useState<string | undefined>(initial);
  const [dir, setDir] = useState<1 | -1>(1);
  return { key, dir, toggle: (k: string) => { if (k === key) setDir((d) => (d === 1 ? -1 : 1)); else { setKey(k); setDir(1); } } };
}
