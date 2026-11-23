import { useState } from 'react';
import type { ChainArt, ChainNode } from '../types';
import { ref } from '../types';
import { PinBtn, type VP } from './shared';

const KIND: Record<ChainNode['kind'], { c: string; t: string }> = {
  victim: { c: '#ff5d73', t: 'VICTIM' }, wallet: { c: '#9fb4c7', t: 'WALLET' }, mixer: { c: '#a78bff', t: 'MIXER' },
  bridge: { c: '#ffb454', t: 'BRIDGE' }, exchange: { c: '#7cffb2', t: 'EXCHANGE' }, dex: { c: '#5ec8ff', t: 'DEX' }, multisig: { c: '#e7c46a', t: 'MULTISIG' },
};

export function ChainView({ art, pins, onPin }: VP<ChainArt>) {
  const [sel, setSel] = useState<string | null>(null);
  const node = (id: string) => art.nodes.find((n) => n.id === id)!;
  const P = (n: ChainNode) => ({ x: n.x, y: n.y * 0.6 + 4 });
  const cur = art.rows.find((e) => e.id === sel);
  return (
    <div className="tl-viewer">
      <div className="tl-chainwrap">
        <svg viewBox="0 0 100 68" className="tl-chain" role="img" aria-label="Fund flow graph">
          <defs><marker id="tl-arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0 6 3 0 6z" fill="currentColor" /></marker></defs>
          {art.rows.map((e) => {
            const a = P(node(e.from)), b = P(node(e.to)), on = ref(art.id, e.id) in pins, isSel = sel === e.id;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            return (
              <g key={e.id} className={`tl-edge${on ? ' on' : ''}${isSel ? ' sel' : ''}`} onClick={() => setSel(isSel ? null : e.id)}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="ln" markerEnd="url(#tl-arr)" />
                <text x={mx} y={my - 1.2} className="amt">{e.amt} {e.asset.split('→')[0]}</text>
              </g>
            );
          })}
          {art.nodes.map((n) => {
            const p = P(n), k = KIND[n.kind];
            return (
              <g key={n.id} className="tl-node" transform={`translate(${p.x} ${p.y})`}>
                <circle r="3.1" fill="#0a0f14" stroke={k.c} strokeWidth="0.5" />
                <text y="0.9" className="k" fill={k.c}>{k.t[0]}</text>
                <text y="6.4" className="lbl">{n.label}</text>
                {n.chain && <text y="9" className="chn">{n.chain} chain</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="tl-dimtxt">Tap an arrow to inspect a transfer. Pinned transfers are drawn as a red string.</p>
      {cur && (
        <div className="tl-card">
          <div className="tl-card-h"><b>{cur.amt} {cur.asset}</b><span>{node(cur.from).label} → {node(cur.to).label}</span><PinBtn on={ref(art.id, cur.id) in pins} onClick={() => onPin(ref(art.id, cur.id))} label="transfer" /></div>
          <dl><div className="x"><dt>Time</dt><dd className="mono">{cur.time}</dd></div><div className="x"><dt>Tx hash</dt><dd className="mono">{cur.hash}</dd></div>
            {cur.detail && Object.entries(cur.detail).map(([k, v]) => <div key={k} className="x"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>
      )}
      <div className="tl-tablewrap">
        <table className="tl-table">
          <thead><tr><th className="pin" /><th>Time</th><th>From</th><th>To</th><th>Amount</th><th>Tx</th></tr></thead>
          <tbody>
            {[...art.rows].sort((a, b) => a.time.localeCompare(b.time)).map((e) => {
              const rf = ref(art.id, e.id), on = rf in pins;
              return (
                <tr key={e.id} className={`${on ? 'pinned' : ''}${sel === e.id ? ' open' : ''}`} onClick={() => setSel(e.id)}>
                  <td className="pin"><PinBtn on={on} onClick={() => onPin(rf)} label="transfer" /></td>
                  <td className="mono">{e.time}</td><td>{node(e.from).label}</td><td>{node(e.to).label}</td><td className="mono">{e.amt} {e.asset}</td><td className="mono">{e.hash}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
