import { ICON_PATH } from "./ui";
import type { MissionInfo, Phase } from "./types";

interface Props {
  missions: MissionInfo[];
  current: number; // index of the mission in play, -1 before the game
  phase: Phase;
}

const W = 640;
const H = 96;

/** The "map": a glowing path with one node per mission. */
export function MapTrail({ missions, current, phase }: Props) {
  const n = missions.length;
  const finished = phase === "finished";
  const doneCount = finished ? n : current < 0 ? 0 : phase === "reveal" ? current + 1 : current;

  const pts = missions.map((_, i) => ({
    x: n === 1 ? W / 2 : 44 + (i * (W - 88)) / (n - 1),
    y: 38 + (i % 2 === 0 ? 6 : -6),
  }));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  // The glowing line reaches the mission being played (or the next one after a reveal).
  const reached = finished ? n - 1 : current < 0 ? 0 : phase === "reveal" ? Math.min(n - 1, current + 1) : current;
  const lit = n <= 1 ? (finished ? 1 : 0) : reached / (n - 1);

  return (
    <svg className="rg-trail" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mission map">
      <defs>
        <linearGradient id="rg-trail-grad" x1="0" x2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent2)" />
        </linearGradient>
      </defs>
      <path d={d} className="rg-trail-base" pathLength={1} />
      <path d={d} className="rg-trail-lit" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - lit} />
      {missions.map((m, i) => {
        const p = pts[i]!;
        const state = i < doneCount ? "done" : i === current ? "now" : "next";
        return (
          <g key={i} className={`rg-node ${state}`} transform={`translate(${p.x} ${p.y})`}>
            {state === "now" && <circle r={22} className="rg-node-ping" />}
            <circle r={17} className="rg-node-body" />
            <g transform="translate(-10 -10) scale(0.84)" className="rg-node-icon">
              {state === "done" ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d={ICON_PATH[m.kind]} />}
            </g>
            <text y={36} textAnchor="middle" className="rg-node-label">{m.title}</text>
          </g>
        );
      })}
    </svg>
  );
}
