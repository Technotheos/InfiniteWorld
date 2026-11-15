import { useEffect, useRef, useState } from 'react';
import { WS_URL } from '../components/authApi';
import { getSession, getToken, refreshSession, subscribe } from '../session';

/** Pass `null` while no room is open: no socket is created until there is a room. */
export const useWebSocket = (roomId: string | null) => {
  const [messages, setMessages] = useState<any[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    if (!getToken()) {
      console.error('No session. Please log in first.');
      return;
    }

    setMessages([]); // each room starts with a clean history

    let stopped = false;
    let retriedAfterExpiry = false;

    const connect = () => {
      const token = getToken();
      if (!token) return;
      // The token travels as a WebSocket subprotocol, never in the URL: URLs end
      // up in server logs, proxies and browser history (matches ws.go).
      const ws = new WebSocket(`${WS_URL}/ws?room_id=${encodeURIComponent(roomId)}`, ['bearer', token]);
      socketRef.current = ws;

      // Every successful connection re-arms the one-shot expiry retry, so the
      // NEXT 15-minute expiry is handled too, not only the first.
      ws.onopen = () => {
        retriedAfterExpiry = false;
      };

      ws.onmessage = (event) => {
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        setMessages((prev) => [...prev, data]);
      };

      ws.onclose = async (ev) => {
        if (socketRef.current === ws) socketRef.current = null;
        if (stopped) return;
        // The server closes the socket when the 15-minute access token ends.
        // Refresh the session and rejoin once, instead of dropping the user.
        if (ev.code === 1008 && !retriedAfterExpiry && (await refreshSession())) {
          retriedAfterExpiry = true;
          connect();
        }
      };
    };

    connect();

    // Renew the socket's login in-band whenever the session refreshes, so the
    // chat is not cut when the 15-minute token ends.
    const unsubscribe = subscribe((s) => {
      const ws = socketRef.current;
      if (s && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'reauth', content: s.token }));
    });

    return () => {
      unsubscribe();
      stopped = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId]);

  const sendMessage = (content: string, action = 'chat') => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, content }));
      setMessages((prev) => [...prev, { sender: getSession()?.username ?? 'me', content }]);
    } else {
      console.error('Message not sent: the connection is not open.');
    }
  };

  return { messages, sendMessage };
};
