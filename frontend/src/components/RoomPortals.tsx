import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, KeyRound, Loader2, Lock } from 'lucide-react';
import '../styles/portals.css';
import { useSocialOptional } from '../social/socialCore';

/* -------------------------------------------------------------------------- */
/*  The five game rooms as sci-fi "portals". Each card enters its room        */
/*  directly: no second list to pick from.                                    */
/* -------------------------------------------------------------------------- */

export interface Portal {
  /** Server map id (backend-go/maps/<id>.json). */
  id: string;
  code: string; // e.g. "SECTOR 01"
  name: string;
  mode: string;
  players: string;
  slots: number; // dots shown on the card
  desc: string;
  accent: string;
  accent2: string;
  Emblem: () => ReactNode;
}

const RING = (r: number, w = 0.6, o = 0.5) => (
  <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth={w} opacity={o} />
);

/** Reflex orbit: concentric rings, a locking reticle and a streaking comet. */
const ArenaEmblem = () => (
  <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
    {RING(44, 0.4, 0.35)}
    {RING(32, 0.6, 0.5)}
    {RING(18, 0.8, 0.7)}
    <g className="pt-spin" style={{ transformOrigin: '50px 50px' }}>
      <circle cx="50" cy="6" r="2.6" fill="currentColor" />
      <path d="M50 6 L45 -2" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </g>
    <g stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <path d="M50 28v8M50 64v8M28 50h8M64 50h8" />
    </g>
    <circle cx="50" cy="50" r="3" fill="currentColor" className="pt-pulse" />
  </svg>
);

/** Cipher: a hex lattice with a lit binary core. */
const CipherEmblem = () => (
  <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
    <polygon points="50,8 86,29 86,71 50,92 14,71 14,29" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
    <polygon points="50,22 74,36 74,64 50,78 26,64 26,36" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.4" className="pt-spin-r" style={{ transformOrigin: '50px 50px' }} />
    <g fontFamily="ui-monospace,Menlo,monospace" fontSize="9" fill="currentColor" textAnchor="middle">
      <text x="50" y="46" className="pt-flicker">0110</text>
      <text x="50" y="58" opacity="0.7" className="pt-flicker2">1011</text>
    </g>
    <path d="M14 29L50 50 86 29M50 50V92" stroke="currentColor" strokeWidth="0.4" opacity="0.35" />
  </svg>
);

