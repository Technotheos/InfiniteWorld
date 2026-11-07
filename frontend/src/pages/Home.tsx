import React, { useRef, useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  BarChart2,
  Settings,
  Sparkles,
  Compass,
  LogOut,
  ArrowUpRight,
} from 'lucide-react';
import { Starfield, type StarfieldHandle } from '../components/Starfield';

/* -------------------------------------------------------------------------- */
/*  Home                                                                      */
/* -------------------------------------------------------------------------- */

type EngineStatus = 'connected' | 'connecting' | 'offline';

interface HomeProps {
  username?: string | null;
  onSelectRoom: (roomId: string) => void;
  onLogout: () => void;
  /** Pass the real WebSocket/engine state so the badge never lies. */
  engineStatus?: EngineStatus;
}

const STATUS_STYLES: Record<EngineStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-400' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400', text: 'text-amber-300' },
  offline: { label: 'Offline', dot: 'bg-red-500', text: 'text-red-400' },
};

// Room ids must match the server's ^[A-Za-z0-9_-]{1,64}$ rule.
const rooms = [
  { id: 'nasdaq-scalping', title: '📈 Nasdaq 1-Min Scalps', desc: 'Live WebSocket connection ready.', users: 14 },
  { id: 'crypto-alpha', title: '⚡ Crypto Alpha & Flows', desc: 'Live WebSocket connection ready.', users: 28 },
  { id: 'zeroday-websec', title: '🛡️ Zero-Day & WebSec', desc: 'Live WebSocket connection ready.', users: 9 },
  { id: 'distributed-systems', title: '⚙️ Distributed Systems', desc: 'Live WebSocket connection ready.', users: 6 },
];

const activeFriends = [
  { name: 'Alex_V', status: 'In #nasdaq-scalping' },
  { name: 'Kawtar_N', status: 'Online' },
  { name: 'Satoshi99', status: 'In #crypto-alpha' },
];

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

