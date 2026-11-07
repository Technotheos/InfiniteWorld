import { useEffect, useState } from "react";
import { createRoom, listMaps, quickPlay } from "./gameApi";
import { MissionIcon } from "./ui";
import type { MapInfo } from "./types";
import "./game.css";

interface Props {
  token: string;
  /** Navigate to your room route, e.g. navigate(`/play/${code}`). */
  onEnter: (code: string) => void;
}

export function RoomPicker({ token, onEnter }: Props) {
  const [maps, setMaps] = useState<MapInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    listMaps().then(setMaps).catch((e: Error) => setError(e.message));
  }, []);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    try {
      onEnter(await fn());
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="rg-root rg-picker" data-theme="nebula">
      <h2 className="rg-title">Choose a room</h2>
      <p className="rg-dim">Every room is a map of missions. Finish them, and see who played best.</p>
      {error && <div className="rg-banner bad" role="alert">{error}</div>}
      <div className="rg-grid">
        {(maps ?? []).map((m) => (
          <article key={m.id} className="rg-card rg-map" data-theme={m.theme}>
            <div className="rg-chips">
              <span className="rg-chip">{m.mode === "coop" ? "Co-op" : "Versus"}</span>
              <span className="rg-chip dim">{m.min_players === m.max_players ? m.min_players : `${m.min_players}-${m.max_players}`} players</span>
            </div>
            <h3 className="rg-h2">{m.name}</h3>
            <p className="rg-dim">{m.tagline}</p>
            <div className="rg-mini-trail">
              {m.missions.map((x, i) => <span key={i} title={x.title}><MissionIcon kind={x.kind} size={16} /></span>)}
            </div>
            <div className="rg-actions">
              <button type="button" className="rg-btn" disabled={busy !== null} onClick={() => run(`q-${m.id}`, () => quickPlay(token, m.id))}>
                {busy === `q-${m.id}` ? "Finding a room…" : "Quick play"}
              </button>
              <button type="button" className="rg-btn ghost" disabled={busy !== null} onClick={() => run(`p-${m.id}`, () => createRoom(token, m.id, true))}>
                Private room
              </button>
            </div>
          </article>
        ))}
        {maps === null && !error && <p className="rg-dim">Loading rooms…</p>}
      </div>
      <form className="rg-card rg-join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onEnter(code.trim().toUpperCase()); }}>
        <label htmlFor="rg-join-code">Have a code?</label>
        <input id="rg-join-code" className="rg-input" value={code} maxLength={8} placeholder="ABCDE"
          onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" />
        <button type="submit" className="rg-btn" disabled={!code.trim()}>Join</button>
      </form>
    </div>
  );
}
