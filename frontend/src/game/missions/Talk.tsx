import { Avatar } from "../ui";
import type { MissionProps, TalkPlay, TalkPrivate } from "../types";

export function Talk({ play, priv, players, send }: MissionProps<TalkPlay, TalkPrivate>) {
  const done = priv?.done ?? false;
  return (
    <div className="rg-talk">
      <blockquote className="rg-prompt-card">{play.prompt}</blockquote>
      <p className="rg-dim">Talk it through in the chat. When you are happy with it, press the button. The mission completes when everyone has.</p>
      <button type="button" className={`rg-btn big${done ? " on" : ""}`} aria-pressed={done}
        onClick={() => send("act", { op: "done", value: !done })}>
        {done ? "✓ I'm done (tap to undo)" : "We did it"}
      </button>
      <div className="rg-solvers">
        {players.filter((p) => !p.spectator).map((p) => (
          <span key={p.name} className={`rg-solver${play.done.includes(p.name) ? " yes" : ""}`}>
            <Avatar name={p.name} size={20} /> {p.name} {play.done.includes(p.name) ? "✓" : "…"}
          </span>
        ))}
        <span className="rg-dim rg-small">{play.done.length}/{play.total} ready</span>
      </div>
    </div>
  );
}
