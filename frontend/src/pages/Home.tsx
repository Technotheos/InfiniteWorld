import { useCallback, useRef, useState } from 'react';
import { motion, useReducedMotion, type MotionProps } from 'framer-motion';
import {
  ArrowUpRight, Brain, Bug, Compass, Gamepad2, Home as HomeIcon, LogOut, MessageSquare,
  Network, Settings as SettingsIcon, ShieldAlert, TrendingUp, Zap, type LucideIcon,
} from 'lucide-react';
import '../styles/celestial.css';
import { Starfield, type StarfieldHandle } from '../components/Starfield';
import { Sigil } from '../components/Sigil';
import { Avatar } from '../components/Avatar';
import { usePrefs } from '../hooks/usePrefs';
import type { EngineStatus } from '../hooks/useEngineStatus';
import { MAP_ORDER, MISSIONS, NODE_POS, loadProgress, rankFor, totalXp } from '../game/chain-lab';

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface HomeProps {
  username?: string | null;
  /** Open the Chain Security Lab room. */
  onOpenLab: () => void;
  /** Open the Deep AI Lab room. */
  onOpenAILab: () => void;
  /** Open the game room picker (Quick Arena, Cipher Lab, Social Spark...). */
  onOpenPlay: () => void;
  /** Join a live chat room by id. */
  onSelectRoom: (roomId: string) => void;
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

// Room ids must match the server's ^[A-Za-z0-9_-]{1,64}$ rule.
// Each room has its own icon + accent colour so the list reads at a glance.
const chatRooms: { id: string; title: string; tag: string; desc: string; icon: LucideIcon; accent: string }[] = [
  {
    id: 'zeroday-websec',
    title: 'Zero-Day & WebSec',
    tag: 'Security',
    desc: 'Vulnerabilities, write-ups and patches. Talk about the lab here.',
    icon: Bug,
    accent: '#ff5d4a',
  },
  {
    id: 'ai-deep-dive',
    title: 'Deep AI',
    tag: 'Deep learning',
    desc: 'Algorithms, the math behind them, and papers. Talk about the AI lab here.',
    icon: Brain,
    accent: '#22d3ee',
  },
  {
    id: 'nasdaq-scalping',
    title: 'Nasdaq 1-Min Scalps',
    tag: 'Markets',
    desc: 'Tape reading and fast entries.',
    icon: TrendingUp,
    accent: '#e9b872',
  },
  {
    id: 'crypto-alpha',
    title: 'Crypto Alpha & Flows',
    tag: 'On-chain',
    desc: 'On-chain flows and setups.',
    icon: Zap,
    accent: '#9b8cff',
  },
  {
    id: 'distributed-systems',
    title: 'Distributed Systems',
    tag: 'Systems',
    desc: 'Consensus, queues and failure modes.',
    icon: Network,
    accent: '#5eead4',
  },
];

// Informational cards for the game rooms (the live list comes from the server in the picker).
const arcade = [
  {
    name: 'Quick Arena',
    mode: 'Versus',
    players: '1–8 players',
    desc: 'Reflex, Math Sprint and Type Storm, head to head.',
    accent: '#9b8cff',
  },
  {
    name: 'Cipher Lab',
    mode: 'Versus',
    players: '1–8 players',
    desc: 'Crack Caesar, Base64, Hex and Binary, and learn what each encoding really is.',
    accent: '#5eead4',
  },
  {
    name: 'Social Spark',
    mode: 'Co-op',
    players: '2–6 players',
    desc: 'Three conversation missions. The team wins only if everyone agrees each is done.',
    accent: '#e9b872',
  },
];

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                              */
/* -------------------------------------------------------------------------- */

/** A tiny preview of the lab's sector map: lit nodes are missions you have charted. */
function MiniConstellation({ done }: { done: Record<string, number> }) {
  return (
    <svg viewBox="0 0 100 70" className="w-full h-44" aria-hidden="true">
      <circle cx="50" cy="35" r="30" fill="none" stroke="rgba(238,233,220,0.08)" />
      <circle cx="50" cy="35" r="20" fill="none" stroke="rgba(238,233,220,0.06)" />
      {MAP_ORDER.slice(0, -1).map((id, i) => {
        const a = NODE_POS[id];
        const b = NODE_POS[MAP_ORDER[i + 1]];
        const lit = id in done;
        return (
          <line
            key={id}
            x1={a.x}
            y1={a.y * 0.7}
            x2={b.x}
            y2={b.y * 0.7}
            stroke={lit ? 'rgba(233,184,114,0.85)' : 'rgba(238,233,220,0.25)'}
            strokeDasharray={lit ? undefined : '1.5 2'}
            strokeWidth="0.6"
          />
        );
      })}
      {MAP_ORDER.map((id) => {
        const p = NODE_POS[id];
        const isMission = MISSIONS.some((m) => m.id === id);
        const lit = id in done;
        return (
          <g key={id}>
            {isMission && !lit && (
              <circle cx={p.x} cy={p.y * 0.7} r="4.5" fill="none" stroke="rgba(155,140,255,0.5)" className="iw-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
            )}
            <circle
              cx={p.x}
              cy={p.y * 0.7}
              r="2.6"
              fill={lit ? '#e9b872' : isMission ? '#9b8cff' : 'rgba(238,233,220,0.25)'}
            />
          </g>
        );
      })}
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
  onOpenPlay,
  onSelectRoom,
  onLogout,
  onOpenSettings,
  avatarSrc,
  engineStatus = 'connecting',
}: HomeProps) {
  const displayName = username || 'Explorer';
  const starfield = useRef<StarfieldHandle | null>(null);
  const chatRef = useRef<HTMLElement | null>(null);
  const [warping, setWarping] = useState(false);
  const [done] = useState(loadProgress);
  const reduce = useReducedMotion();
  const [prefs] = usePrefs();
  const status = STATUS_STYLES[engineStatus];

  const xp = totalXp(done);
  const rank = rankFor(xp);
  const charted = MISSIONS.filter((m) => m.id in done).length;
  const nextUp = MISSIONS.find((m) => !(m.id in done));

  // Plays the hyperspace jump, then navigates.
  const enter = useCallback(
    async (go: () => void) => {
      if (warping) return;
      if (!prefs.warp) {
        go();
        return;
      }
      setWarping(true);
      try {
        await starfield.current?.warp();
        go();
      } finally {
        setWarping(false);
      }
    },
    [warping, prefs.warp],
  );

  const surprise = () => {
    const room = chatRooms[Math.floor(Math.random() * chatRooms.length)];
    void enter(() => onSelectRoom(room.id));
  };

  const rise = (i: number): MotionProps =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: i * 0.08 } };

  const fade = `transition-all duration-700 ${warping ? 'opacity-0 scale-[1.03]' : 'opacity-100'}`;
  const navBtn = `w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors ${FOCUS}`;

  return (
    <div className={`iw-root relative min-h-screen flex overflow-hidden ${prefs.ambient ? '' : 'iw-calm'}`}>
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
        className={`relative z-10 hidden md:flex w-64 shrink-0 bg-[#06050b]/80 backdrop-blur-xl border-r border-white/10 flex-col p-6 justify-between ${fade}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-10">
            <span className="text-xl" aria-hidden="true">🫍</span>
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
            <button onClick={() => void enter(onOpenPlay)} disabled={warping} className={`${navBtn} text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5`}>
              <Gamepad2 size={18} /> Arcade
            </button>
            <button
              onClick={() => chatRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })}
              className={`${navBtn} text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5`}
            >
              <MessageSquare size={18} /> Chat rooms
            </button>
          </div>
        </div>

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
      </nav>

      {/* Main */}
      <main className={`relative z-10 flex-1 min-w-0 overflow-y-auto ${fade}`}>
        <div className="mx-auto max-w-6xl px-5 sm:px-10 py-8 space-y-10">
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
                <h2 className="iw-display text-5xl sm:text-6xl font-light tracking-wide capitalize leading-tight">
                  {displayName}
                </h2>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden"
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

          <motion.p {...rise(1)} className="iw-display italic font-light text-xl leading-relaxed text-[#b9b3c4] max-w-4xl">
            “Time is not a currency to be spent, but an orbit—choose to revolve around what anchors your spirit, deepens your bonds, and expands your universe.”
          </motion.p>

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
                  <MiniConstellation done={done} />
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

          {/* Arcade */}
          <motion.section {...rise(4)} aria-label="Arcade" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="iw-display text-3xl font-light">Arcade</h3>
                <p className="text-sm text-[#a49fb0] mt-1">Quick missions with other players. Finish them and see who played best.</p>
              </div>
              <button
                onClick={() => void enter(onOpenPlay)}
                disabled={warping}
                className={`px-4 py-2.5 rounded-xl border border-white/10 text-sm text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 flex items-center gap-2 transition ${FOCUS}`}
              >
                Choose a room <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {arcade.map((a) => (
                <motion.button
                  key={a.name}
                  onClick={() => void enter(onOpenPlay)}
                  disabled={warping}
                  whileHover={reduce ? undefined : { y: -3 }}
                  className={`text-left rounded-2xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md p-5 hover:border-white/25 transition-colors ${FOCUS}`}
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="px-2.5 py-1 rounded-full border" style={{ color: a.accent, borderColor: `${a.accent}66` }}>
                      {a.mode}
                    </span>
                    <span className="text-[#a49fb0]">{a.players}</span>
                  </div>
                  <div className="iw-display text-2xl mt-3">{a.name}</div>
                  <p className="text-xs text-[#a49fb0] leading-relaxed mt-1.5">{a.desc}</p>
                </motion.button>
              ))}
            </div>
          </motion.section>

          {/* Chat rooms */}
          <motion.section {...rise(5)} aria-label="Chat rooms" ref={chatRef} className="space-y-4 scroll-mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="iw-display text-3xl font-light">Chat rooms</h3>
                <p className="text-sm text-[#a49fb0] mt-1">Live conversation, one topic per room.</p>
              </div>
              <button
                onClick={surprise}
                disabled={warping}
                className={`px-4 py-2.5 rounded-xl border border-white/10 text-sm text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 flex items-center gap-2 transition ${FOCUS}`}
              >
                <Compass size={15} /> Surprise me
              </button>
            </div>
            <ul className="space-y-3">
              {chatRooms.map((r) => {
                const Icon = r.icon;
                return (
                  <li
                    key={r.id}
                    className="relative overflow-hidden flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md pl-6 pr-5 py-4 hover:border-white/25 transition-colors"
                  >
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: r.accent }} />
                    <div className="flex items-center gap-4 min-w-0">
                      <span
                        aria-hidden="true"
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border"
                        style={{ color: r.accent, borderColor: `${r.accent}55`, background: `${r.accent}14`, boxShadow: `0 0 26px ${r.accent}33` }}
                      >
                        <Icon size={22} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#eee9dc] truncate">{r.title}</span>
                          <span
                            className="hidden sm:inline shrink-0 rounded-full border px-2 py-0.5 text-[10px]"
                            style={{ color: r.accent, borderColor: `${r.accent}55` }}
                          >
                            {r.tag}
                          </span>
                        </div>
                        <div className="text-xs text-[#a49fb0] truncate">{r.desc}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => void enter(() => onSelectRoom(r.id))}
                      disabled={warping}
                      className={`shrink-0 px-5 py-2 rounded-xl text-[#0b0a10] font-bold text-sm hover:brightness-110 disabled:opacity-60 transition ${FOCUS}`}
                      style={{ background: r.accent }}
                    >
                      Join
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        </div>
      </main>
    </div>
  );
}