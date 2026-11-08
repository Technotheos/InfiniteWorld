import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  BarChart2,
  Settings,
  Sparkles,
  Compass,
  LogOut,
  ArrowUpRight,
  Send,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Starfield, type StarfieldHandle } from '../components/Starfield';

/* -------------------------------------------------------------------------- */
/*  Types & data                                                              */
/* -------------------------------------------------------------------------- */

type EngineStatus = 'connected' | 'connecting' | 'offline';
type RoomKind = 'trade' | 'security' | 'map' | 'chat';

interface HomeProps {
  username?: string | null;
  onSelectRoom: (roomId: string) => void;
  onLogout: () => void;
  /** Pass the real WebSocket/engine state so the badge never lies. */
  engineStatus?: EngineStatus;
}

interface Room {
  id: string;
  title: string;
  icon: string;
  kind: RoomKind;
  desc: string;
  users: number;
  /** CSS gradient that colours the planet. */
  glow: string;
  /** Orbit radius as % of the stage, orbit period in seconds, start phase in seconds. */
  orbit: { r: number; period: number; phase: number };
  /** Starting price for trade rooms. */
  symbol?: { name: string; price: number; lot: number };
}

const STATUS_STYLES: Record<EngineStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-emerald-500', text: 'text-emerald-400' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-400', text: 'text-amber-300' },
  offline: { label: 'Offline', dot: 'bg-red-500', text: 'text-red-400' },
};

// Room ids must match the server's ^[A-Za-z0-9_-]{1,64}$ rule.
// NOTE: 'chain-sentinel' and 'world-atlas' are new; the server must accept them.
const rooms: Room[] = [
  {
    id: 'nasdaq-scalping', title: 'Nasdaq 1-Min Scalps', icon: '📈', kind: 'trade',
    desc: 'Tape reading and fast entries.', users: 14,
    glow: 'radial-gradient(circle at 30% 30%, #bae6fd, #0ea5e9 55%, #0c4a6e)',
    orbit: { r: 34, period: 26, phase: 0 },
    symbol: { name: 'NQ', price: 21480, lot: 1 },
  },
  {
    id: 'crypto-alpha', title: 'Crypto Alpha & Flows', icon: '⚡', kind: 'trade',
    desc: 'On-chain flows and setups.', users: 28,
    glow: 'radial-gradient(circle at 30% 30%, #fde68a, #f59e0b 55%, #78350f)',
    orbit: { r: 46, period: 34, phase: 11 },
    symbol: { name: 'BTC', price: 96250, lot: 0.1 },
  },
  {
    id: 'zeroday-websec', title: 'Zero-Day & WebSec', icon: '🛡️', kind: 'security',
    desc: 'Vulnerabilities, writeups, patches.', users: 9,
    glow: 'radial-gradient(circle at 30% 30%, #fecaca, #ef4444 55%, #7f1d1d)',
    orbit: { r: 58, period: 42, phase: 23 },
  },
  {
    id: 'distributed-systems', title: 'Distributed Systems', icon: '⚙️', kind: 'chat',
    desc: 'Consensus, queues, and failure modes.', users: 6,
    glow: 'radial-gradient(circle at 30% 30%, #ddd6fe, #8b5cf6 55%, #4c1d95)',
    orbit: { r: 70, period: 50, phase: 5 },
  },
  {
    id: 'chain-sentinel', title: 'Chain Sentinel', icon: '⛓️', kind: 'security',
    desc: 'Watch blocks and flag risky contracts.', users: 11,
    glow: 'radial-gradient(circle at 30% 30%, #a7f3d0, #10b981 55%, #064e3b)',
    orbit: { r: 82, period: 58, phase: 31 },
  },
  {
    id: 'world-atlas', title: 'World Atlas', icon: '🌍', kind: 'map',
    desc: 'See where the community is tonight.', users: 19,
    glow: 'radial-gradient(circle at 30% 30%, #fbcfe8, #ec4899 55%, #831843)',
    orbit: { r: 94, period: 66, phase: 17 },
  },
];

