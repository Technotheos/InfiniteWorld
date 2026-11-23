import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Briefcase, ClipboardCheck, GitCommitHorizontal, Map as MapIcon, Pin, ScrollText } from 'lucide-react';
import type { Artifact, Case, Ref, ToolId } from './types';
import { ref } from './types';
import { allResolved, provenHosts, scoreCase, type CaseState, type Score } from './store';
import { Notebook, unpin } from './Notebook';
import { NetMap } from './NetMap';
import { Timeline } from './Timeline';
import { Replay } from './Replay';
import { TableView } from './viewers/TableView';
import { DiskView } from './viewers/DiskView';
import { PcapView } from './viewers/PcapView';
import { ProcView } from './viewers/ProcView';
import { HexView } from './viewers/HexView';
import { ChainView } from './viewers/ChainView';
import { sfx } from '../sound';

const TOOL: Record<ToolId, string> = { logs: 'Log viewer + query bar', disk: 'Disk viewer + UV scanner', packets: 'Packet table + interval analyser', hex: 'Hex viewer', proc: 'Process tree + deep scan', chain: 'Chain graph', map: 'Network map', timeline: 'Timeline builder' };
const KINDLABEL: Record<Artifact['kind'], string> = { table: 'LOG', disk: 'DISK', pcap: 'PCAP', proc: 'RAM', hex: 'HEX', chain: 'CHAIN' };

type Tab = 'bench' | 'book' | 'map' | 'time';

