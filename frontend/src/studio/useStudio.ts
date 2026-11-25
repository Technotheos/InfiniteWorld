import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshSession, subscribe } from '../session';
import { StudioClock } from './audio';
import { studioTicket, studioWsUrl, type StudioChatMsg, type StudioState, type StudioTake } from './studioApi';
import type { RtcSignal } from '../game/types';

export type StudioStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StepEvent {
  t: number;
  s: number;
  on: boolean;
  by: string;
  at: number;
}

export interface ServerError {
  code: string;
  message: string;
  held_by?: string[];
  n: number;
}

const MAX_RETRIES = 6;

export function useStudio(code: string, onAuthExpired: () => void) {
  const [status, setStatus] = useState<StudioStatus>('connecting');
  const [state, setState] = useState<StudioState | null>(null);
  const [cells, setCells] = useState<string[][]>([]);
  const [trail, setTrail] = useState<Record<string, { by: string; at: number }>>({});
  const [chat, setChat] = useState<StudioChatMsg[]>([]);
  const [lastTake, setLastTake] = useState<(StudioTake & { n: number }) | null>(null);
  const [error, setError] = useState<ServerError | null>(null);
  const [closeReason, setCloseReason] = useState<string | null>(null);
  const clock = useRef(new StudioClock()).current;
  const wsRef = useRef<WebSocket | null>(null);
  const rtcSubs = useRef(new Set<(s: RtcSignal) => void>());
  const authRef = useRef(onAuthExpired);
  authRef.current = onAuthExpired;

  useEffect(() => {
    let stopped = false;
    let retries = 0;
    let timer: number | undefined;
    let pingTimer: number | undefined;
    let ended = false; // the server told us the studio closed or removed us: never reconnect
    let errN = 0;
    const samples: { rtt: number; skew: number }[] = [];

    const toCells = (s: StudioState) => s.grid.map((row) => row.map((v) => (v < 0 ? '' : v === 0 ? '·' : s.owners[v - 1] ?? '')));

    const connect = async () => {
      setStatus(retries ? 'reconnecting' : 'connecting');
      let ticket: string;
      try {
        ticket = await studioTicket(code); // the room rules are checked here, before any socket exists
      } catch (e) {
        if (stopped) return;
        setStatus('closed');
        setCloseReason((e as Error).message || 'Could not enter this studio.');
        return;
      }
      if (stopped) return;
      // The room ticket (45 s, single use, this room only) is the subprotocol, never the login token.
      const ws = new WebSocket(studioWsUrl(code), ['bearer', ticket]);
      wsRef.current = ws;

      const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping', payload: { t: performance.now() } }));
      ws.onopen = () => {
        retries = 0;
        setStatus('open');
        samples.length = 0;
        ping();
        let n = 0;
        pingTimer = window.setInterval(() => {
          ping();
          if (++n === 6) {
            window.clearInterval(pingTimer);
            pingTimer = window.setInterval(ping, 10000);
          }
        }, 700);
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: { type: string; payload: any };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const p = msg.payload;
        switch (msg.type) {
          case 'state': {
            const st = p as StudioState;
            if (!samples.length) clock.skew = st.now - Date.now();
            clock.apply(st);
            setState(st);
            setCells(toCells(st));
            setChat(st.chat ?? []);
            break;
          }
          case 'pong': {
            // NTP-style: the sample with the smallest round trip is the most trustworthy.
            const rtt = performance.now() - p.t;
            samples.push({ rtt, skew: p.now + rtt / 2 - Date.now() });
            if (samples.length > 8) samples.shift();
            clock.skew = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).skew;
            break;
          }
          case 'step': {
            const e = p as StepEvent;
            setCells((c) => c.map((row, t) => (t === e.t ? row.map((v, s) => (s === e.s ? (e.on ? e.by : '') : v)) : row)));
            setTrail((tr) => ({ ...tr, [`${e.t}-${e.s}`]: { by: e.by, at: e.at } }));
            break;
          }
          case 'chat':
            setChat((c) => [...c.slice(-29), p as StudioChatMsg]);
            break;
          case 'take':
            setLastTake({ ...(p as StudioTake), n: Date.now() });
            break;
          case 'rtc':
            if (p && typeof p.from === 'string' && typeof p.sdp === 'string') rtcSubs.current.forEach((fn) => fn(p as RtcSignal));
            break;
          case 'error':
            setError({ ...(p as ServerError), n: ++errN });
            break;
          case 'kicked':
          case 'closing':
            ended = true;
            setCloseReason((p as { message: string }).message);
            break;
        }
      };
      ws.onclose = (ev: CloseEvent) => {
        window.clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        if (ended) {
          setStatus('closed');
          return;
        }
        if (ev.code === 1008 && ev.reason.includes('token')) {
          void refreshSession().then((ok) => {
            if (stopped) return;
            if (ok) void connect();
            else {
              setStatus('closed');
              authRef.current();
            }
          });
          return;
        }
        if (retries >= MAX_RETRIES) {
          setStatus('closed');
          setCloseReason(ev.reason || 'Lost the connection to the studio.');
          return;
        }
        retries += 1;
        setStatus('reconnecting');
        timer = window.setTimeout(() => void connect(), Math.min(4000, 400 * 2 ** retries));
      };
    };
    void connect();

    // Keep the socket's own permission fresh as the login renews.
    const unsub = subscribe((s) => {
      const ws = wsRef.current;
      if (s && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reauth', payload: s.token }));
    });

    return () => {
      stopped = true;
      unsub();
      window.clearTimeout(timer);
      window.clearInterval(pingTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [code, clock]);

  const send = useCallback((type: string, payload?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
  }, []);

  const onRtc = useCallback((fn: (s: RtcSignal) => void) => {
    rtcSubs.current.add(fn);
    return () => void rtcSubs.current.delete(fn);
  }, []);

  return { status, state, cells, trail, chat, lastTake, error, closeReason, clock, send, onRtc };
}