const KIND_LABEL: Record<RoomKind, string> = {
  trade: 'Trading desk',
  security: 'Security monitor',
  map: 'Community map',
  chat: 'Live chat',
};

const activeFriends = [
  { name: 'Alex_V', status: 'In #nasdaq-scalping' },
  { name: 'Kawtar_N', status: 'Online' },
  { name: 'Satoshi99', status: 'In #crypto-alpha' },
];

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

const TILT = 60; // degrees the orrery plane is tipped away from the viewer

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

const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/* -------------------------------------------------------------------------- */
/*  Orrery: the rooms as planets on tilted, rotating orbits (CSS 3D)          */
/* -------------------------------------------------------------------------- */

function Orrery({
  selectedId,
  hoverId,
  onHover,
  onSelect,
  displayName,
}: {
  selectedId: string;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  displayName: string;
}) {
  const tiltRef = useRef<HTMLDivElement | null>(null);

  // Camera leans toward the cursor. Writes CSS vars directly, so there is no re-render.
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-ny * 14).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(nx * 18).toFixed(2)}deg`);
  };
  const onLeave = () => {
    tiltRef.current?.style.setProperty('--rx', '0deg');
    tiltRef.current?.style.setProperty('--ry', '0deg');
    onHover(null);
  };

  const paused = hoverId !== null;

  return (
    <div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`relative w-full aspect-[16/10] select-none ${paused ? 'lb-paused' : ''}`}
      style={{ perspective: '1100px' }}
    >
      <div
        ref={tiltRef}
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
          transition: 'transform .25s ease-out',
        }}
      >
        {/* The tipped orbital plane */}
        <div
          className="absolute left-0 right-0 top-1/2 aspect-square"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateY(-50%) rotateX(${TILT}deg)`,
          }}
        >
          {/* Orbits + planets */}
          {rooms.map((room) => {
            const { r, period, phase } = room.orbit;
            const active = room.id === selectedId;
            return (
              <div
                key={room.id}
                className={`lb-anim absolute rounded-full border border-dashed ${
                  active ? 'border-sky-400/50' : 'border-white/10'
                }`}
                style={{
                  width: `${r}%`,
                  aspectRatio: '1',
                  left: `${50 - r / 2}%`,
                  top: `${50 - r / 2}%`,
                  transformStyle: 'preserve-3d',
                  animation: `lb-orbit ${period}s linear infinite`,
                  animationDelay: `-${phase}s`,
                }}
              >
                <div
                  className="lb-anim lb-orb absolute"
                  style={{
                    top: 0,
                    left: '50%',
                    width: 56,
                    height: 56,
                    margin: '-28px 0 0 -28px',
                    animation: `lb-face ${period}s linear infinite`,
                    animationDelay: `-${phase}s`,
                  }}
                >
                  <button
                    onClick={() => onSelect(room.id)}
                    onMouseEnter={() => onHover(room.id)}
                    onFocus={() => onHover(room.id)}
                    onBlur={() => onHover(null)}
                    aria-label={`${room.title}, ${room.users} online`}
                    aria-pressed={active}
                    className={`w-full h-full rounded-full flex items-center justify-center text-xl transition-transform duration-200 hover:scale-125 ${FOCUS}`}
                    style={{
                      background: room.glow,
                      boxShadow: active
                        ? '0 0 0 2px rgba(125,211,252,.9), 0 0 36px rgba(56,189,248,.7)'
                        : '0 0 22px rgba(125,211,252,.25), inset -6px -8px 14px rgba(0,0,0,.45)',
                    }}
                  >
                    <span aria-hidden="true">{room.icon}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Core: turned back toward the viewer so it reads as a sphere */}
          <div
            className="absolute left-1/2 top-1/2 flex items-center justify-center"
            style={{ transform: `translate(-50%, -50%) rotateX(-${TILT}deg)` }}
          >
            <div
              className="lb-anim w-28 h-28 rounded-full flex flex-col items-center justify-center text-center"
              style={{
                background:
                  'radial-gradient(circle at 35% 30%, #e0f2fe, #38bdf8 35%, #312e81 80%, #020617)',
                boxShadow: '0 0 60px rgba(56,189,248,.55), 0 0 140px rgba(99,102,241,.35)',
                animation: 'lb-breathe 6s ease-in-out infinite',
              }}
            >
              <span className="text-[10px] text-sky-950/80 font-semibold leading-tight">Welcome</span>
              <span className="text-sm font-bold text-white drop-shadow capitalize max-w-[88px] truncate">
                {displayName}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Room instruments (all simulated; swap the data source for your engine)    */
/* -------------------------------------------------------------------------- */

function TradingPanel({ symbol }: { symbol: NonNullable<Room['symbol']> }) {
  const START_CASH = 100000;
  const [series, setSeries] = useState<number[]>(() => {
    const out = [symbol.price];
    for (let i = 0; i < 59; i++) out.push(out[i] * (1 + (Math.random() - 0.5) * 0.002));
    return out;
  });
  const [cash, setCash] = useState(START_CASH);
  const [qty, setQty] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setSeries((s) => {
        const last = s[s.length - 1];
        return [...s.slice(-59), last * (1 + (Math.random() - 0.5) * 0.002)];
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const price = series[series.length - 1];
  const change = ((price - series[0]) / series[0]) * 100;
  const up = change >= 0;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * 300},${96 - ((v - lo) / (hi - lo || 1)) * 88}`)
    .join(' ');
  const equity = cash + qty * price;
  const pnl = equity - START_CASH;

  const buy = () => {
    const cost = price * symbol.lot;
    if (cost > cash) return;
    setCash((c) => c - cost);
    setQty((q) => +(q + symbol.lot).toFixed(4));
  };
  const sell = () => {
    if (qty < symbol.lot) return;
    setCash((c) => c + price * symbol.lot);
    setQty((q) => +(q - symbol.lot).toFixed(4));
  };

  const color = up ? '#34d399' : '#f87171';

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-slate-400">{symbol.name} · simulated</div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className={`flex items-center gap-1 text-sm font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
          {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          {change.toFixed(2)}%
        </div>
      </div>

      <svg viewBox="0 0 300 100" className="w-full h-28 mt-3" role="img" aria-label={`${symbol.name} simulated price`}>
        <defs>
          <linearGradient id={`fill-${symbol.name}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${pts} 300,100`} fill={`url(#fill-${symbol.name})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={buy}
          className={`py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-300 text-sm font-medium transition-colors ${FOCUS}`}
        >
          Buy {symbol.lot}
        </button>
        <button
          onClick={sell}
          disabled={qty < symbol.lot}
          className={`py-2 rounded-xl bg-red-500/15 hover:bg-red-500/30 disabled:opacity-40 border border-red-400/30 text-red-300 text-sm font-medium transition-colors ${FOCUS}`}
        >
          Sell {symbol.lot}
        </button>
      </div>
      <div className="mt-3 text-xs text-slate-400 flex justify-between">
        <span>Paper position: {qty}</span>
        <span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          P&amp;L {pnl >= 0 ? '+' : ''}
          {pnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

interface Block {
  height: number;
  hash: string;
  prev: string;
  txs: number;
  flag?: string;
}

const FLAGS = [
  'Reentrancy pattern in contract call',
  'Abnormal gas spike',
  'Unrecognised signer set',
  'Dust-transfer cluster',
];

function makeBlock(height: number, prev: string): Block {
  return {
    height,
    hash: hex(8),
    prev,
    txs: 80 + Math.floor(Math.random() * 240),
    flag: Math.random() < 0.22 ? FLAGS[Math.floor(Math.random() * FLAGS.length)] : undefined,
  };
}

function SecurityPanel() {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const out: Block[] = [];
    let prev = hex(8);
    for (let i = 0; i < 4; i++) {
      const b = makeBlock(18_450_100 + i, prev);
      out.unshift(b);
      prev = b.hash;
    }
    return out;
  });
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setBlocks((bs) => [makeBlock(bs[0].height + 1, bs[0].hash), ...bs].slice(0, 12));
    }, 2500);
    return () => clearInterval(t);
  }, []);

  const flagged = blocks.filter((b) => b.flag).length;
  const shown = (onlyFlagged ? blocks.filter((b) => b.flag) : blocks).slice(0, 6);

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Simulated chain feed</span>
        <button
          onClick={() => setOnlyFlagged((v) => !v)}
          aria-pressed={onlyFlagged}
          className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${FOCUS} ${
            onlyFlagged ? 'bg-red-500/20 border-red-400/40 text-red-300' : 'border-white/10 hover:bg-white/5'
          }`}
        >
          Flagged only ({flagged})
        </button>
      </div>
      <ul className="mt-3 space-y-2" aria-live="polite">
        {shown.length === 0 && <li className="text-xs text-slate-500">No flagged blocks yet. Watching…</li>}
        {shown.map((b) => (
          <li
            key={b.hash}
            className={`rounded-xl border px-3 py-2 text-xs ${
              b.flag ? 'border-red-400/30 bg-red-500/10' : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 tabular-nums">#{b.height.toLocaleString()}</span>
              <span className={`flex items-center gap-1 ${b.flag ? 'text-red-300' : 'text-emerald-400'}`}>
                {b.flag ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
                {b.flag ? 'Flagged' : 'Verified'}
              </span>
            </div>
            <div className="mt-1 text-slate-400 font-mono">
              0x{b.hash} ← 0x{b.prev} · {b.txs} txs
            </div>
            {b.flag && <div className="mt-1 text-red-300">{b.flag}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const PINS = [
  { name: 'Tokyo', lat: 35.7, lon: 139.7 },
  { name: 'New York', lat: 40.7, lon: -74 },
  { name: 'London', lat: 51.5, lon: -0.1 },
  { name: 'Lagos', lat: 6.5, lon: 3.4 },
  { name: 'São Paulo', lat: -23.5, lon: -46.6 },
  { name: 'Sydney', lat: -33.9, lon: 151.2 },
];

function GlobePanel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ lon: 10, lat: 22, dragging: false, x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rad = Math.PI / 180;
    let raf = 0;

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const v = view.current;
      if (!v.dragging && !reduce) v.lon += 0.12;
      const R = Math.min(w, h) * 0.42;
      const cx = w / 2;
      const cy = h / 2;
      const l0 = v.lon * rad;
      const p0 = v.lat * rad;

      // lat/lon -> screen. `vis` is false on the far side of the sphere.
      const project = (lat: number, lon: number) => {
        const p = lat * rad;
        const dl = lon * rad - l0;
        const vis = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl) > 0;
        return {
          x: cx + R * Math.cos(p) * Math.sin(dl),
          y: cy - R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)),
          vis,
        };
      };

      // Sphere body
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      g.addColorStop(0, 'rgba(56,189,248,0.18)');
      g.addColorStop(1, 'rgba(15,23,42,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(125,211,252,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Graticule
      ctx.strokeStyle = 'rgba(125,211,252,0.16)';
      const line = (pts: { lat: number; lon: number }[]) => {
        ctx.beginPath();
        let pen = false;
        for (const q of pts) {
          const s = project(q.lat, q.lon);
          if (s.vis) {
            if (pen) ctx.lineTo(s.x, s.y);
            else ctx.moveTo(s.x, s.y);
            pen = true;
          } else pen = false;
        }
        ctx.stroke();
      };
      for (let lon = -180; lon < 180; lon += 30) {
        const pts = [];
        for (let lat = -90; lat <= 90; lat += 4) pts.push({ lat, lon });
        line(pts);
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 4) pts.push({ lat, lon });
        line(pts);
      }

      // Pins
      ctx.font = '11px system-ui, sans-serif';
      PINS.forEach((pin, i) => {
        const s = project(pin.lat, pin.lon);
        if (!s.vis) return;
        const pulse = reduce ? 0 : (Math.sin(t / 500 + i) + 1) / 2;
        ctx.fillStyle = `rgba(56,189,248,${0.25 * (1 - pulse)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5 + pulse * 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(226,232,240,0.9)';
        ctx.fillText(pin.name, s.x + 8, s.y + 4);
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    Object.assign(view.current, { dragging: true, x: e.clientX, y: e.clientY });
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = view.current;
    if (!v.dragging) return;
    v.lon -= (e.clientX - v.x) * 0.4;
    v.lat = Math.max(-80, Math.min(80, v.lat + (e.clientY - v.y) * 0.3));
    v.x = e.clientX;
    v.y = e.clientY;
  };
  const up = () => {
    view.current.dragging = false;
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label="Interactive globe showing community locations. Drag to rotate."
        className="w-full h-60 cursor-grab active:cursor-grabbing touch-none"
      />
      <p className="text-xs text-slate-400 mt-2">Drag to rotate. Pins are sample locations.</p>
    </div>
  );
}

interface Msg {
  id: number;
  from: string;
  text: string;
}

const BOT_REPLIES = [
  'Good point. What happens to that when a node drops mid-write?',
  'I would add a retry with jitter before anything else.',
  'Same here. Logging the failure path first saved me hours.',
  'Worth a test with the network partitioned. Want to pair on it?',
];

function ChatPanel({ displayName }: { displayName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 1, from: 'Nova', text: 'Welcome in. Say hi to try the chat.' },
  ]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);
  const nextId = useRef(2);
  const replyIdx = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMsgs((m) => [...m, { id: nextId.current++, from: displayName, text }]);
    setDraft('');
    const t = window.setTimeout(() => {
      const reply = BOT_REPLIES[replyIdx.current++ % BOT_REPLIES.length];
      setMsgs((m) => [...m, { id: nextId.current++, from: 'Nova', text: reply }]);
    }, 900);
    timers.current.push(t);
  };

  return (
    <div>
      <div ref={listRef} className="h-52 overflow-y-auto space-y-2 pr-1" aria-live="polite">
        {msgs.map((m) => {
          const mine = m.from === displayName;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                  mine ? 'bg-sky-500/80 text-white' : 'bg-white/[0.06] border border-white/10 text-slate-200'
                }`}
              >
                {!mine && <div className="text-[10px] text-sky-300 mb-0.5">{m.from}</div>}
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          maxLength={500}
          aria-label="Message"
          placeholder="Write a message"
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/50 border border-white/10 focus:border-sky-400/60 text-sm text-slate-100 placeholder:text-slate-500 outline-none"
        />
        <button
          onClick={send}
          aria-label="Send message"
          className={`px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white transition-colors ${FOCUS}`}
        >
          <Send size={16} />
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-2">Local preview. Join the room to talk live.</p>
    </div>
  );
}

function RoomInstrument({ room, displayName }: { room: Room; displayName: string }) {
  switch (room.kind) {
    case 'trade':
      return <TradingPanel symbol={room.symbol!} />;
    case 'security':
      return <SecurityPanel />;
    case 'map':
      return <GlobePanel />;
    case 'chat':
      return <ChatPanel displayName={displayName} />;
  }
}

/* -------------------------------------------------------------------------- */
/*  Home                                                                      */
/* -------------------------------------------------------------------------- */

export default function Home({
  username,
  onSelectRoom,
  onLogout,
  engineStatus = 'connected',
}: HomeProps) {
  const displayName = username || 'Explorer';
  const starfield = useRef<StarfieldHandle | null>(null);
  const [warping, setWarping] = useState(false);
  const [selectedId, setSelectedId] = useState(rooms[0].id);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const status = STATUS_STYLES[engineStatus];

  const selected = rooms.find((r) => r.id === selectedId) ?? rooms[0];
  const caption = rooms.find((r) => r.id === (hoverId ?? selectedId)) ?? selected;

  const enterRoom = useCallback(
    async (roomId: string) => {
      if (warping) return;
      setWarping(true);
      try {
        await starfield.current?.warp();
        onSelectRoom(roomId);
      } finally {
        setWarping(false);
      }
    },
    [warping, onSelectRoom],
  );

  const handleRandomAdventure = () => {
    const room = rooms[Math.floor(Math.random() * rooms.length)];
    void enterRoom(room.id);
  };

  const fade = `transition-all duration-700 ${warping ? 'opacity-0 scale-[1.03]' : 'opacity-100'}`;

  return (
    <div className="relative min-h-screen bg-black text-slate-100 flex overflow-hidden">
      <style>{`
        @keyframes lb-drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,30px); } }
        @keyframes lb-orbit { to { transform: rotateZ(360deg); } }
        @keyframes lb-face {
          from { transform: rotateZ(0deg) rotateX(-${TILT}deg); }
          to   { transform: rotateZ(-360deg) rotateX(-${TILT}deg); }
        }
        @keyframes lb-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        .lb-orb { transform: rotateX(-${TILT}deg); }
        .lb-paused .lb-anim { animation-play-state: paused !important; }
        @media (prefers-reduced-motion: reduce) {
          .lb-anim { animation: none !important; }
          .lb-orb { transform: rotateX(-${TILT}deg) !important; }
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
        className={`relative z-10 hidden md:flex w-64 shrink-0 bg-black/80 backdrop-blur-xl border-r border-white/10 flex-col p-6 justify-between ${fade}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-10">
            <span className="text-xl" aria-hidden="true">🫍</span>
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
      <main className={`relative z-10 flex-1 min-w-0 flex flex-col overflow-y-auto ${fade}`}>
        <header className="px-5 sm:px-10 py-8 border-b border-white/10 flex flex-wrap gap-4 justify-between items-start bg-black/40 backdrop-blur-md">
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

        <div className="p-5 sm:p-10 grid grid-cols-1 xl:grid-cols-5 gap-8">
          {/* Orrery */}
          <section className="xl:col-span-3 space-y-4" aria-label="Rooms">
            <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2">
              <span aria-hidden="true">🚀</span> Active Real-Time Rooms
            </h3>

            <div className="rounded-3xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden">
              <Orrery
                selectedId={selectedId}
                hoverId={hoverId}
                onHover={setHoverId}
                onSelect={setSelectedId}
                displayName={displayName}
              />
              <div className="px-5 pb-5 text-center" aria-live="polite">
                <div className="text-sky-200 font-semibold">
                  <span aria-hidden="true">{caption.icon}</span> {caption.title}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {caption.desc} <span aria-hidden="true">👥</span> {caption.users} online
                </div>
              </div>
            </div>

            {/* Keyboard- and touch-friendly list of the same rooms */}
            <div className="flex flex-wrap gap-2">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedId(room.id)}
                  aria-pressed={room.id === selectedId}
                  className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors ${FOCUS} ${
                    room.id === selectedId
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                      : 'bg-black/50 border-white/10 text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <span aria-hidden="true">{room.icon}</span> {room.title}
                </button>
              ))}
            </div>
          </section>

          {/* Side column */}
          <aside className="xl:col-span-2 space-y-6">
            <div
              onMouseMove={trackSpotlight}
              className="relative overflow-hidden group p-5 bg-black/60 border border-white/10 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={spotlightStyle}
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sky-300 font-semibold text-base">
                      <span aria-hidden="true">{selected.icon}</span> {selected.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">{KIND_LABEL[selected.kind]}</p>
                  </div>
                  <button
                    onClick={() => void enterRoom(selected.id)}
                    disabled={warping}
                    className={`shrink-0 px-4 py-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-medium text-sm rounded-xl shadow-lg shadow-sky-500/20 transition-all border border-sky-400/30 flex items-center gap-1.5 ${FOCUS}`}
                  >
                    Join Room <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="mt-5">
                  <RoomInstrument key={selected.id} room={selected} displayName={displayName} />
                </div>
              </div>
            </div>

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