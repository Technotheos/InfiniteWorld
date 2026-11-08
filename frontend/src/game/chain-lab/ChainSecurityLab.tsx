import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import '../../styles/celestial.css';
import { Starfield } from '../../components/Starfield';
import { MissionView } from './MissionView';
import { SectorMap } from './SectorMap';
import { MISSIONS } from './missions';
import { loadProgress, rankFor, saveProgress, totalXp, type Progress } from './progress';
import { FOCUS } from './ui';

export interface ChainSecurityLabProps {
  username?: string | null;
  /** Back to the Home hub. */
  onLeave: () => void;
  /** Optional: open the live chat room for this lab. */
  onDiscuss?: () => void;
}

/**
 * Chain Security Lab: a room where you replay real bridge exploits in 3D,
 * find the flaw in simplified code, and choose the patch.
 * Everything runs in the browser; progress is kept in localStorage.
 */
export default function ChainSecurityLab({ username, onLeave, onDiscuss }: ChainSecurityLabProps) {
  const [done, setDone] = useState<Progress>(loadProgress);
  const [activeId, setActiveId] = useState<string | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => saveProgress(done), [done]);

  // Escape: leave the mission and return to the sector map.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeId]);

  const complete = useCallback((id: string, earned: number) => {
    setDone((d) => (id in d ? d : { ...d, [id]: earned }));
  }, []);

  const xp = totalXp(done);
  const rank = rankFor(xp);
  const mission = MISSIONS.find((m) => m.id === activeId) ?? null;
  const callsign = username || 'Explorer';

  return (
    <div className="iw-root relative min-h-screen overflow-x-hidden">
      <Starfield />

      {/* Ambient nebula */}
      <div
        className="iw-anim fixed top-[-10%] left-[-10%] w-[520px] h-[520px] bg-[#2a1750]/30 rounded-full blur-[150px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 26s ease-in-out infinite' }}
      />
      <div
        className="iw-anim fixed bottom-[-12%] right-[-10%] w-[620px] h-[620px] bg-[#5a3b12]/20 rounded-full blur-[170px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 32s ease-in-out infinite reverse' }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 py-6 space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <button
              onClick={onLeave}
              aria-label="Back to home"
              className={`mt-1 w-10 h-10 shrink-0 rounded-full border border-white/10 flex items-center justify-center text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 transition ${FOCUS}`}
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="iw-display text-4xl sm:text-5xl font-light tracking-wide leading-tight">
                Chain Security Lab
              </h1>
              <p className="text-sm text-[#a49fb0] mt-1 max-w-xl">
                Replay famous bridge exploits in 3D, find the flaw, and ship the fix.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-4 py-2 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md">
              <div className="text-[11px] text-[#a49fb0] capitalize">
                {callsign} · {rank.title}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div
                  className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(rank.pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress to next rank"
                >
                  <div
                    className="h-full bg-gradient-to-r from-[#e9b872] to-[#9b8cff] transition-all duration-700"
                    style={{ width: `${rank.pct}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-[#c9c4d2]">{xp} XP</span>
              </div>
            </div>
            {onDiscuss && (
              <button
                onClick={onDiscuss}
                className={`px-4 py-2.5 rounded-xl border border-white/10 text-sm text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 flex items-center gap-2 transition ${FOCUS}`}
              >
                <MessageSquare size={15} /> Live discussion
              </button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={mission?.id ?? 'map'}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
          >
            {mission ? (
              <MissionView
                mission={mission}
                alreadyDone={mission.id in done}
                onBack={() => setActiveId(null)}
                onComplete={complete}
              />
            ) : (
              <SectorMap done={done} onLaunch={setActiveId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
