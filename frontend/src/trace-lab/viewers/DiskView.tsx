import { Fragment, useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import type { DiskArt, DiskRow } from '../types';
import { ref } from '../types';
import { matches, parseQuery } from '../query';
import { SectorGrid } from '../SectorGrid';
import { sfx } from '../../sound';
import { PinBtn, QueryBar, useSort, type VP } from './shared';

const COLS = 28, ROWS = 8;
const size = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Deterministic, collision-free sector for every hidden or deleted entry. */
function cellMap(rows: DiskRow[]): Map<string, number> {
  const used = new Set<number>(), out = new Map<string, number>();
  for (const r of rows) {
    if (r.state === 'live') continue;
    let h = 7;
    for (const ch of r.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let c = h % (COLS * ROWS);
    while (used.has(c)) c = (c + 1) % (COLS * ROWS);
    used.add(c); out.set(r.id, c);
  }
  return out;
}

export function DiskView({ art, pins, onPin, scanned, onScanned, reduce }: VP<DiskArt>) {
  const [q, setQ] = useState('');
  const [running, setRunning] = useState(false);
  const [foundCells, setFound] = useState<number[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const sort = useSort('c');
  const cells = useMemo(() => cellMap(art.rows), [art.rows]);
  const hidden = useMemo(() => [...cells.values()], [cells]);
  const terms = useMemo(() => parseQuery(q), [q]);

  const visible = (r: DiskRow) => r.state === 'live' || scanned || foundCells.includes(cells.get(r.id) ?? -1);
  const rows = useMemo(() => {
    const k = sort.key as 'c' | 'm' | 'a' | 'path' | 'size';
    return art.rows
      .filter((r) => visible(r) && matches(terms, { path: r.path, state: r.state, m: r.m, a: r.a, c: r.c, fn: r.fn }))
      .sort((a, b) => {
        const x = a[k], y = b[k];
        return (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y))) * sort.dir;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.rows, terms, sort.key, sort.dir, scanned, foundCells]);

  const found = scanned ? hidden.length : foundCells.length;
  const start = () => { if (running) return; sfx('whoosh'); setFound([]); setRunning(true); };

  return (
    <div className="tl-viewer">
      <div className="tl-uv">
        <SectorGrid cols={COLS} rows={ROWS} hidden={hidden} running={running} litAll={scanned && !running} reduce={reduce}
          onFound={() => { sfx('ping'); }} onDone={() => { setRunning(false); onScanned(); }}
        />
        <div className="tl-uv-bar">
          <button type="button" className="tl-btn uv" onClick={start} disabled={running}>
            <ScanLine size={16} /> {running ? 'Sweeping…' : scanned ? 'Sweep again' : 'UV sweep the drive'}
          </button>
          <span className="tl-dimtxt">{found ? `${found} hidden or deleted entr${found === 1 ? 'y' : 'ies'} glowing` : 'Deleted and hidden entries only show under UV light.'}</span>
        </div>
      </div>
      <QueryBar value={q} onChange={setQ} count={rows.length} total={art.rows.filter(visible).length} placeholder='query  e.g.  path:Finance   state:deleted   -Temp' />
      <div className="tl-tablewrap">
        <table className="tl-table disk">
          <thead>
            <tr>
              <th className="pin" />
              {([['path', 'Path'], ['size', 'Size'], ['m', 'Modified'], ['a', 'Accessed'], ['c', 'Created ($SI)']] as const).map(([k, l]) => (
                <th key={k}><button type="button" onClick={() => sort.toggle(k)}>{l}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
              ))}
              <th>Created ($FN)</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rf = ref(art.id, r.id), on = rf in pins;
              return (
                <Fragment key={r.id}>
                  <tr className={`${on ? 'pinned' : ''}${r.state !== 'live' ? ` ghost ${r.state}` : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="pin"><PinBtn on={on} onClick={() => onPin(rf)} /></td>
                    <td className="mono path">{r.path}</td>
                    <td className="mono">{size(r.size)}</td>
                    <td className="mono">{r.m}</td><td className="mono">{r.a}</td><td className="mono">{r.c}</td><td className="mono">{r.fn}</td>
                    <td>{r.state === 'live' ? '' : r.state === 'deleted' ? 'deleted' : 'hidden'}</td>
                  </tr>
                  {open === r.id && r.detail && (
                    <tr className="tl-detail"><td colSpan={8}><dl>{Object.entries(r.detail).map(([k, v]) => <div key={k} className="x"><dt>{k}</dt><dd>{v}</dd></div>)}</dl></td></tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="tl-empty">No entries match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
