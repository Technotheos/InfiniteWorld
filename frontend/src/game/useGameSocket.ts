import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "./gameApi";
import type { ChatMsg, ClientMsgType, Hello, StateView } from "./types";
import { getToken, refreshSession, subscribe } from "../session";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

const MAX_RETRIES = 5;
// 1008 = policy violation (token expired / rate limit), 1013 = try again later (room full or closed)
const NO_RETRY = new Set([1000, 1008, 1013]);

export interface GameSocket {
  status: ConnStatus;
  state: StateView | null;
  chat: ChatMsg[];
  /** server clock minus local clock, in ms; add it to Date.now() to get server time */
  skew: number;
  closeReason: string | null;
  authExpired: boolean;
  send: (type: ClientMsgType, payload?: unknown) => void;
}

export function useGameSocket(code: string, token: string): GameSocket {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<StateView | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [skew, setSkew] = useState(0);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // The token is read at connect time from a ref: when the session silently
  // refreshes every ~14 minutes the prop changes, and that must NOT drop the
  // player from a live game.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    let stopped = false;
    let retries = 0;
    let timer: number | undefined;
    setState(null);
    setChat([]);
    setCloseReason(null);
    setAuthExpired(false);

    const connect = () => {
      setStatus(retries ? "reconnecting" : "connecting");
      // The JWT travels as a WebSocket subprotocol, never in the URL (matches ws.go).
      const ws = new WebSocket(wsUrl(code), ["bearer", getToken() ?? tokenRef.current]);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        setStatus("open");
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: { type: string; payload: unknown };
        try {
          msg = JSON.parse(ev.data) as { type: string; payload: unknown };
        } catch {
          return;
        }
        if (msg.type === "state") {
          const st = msg.payload as StateView;
          setSkew(st.now - Date.now());
          setState(st);
        } else if (msg.type === "hello") {
          setChat(((msg.payload as Hello).chat ?? []).slice());
        } else if (msg.type === "chat") {
          setChat((c) => [...c.slice(-49), msg.payload as ChatMsg]);
        }
      };
      ws.onclose = (ev: CloseEvent) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        if (ev.code === 1008 && ev.reason.includes("token")) {
          // The 15-minute access token ended mid-game. Renew the session and
          // rejoin; only a failed renewal counts as "signed out".
          void refreshSession().then((ok) => {
            if (stopped) return;
            if (ok) {
              retries = 0;
              connect();
            } else {
              setAuthExpired(true);
              setStatus("closed");
              setCloseReason("Your session has expired. Please sign in again.");
            }
          });
          return;
        }
        if (NO_RETRY.has(ev.code) || retries >= MAX_RETRIES) {
          setStatus("closed");
          setCloseReason(
            ev.reason || (ev.code === 1006 ? "Could not join this room. It may have closed." : `Disconnected (${ev.code})`),
          );
          return;
        }
        retries += 1;
        setStatus("reconnecting");
        timer = window.setTimeout(connect, Math.min(4000, 400 * 2 ** retries));
      };
    };

    connect();

    // Every time the session renews (about every 14 minutes) hand the new token
    // to the server over the open socket, so the game is never cut at expiry.
    // If the server cannot take it, the 1008 handler above reconnects instead.
    const unsubscribe = subscribe((s) => {
      const ws = wsRef.current;
      if (s && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "reauth", payload: s.token }));
    });

    return () => {
      unsubscribe();
      stopped = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code]);

  const send = useCallback((type: ClientMsgType, payload?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
  }, []);

  return { status, state, chat, skew, closeReason, authExpired, send };
}
