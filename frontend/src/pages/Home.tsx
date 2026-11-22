import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from '../components/Logo';
import { motion, useReducedMotion, type MotionProps } from 'framer-motion';
import {
  ArrowUpRight, Brain, Fingerprint, Gamepad2, Home as HomeIcon, LogOut,
  Settings as SettingsIcon, ShieldAlert,
} from 'lucide-react';
import '../styles/celestial.css';
import { Starfield, type StarfieldHandle } from '../components/Starfield';
import { Sigil } from '../components/Sigil';
import { Avatar } from '../components/Avatar';
import { usePrefs } from '../hooks/usePrefs';
import type { EngineStatus } from '../hooks/useEngineStatus';
import { MISSIONS, loadProgress, rankFor, totalXp } from '../game/chain-lab';
import { CASES, SectorGrid, loadProgress as loadTrace } from '../trace-lab';
import { SlugToggles, useDockedToggles } from '../mascot';
import { RoomPortals } from '../components/RoomPortals';
import { FriendsPanel } from '../social/FriendsPanel';
import { Ambient, sfx } from '../sound';

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface HomeProps {
  username?: string | null;
  /** Open the Chain Security Lab room. */
  onOpenLab: () => void;
  /** Open the Deep AI Lab room. */
  onOpenAILab: () => void;
  /** Open the Trace Lab (digital forensics). */
  onOpenTrace: () => void;
  /** Enter a game room straight from its card (quick play, or a new private room). */
  onPlayMap: (mapId: string, isPrivate: boolean) => Promise<string>;
  /** Join a game room by its code. */
  onJoinCode: (code: string) => void;
  onLogout: () => void;
  /** Open the profile & settings page. */
  onOpenSettings: () => void;
  /** The user's profile picture URL, if they have one. */
  avatarSrc?: string | null;
  /** Pass the real engine state so the badge never lies. */
  engineStatus?: EngineStatus;
}

const STATUS_STYLES: Record<EngineStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-[#5eead4]', text: 'text-[#5eead4]' },
  connecting: { label: 'Connecting…', dot: 'bg-[#e9b872]', text: 'text-[#e9b872]' },
  offline: { label: 'Offline', dot: 'bg-[#ff5d4a]', text: 'text-[#ff5d4a]' },
};

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';

/* -------------------------------------------------------------------------- */
/*  Content                                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A tiny blockchain under attack, for the Chain Security Lab card:
 * a hostile packet races down the chain, one block gets breached (red, glitching),
 * its hash scrambles, then the patch lands and it turns back to gold. Loops forever.
 * Pure SVG + CSS keyframes (see celestial.css); `iw-anim` makes it respect reduced motion / calm mode.
 */
