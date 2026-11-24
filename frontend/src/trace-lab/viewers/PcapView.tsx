import { Fragment, useMemo, useState } from 'react';
import { Activity, Unlock } from 'lucide-react';
import type { PacketRow, PcapArt } from '../types';
import { ref } from '../types';
import { b32dec, clock } from '../gen';
import { matches, parseQuery } from '../query';
import { HexDump, PinBtn, QueryBar, Sec, type VP } from './shared';

interface Flow { key: string; src: string; dst: string; n: number; mean: number; cov: number; deltas: number[] }

function flowsOf(rows: PacketRow[]): { flows: Flow[]; delta: Map<string, number> } {
  const last = new Map<string, number>(), by = new Map<string, number[]>(), delta = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.src}>${r.dst}`;
    const p = last.get(k);
    if (p !== undefined) { const d = r.t - p; delta.set(r.id, d); (by.get(k) ?? by.set(k, []).get(k)!).push(d); }
    last.set(k, r.t);
  }
  const flows: Flow[] = [];
  for (const [k, ds] of by) {
    if (ds.length < 5) continue;
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length);
    const [src, dst] = k.split('>') as [string, string];
    flows.push({ key: k, src, dst, n: ds.length + 1, mean, cov: mean ? sd / mean : 0, deltas: ds });
  }
  return { flows: flows.sort((a, b) => a.cov - b.cov), delta };
}

const decodeInfo = (info: string): string | null => {
  const m = /TXT\s+(?:[0-9a-f]{2}\.)?([a-z2-7]{8,})\./.exec(info);
  return m ? b32dec(m[1]!) : null;
};

export function PcapView({ art, pins, onPin }: VP<PcapArt>) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [tool, setTool] = useState(false);
  const [dec, setDec] = useState<Record<string, string>>({});
  const terms = useMemo(() => parseQuery(q), [q]);
  const { flows, delta } = useMemo(() => flowsOf(art.rows), [art.rows]);
  const rows = useMemo(() => art.rows.filter((r) => matches(terms, { src: r.src, dst: r.dst, proto: r.proto, info: r.info, len: String(r.len) })), [art.rows, terms]);
  const inv = art.inventory ?? {};

  return (
    <div className="tl-viewer">
      <QueryBar value={q} onChange={setQ} count={rows.length} total={art.rows.length} placeholder='filter  e.g.  src:10.20.4.31   proto:dns   -ntp   "cdn-update"'
        extra={<button type="button" className={`tl-btn small${tool ? ' on' : ''}`} onClick={() => setTool(!tool)} aria-pressed={tool}><Activity size={14} /> Intervals</button>} />
      {tool && (
        <Sec title="Interval analyser · flows with five or more packets, most regular first">
          <div className="tl-flows">
            {flows.slice(0, 8).map((f) => (
              <button type="button" key={f.key} className="tl-flow" onClick={() => { setQ(`src:${f.src} dst:${f.dst}`); setTool(false); }} title="Filter to this flow">
                <div className="h"><b>{f.src}</b> → <b>{f.dst}</b></div>
                <div className="m">{inv[f.dst] ?? 'unknown host'}</div>
                <Spark ds={f.deltas} />
                <div className="s">{f.n} packets · mean gap {f.mean.toFixed(1)} s · spread {(f.cov * 100).toFixed(1)} %</div>
              </button>
            ))}
            {!flows.length && <p className="tl-dimtxt">No repeating flows.</p>}
          </div>
          <p className="tl-dimtxt">A low spread means a very regular rhythm. Regular is suspicious, but plenty of honest software is regular too.</p>
        </Sec>
      )}
      <div className="tl-tablewrap tall">
        <table className="tl-table pcap">
          <thead><tr><th className="pin" /><th>No.</th><th>Time</th><th>Δ same flow</th><th>Source</th><th>Destination</th><th>Proto</th><th>Len</th><th>Info</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const rf = ref(art.id, r.id), on = rf in pins, d = delta.get(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className={`${on ? 'pinned' : ''}${open === r.id ? ' open' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="pin"><PinBtn on={on} onClick={() => onPin(rf)} /></td>
                    <td className="mono">{i + 1}</td>
                    <td className="mono">{r.t.toFixed(3)}</td>
                    <td className="mono">{d === undefined ? '' : d.toFixed(2)}</td>
                    <td className="mono" title={inv[r.src]}>{r.src}</td><td className="mono" title={inv[r.dst]}>{r.dst}</td>
                    <td>{r.proto}</td><td className="mono">{r.len}</td><td className="info">{r.info}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="tl-detail"><td colSpan={9}>
                      <dl>
                        <div className="x"><dt>Source</dt><dd>{r.src} · {inv[r.src] ?? 'external / unlisted'}</dd></div>
                        <div className="x"><dt>Destination</dt><dd>{r.dst} · {inv[r.dst] ?? 'external / unlisted'}</dd></div>
                        <div className="x"><dt>Capture time</dt><dd>{clock(r.t)} into the capture</dd></div>
                      </dl>
                      {r.payload && <HexDump bytes={r.payload} />}
                      {decodeInfo(r.info) !== null && (
                        <div className="tl-decode">
                          <button type="button" className="tl-btn small" onClick={() => setDec((s) => ({ ...s, [r.id]: decodeInfo(r.info)! }))}><Unlock size={14} /> Decode base32 label</button>
                          {dec[r.id] !== undefined && <code>{dec[r.id]}</code>}
                        </div>
                      )}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="tl-empty">No packets match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Gap between consecutive packets: a flat line means a metronome. */
function Spark({ ds }: { ds: number[] }) {
  const max = Math.max(...ds) * 1.15 || 1, W = 160, H = 34;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tl-spark" aria-hidden="true">
      {ds.slice(0, 60).map((d, i) => <circle key={i} cx={4 + (i * (W - 8)) / Math.max(1, Math.min(ds.length, 60) - 1)} cy={H - 3 - (d / max) * (H - 6)} r="1.7" />)}
    </svg>
  );
}
