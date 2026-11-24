import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TableArt, TableRow } from '../types';
import { ref } from '../types';
import { matches, parseQuery } from '../query';
import { PinBtn, QueryBar, useSort, type VP } from './shared';

/** Logs, registry exports, audit trails, tickets, sockets: one viewer with a query bar, sorting and a row inspector. */
export function TableView({ art, pins, onPin }: VP<TableArt>) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const sort = useSort(art.sortKey);
  const terms = useMemo(() => parseQuery(q), [q]);

  const rows = useMemo(() => {
    let r = art.rows.filter((x) => matches(terms, x.cells));
    if (sort.key) {
      const k = sort.key;
      r = [...r].sort((a, b) => (a.cells[k] ?? '').localeCompare(b.cells[k] ?? '', undefined, { numeric: true }) * sort.dir);
    }
    return r;
  }, [art.rows, terms, sort.key, sort.dir]);

  const fieldHint = art.cols.map((c) => c.k).join(', ');
  return (
    <div className="tl-viewer">
      <QueryBar value={q} onChange={setQ} count={rows.length} total={art.rows.length} placeholder={`query  e.g.  ${art.cols[1]?.k ?? 'field'}:value  -noise  "exact phrase"`} />
      <div className="tl-qhint">fields: {fieldHint}</div>
      <div className="tl-tablewrap">
        <table className="tl-table">
          <thead>
            <tr>
              <th className="pin" />
              {art.cols.map((c) => (
                <th key={c.k} style={c.w ? { minWidth: c.w } : undefined}>
                  <button type="button" onClick={() => sort.toggle(c.k)} aria-label={`Sort by ${c.label}`}>{c.label}{sort.key === c.k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.id} art={art} r={r} on={ref(art.id, r.id) in pins} open={open === r.id} setOpen={() => setOpen(open === r.id ? null : r.id)} onPin={() => onPin(ref(art.id, r.id))} />)}
            {!rows.length && <tr><td colSpan={art.cols.length + 1} className="tl-empty">No rows match this query.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ art, r, on, open, setOpen, onPin }: { art: TableArt; r: TableRow; on: boolean; open: boolean; setOpen: () => void; onPin: () => void }) {
  return (
    <Fragment>
      <tr className={`${on ? 'pinned' : ''}${open ? ' open' : ''}`} onClick={setOpen}>
        <td className="pin"><PinBtn on={on} onClick={onPin} /></td>
        {art.cols.map((c, i) => (
          <td key={c.k} className={c.mono ? 'mono' : undefined}>
            {i === 0 && (open ? <ChevronDown size={12} className="tl-chev" /> : <ChevronRight size={12} className="tl-chev" />)}
            {r.cells[c.k]}
          </td>
        ))}
      </tr>
      {open && (
        <tr className="tl-detail">
          <td colSpan={art.cols.length + 1}>
            <dl>
              {art.cols.map((c) => <div key={c.k}><dt>{c.label}</dt><dd className={c.mono ? 'mono' : undefined}>{r.cells[c.k]}</dd></div>)}
              {r.detail && Object.entries(r.detail).map(([k, v]) => <div key={k} className="x"><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
