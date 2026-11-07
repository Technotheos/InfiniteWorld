import { useState } from "react";
import { Chat } from "./Chat";
import { MapTrail } from "./MapTrail";
import { Scoreboard } from "./Scoreboard";
import { Avatar, MissionIcon, TimerBar, useCountdown } from "./ui";
import { Cipher } from "./missions/Cipher";
import { MathSprint } from "./missions/MathSprint";
import { Reaction } from "./missions/Reaction";
import { Talk } from "./missions/Talk";
import { Typing } from "./missions/Typing";
import type {
  ChatMsg, CipherPlay, CipherPrivate, MathPrivate, MissionProps, ReactionPlay, ReactionPrivate, SendFn,
  StateView, TalkPlay, TalkPrivate, TypingPlay,
} from "./types";
import type { ConnStatus } from "./useGameSocket";

export interface GameViewProps {
  state: StateView;
  chat: ChatMsg[];
  status: ConnStatus;
  skew: number;
  send: SendFn;
  onLeave: () => void;
}

/** Pure view of one room state. No sockets in here, so it is easy to preview and test. */
export function GameView({ state, chat, status, skew, send, onLeave }: GameViewProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(state.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rg-root" data-theme={state.map.theme}>
      <header className="rg-top">
        <div>
          <div className="rg-eyebrow">{state.map.mode === "coop" ? "Co-op room" : "Versus room"}</div>
          <h2 className="rg-title">{state.map.name}</h2>
        </div>
        <div className="rg-top-right">
          {status !== "open" && <span className="rg-pill warn">{status === "reconnecting" ? "Reconnecting…" : status}</span>}
          <button type="button" className="rg-code" onClick={copy} title="Copy room code">
            {copied ? "Copied" : state.code}
          </button>
          <button type="button" className="rg-btn ghost small" onClick={onLeave}>Leave</button>
        </div>
      </header>

      <MapTrail missions={state.map.missions} current={state.mission} phase={state.phase} />

      <main className="rg-main">
        <section className="rg-stage" aria-live="polite">
          {state.spectating && state.phase !== "lobby" && state.phase !== "finished" && (
            <div className="rg-banner">You joined mid-game. You can watch and chat, and you will play the next round.</div>
          )}
          <Stage state={state} skew={skew} send={send} />
        </section>
        <aside className="rg-side">
          <Scoreboard players={state.players} you={state.you} phase={state.phase} />
          <Chat messages={chat} you={state.you} send={send} />
        </aside>
      </main>
    </div>
  );
}

function Stage({ state, skew, send }: { state: StateView; skew: number; send: SendFn }) {
  switch (state.phase) {
    case "lobby": return <Lobby state={state} send={send} />;
    case "countdown": return <Countdown state={state} skew={skew} />;
    case "briefing": return <Briefing state={state} skew={skew} />;
    case "playing": return <Playing state={state} skew={skew} send={send} />;
    case "reveal": return <Reveal state={state} skew={skew} />;
    case "finished": return <Finished state={state} send={send} />;
  }
}

// ---- lobby -----------------------------------------------------------------

function Lobby({ state, send }: { state: StateView; send: SendFn }) {
  const me = state.players.find((p) => p.name === state.you);
  const active = state.players.filter((p) => !p.spectator && p.connected);
  const need = Math.max(0, state.map.min_players - active.length);
  return (
    <div className="rg-card rg-lobby">
      <p className="rg-tagline">{state.map.tagline}</p>
      <ol className="rg-mission-list">
        {state.map.missions.map((m, i) => (
          <li key={i}>
            <span className="rg-mi"><MissionIcon kind={m.kind} /></span>
            <div><b>{m.title}</b><span className="rg-dim">{m.brief}</span></div>
          </li>
        ))}
      </ol>
      <div className="rg-ready-row">
        {active.map((p) => (
          <span key={p.name} className={`rg-solver${p.ready ? " yes" : ""}`}>
            <Avatar name={p.name} size={22} /> {p.name} {p.ready ? "✓" : "…"}
          </span>
        ))}
      </div>
      <p className="rg-dim">
        {need > 0
          ? `Waiting for ${need} more player${need > 1 ? "s" : ""}. Share the room code above.`
          : "Everyone ready starts the game. The host can also start now."}
      </p>
      <div className="rg-actions">
        <button type="button" className={`rg-btn big${me?.ready ? " on" : ""}`} disabled={!me || me.spectator}
          onClick={() => send("ready", { ready: !me?.ready })}>
          {me?.ready ? "✓ Ready (tap to undo)" : "I'm ready"}
        </button>
        {me?.host && (
          <button type="button" className="rg-btn ghost" disabled={need > 0} onClick={() => send("start")}>Start now</button>
        )}
      </div>
    </div>
  );
}

// ---- transitions -----------------------------------------------------------

function Countdown({ state, skew }: { state: StateView; skew: number }) {
  const { seconds } = useCountdown(state.deadline, skew);
  return (
    <div className="rg-card rg-center">
      <p className="rg-eyebrow">Get ready</p>
      <div className="rg-bignum" key={seconds}>{Math.max(1, seconds)}</div>
    </div>
  );
}