/** Social Spark: a small constellation of linked stars. */
const SparkEmblem = () => {
  const n = [
    [50, 20], [78, 38], [68, 72], [32, 72], [22, 38],
  ];
  return (
    <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
      {RING(40, 0.4, 0.3)}
      <g stroke="currentColor" strokeWidth="0.7" opacity="0.6">
        {n.map((a, i) => {
          const b = n[(i + 1) % n.length];
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        <line x1="50" y1="20" x2="68" y2="72" opacity="0.35" />
        <line x1="50" y1="20" x2="32" y2="72" opacity="0.35" />
      </g>
      {n.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3.4" fill="currentColor" className="pt-twinkle" style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
      <circle cx="50" cy="52" r="5" fill="none" stroke="currentColor" strokeWidth="1" className="pt-pulse" />
    </svg>
  );
};

/** Bazaar: a gold coin orbited by a trade moon. */
const BazaarEmblem = () => (
  <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
    <ellipse cx="50" cy="50" rx="42" ry="14" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.5" transform="rotate(-24 50 50)" />
    <circle cx="50" cy="50" r="19" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.6" />
    <path d="M50 40v20M54 44c0-2-2-3-4-3s-4 1-4 3 2 3 4 3 4 1 4 3-2 3-4 3-4-1-4-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <g className="pt-spin" style={{ transformOrigin: '50px 50px' }}>
      <circle cx="90" cy="50" r="3" fill="currentColor" />
    </g>
  </svg>
);

/** Mystery: an eclipse with a corona and a watching eye slit. */
const MysteryEmblem = () => (
  <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
    <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" className="pt-pulse" />
    <circle cx="50" cy="50" r="22" fill="#05040a" stroke="currentColor" strokeWidth="1.4" />
    <path d="M50 28a22 22 0 0 1 0 44 16 22 0 0 0 0-44z" fill="currentColor" opacity="0.22" />
    <g stroke="currentColor" strokeWidth="0.8" opacity="0.7" strokeLinecap="round">
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <line key={i} x1={50 + Math.cos(a) * 27} y1={50 + Math.sin(a) * 27} x2={50 + Math.cos(a) * (i % 2 ? 32 : 36)} y2={50 + Math.sin(a) * (i % 2 ? 32 : 36)} />;
      })}
    </g>
    <path d="M38 50q12-9 24 0q-12 9-24 0z" fill="none" stroke="currentColor" strokeWidth="1" />
    <circle cx="50" cy="50" r="2.6" fill="currentColor" />
  </svg>
);

/** Cursed Relic: a buried idol under a waxing moon, with a lantern ring that heats up. */
const RelicEmblem = () => (
  <svg viewBox="0 0 100 100" className="pt-emblem" aria-hidden="true">
    <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" className="pt-pulse" />
    <path d="M10 74q40-12 80 0" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
    <path d="M30 74q20-8 40 0" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
    <path d="M50 20c-9 0-14 7-14 14 0 6 3 10 6 12l-3 14h22l-3-14c3-2 6-6 6-12 0-7-5-14-14-14z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <circle cx="44" cy="34" r="2" fill="currentColor" /><circle cx="56" cy="34" r="2" fill="currentColor" />
    <path d="M45 42q5 3 10 0" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <g className="pt-spin" style={{ transformOrigin: '50px 50px' }}><circle cx="50" cy="12" r="2.6" fill="currentColor" /></g>
  </svg>
);

export const PORTALS: Portal[] = [
  {
    id: 'arena', code: 'SECTOR 01', name: 'Quick Arena', mode: 'Versus', players: '1–8', slots: 8,
    desc: 'Reflex, Math Sprint and Type Storm, head to head.',
    accent: '#9b8cff', accent2: '#e879f9', Emblem: ArenaEmblem,
  },
  {
    id: 'cipher-lab', code: 'SECTOR 02', name: 'Cipher Lab', mode: 'Versus', players: '1–8', slots: 8,
    desc: 'Crack Caesar, Base64, Hex and Binary, and learn what each encoding really is.',
    accent: '#5eead4', accent2: '#38bdf8', Emblem: CipherEmblem,
  },
  {
    id: 'spark', code: 'SECTOR 03', name: 'Social Spark', mode: 'Co-op', players: '2–6', slots: 6,
    desc: 'Three conversation missions. The team wins only if everyone agrees each is done.',
    accent: '#e9b872', accent2: '#fb7185', Emblem: SparkEmblem,
  },
  {
    id: 'brain-bazaar', code: 'SECTOR 04', name: 'Brain Bazaar', mode: 'Versus', players: '1–8', slots: 8,
    desc: 'Bet coins on your own knowledge. Bold bets pay double.',
    accent: '#f5b942', accent2: '#ff7a45', Emblem: BazaarEmblem,
  },
  {
    id: 'midnight-mystery', code: 'SECTOR 05', name: 'Midnight Mystery', mode: 'Social deduction', players: '4–6', slots: 6,
    desc: 'A crime in 3D noir. Secret roles, a hidden liar, and testimony to cross-check.',
    accent: '#ff5d73', accent2: '#b8c1ec', Emblem: MysteryEmblem,
  },
  {
    id: 'cursed-relic', code: 'SECTOR 06', name: 'The Cursed Relic', mode: 'Hunt · voice & cam', players: '2–6', slots: 6,
    desc: 'Watch a cursed object get buried, then hunt it in a haunted 3D graveyard. Talk to your team with mic and camera.',
    accent: '#6df2b8', accent2: '#9b8cff', Emblem: RelicEmblem,
  },
];

/* -------------------------------------------------------------------------- */

export function RoomPortals({
  onPlayMap,
  onJoinCode,
  disabled,
  warp,
}: {
  /** Resolves to the room code (quick play or a new private room). */
  onPlayMap: (mapId: string, isPrivate: boolean) => Promise<string>;
  onJoinCode: (code: string) => void;
  disabled?: boolean;
  /** Wraps navigation in the hyperspace jump (Home passes its own). */
  warp: (go: () => Promise<void> | void) => Promise<void>;
}) {
  const reduce = useReducedMotion();
  const counts = useSocialOptional()?.counts ?? {};
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const enter = async (id: string, isPrivate: boolean) => {
    if (busy || disabled) return;
    const key = `${isPrivate ? 'p' : 'q'}-${id}`;
    setBusy(key);
    setError(null);
    try {
      // Get the room first, so a full/offline error never costs a warp jump.
      const roomCode = await onPlayMap(id, isPrivate);
      await warp(() => onJoinCode(roomCode));
    } catch (e) {
      setError((e as Error).message || 'Could not open that room.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-xl border border-[#ff5d4a]/40 bg-[#ff5d4a]/10 px-4 py-2.5 text-sm text-[#ffc9c2]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {PORTALS.map((p, i) => {
          const Emblem = p.Emblem;
          const loading = busy === `q-${p.id}`;
          return (
            <motion.article
              key={p.id}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.45, delay: (i % 3) * 0.07 }}
              className="pt-card"
              style={{ ['--a' as string]: p.accent, ['--b' as string]: p.accent2 }}
            >
              <span className="pt-corner tl" /><span className="pt-corner tr" /><span className="pt-corner bl" /><span className="pt-corner br" />
              <span className="pt-scan" aria-hidden="true" />

              <button
                type="button"
                onClick={() => void enter(p.id, false)}
                disabled={disabled || busy !== null}
                aria-label={`Enter ${p.name}`}
                className="pt-hit"
              >
                <div className="pt-head">
                  <span className="pt-code">{p.code}</span>
                  <span className="pt-live"><i /> {(counts[p.id] ?? 0) > 0 ? `${counts[p.id]} playing` : 'OPEN'}</span>
                </div>

                <div className="pt-core">
                  <span className="pt-halo" aria-hidden="true" />
                  <Emblem />
                </div>

                <h4 className="pt-name">{p.name}</h4>
                <p className="pt-desc">{p.desc}</p>

                <div className="pt-meta">
                  <span className="pt-tag">{p.mode}</span>
                  <span className="pt-slots" title={`${p.players} players`} aria-label={`${p.players} players`}>
                    {Array.from({ length: p.slots }, (_, k) => <i key={k} />)}
                    <b>{p.players}</b>
                  </span>
                </div>

                <span className="pt-go">
                  {loading ? <><Loader2 size={15} className="animate-spin" /> Opening a gate…</> : <>Enter room <ArrowUpRight size={15} /></>}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void enter(p.id, true)}
                disabled={disabled || busy !== null}
                className="pt-private"
                aria-label={`Create a private ${p.name} room`}
              >
                <Lock size={12} /> {busy === `p-${p.id}` ? 'Creating…' : 'Private'}
              </button>
            </motion.article>
          );
        })}

        {/* Join with a code */}
        <form
          className="pt-card pt-code-card"
          style={{ ['--a' as string]: '#a49fb0', ['--b' as string]: '#9b8cff' }}
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) void warp(() => onJoinCode(c));
          }}
        >
          <span className="pt-corner tl" /><span className="pt-corner tr" /><span className="pt-corner bl" /><span className="pt-corner br" />
          <div className="pt-head"><span className="pt-code">PRIVATE GATE</span></div>
          <div className="flex items-center gap-2 mt-3 text-[#eee9dc]">
            <KeyRound size={18} className="text-[#9b8cff]" />
            <h4 className="pt-name !mt-0">Have a code?</h4>
          </div>
          <p className="pt-desc">Friend made a private room? Type its code to dock.</p>
          <div className="flex gap-2 mt-4">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="ABCDE"
              autoComplete="off"
              aria-label="Room code"
              className="pt-input"
            />
            <button type="submit" disabled={!code.trim() || disabled} className="pt-join">Join</button>
          </div>
        </form>
      </div>
    </div>
  );
}
