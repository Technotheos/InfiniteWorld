import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WS_URL } from '../components/authApi';
import { getToken, getSession, refreshSession, subscribe } from '../session';
import { getFriends, openDM as openDMApi, type Friend } from './socialApi';
import { ProfileCard } from './ProfileCard';
import { sfx } from '../sound';
import { DMDrawer } from './DMDrawer';
import { Ctx, type DMInvite, type SocialApi } from './socialCore';

export { useSocial, useSocialOptional } from './socialCore';

/* -------------------------------------------------------------------------- */
/*  One lobby socket for the whole signed-in app. It carries:                 */
/*    presence  - a friend went online/offline or moved rooms                 */
/*    friends   - your friend list changed (refetch)                          */
/*    counts    - "N playing" per game map                                    */
/*    dm        - someone opened a direct message to you                      */
/* -------------------------------------------------------------------------- */

const NO_RETRY = new Set([1000, 1008, 1013]);

export function SocialProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(Boolean(getSession()));
  useEffect(() => subscribe((s) => setSignedIn(Boolean(s))), []);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [dmPeer, setDmPeer] = useState<{ name: string; roomId: string } | null>(null);
  const [invite, setInvite] = useState<DMInvite | null>(null);
  const joinRef = useRef<((code: string) => void) | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  friendsRef.current = friends;

  const refreshFriends = useCallback(() => {
    const token = getToken();
    if (!token) return;
    getFriends(token)
      .then((r) => setFriends(r.friends ?? []))
      .catch(() => {
        /* offline or signed out: keep what we have */
      });
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setFriends([]);
      setCounts({});
      setCardFor(null);
      setDmPeer(null);
      setInvite(null);
      return;
    }
    let stopped = false;
    let retries = 0;
    let timer: number | undefined;
    let ws: WebSocket | null = null;

    refreshFriends();

    const connect = () => {
      const token = getToken();
      if (!token || stopped) return;
      ws = new WebSocket(`${WS_URL}/ws/lobby`, ['bearer', token]);
      const mine = ws;
      mine.onopen = () => {
        retries = 0;
        refreshFriends(); // anything missed while offline
      };
      mine.onmessage = (ev: MessageEvent<string>) => {
        let msg: { type: string; payload: unknown };
        try {
          msg = JSON.parse(ev.data) as { type: string; payload: unknown };
        } catch {
          return;
        }
        if (msg.type === 'counts') {
          setCounts((msg.payload as Record<string, number>) ?? {});
        } else if (msg.type === 'presence') {
          const p = msg.payload as Friend;
          if (friendsRef.current.some((f) => f.name === p.name)) {
            setFriends((list) => list.map((f) => (f.name === p.name ? p : f)));
          } else {
            refreshFriends();
          }
        } else if (msg.type === 'friends') {
          refreshFriends();
        } else if (msg.type === 'dm') {
          setInvite(msg.payload as DMInvite);
          sfx('ping');
        }
      };
      mine.onclose = (ev: CloseEvent) => {
        if (ws === mine) ws = null;
        if (stopped) return;
        if (ev.code === 1008 && ev.reason.includes('token')) {
          void refreshSession().then((ok) => {
            if (ok && !stopped) connect();
          });
          return;
        }
        if (NO_RETRY.has(ev.code)) return;
        // Quiet reconnect forever: the lobby is a nice-to-have, never an error screen.
        retries += 1;
        timer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retries, 5)));
      };
    };
    connect();

    const unsub = subscribe((s) => {
      if (s && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reauth', payload: s.token }));
    });

    return () => {
      stopped = true;
      unsub();
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [signedIn, refreshFriends]);

  const openDM = useCallback(async (name: string) => {
    const token = getToken();
    if (!token) throw new Error('You are signed out.');
    const r = await openDMApi(token, name);
    setDmPeer({ name: r.with, roomId: r.room_id });
    setInvite((i) => (i && i.room_id === r.room_id ? null : i));
  }, []);

  const api = useMemo<SocialApi>(
    () => ({
      friends,
      counts,
      openCard: (name) => setCardFor(name),
      openDM,
      refreshFriends,
      setJoinHandler: (fn) => {
        joinRef.current = fn;
      },
      joinRoom: (code) => joinRef.current?.(code),
      invite,
      dismissInvite: () => setInvite(null),
    }),
    [friends, counts, openDM, refreshFriends, invite],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {signedIn && cardFor && <ProfileCard name={cardFor} onClose={() => setCardFor(null)} />}
      {signedIn && dmPeer && <DMDrawer key={dmPeer.roomId} peer={dmPeer.name} roomId={dmPeer.roomId} onClose={() => setDmPeer(null)} />}
      {signedIn && invite && !dmPeer && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-[#e9b872]/40 bg-[#0d0b16]/95 px-4 py-3 text-sm text-[#eee9dc] shadow-2xl backdrop-blur">
          <span>
            <b className="text-[#e9b872]">{invite.from}</b> wants to chat
          </span>
          <button
            type="button"
            className="rounded-lg bg-[#e9b872] px-3 py-1 font-semibold text-[#1a1208] hover:brightness-110"
            onClick={() => void openDM(invite.from).catch(() => setInvite(null))}
          >
            Open
          </button>
          <button type="button" aria-label="Dismiss" className="text-[#a49fb0] hover:text-white" onClick={() => setInvite(null)}>
            ✕
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