function MiniChainHack() {
  const blocks = [8, 38, 68]; // x of each block (viewBox 100 wide)
  const hexes = ['0x9f3a', '0xc41e', '0x7b02', '0xe5d8', '0x31af', '0xa07c'];
  return (
    <svg viewBox="0 0 100 70" className="w-full h-44" aria-hidden="true">
      {/* falling hex data in the background */}
      {hexes.map((h, i) => (
        <text key={h} x={6 + i * 16} y="0" fontSize="3.4" fontFamily="monospace" fill="rgba(233,184,114,0.35)"
          className="iw-anim iw-hexfall" style={{ animationDelay: `${-i * 1.1}s`, animationDuration: `${5 + (i % 3)}s` }}>
          {h}
        </text>
      ))}

      {/* links between blocks */}
      {blocks.slice(0, -1).map((x, i) => (
        <g key={x}>
          <line x1={x + 24} y1="35" x2={blocks[i + 1]} y2="35" stroke="rgba(233,184,114,0.55)" strokeWidth="1" />
          <line x1={x + 24} y1="35" x2={blocks[i + 1]} y2="35" stroke="#e9b872" strokeWidth="1"
            strokeDasharray="2 4" className="iw-anim iw-flow" />
        </g>
      ))}

      {/* blocks */}
      {blocks.map((x, i) => {
        const hit = i === 1; // the middle block is the one that gets breached
        return (
          <g key={x} className={hit ? 'iw-anim iw-breach' : ''} style={hit ? { transformBox: 'fill-box', transformOrigin: 'center' } : undefined}>
            <rect x={x} y="21" width="24" height="28" rx="3" fill="rgba(13,11,22,0.9)"
              stroke="rgba(233,184,114,0.7)" strokeWidth="0.8" className={hit ? 'iw-anim iw-breach-stroke' : ''} />
            <text x={x + 3} y="28" fontSize="3" fontFamily="monospace" fill="rgba(238,233,220,0.55)">#{4821 + i}</text>
            <rect x={x + 3} y="31" width="18" height="1.6" rx="0.8" fill="rgba(233,184,114,0.5)" />
            <rect x={x + 3} y="35" width="13" height="1.6" rx="0.8" fill="rgba(155,140,255,0.5)" />
            <rect x={x + 3} y="39" width="16" height="1.6" rx="0.8" fill="rgba(233,184,114,0.35)" />
            {hit ? (
              <>
                <text x={x + 3} y="46" fontSize="3" fontFamily="monospace" fill="#ff5d4a" className="iw-anim iw-hash-bad">0xDEAD</text>
                <text x={x + 3} y="46" fontSize="3" fontFamily="monospace" fill="#5eead4" className="iw-anim iw-hash-good">PATCHED</text>
              </>
            ) : (
              <text x={x + 3} y="46" fontSize="3" fontFamily="monospace" fill="rgba(94,234,212,0.7)">0x{(0x7a1c + i * 0x2f3).toString(16)}</text>
            )}
          </g>
        );
      })}

      {/* the hostile packet travelling the chain */}
      <g className="iw-anim iw-packet">
        <circle r="3.6" fill="rgba(255,93,74,0.25)" />
        <circle r="1.7" fill="#ff5d4a" />
      </g>

      {/* shield flash when the patch lands */}
      <circle cx="50" cy="35" r="14" fill="none" stroke="#5eead4" strokeWidth="0.8"
        className="iw-anim iw-shield" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />

      {/* status line */}
      <text x="8" y="62" fontSize="3.2" fontFamily="monospace" fill="#ff5d4a" className="iw-anim iw-status-bad">&gt; exploit detected…</text>
      <text x="8" y="62" fontSize="3.2" fontFamily="monospace" fill="#5eead4" className="iw-anim iw-status-good">&gt; patch applied. chain secure.</text>
    </svg>
  );
}

