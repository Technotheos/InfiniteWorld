import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Headphones, MessageSquare, Mic, Video } from 'lucide-react';
import '../styles/celestial.css';
import './trace-lab.css';
import { UserAvatar } from '../components/Avatar';
import { usePrefs } from '../hooks/usePrefs';
import { Atmosphere } from './Atmosphere';
import { CaseMap } from './CaseMap';
import { CaseDesk } from './CaseDesk';
import { DeskLine, OFFLINE, type LineStatus } from './DeskLine';
import { CASES } from './cases';
import { loadCase, loadProgress, rankFor, saveCase, saveProgress, totalXp, type CaseState, type Score, type TraceProgress } from './store';

export interface TraceLabProps {
  username?: string | null;
  /** The login token, used to open or join a desk line (voice, camera and chat). */
  token: string;
  onLeave: () => void;
  onDiscuss?: () => void;
  onAuthExpired?: () => void;
}

/**
 * Trace Lab: digital forensics. Seven breaches that already happened. You get raw evidence, rebuild the attack,
 * prove every answer, then watch what really happened. Runs in the browser; progress lives in localStorage.
 */
export default function TraceLab({ username, token, onLeave, onDiscuss, onAuthExpired }: TraceLabProps) {
  const [progress, setProgress] = useState<TraceProgress>(loadProgress);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saved, setSaved] = useState<CaseState | null>(null);
  const [lineOpen, setLineOpen] = useState(false);
  const [line, setLine] = useState<LineStatus>(OFFLINE);
  const reduce = Boolean(useReducedMotion());
  const [prefs] = usePrefs();
  const calm = reduce || !prefs.ambient;

  useEffect(() => saveProgress(progress), [progress]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeId]);

  const open = useCallback((id: string) => { setSaved(loadCase(id)); setActiveId(id); }, []);
  const c = CASES.find((x) => x.id === activeId) ?? null;
  const onChange = useCallback((s: CaseState) => { if (activeId) saveCase(activeId, s); }, [activeId]);
  const onClose = useCallback((sc: Score) => {
    if (!activeId) return;
    // a replay never lowers a score you already earned
    setProgress((p) => (p[activeId] && p[activeId]!.xp >= sc.xp ? p : { ...p, [activeId]: { xp: sc.xp, pct: sc.pct, stars: sc.stars } }));
  }, [activeId]);

  const xp = totalXp(progress), rank = rankFor(xp), callsign = username || 'Analyst';
  const lineLive = line.connected;

  return (
    <div className={`tl-root iw-root${calm ? ' iw-calm' : ''}`}>
      <Atmosphere calm={calm} />
      <div className="tl-shell">
        <header className="tl-head">
          <button type="button" className="tl-iconbtn" onClick={onLeave} aria-label="Back to home"><ArrowLeft size={18} /></button>
          <div className="ttl">
            <p className="eyebrow">// FORENSICS LAB · AFTER HOURS</p>
            <h1>Trace Lab</h1>
          </div>
          <div className="right">
            <div className="tl-rank">
              <UserAvatar name={callsign} size={34} />
              <div>
                <span className="cs">{callsign} · {rank.title}</span>
                <div className="rb" role="progressbar" aria-valuenow={Math.round(rank.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next rank"><i style={{ width: `${rank.pct}%` }} /></div>
              </div>
              <b>{xp} XP</b>
            </div>
            <button type="button" className={`tl-btn small line${lineLive ? ' live' : ''}`} onClick={() => setLineOpen(true)} aria-label="Desk line: voice, camera and chat">
              <Headphones size={15} /><span>Desk line</span>
              {lineLive && <span className="ind">{line.inVoice ? <Mic size={11} /> : <Video size={11} />}{line.others > 0 && <em>{line.others + 1}</em>}</span>}
            </button>
            {onDiscuss && <button type="button" className="tl-btn small ghost hide-sm" onClick={onDiscuss}><MessageSquare size={14} /> Discuss</button>}
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.main key={c?.id ?? 'map'} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            {c && saved ? (
              <CaseDesk key={c.id} c={c} saved={saved} onChange={onChange} onClose={onClose} onExit={() => { setActiveId(null); setSaved(null); }} reduce={reduce} />
            ) : (
              <>
                <section className="tl-intro">
                  <p>The breach has already happened. You get the evidence. Rebuild what the attacker did, in what order, and how they got in, and prove every answer.</p>
                  <div className="meta"><span>{Object.keys(progress).length} of {CASES.length} cases closed</span>{rank.next && <span>{rank.next.at - xp} XP to {rank.next.title}</span>}</div>
                </section>
                <CaseMap progress={progress} onOpen={open} reduce={reduce} />
              </>
            )}
          </motion.main>
        </AnimatePresence>
      </div>
      <DeskLine token={token} open={lineOpen} onClose={() => setLineOpen(false)} onStatus={setLine} onAuthExpired={onAuthExpired} />
    </div>
  );
}