// Moves the CSS vars that drive the cursor spotlight on a card (no re-render).
const trackSpotlight = (e: React.MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

const spotlightStyle: React.CSSProperties = {
  background:
    'radial-gradient(360px circle at var(--mx, 50%) var(--my, 50%), rgba(56,189,248,0.14), transparent 45%)',
};

export default function Home({
  username,
  onSelectRoom,
  onLogout,
  engineStatus = 'connected',
}: HomeProps) {
  const displayName = username || 'Explorer';
  const starfield = useRef<StarfieldHandle | null>(null);
  const [warping, setWarping] = useState(false);
  const status = STATUS_STYLES[engineStatus];

  const handleRandomAdventure = async () => {
    if (warping) return;
    const room = rooms[Math.floor(Math.random() * rooms.length)];
    setWarping(true);
    try {
      await starfield.current?.warp();
      onSelectRoom(room.id);
    } finally {
      setWarping(false);
    }
  };

  const fade = `transition-all duration-700 ${warping ? 'opacity-0 scale-[1.03]' : 'opacity-100'}`;

  return (
    <div className="relative min-h-screen bg-black text-slate-100 flex overflow-hidden">
      <style>{`
        @keyframes lb-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes lb-drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,30px); } }
        @media (prefers-reduced-motion: reduce) {
          .lb-anim { animation: none !important; }
        }
      `}</style>

      <Starfield ref={starfield} />

      {/* Ambient nebula glows (slow drift) */}
      <div
        className="lb-anim absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-950/20 rounded-full blur-[140px] pointer-events-none z-0"
        style={{ animation: 'lb-drift 24s ease-in-out infinite' }}
      />
      <div
        className="lb-anim absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-sky-950/15 rounded-full blur-[160px] pointer-events-none z-0"
        style={{ animation: 'lb-drift 30s ease-in-out infinite reverse' }}
      />

      {/* Warp flash */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-700 ${
          warping ? 'opacity-20' : 'opacity-0'
        }`}
      />

      {/* 1. Sidebar */}
      <nav
        aria-label="Main"
        className={`relative z-10 w-64 bg-black/80 backdrop-blur-xl border-r border-white/10 flex flex-col p-6 justify-between ${fade}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-10">
            <span className="text-xl" aria-hidden="true">🀋</span>
            <h1 className="text-lg font-bold tracking-wider text-sky-400">Infinite World</h1>
          </div>

          <div className="space-y-2">
            <button
              aria-current="page"
              className={`w-full flex items-center gap-3 px-4 py-3 bg-sky-500 text-white rounded-2xl font-medium text-sm shadow-lg shadow-sky-500/20 transition-all border border-sky-400/30 ${FOCUS}`}
            >
              <LayoutDashboard size={18} /> Dashboard
            </button>
            {[
              { icon: <MessageSquare size={18} />, label: 'Chat Rooms' },
              { icon: <BarChart2 size={18} />, label: 'Analytics & Backtests' },
              { icon: <Settings size={18} />, label: 'Settings' },
            ].map((item) => (
              <button
                key={item.label}
                className={`w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-white/5 rounded-2xl font-medium text-sm transition-all ${FOCUS}`}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center font-bold text-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.2)]">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-200 capitalize">{displayName}</div>
              <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Online
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Logout"
            aria-label="Log out"
            className={`p-2 text-slate-400 hover:text-red-400 hover:bg-white/5 rounded-xl transition-colors ${FOCUS}`}
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* 2. Main */}
      <main className={`relative z-10 flex-1 flex flex-col overflow-y-auto ${fade}`}>
        <header className="px-10 py-8 border-b border-white/10 flex justify-between items-start bg-black/40 backdrop-blur-md">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Welcome back, {displayName}! <span aria-hidden="true">👋</span>
            </h2>
            <p className="text-sm text-slate-400 mt-2 italic font-light leading-relaxed">
              “Time is not a currency to be spent, but an orbit—choose to revolve around what anchors your spirit, deepens your bonds, and expands your universe.”
            </p>
          </div>

          <div
            role="status"
            className="px-4 py-2 bg-black/60 border border-white/10 rounded-2xl text-xs text-slate-300 flex items-center gap-2.5 shadow-[0_0_15px_rgba(0,0,0,0.8)] backdrop-blur-md"
          >
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${status.dot}`} />
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Engine Status:</div>
              <div className={`font-semibold ${status.text}`}>{status.label}</div>
            </div>
          </div>
        </header>

        <div className="p-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Rooms */}
          <section className="lg:col-span-2 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-sky-400 flex items-center gap-2">
              <span aria-hidden="true">🚀</span> Active Real-Time Rooms
            </h3>
            <div className="space-y-4">
              {rooms.map((room, i) => (
                <div
                  key={room.id}
                  onMouseMove={trackSpotlight}
                  className="lb-anim relative overflow-hidden p-5 bg-black/60 hover:bg-black/80 border border-white/10 hover:border-sky-500/50 rounded-2xl flex justify-between items-center shadow-[0_4px_20px_rgba(0,0,0,0.5)] hover:shadow-[0_0_25px_rgba(56,189,248,0.15)] transition-all duration-300 backdrop-blur-md group"
                  style={{ animation: 'lb-rise .6s ease both', animationDelay: `${i * 90}ms` }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    style={spotlightStyle}
                  />
                  <div className="relative">
                    <h4 className="text-sky-300 font-semibold text-base group-hover:text-sky-200 transition-colors flex items-center gap-2">
                      {room.title}
                      <ArrowUpRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity text-sky-400" />
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">{room.desc}</p>
                  </div>
                  <div className="relative flex items-center gap-4">
                    <span className="text-xs px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-slate-300 font-medium">
                      <span aria-hidden="true">👥</span> {room.users} online
                    </span>
                    <button
                      onClick={() => onSelectRoom(room.id)}
                      className={`px-5 py-2 bg-sky-500 hover:bg-sky-400 text-white font-medium text-sm rounded-xl shadow-lg shadow-sky-500/20 transition-all border border-sky-400/30 ${FOCUS}`}
                    >
                      Join Room
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Side column */}
          <aside className="space-y-6">
            <div className="p-5 bg-black/60 border border-white/10 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-sky-400 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Active Friends
              </h3>
              <div className="space-y-3.5">
                {activeFriends.map((friend) => (
                  <div key={friend.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="font-medium text-slate-200">{friend.name}</span>
                    </div>
                    <span className="text-xs text-slate-400">{friend.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div
              onMouseMove={trackSpotlight}
              className="p-5 bg-black/60 border border-white/10 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md relative overflow-hidden group"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={spotlightStyle}
              />
              <div className="absolute -right-8 -bottom-8 w-28 h-28 bg-sky-500/10 rounded-full blur-xl group-hover:bg-sky-500/20 transition-all" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-sky-400 mb-2 flex items-center gap-2 relative z-10">
                <Compass size={15} /> Random Adventure
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-4 relative z-10">
                Not sure what you want to do? Our protocol will warp you into a suitable room.
              </p>
              <button
                onClick={handleRandomAdventure}
                disabled={warping}
                className={`w-full py-2.5 bg-white/5 hover:bg-sky-500 disabled:opacity-60 text-slate-200 hover:text-white font-medium text-xs rounded-xl border border-white/10 hover:border-sky-400 transition-all shadow-sm flex items-center justify-center gap-2 relative z-10 ${FOCUS}`}
              >
                <Sparkles size={14} /> {warping ? 'Warping…' : 'Launch Random Sector'}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}