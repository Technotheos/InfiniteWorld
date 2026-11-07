import { useEffect } from "react";
import { GameView } from "./GameView";
import { useGameSocket } from "./useGameSocket";
import "./game.css";

interface Props {
  code: string;
  /** The JWT from your login. It is sent as a WebSocket subprotocol, never in the URL. */
  token: string;
  onLeave: () => void;
  /** Called once if the server closed the socket because the 15-minute token expired. */
  onAuthExpired?: () => void;
}

/** Connects to a room and renders it. Mount at /play/:code. */
export function GameRoom({ code, token, onLeave, onAuthExpired }: Props) {
  const { status, state, chat, skew, closeReason, authExpired, send } = useGameSocket(code, token);

  useEffect(() => {
    if (authExpired) onAuthExpired?.();
  }, [authExpired, onAuthExpired]);

  if (state) {
    return <GameView state={state} chat={chat} status={status} skew={skew} send={send} onLeave={onLeave} />;
  }
  return (
    <div className="rg-root rg-splash" data-theme="nebula">
      <div className="rg-card rg-center">
        {status === "closed" ? (
          <>
            <h3 className="rg-h2">{authExpired ? "Session expired" : "Can't join this room"}</h3>
            <p className="rg-dim">{authExpired ? "Please sign in again." : closeReason}</p>
            <button type="button" className="rg-btn" onClick={onLeave}>Back</button>
          </>
        ) : (
          <>
            <div className="rg-spinner" aria-hidden="true" />
            <p className="rg-dim">{status === "reconnecting" ? "Reconnecting…" : "Joining the room…"}</p>
          </>
        )}
      </div>
    </div>
  );
}
