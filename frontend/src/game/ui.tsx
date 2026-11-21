import { useEffect, useRef, useState } from "react";
import type { MissionKind } from "./types";
import { publicAvatarUrl } from "../components/profileApi";
import { useSocialOptional } from "../social/socialCore";
import "../social/social.css";

// ---- icons (24x24 paths, no icon library needed) ---------------------------

export const ICON_PATH: Record<MissionKind, string> = {
  reaction: "M13 2 4 14h6l-1 8 9-12h-6z",
  math: "M5 12h14M12 5v14M5 5l4 4M9 5 5 9",
  typing: "M3 7h18v10H3zM6 10h2M10 10h2M14 10h2M7 14h10",
  cipher: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2",
  talk: "M4 5h16v11H9l-5 4z",
  bazaar: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M15 9.5c0-1.2-1.3-2-3-2s-3 .8-3 2 1.3 1.8 3 2 3 .8 3 2-1.3 2-3 2-3-.8-3-2",
  relic: "M12 2l2.5 5.5L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5zM6 21h12",
  mystery: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM16 16l5 5",
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
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name]);
  const showImage = Boolean(name) && !failed;
  const social = useSocialOptional();
  const face = (
    <span className="rg-avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${hue(name)} 70% 58%), hsl(${(hue(name) + 50) % 360} 70% 42%))` }}>
      {showImage ? (
        <img src={publicAvatarUrl(name)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
  if (!social || !name) return face;
  return (
    <button type="button" className="iw-avatar-btn" onClick={() => social.openCard(name)} aria-label={`View ${name}'s profile`}>
      {face}
    </button>
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