/** A tiny animated neural net for the Deep AI Lab card. */
function MiniNeuralNet() {
  const layers = [3, 4, 4, 2];
  const x = (l: number) => 14 + l * 24;
  const y = (l: number, i: number) => 35 + (i - (layers[l] - 1) / 2) * 13;
  return (
    <svg viewBox="0 0 100 70" className="w-full h-44" aria-hidden="true">
      {layers.slice(0, -1).map((n, l) =>
        Array.from({ length: n }).map((_, i) =>
          Array.from({ length: layers[l + 1] }).map((_, j) => (
            <line
              key={`${l}-${i}-${j}`}
              x1={x(l)} y1={y(l, i)} x2={x(l + 1)} y2={y(l + 1, j)}
              stroke={(i + j) % 2 ? 'rgba(34,211,238,0.55)' : 'rgba(244,114,182,0.45)'}
              strokeWidth="0.5"
              strokeDasharray="1.5 3"
              className="iw-anim"
              style={{ animation: `iw-drift ${6 + ((i + j) % 3)}s ease-in-out infinite` }}
            />
          )),
        ),
      )}
      {layers.map((n, l) =>
        Array.from({ length: n }).map((_, i) => (
          <circle key={`${l}-${i}`} cx={x(l)} cy={y(l, i)} r="2.6" fill={l % 2 ? '#8b5cf6' : '#22d3ee'} />
        )),
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Home                                                                      */
/* -------------------------------------------------------------------------- */

export default function Home({
  username,
  onOpenLab,
  onOpenAILab,
  onOpenTrace,
  onPlayMap,
  onJoinCode,
  onLogout,
  onOpenSettings,
  avatarSrc,
  engineStatus = 'connecting',
}: HomeProps) {
  const displayName = username || 'Explorer';
  const starfield = useRef<StarfieldHandle | null>(null);
  const arcadeRef = useRef<HTMLElement | null>(null);
  const [warping, setWarping] = useState(false);
  const [done] = useState(loadProgress);
  const [trace] = useState(loadTrace);
  const traceClosed = CASES.filter((c) => c.id in trace).length;
  const traceNext = CASES.find((c) => !(c.id in trace));
  const reduce = useReducedMotion();
  const [prefs] = usePrefs();
  const status = STATUS_STYLES[engineStatus];

  // Laptops get the slug basket in the left sidebar; phones get a slim row under the friends panel.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useDockedToggles(isDesktop); // on laptops the icons live in the sidebar; elsewhere they float bottom-left

  const xp = totalXp(done);
  const rank = rankFor(xp);
  const charted = MISSIONS.filter((m) => m.id in done).length;
  const nextUp = MISSIONS.find((m) => !(m.id in done));

  // Plays the hyperspace jump, then navigates.
  const enter = useCallback(
    async (go: () => Promise<void> | void) => {
      if (warping) return;
      if (!prefs.warp) {
        await go();
        return;
      }
      setWarping(true);
      sfx('whoosh');
      try {
        await starfield.current?.warp();
        await go();
      } finally {
        setWarping(false);
      }
    },
    [warping, prefs.warp],
  );

  const rise = (i: number): MotionProps =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: i * 0.08 } };

  const fade = `transition-all duration-700 ${warping ? 'opacity-0 scale-[1.03]' : 'opacity-100'}`;
  const navBtn = `w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors ${FOCUS}`;

  return (
    <div className={`iw-root relative h-screen h-[100dvh] flex overflow-hidden ${prefs.ambient ? '' : 'iw-calm'}`}>
      <Ambient scene="home" />
      {prefs.starfield && <Starfield ref={starfield} />}

      {/* Ambient nebula */}
      <div
        className="iw-anim absolute top-[-10%] left-[-10%] w-[520px] h-[520px] bg-[#2a1750]/30 rounded-full blur-[150px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 26s ease-in-out infinite' }}
      />
      <div
        className="iw-anim absolute bottom-[-12%] right-[-10%] w-[620px] h-[620px] bg-[#5a3b12]/20 rounded-full blur-[170px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 32s ease-in-out infinite reverse' }}
      />

      {/* Warp flash */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-700 ${warping ? 'opacity-20' : 'opacity-0'}`}
      />

      {/* Sidebar */}
      <nav
        aria-label="Main"
        className={`relative z-10 hidden md:flex w-64 shrink-0 bg-[#06050b]/80 backdrop-blur-xl border-r border-white/10 flex-col p-6 justify-between gap-4 overflow-y-auto ${fade}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-10">
            <Logo size={38} animated={prefs.ambient} />
            <h1 className="iw-display text-2xl font-medium tracking-wide text-[#e9b872]">Infinite World</h1>
          </div>

          <div className="space-y-1.5">
            <button
              aria-current="page"
              className={`${navBtn} bg-[#e9b872]/12 text-[#e9b872] border border-[#e9b872]/30`}
            >
              <HomeIcon size={18} /> Home
            </button>
            <button onClick={() => void enter(onOpenLab)} disabled={warping} className={`${navBtn} text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5`}>
              <ShieldAlert size={18} /> Chain Security Lab
            </button>
            <button onClick={() => void enter(onOpenAILab)} disabled={warping} className={`${navBtn} text-[#a49fb0] hover:text-cyan-300 hover:bg-cyan-400/5`}>
              <Brain size={18} /> Deep AI Lab
            </button>
            <button onClick={() => void enter(onOpenTrace)} disabled={warping} className={`${navBtn} text-[#a49fb0] hover:text-[#ff8a93] hover:bg-red-400/5`}>
              <Fingerprint size={18} /> Trace Lab
            </button>
            <button onClick={() => arcadeRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })} className={`${navBtn} text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5`}>
              <Gamepad2 size={18} /> Arcade
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {/* Fire / electricity / nature slugs: a small row just above the profile, never on top of it */}
          {isDesktop && <SlugToggles className="justify-center pb-1" />}
        <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-1">
          <button
            onClick={onOpenSettings}
            title="Profile & settings"
            aria-label="Open profile and settings"
            className={`flex items-center gap-3 min-w-0 flex-1 p-1.5 -m-1.5 rounded-2xl text-left hover:bg-white/5 transition-colors ${FOCUS}`}
          >
            <Avatar name={displayName} src={avatarSrc} size={40} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#eee9dc] capitalize truncate">{displayName}</div>
              <div className="text-xs text-[#a49fb0]">{rank.title}</div>
            </div>
          </button>
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            className={`p-2 text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 rounded-xl transition-colors ${FOCUS}`}
          >
            <SettingsIcon size={18} />
          </button>
          <button
            onClick={onLogout}
            title="Logout"
            aria-label="Log out"
            className={`p-2 text-[#a49fb0] hover:text-[#ff5d4a] hover:bg-white/5 rounded-xl transition-colors ${FOCUS}`}
          >
            <LogOut size={18} />
          </button>
        </div>
        </div>
      </nav>

      {/* Main */}
      <main className={`relative z-10 flex-1 min-w-0 overflow-y-auto ${fade}`}>
        <div className="mx-auto max-w-6xl px-4 sm:px-10 py-6 sm:py-8 space-y-8 sm:space-y-10">
          <div className="md:hidden flex items-center gap-2.5">
            <Logo size={30} animated={prefs.ambient} />
            <span className="iw-display text-xl text-[#e9b872]">Infinite World</span>
          </div>
          {/* Identity */}
          <motion.header {...rise(0)} className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-start gap-5">
              {avatarSrc ? (
                <Sigil size={80}>
                  <Avatar name={displayName} src={avatarSrc} size={58} />
                </Sigil>
              ) : (
                <Sigil />
              )}
              <div>
                <p className="text-xs text-[#a49fb0]">
                  {rank.title} · {charted} of {MISSIONS.length} missions charted
                </p>
                <h2 className="iw-display text-4xl sm:text-6xl font-light tracking-wide capitalize leading-tight break-all sm:break-normal">
                  {displayName}
                </h2>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="w-28 sm:w-44 h-1.5 rounded-full bg-white/10 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(rank.pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Progress to next rank"
                  >
                    <div className="h-full bg-gradient-to-r from-[#e9b872] to-[#9b8cff]" style={{ width: `${rank.pct}%` }} />
                  </div>
                  <span className="text-xs text-[#a49fb0] tabular-nums">
                    {xp} XP{rank.next ? ` · ${rank.next.at - xp} to ${rank.next.title}` : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div role="status" className="px-4 py-2 bg-black/50 border border-white/10 rounded-2xl text-xs flex items-center gap-2.5 backdrop-blur-md">
                <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${status.dot}`} />
                <div>
                  <div className="text-[11px] text-[#a49fb0]">Engine status</div>
                  <div className={`font-semibold ${status.text}`}>{status.label}</div>
                </div>
              </div>
              <button
                onClick={onOpenSettings}
                aria-label="Profile and settings"
                className={`md:hidden p-2.5 rounded-xl border border-white/10 text-[#a49fb0] hover:text-[#eee9dc] ${FOCUS}`}
              >
                <SettingsIcon size={18} />
              </button>
              <button
                onClick={onLogout}
                aria-label="Log out"
                className={`md:hidden p-2.5 rounded-xl border border-white/10 text-[#a49fb0] hover:text-[#ff5d4a] ${FOCUS}`}
              >
                <LogOut size={18} />
              </button>
            </div>
          </motion.header>

          <motion.p {...rise(0.5)} className="iw-display italic font-light text-xl leading-relaxed text-[#b9b3c4] max-w-4xl">
            “Time is not a currency to be spent, but an orbit—choose to revolve around what anchors your spirit, deepens your bonds, and expands your universe.”
          </motion.p>

          {/* Friends and online status, right under the quote */}
          <motion.div {...rise(1)}>
            <FriendsPanel />
          </motion.div>

          {/* Featured room: Chain Security Lab */}
          <motion.section {...rise(2)} aria-label="Chain Security Lab">
            <div className="relative overflow-hidden rounded-3xl border border-[#e9b872]/30 bg-[#0d0b16]/75 backdrop-blur-md p-6 sm:p-8 shadow-[0_0_60px_rgba(233,184,114,0.08)]">
              <svg viewBox="0 0 400 400" className="absolute -right-24 -top-24 w-[420px] h-[420px] opacity-60 pointer-events-none" aria-hidden="true">
                <g className="iw-spin-slow" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
                  <circle cx="200" cy="200" r="190" fill="none" stroke="rgba(233,184,114,0.25)" strokeDasharray="1 6" />
                  {Array.from({ length: 48 }, (_, i) => {
                    const a = (i / 48) * Math.PI * 2;
                    const r2 = i % 4 === 0 ? 198 : 194;
                    return (
                      <line key={i} x1={200 + Math.cos(a) * 190} y1={200 + Math.sin(a) * 190} x2={200 + Math.cos(a) * r2} y2={200 + Math.sin(a) * r2} stroke="rgba(233,184,114,0.4)" />
                    );
                  })}
                </g>
                <circle cx="200" cy="200" r="140" fill="none" stroke="rgba(238,233,220,0.07)" />
                <circle cx="200" cy="200" r="90" fill="none" stroke="rgba(238,233,220,0.06)" />
              </svg>

              <div className="relative grid lg:grid-cols-5 gap-6 items-center">
                <div className="lg:col-span-3">
                  <div className="flex flex-wrap gap-2 text-[11px] text-[#c9c4d2]">
                    <span className="px-2.5 py-1 rounded-full border border-[#e9b872]/40 text-[#e9b872]">Learn</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">Single player</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">3D replays</span>
                  </div>
                  <h3 className="iw-display text-4xl sm:text-5xl font-light mt-3">Chain Security Lab</h3>
                  <p className="text-sm text-[#c9c4d2] leading-relaxed mt-3 max-w-xl">
                    Replay the exploits behind Wormhole and Aurora in 3D, find the flaw in the code, and choose the patch that closes it.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <button
                      onClick={() => void enter(onOpenLab)}
                      disabled={warping}
                      className={`px-6 py-3 rounded-xl bg-[#e9b872] text-[#1a1208] font-bold text-sm hover:brightness-110 disabled:opacity-60 transition flex items-center gap-2 ${FOCUS}`}
                    >
                      {charted === MISSIONS.length ? 'Replay missions' : 'Enter the lab'} <ArrowUpRight size={16} />
                    </button>
                    <span className="text-xs text-[#a49fb0]">
                      {nextUp ? `Next up: ${nextUp.title}` : 'Every mission charted'}
                    </span>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <MiniChainHack />
                </div>
              </div>
            </div>
          </motion.section>

          {/* Featured room: Deep AI Lab */}
          <motion.section {...rise(3)} aria-label="Deep AI Lab">
            <div className="relative overflow-hidden rounded-3xl border border-cyan-400/30 bg-[#05060f]/80 backdrop-blur-md p-6 sm:p-8 shadow-[0_0_60px_rgba(34,211,238,0.12)]">
              <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-violet-500/25 blur-[90px] pointer-events-none" />
              <div className="absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-[90px] pointer-events-none" />
              <div className="relative grid lg:grid-cols-5 gap-6 items-center">
                <div className="lg:col-span-3">
                  <div className="flex flex-wrap gap-2 text-[11px] text-[#c9c4d2]">
                    <span className="px-2.5 py-1 rounded-full border border-cyan-400/40 text-cyan-300">Deep learning</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">Live models</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">Math + code</span>
                  </div>
                  <h3 className="iw-display text-4xl sm:text-5xl font-light mt-3 bg-gradient-to-r from-cyan-300 via-violet-400 to-pink-400 bg-clip-text text-transparent">
                    Deep AI Lab
                  </h3>
                  <p className="text-sm text-[#c9c4d2] leading-relaxed mt-3 max-w-xl">
                    Open the black box. Watch backpropagation train a real network, see the math behind it, and read the code.
                  </p>
                  <button
                    onClick={() => void enter(onOpenAILab)}
                    disabled={warping}
                    className={`mt-6 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-300 to-violet-400 text-[#04050d] font-bold text-sm hover:brightness-110 disabled:opacity-60 transition flex items-center gap-2 ${FOCUS}`}
                  >
                    Enter the lab <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="lg:col-span-2">
                  <MiniNeuralNet />
                </div>
              </div>
            </div>
          </motion.section>

          {/* Featured room: Trace Lab */}
          <motion.section {...rise(3.5)} aria-label="Trace Lab">
            <div className="relative overflow-hidden rounded-3xl border border-red-500/30 bg-[#070a0d]/85 backdrop-blur-md p-6 sm:p-8 shadow-[0_0_60px_rgba(255,59,74,0.10)]">
              <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-amber-400/10 blur-[90px] pointer-events-none" />
              <div className="relative grid lg:grid-cols-5 gap-6 items-center">
                <div className="lg:col-span-3">
                  <div className="flex flex-wrap gap-2 text-[11px] text-[#c9c4d2]">
                    <span className="px-2.5 py-1 rounded-full border border-red-400/40 text-red-300">Digital forensics</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">7 cases</span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">Voice &amp; cam</span>
                  </div>
                  <h3 className="mt-3 text-4xl sm:text-5xl font-light" style={{ fontFamily: "'Special Elite', 'Courier New', monospace" }}>Trace Lab</h3>
                  <p className="text-sm text-[#c9c4d2] leading-relaxed mt-3 max-w-xl">
                    The breach already happened. Work real evidence (disks, packets, RAM, logs, cloud audits, blockchains), prove every answer, and watch what the attacker really did.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <button
                      onClick={() => void enter(onOpenTrace)}
                      disabled={warping}
                      className={`px-6 py-3 rounded-xl bg-gradient-to-r from-amber-300 to-orange-400 text-[#1b1006] font-bold text-sm hover:brightness-110 disabled:opacity-60 transition flex items-center gap-2 ${FOCUS}`}
                    >
                      {traceClosed === CASES.length ? 'Replay cases' : traceClosed ? 'Continue investigating' : 'Open a case'} <ArrowUpRight size={16} />
                    </button>
                    <span className="text-xs text-[#a49fb0]">{traceNext ? `Next case: ${traceNext.title}` : 'Every case closed'}</span>
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <SectorGrid cols={24} rows={9} hidden={[30, 77, 119, 158]} running loop reduce={Boolean(reduce) || !prefs.ambient} className="w-full h-44" />
                </div>
              </div>
            </div>
          </motion.section>

          {/* Arcade: each portal enters its room directly */}
          <motion.section {...rise(4)} aria-label="Arcade" ref={arcadeRef} className="space-y-4 scroll-mt-8">
            <div>
              <div className="font-mono text-[11px] tracking-[0.25em] text-[#9b8cff]">// GAME SECTORS</div>
              <h3 className="iw-display text-3xl font-light mt-1">Arcade</h3>
              <p className="text-sm text-[#a49fb0] mt-1">Pick a sector and you are in. Finish the missions and see who played best.</p>
            </div>
            <RoomPortals onPlayMap={onPlayMap} onJoinCode={onJoinCode} disabled={warping} warp={enter} />
          </motion.section>
        </div>
      </main>

    </div>
  );
}