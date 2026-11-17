import { useEffect, useMemo, useState } from "react";
import { Coins, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { Avatar } from "../ui";
import { Scene3D } from "../three/Scene3D";
import type { BazaarPlay, BazaarPrivate, MissionProps } from "../types";
import type { BazaarSceneState } from "../three/bazaarScene";
import "../rooms.css";

const loadScene = () => import("../three/bazaarScene").then((m) => m.createBazaarScene);

const STAKES = [
  { bet: 1, label: "Cautious", coins: 50 },
  { bet: 2, label: "Confident", coins: 100 },
  { bet: 3, label: "All-in", coins: 200 },
];

const HOW: Record<BazaarPlay["variant"], string> = {
  estimate: "Type your best guess. Bullseye pays double, close pays the stake, far off costs it.",
  fib: "Pick the statement you think is false.",
  chain: "Pick the idea that fills the gap in the chain.",
};

export function Bazaar({ play, priv, players, you, send }: MissionProps<BazaarPlay, BazaarPrivate>) {
  const [pick, setPick] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [bet, setBet] = useState(2);
  useEffect(() => {
    setPick(null);
    setText("");
  }, [play.round]);

  const answered = priv?.answered ?? false;
  const between = play.status === "between";
  const estimate = play.variant === "estimate";
  const parsed = Number(text.replace(/[,\s]/g, ""));
  const valid = estimate ? text.trim() !== "" && Number.isFinite(parsed) : pick !== null;
  const lock = () => {
    if (!valid || answered || between) return;
    send("act", { op: "answer", value: estimate ? parsed : pick, bet });
  };

  const names = players.filter((p) => !p.spectator).map((p) => p.name);
  const mine = play.results?.find((r) => r.name === you);
  const scene = useMemo<BazaarSceneState>(() => {
    const gains: Record<string, number> = {};
    for (const r of play.results ?? []) gains[r.name] = r.delta;
    return {
      players: names, net: play.net, you, status: play.status, event: play.event, locked: play.locked,
      roundKey: `${play.round}:${play.status}`, gains,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|"), play.net, play.status, play.event, play.round, play.results, play.locked, you]);

  const chosenText = between ? play.options?.[play.correct ?? -1] : pick !== null ? play.options?.[pick] : undefined;

  return (
    <div className="bz">
      <Scene3D load={loadScene} state={scene} className="bz-stage" label="A night market with a coin stack for every player" />

      {play.event !== "none" && (
        <div className={`bz-event ${play.event}`} role="status">
          {play.event === "bull" && <TrendingUp size={18} />}
          {play.event === "crash" && <TrendingDown size={18} />}
          {play.event === "tip" && <Lightbulb size={18} />}
          <b>{play.event === "bull" ? "Bull market" : play.event === "crash" ? "Market crash" : "Insider tip"}</b>
          <span>
            {play.event === "bull" && "Winning bets pay double this round."}
            {play.event === "crash" && "Losing bets cost double this round."}
            {play.event === "tip" && (play.hint ?? "")}
          </span>
        </div>
      )}

      <div className="bz-q">
        <span className="rg-chip dim">Question {play.round} of {play.rounds}</span>
        <h4 className="bz-prompt">{play.prompt}</h4>
        <p className="rg-dim rg-small">{HOW[play.variant]}</p>
      </div>

      {play.chain && (
        <ol className="bz-chain" aria-label="Chain of ideas">
          {play.chain.map((node, i) => (
            <li key={i} className={i === play.blank ? "gap" : ""}>
              {i === play.blank ? <span className={between ? "ok" : ""}>{chosenText ?? "?"}</span> : node}
            </li>
          ))}
        </ol>
      )}

      {play.options && (
        <div className="bz-options" role="group" aria-label="Answers">
          {play.options.map((o, i) => {
            const struck = play.struck === i;
            const cls = [
              "bz-opt",
              pick === i ? "picked" : "",
              struck ? "struck" : "",
              between && i === play.correct ? "right" : "",
              between && mine?.answer === o && i !== play.correct ? "wrong" : "",
            ].join(" ");
            return (
              <button key={i} type="button" className={cls} disabled={answered || between || struck}
                aria-pressed={pick === i} onClick={() => setPick(i)}>
                <span className="bz-key">{String.fromCharCode(65 + i)}</span>
                <span>{o}</span>
              </button>
            );
          })}
        </div>
      )}

      {estimate && !between && (
        <label className="bz-guess">
          <input className="rg-input" inputMode="decimal" value={text} disabled={answered} placeholder="Your estimate"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lock()} />
          {play.unit && <span className="rg-dim">{play.unit}</span>}
        </label>
      )}

      {!between && (
        <div className="bz-bet">
          <div className="bz-stakes" role="radiogroup" aria-label="How much do you stake?">
            {STAKES.map((s) => (
              <button key={s.bet} type="button" role="radio" aria-checked={bet === s.bet} disabled={answered}
                className={`bz-stake s${s.bet}${bet === s.bet ? " on" : ""}`} onClick={() => setBet(s.bet)}>
                <Coins size={16} /> <b>{s.label}</b> <span>{s.coins}</span>
              </button>
            ))}
          </div>
          <button type="button" className="rg-btn big" disabled={!valid || answered} onClick={lock}>
            {answered ? `Locked in · ${STAKES[(priv?.bet ?? 1) - 1]?.coins} coins` : "Lock in my bet"}
          </button>
        </div>
      )}

      {!between && (
        <div className="rg-solvers">
          {names.map((n) => (
            <span key={n} className={`rg-solver${play.locked.includes(n) ? " yes" : ""}`}>
              <Avatar name={n} size={20} /> {n} {play.locked.includes(n) ? "✓" : "…"}
            </span>
          ))}
        </div>
      )}

      {between && (
        <div className="bz-reveal">
          <div className="bz-answer"><span className="rg-eyebrow">The answer</span><b>{play.answer}</b></div>
          {play.explain && <p className="rg-note"><b>Why</b><br />{play.explain}</p>}
          <ul className="bz-results">
            {(play.results ?? []).map((r, i) => (
              <li key={r.name} className={r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""} style={{ animationDelay: `${i * 90}ms` }}>
                <Avatar name={r.name} size={26} />
                <div><b>{r.name}</b><span className="rg-dim rg-small">{r.answer} · bet {r.bet ? STAKES[r.bet - 1]?.coins : 0}</span></div>
                <strong>{r.delta > 0 ? "+" : ""}{r.delta}</strong>
              </li>
            ))}
          </ul>
          {play.penalty && (
            <div className="bz-penalty" role="status">
              <b>Wacky Penalty for {play.penalty.name}</b>
              <span>{play.penalty.text}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