function useDesktop() {
  const [d, setD] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => { const m = window.matchMedia('(min-width: 1024px)'); const f = () => setD(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return d;
}

interface Props { c: Case; saved: CaseState; onChange: (s: CaseState) => void; onExit: () => void; onClose: (sc: Score) => void; reduce: boolean }

export function CaseDesk({ c, saved, onChange, onExit, onClose, reduce }: Props) {
  const [s, setS] = useState<CaseState>(saved);
  const [tab, setTab] = useState<Tab>('bench');
  const [side, setSide] = useState<'book' | 'map' | 'time'>('book');
  const [art, setArt] = useState(c.artifacts[0]!.id);
  const [brief, setBrief] = useState(!saved.seen);
  const [toast, setToast] = useState<string | null>(null);
  const [pull, setPull] = useState(0);
  const desktop = useDesktop();
  useEffect(() => onChange(s), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 2200); return () => window.clearTimeout(t); }, [toast]);

  const proven = useMemo(() => provenHosts(c, s), [c, s]);
  const score = useMemo(() => scoreCase(c, s), [c, s]);
  const pinCount = Object.keys(s.pins).length;
  const ready = allResolved(c, s);
  const cur = c.artifacts.find((a) => a.id === art)!;

  const onPin = (r: Ref) => {
    const had = r in s.pins;
    const before = provenHosts(c, s).size;
    setS((st) => {
      if (st.pins[r] !== undefined) return unpin(st, r);
      return { ...st, pins: { ...st.pins, [r]: Date.now() } };
    });
    sfx('click');
    if (!had) {
      setPull((n) => n + 1);
      const after = provenHosts(c, { ...s, pins: { ...s.pins, [r]: 1 } });
      if (after.size > before) { const h = c.hosts.find((x) => after.has(x.id) && !proven.has(x.id)); if (h) setToast(`Host proven: ${h.label}`); }
    }
  };

  const viewer = (a: Artifact) => {
    const common = { pins: s.pins, onPin, scanned: Boolean(s.scanned[a.id]), onScanned: () => setS((st) => ({ ...st, scanned: { ...st.scanned, [a.id]: true } })), reduce };
    switch (a.kind) {
      case 'table': return <TableView key={a.id} art={a} {...common} />;
      case 'disk': return <DiskView key={a.id} art={a} {...common} />;
      case 'pcap': return <PcapView key={a.id} art={a} {...common} />;
      case 'proc': return <ProcView key={a.id} art={a} {...common} />;
      case 'hex': return <HexView key={a.id} art={a} {...common} />;
      case 'chain': return <ChainView key={a.id} art={a} {...common} />;
    }
  };

  const close = () => { const sc = scoreCase(c, s); setS((st) => ({ ...st, closed: true })); sfx('win'); onClose(sc); };

  if (s.closed) return <Replay c={c} s={s} score={score} reduce={reduce} onExit={onExit} />;

  const bench = (
    <div className="tl-bench">
      <div className="tl-bags" role="tablist" aria-label="Evidence bags">
        {c.artifacts.map((a, i) => {
          const n = Object.keys(s.pins).filter((r) => r.startsWith(`${a.id}:`)).length;
          return (
            <button key={a.id} role="tab" aria-selected={art === a.id} className={`tl-bag${art === a.id ? ' on' : ''}`} onClick={() => { setArt(a.id); sfx('tick'); }}>
              <span className="strip">EVIDENCE</span>
              <span className="id">EV-{String(i + 1).padStart(2, '0')} · {KINDLABEL[a.kind]}</span>
              <b>{a.label}</b>
              {n > 0 && <span className="n">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="tl-crt">
        <div className="tl-crt-h"><span>{cur.label}</span><em>{cur.sub}</em></div>
        {viewer(cur)}
      </div>
    </div>
  );

  const book = <Notebook c={c} s={s} setS={setS} onJump={(id) => { setArt(id); setTab('bench'); }} />;
  const map = <NetMap c={c} proven={proven} />;
  const time = <Timeline c={c} s={s} setS={setS} />;

  return (
    <div className="tl-desk">
      <div className="tl-deskbar">
        <button type="button" className="tl-iconbtn" onClick={onExit} aria-label="Back to the case map"><ArrowLeft size={18} /></button>
        <div className="ttl"><span>CASE {String(c.no).padStart(2, '0')} · {c.kind}</span><h2>{c.title}</h2></div>
        <button type="button" className="tl-btn small" onClick={() => setBrief(true)}><ScrollText size={14} /> Briefing</button>
        <button type="button" className="tl-btn primary small" disabled={!ready} onClick={close} title={ready ? 'Close the case and see what really happened' : 'Resolve every question first'}><ClipboardCheck size={14} /> Close case</button>
        <i key={pull} className="tl-pull" aria-hidden="true" />
      </div>

      {desktop ? (
        <div className="tl-cols">
          <div className="main">{bench}</div>
          <aside className="side">
            <div className="tl-seg" role="tablist">
              {([['book', 'Notebook', pinCount], ['map', 'Map', proven.size], ['time', 'Timeline', s.timeline.length]] as const).map(([k, l, n]) => (
                <button key={k} role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>{l}{n ? <em>{n}</em> : null}</button>
              ))}
            </div>
            {side === 'book' ? book : side === 'map' ? map : time}
          </aside>
        </div>
      ) : (
        <div className="tl-mobile">{tab === 'bench' ? bench : tab === 'book' ? book : tab === 'map' ? map : time}</div>
      )}

      {!desktop && (
        <nav className="tl-tabbar" aria-label="Investigation desk">
          {([['bench', 'Bench', Briefcase, 0], ['book', 'Notebook', BookOpen, pinCount], ['map', 'Map', MapIcon, proven.size], ['time', 'Timeline', GitCommitHorizontal, s.timeline.length]] as const).map(([k, l, I, n]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}><I size={19} /><span>{l}</span>{n > 0 && <em>{n}</em>}</button>
          ))}
        </nav>
      )}

      {toast && <div className="tl-toast" role="status"><Pin size={14} /> {toast}</div>}

      {brief && (
        <div className="tl-modal" role="dialog" aria-modal="true" aria-label="Case briefing">
          <div className="tl-brief">
            <div className="bagrow">{c.artifacts.map((a, i) => <span key={a.id} className="mini" style={{ animationDelay: `${i * 0.12}s` }}>EV-{String(i + 1).padStart(2, '0')}</span>)}</div>
            <p className="eyebrow">CASE {String(c.no).padStart(2, '0')} · {c.kind.toUpperCase()}</p>
            <h2>{c.title}</h2>
            {c.briefing.map((p, i) => <p key={i} className="para" style={{ animationDelay: `${0.25 + i * 0.35}s` }}>{p}</p>)}
            {c.newTools.length > 0 && <div className="newtools"><b>Unlocked:</b> {c.newTools.map((t) => <span key={t}>{TOOL[t]}</span>)}</div>}
            <p className="rules">To answer a question you must pin evidence and link it. A lucky guess with no proof earns nothing. Some things look suspicious and are perfectly normal; pinning them costs you accuracy.</p>
            <button type="button" className="tl-btn primary" onClick={() => { setBrief(false); setS((st) => ({ ...st, seen: true })); sfx('go'); }}>Open the evidence bags</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { ref };
