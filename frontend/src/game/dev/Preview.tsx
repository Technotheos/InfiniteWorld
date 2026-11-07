import { useMemo, useState } from "react";
import { GameView } from "../GameView";
import { SAMPLE_CHAT, SCENARIOS } from "./fixtures";
import "../game.css";

/**
 * Dev-only page: renders every screen from fixtures, no backend needed.
 * Mount it on a route like /dev/rooms while you work on visuals.
 */
export function Preview() {
  const names = Object.keys(SCENARIOS);
  const [name, setName] = useState(names[0]!);
  const [n, setN] = useState(0); // bump to regenerate countdown deadlines
  const state = useMemo(() => SCENARIOS[name]!(), [name, n]);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 12, background: "#000" }}>
        {names.map((k) => (
          <button key={k} type="button" onClick={() => { setName(k); setN((x) => x + 1); }}
            style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #444", background: k === name ? "#9b7bff" : "#111", color: "#fff", cursor: "pointer" }}>
            {k}
          </button>
        ))}
      </div>
      <GameView state={state} chat={SAMPLE_CHAT} status="open" skew={0} send={(t, p) => console.log("send", t, p)} onLeave={() => undefined} />
    </div>
  );
}
