import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../ui";
import type { MissionProps, TypingPlay } from "../types";

const SEND_EVERY_MS = 120; // stays far below the server's 12 actions/second limit

export function Typing({ play, players, you, send }: MissionProps<TypingPlay>) {
  const text = play.text;
  const [typed, setTyped] = useState("");
  const started = useRef(0);
  const lastSent = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
    return () => window.clearTimeout(pending.current);
  }, []);

  const push = (value: string) => {
    const go = () => {
      send("act", { op: "progress", typed: value });
      lastSent.current = performance.now();
    };
    window.clearTimeout(pending.current);
    const wait = SEND_EVERY_MS - (performance.now() - lastSent.current);
    if (wait <= 0) go();
    else pending.current = window.setTimeout(go, wait); // trailing send: the last keystroke always arrives
  };

  const firstBad = useMemo(() => {
    for (let i = 0; i < typed.length; i++) if (typed[i] !== text[i]) return i;
    return -1;
  }, [typed, text]);
  const correct = firstBad === -1 ? typed.length : firstBad;
  const done = typed === text;

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value.replace(/\n/g, "").slice(0, text.length);
    if (!started.current && value) started.current = performance.now();
    setTyped(value);
    push(value);
  };

  const minutes = started.current ? (performance.now() - started.current) / 60000 : 0;
  const wpm = minutes > 0.02 ? Math.round(correct / 5 / minutes) : 0;

  return (
    <div className="rg-typing" onClick={() => box.current?.focus()}>
      <div className="rg-lanes">
        {players.filter((p) => !p.spectator).map((p) => (
          <div key={p.name} className={`rg-lane${p.name === you ? " me" : ""}`}>
            <Avatar name={p.name} size={22} />
            <div className="rg-lane-track">
              <span className="rg-lane-dot" style={{ left: `${Math.min(100, p.progress * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="rg-text" aria-label="Passage to type">
        {Array.from(text).map((ch, i) => {
          const state = i >= typed.length ? "" : firstBad !== -1 && i >= firstBad ? "bad" : "ok";
          return <span key={i} className={`rg-ch ${state}${i === typed.length ? " cur" : ""}`}>{ch}</span>;
        })}
      </div>
      <textarea ref={box} className="rg-ghost" value={typed} onChange={onChange} onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={done}
        aria-label="Type here" />
      <div className="rg-stats">
        <span><b>{wpm}</b> WPM</span>
        <span><b>{correct}</b> / {text.length}</span>
        {firstBad !== -1 && <span className="rg-warn">Fix the red character to continue counting</span>}
        {done && <span className="rg-ok">Finished. Waiting for the others…</span>}
      </div>
    </div>
  );
}
