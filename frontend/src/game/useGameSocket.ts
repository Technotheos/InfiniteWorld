import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "./gameApi";
import type { ChatMsg, ClientMsgType, Hello, StateView } from "./types";

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
      const ws = new WebSocket(wsUrl(code), ["bearer", token]);
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
        if (ev.code === 1008 && ev.reason.includes("token")) setAuthExpired(true);
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
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, token]);

  const send = useCallback((type: ClientMsgType, payload?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
  }, []);

  return { status, state, chat, skew, closeReason, authExpired, send };
}
