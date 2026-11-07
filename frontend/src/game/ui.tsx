import { useEffect, useRef, useState } from "react";
import type { MissionKind } from "./types";

// ---- icons (24x24 paths, no icon library needed) ---------------------------

export const ICON_PATH: Record<MissionKind, string> = {
  reaction: "M13 2 4 14h6l-1 8 9-12h-6z",
  math: "M5 12h14M12 5v14M5 5l4 4M9 5 5 9",
  typing: "M3 7h18v10H3zM6 10h2M10 10h2M14 10h2M7 14h10",
  cipher: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2",
  talk: "M4 5h16v11H9l-5 4z",
};

export function MissionIcon({ kind, size = 22 }: { kind: MissionKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATH[kind]} />
    </svg>
  );
}

// ---- avatar ----------------------------------------------------------------

function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span className="rg-avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${hue(name)} 70% 58%), hsl(${(hue(name) + 50) % 360} 70% 42%))` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---- hooks -----------------------------------------------------------------

/** Counts down to a server deadline, corrected for clock skew. */
export function useCountdown(deadline: number | undefined, skew: number) {
  const [, tick] = useState(0);
  const total = useRef({ deadline: 0, total: 1 });
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [deadline]);

  const remaining = deadline ? Math.max(0, deadline - (Date.now() + skew)) : 0;
  if (deadline && total.current.deadline !== deadline) {
    total.current = { deadline, total: Math.max(1, deadline - (Date.now() + skew)) };
  }
  return {
    remaining,
    seconds: Math.ceil(remaining / 1000),
    fraction: deadline ? Math.min(1, remaining / total.current.total) : 0,
  };
}

/** Smoothly animates a number towards its target. */
export function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(begin + (target - begin) * eased);
      setValue(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// ---- small shared pieces ---------------------------------------------------

export function TimerBar({ fraction, seconds }: { fraction: number; seconds: number }) {
  return (
    <div className="rg-timer" role="timer" aria-label={`${seconds} seconds left`}>
      <div className="rg-timer-fill" style={{ transform: `scaleX(${fraction})` }} data-low={fraction < 0.25} />
      <span className="rg-timer-num">{seconds}s</span>
    </div>
  );
}
