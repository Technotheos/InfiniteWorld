import { useEffect, useRef, useState } from 'react';

interface Props {
  cols?: number; rows?: number;
  /** cell indexes that hold something hidden */
  hidden: number[];
  /** run the UV sweep */
  running?: boolean;
  /** sweep forever (Home card) */
  loop?: boolean;
  /** show hidden cells as already found (after a finished scan) */
  litAll?: boolean;
  reduce?: boolean;
  onFound?: (cell: number) => void;
  onDone?: () => void;
  className?: string;
}

const HEX = ['9f3a', 'c41e', '7b02', 'e5d8', '31af', 'a07c', '5d90', 'b6e1'];
const SWEEP_MS = 4200;

/** A drive's sector grid with hex digits scrolling behind it and a UV bar that makes hidden cells glow red, each pulling a red thread to a pin on a timeline. */
export function SectorGrid({ cols = 28, rows = 8, hidden, running, loop, litAll, reduce, onFound, onDone, className }: Props) {
  const [p, setP] = useState(running ? 0 : 1);
  const [found, setFound] = useState<number[]>([]);
  const cb = useRef({ onFound, onDone });
  cb.current = { onFound, onDone };

  useEffect(() => {
    if (!running) return;
    const hit = new Set<number>();
    let raf = 0, timer = 0, start = performance.now();
    const finish = () => { cb.current.onDone?.(); };
    if (reduce) { hidden.forEach((c) => { hit.add(c); cb.current.onFound?.(c); }); setFound([...hit]); setP(1); finish(); return; }
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / SWEEP_MS);
      setP(x);
      for (const c of hidden) {
        if (!hit.has(c) && x * cols >= (c % cols) + 0.5) { hit.add(c); setFound([...hit]); cb.current.onFound?.(c); }
      }
      if (x < 1) raf = requestAnimationFrame(tick);
      else {
        finish();
        if (loop) timer = window.setTimeout(() => { hit.clear(); setFound([]); setP(0); start = performance.now(); raf = requestAnimationFrame(tick); }, 2600);
      }
    };
    setFound([]); setP(0);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, loop, reduce, cols, hidden.join(',')]);

  const S = 7, W = cols * S, GH = rows * S, H = GH + 30;
  const lit = running ? found : litAll ? hidden : [];
  const litSorted = [...lit].sort((a, b) => (a % cols) - (b % cols));
  const pinX = (i: number) => 14 + (litSorted.length <= 1 ? (W - 28) / 2 : (i * (W - 28)) / (litSorted.length - 1));
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    const isH = hidden.includes(idx);
    const on = lit.includes(idx);
    cells.push(<rect key={idx} x={c * S + 0.8} y={r * S + 0.8} width={S - 1.6} height={S - 1.6} rx="1"
      className={on ? 'tl-cell hot' : isH ? 'tl-cell sec' : 'tl-cell'} />);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className ?? 'tl-sector'} role="img" aria-label="Disk sector grid under UV light">
      {Array.from({ length: Math.min(8, Math.floor(cols / 3)) }, (_, i) => (
        <text key={i} x={6 + i * (W / 8)} y="0" className="tl-hexbg tl-anim" style={{ animationDelay: `${-i * 0.9}s`, animationDuration: `${5 + (i % 3)}s` }}>{HEX[i % HEX.length]}</text>
      ))}
      {cells}
      {running && <rect x={p * W - 3} y="-2" width="6" height={GH + 4} className="tl-uvbar" />}
      {running && <rect x={Math.max(0, p * W - 40)} y="0" width={Math.min(40, p * W)} height={GH} className="tl-uvtrail" />}
      {/* timeline with pins */}
      <line x1="8" y1={GH + 20} x2={W - 8} y2={GH + 20} className="tl-tline" />
      {litSorted.map((c, i) => {
        const cx = (c % cols) * S + S / 2, cy = Math.floor(c / cols) * S + S / 2, px = pinX(i), py = GH + 20;
        return (
          <g key={c}>
            <path d={`M${cx} ${cy} C ${cx} ${cy + 20}, ${px} ${py - 20}, ${px} ${py}`} className="tl-thread tl-anim" pathLength={1} />
            <circle cx={px} cy={py} r="2.6" className="tl-pin" />
          </g>
        );
      })}
    </svg>
  );
}
