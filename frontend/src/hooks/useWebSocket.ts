import { useEffect, useRef, useState } from 'react';

/** Pass `null` while no room is open: no socket is created until there is a room. */
export const useWebSocket = (roomId: string | null) => {
  const [messages, setMessages] = useState<any[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;

    // 1. Grab the JWT token stored during login
    const token = localStorage.getItem('jwt_token');
    if (!token) {
      console.error('No JWT token found. Please log in first.');
      return;
    }

    setMessages([]); // each room starts with a clean history

    // 2. Connect to Go backend passing the token and room_id
    const wsUrl = `ws://localhost:8080/ws?token=${token}&room_id=${roomId}`;
    console.log("🔥 ACTUAL WEBSOCKET URL BEING CALLED:", wsUrl)
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket room:', roomId);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages((prev) => [...prev, data]);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    return () => {
      ws.close();
    };
  }, [roomId]);

  const sendMessage = (content: string, action = 'chat') => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const payload = {action, content};
      socketRef.current.send(JSON.stringify(payload));

      const currentUsername = localStorage.getItem('username') || 'Nta';
      setMessages((prev) => [
        ...prev,
        { sender: currentUsername, content: content }
      ]);
    } else {
      console.error('❌hmm, this message faced an error, try to shut down your network and go for a walk')
    }
  };

  return { messages, sendMessage };
};