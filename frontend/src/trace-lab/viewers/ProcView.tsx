import { Fragment, useMemo, useState } from 'react';
import { Radar } from 'lucide-react';
import type { ProcArt, ProcRow } from '../types';
import { ref } from '../types';
import { matches, parseQuery } from '../query';
import { sfx } from '../../sound';
import { PinBtn, QueryBar, type VP } from './shared';

export function ProcView({ art, pins, onPin, scanned, onScanned, reduce }: VP<ProcArt>) {
  const [q, setQ] = useState('');
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const terms = useMemo(() => parseQuery(q), [q]);

  const shown = (r: ProcRow) => !r.hidden || scanned;
  const flat = useMemo(() => {
    const rows = art.rows.filter(shown);
    const ids = new Set(rows.map((r) => r.pid));
    const kids = new Map<number, ProcRow[]>();
    const roots: ProcRow[] = [];
    for (const r of rows) {
      const parent = r.hidden ? r.ppid : r.ppid;
      if (ids.has(parent) && parent !== r.pid) (kids.get(parent) ?? kids.set(parent, []).get(parent)!).push(r);
      else roots.push(r);
    }
    const out: { r: ProcRow; depth: number }[] = [];
    const walk = (r: ProcRow, depth: number) => { out.push({ r, depth }); (kids.get(r.pid) ?? []).sort((a, b) => a.created.localeCompare(b.created)).forEach((k) => walk(k, depth + 1)); };
    roots.sort((a, b) => a.pid - b.pid).forEach((r) => walk(r, 0));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.rows, scanned]);

  const list = flat.filter(({ r }) => matches(terms, { name: r.name, pid: String(r.pid), ppid: String(r.ppid), user: r.user, cmd: r.cmd }));
  const run = () => {
    if (running) return;
    sfx('whoosh');
    if (reduce) { onScanned(); return; }
    setRunning(true);
    window.setTimeout(() => { setRunning(false); onScanned(); sfx('ping'); }, 2600);
  };

  return (
    <div className="tl-viewer">
      <QueryBar value={q} onChange={setQ} count={list.length} total={flat.length} placeholder='query  e.g.  name:svchost   user:acarter   -MsMpEng'
        extra={<button type="button" className={`tl-btn small${scanned ? ' on' : ''}`} onClick={run} disabled={running}><Radar size={14} /> {running ? 'Scanning…' : scanned ? 'Rescan' : 'Deep scan'}</button>} />
      {!scanned && <div className="tl-qhint">Showing the active process list (pslist). A deep scan walks raw memory (psscan) and also shows each process’s creator.</div>}
      <div className={`tl-tablewrap tall${running ? ' scanning' : ''}`}>
        {running && <div className="tl-sweep" aria-hidden="true" />}
        <table className="tl-table proc">
          <thead><tr><th className="pin" /><th>Process</th><th>PID</th><th>PPID</th><th>Creator</th><th>User</th><th>Created</th></tr></thead>
          <tbody>
            {list.map(({ r, depth }) => {
              const rf = ref(art.id, r.id), on = rf in pins;
              const lie = scanned && r.creator !== undefined && r.creator !== r.ppid;
              return (
                <Fragment key={r.id}>
                  <tr className={`${on ? 'pinned' : ''}${r.hidden ? ' flick' : ''}${lie ? ' lie' : ''}`} onClick={() => setOpen(open === r.pid ? null : r.pid)}>
                    <td className="pin"><PinBtn on={on} onClick={() => onPin(rf)} /></td>
                    <td className="pname" style={{ paddingLeft: 8 + depth * 16 }}><span className="tl-branch">{depth ? '└' : ''}</span>{r.name}</td>
                    <td className="mono">{r.pid}</td>
                    <td className="mono">{r.ppid}</td>
                    <td className="mono">{scanned ? (r.creator ?? r.ppid) : '—'}{lie && <span className="tl-lie" title="Creator differs from the reported parent"> ≠</span>}</td>
                    <td>{r.user.replace('NT AUTHORITY\\', '')}</td>
                    <td className="mono">{r.created.slice(11)}</td>
                  </tr>
                  {open === r.pid && (
                    <tr className="tl-detail"><td colSpan={7}>
                      <dl><div className="x"><dt>Command line</dt><dd className="mono">{r.cmd || '(none)'}</dd></div>
                        <div className="x"><dt>Created</dt><dd className="mono">{r.created}</dd></div>
                        {r.detail && Object.entries(r.detail).map(([k, v]) => <div key={k} className="x"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
