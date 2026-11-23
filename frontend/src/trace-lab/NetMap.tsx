import { useEffect, useRef } from 'react';
import type { Case, Host } from './types';
import { sfx } from '../sound';

const GLYPH: Record<Host['kind'], string> = { ws: 'PC', server: 'SRV', dc: 'DC', cloud: 'CLD', usb: 'USB', net: 'NET', wallet: '0x', attacker: 'ATK' };

/** Starts empty. A host appears the moment you prove the attacker touched it, and a red string joins proven neighbours. */
export function NetMap({ c, proven, all }: { c: Case; proven: Set<string>; all?: boolean }) {
  const shown = (id: string) => all || proven.has(id);
  const hosts = c.hosts.filter((h) => shown(h.id));
  const prev = useRef(0);
  useEffect(() => { if (!all && proven.size > prev.current && prev.current > 0) sfx('ping'); prev.current = proven.size; }, [proven.size, all]);
  const P = (h: Host) => ({ x: h.x, y: h.y * 0.62 + 4 });
  const by = (id: string) => c.hosts.find((h) => h.id === id)!;
  return (
    <div className="tl-netmap">
      <div className="tl-netmap-h"><span>Network map</span><b>{all ? c.hosts.length : proven.size} of {c.hosts.length} hosts {all ? 'in the attack' : 'proven'}</b></div>
      <svg viewBox="0 0 100 68" role="img" aria-label="Network map of proven hosts">
        {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1="0" x2="100" y1={i * 8 + 2} y2={i * 8 + 2} className="grid" />)}
        {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} y1="0" y2="68" x1={i * 8.4} x2={i * 8.4} className="grid" />)}
        {c.edges.filter(([a, b]) => shown(a) && shown(b)).map(([a, b]) => {
          const A = P(by(a)), B = P(by(b));
          return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="string tl-anim" pathLength={1} />;
        })}
        {hosts.map((h) => {
          const p = P(h);
          return (
            <g key={h.id} transform={`translate(${p.x} ${p.y})`} className={`host ${h.kind}`}>
              <g className="pop">
                <circle r="5.2" className="ping tl-anim" />
                <rect x="-5.2" y="-3.8" width="10.4" height="7.6" rx="1.4" className="body" />
                <text y="1.1" className="glyph">{GLYPH[h.kind]}</text>
                <text y="8.6" className="name">{h.label}</text>
                {h.ip && <text y="11.4" className="ip">{h.ip}</text>}
              </g>
            </g>
          );
        })}
      </svg>
      {!hosts.length && <p className="tl-empty-note">No hosts proven yet. Pin evidence that shows where the attacker has been, and the map fills in.</p>}
    </div>
  );
}
