import { Avatar, useCountUp } from "./ui";
import type { Phase, PlayerView } from "./types";

function Row({ p, you, phase, max }: { p: PlayerView; you: string; phase: Phase; max: number }) {
  const shown = useCountUp(p.score);
  const showProgress = phase === "playing" && !p.spectator;
  return (
    <li className={`rg-row${p.name === you ? " me" : ""}${p.connected ? "" : " off"}`}>
      <Avatar name={p.name} />
      <div className="rg-row-main">
        <div className="rg-row-top">
          <span className="rg-row-name">
            {p.name}
            {p.name === you && <em> (you)</em>}
            {p.host && <span className="rg-crown" title="Host">★</span>}
          </span>
          <span className="rg-row-score">
            {phase === "reveal" && p.gain > 0 && <span className="rg-gain">+{p.gain}</span>}
            {shown}
          </span>
        </div>
        <div className="rg-bar">
          <div className="rg-bar-fill" style={{ transform: `scaleX(${showProgress ? p.progress : max ? p.score / max : 0})` }} />
        </div>
      </div>
    </li>
  );
}

export function Scoreboard({ players, you, phase }: { players: PlayerView[]; you: string; phase: Phase }) {
  const active = players.filter((p) => !p.spectator).sort((a, b) => b.score - a.score);
  const watchers = players.filter((p) => p.spectator);
  const max = Math.max(1, ...active.map((p) => p.score));
  return (
    <section className="rg-card" aria-label="Scoreboard">
      <h3 className="rg-h3">Players</h3>
      <ul className="rg-list">
        {active.map((p) => <Row key={p.name} p={p} you={you} phase={phase} max={max} />)}
      </ul>
      {watchers.length > 0 && <p className="rg-dim rg-small">Watching: {watchers.map((w) => w.name).join(", ")}</p>}
    </section>
  );
}