function Briefing({ state, skew }: { state: StateView; skew: number }) {
  const { seconds, fraction } = useCountdown(state.deadline, skew);
  const b = state.brief;
  if (!b) return null;
  return (
    <div className="rg-card rg-center">
      <p className="rg-eyebrow">Mission {b.index + 1} of {b.total}</p>
      <div className="rg-hero-icon"><MissionIcon kind={b.kind} size={44} /></div>
      <h3 className="rg-h2">{b.title}</h3>
      <p className="rg-lead">{b.brief}</p>
      <TimerBar fraction={fraction} seconds={seconds} />
    </div>
  );
}

// ---- playing ---------------------------------------------------------------

function Playing({ state, skew, send }: { state: StateView; skew: number; send: SendFn }) {
  const { seconds, fraction } = useCountdown(state.deadline, skew);
  const play = state.play;
  if (!play) return null;
  const common = { players: state.players, you: state.you, send };
  let body: JSX.Element | null = null;
  if (state.spectating) {
    body = <p className="rg-dim rg-center-text">Watching {state.brief?.title}…</p>;
  } else {
    switch (play.kind) {
      case "reaction": body = <Reaction {...(common as Omit<MissionProps<ReactionPlay, ReactionPrivate>, "play" | "priv">)} play={play} priv={state.private as ReactionPrivate | undefined} />; break;
      case "math": body = <MathSprint {...common} play={play} priv={state.private as MathPrivate | undefined} />; break;
      case "typing": body = <Typing {...(common as Omit<MissionProps<TypingPlay>, "play" | "priv">)} play={play} priv={undefined} />; break;
      case "cipher": body = <Cipher {...(common as Omit<MissionProps<CipherPlay, CipherPrivate>, "play" | "priv">)} play={play} priv={state.private as CipherPrivate | undefined} />; break;
      case "talk": body = <Talk {...(common as Omit<MissionProps<TalkPlay, TalkPrivate>, "play" | "priv">)} play={play} priv={state.private as TalkPrivate | undefined} />; break;
    }
  }
  return (
    <div className="rg-card">
      <div className="rg-card-head">
        <h3 className="rg-h2"><MissionIcon kind={play.kind} /> {state.brief?.title}</h3>
        {state.deadline > 0 && <TimerBar fraction={fraction} seconds={seconds} />}
      </div>
      {body}
    </div>
  );
}

// ---- reveal + final --------------------------------------------------------

function Reveal({ state, skew }: { state: StateView; skew: number }) {
  const { seconds } = useCountdown(state.deadline, skew);
  const r = state.reveal;
  if (!r) return null;
  const rows = Object.entries(r.points).sort(([, a], [, b]) => b - a);
  return (
    <div className="rg-card">
      <p className="rg-eyebrow">{r.title}: results</p>
      <ul className="rg-reveal">
        {rows.map(([name, pts]) => (
          <li key={name}>
            <Avatar name={name} size={28} />
            <div className="rg-reveal-main">
              <div className="rg-row-top"><b>{name}</b><span>{pts} pts</span></div>
              <div className="rg-bar tall"><div className="rg-bar-fill" style={{ transform: `scaleX(${pts / 1000})` }} /></div>
              <span className="rg-dim rg-small">{r.stats[name]}</span>
            </div>
          </li>
        ))}
      </ul>
      {r.note && <div className="rg-note"><b>What you just learned</b><p>{r.note}</p></div>}
      <p className="rg-dim rg-small rg-center-text">Next up in {seconds}s</p>
    </div>
  );
}

function Finished({ state, send }: { state: StateView; send: SendFn }) {
  const res = state.result;
  if (!res) return null;
  const podium = res.ranking.filter((r) => r.place <= 3).slice(0, 3);
  const order = podium.length === 3 ? [podium[1]!, podium[0]!, podium[2]!] : podium;
  return (
    <div className="rg-card rg-center">
      {res.mode === "coop" ? (
        <>
          <p className="rg-eyebrow">Team result</p>
          <h3 className="rg-h2">{res.won ? "Mission complete! 🎉" : "Not this time. Try again?"}</h3>
        </>
      ) : (
        <>
          <p className="rg-eyebrow">Final standings</p>
          <h3 className="rg-h2">{res.ranking[0] ? `${res.ranking[0].name} wins!` : "Game over"}</h3>
          <div className="rg-podium">
            {order.map((r) => (
              <div key={r.name} className={`rg-pod p${r.place}`}>
                <Avatar name={r.name} size={40} />
                <b>{r.name}</b>
                <div className="rg-pod-bar"><span>{r.place}</span></div>
                <i>{r.score}</i>
              </div>
            ))}
          </div>
        </>
      )}
      <ol className="rg-final">
        {res.ranking.map((r) => (
          <li key={r.name} className={r.name === state.you ? "me" : ""}>
            <span>#{r.place}</span><b>{r.name}</b><span>{r.score}</span>
          </li>
        ))}
      </ol>
      <div className="rg-actions center">
        <button type="button" className="rg-btn big" onClick={() => send("rematch")}>Play again</button>
      </div>
    </div>
  );
}
