import { useCallback, useEffect } from "react";
import type { MissionProps, ReactionPlay, ReactionPrivate } from "../types";

function fmt(ms: number): string {
  return ms === -1 ? "false start" : ms === -2 ? "too slow" : `${ms} ms`;
}

export function Reaction({ play, priv, send }: MissionProps<ReactionPlay, ReactionPrivate>) {
  const acted = priv?.acted ?? false;
  const click = useCallback(() => {
    if (!acted && play.status !== "between") send("act", { op: "click" });
  }, [acted, play.status, send]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
        e.preventDefault();
        click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [click]);

  const label =
    play.status === "between" ? "Next round…" : acted ? "Locked in" : play.status === "go" ? "CLICK!" : "Wait for green…";

  const results = play.results
    ? Object.entries(play.results).sort(([, a], [, b]) => (a < 0 ? 1e9 : a) - (b < 0 ? 1e9 : b))
    : [];

  return (
    <div className="rg-reaction">
      <div className="rg-rounds" aria-label={`Round ${play.round} of ${play.rounds}`}>
        {Array.from({ length: play.rounds }, (_, i) => (
          <span key={i} className={`rg-dot${i + 1 < play.round ? " done" : i + 1 === play.round ? " now" : ""}`} />
        ))}
      </div>
      <button type="button" className={`rg-orb ${play.status}${acted ? " acted" : ""}`} onPointerDown={click}
        aria-label={label}>
        <span>{label}</span>
      </button>
      <p className="rg-dim rg-small">Click the orb or press Space. Clicking while it is red scores zero.</p>
      {play.status === "between" && (
        <ul className="rg-results" aria-label="Round results">
          {results.map(([name, ms]) => (
            <li key={name} className={ms < 0 ? "bad" : ""}>
              <span>{name}</span>
              <b>{fmt(ms)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
