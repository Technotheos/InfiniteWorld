import React, { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { GameRoom, RoomPicker } from './game';
import { Signup } from './components/Signup';
import Home from './pages/Home';
import { ChainSecurityLab } from './game/chain-lab';
import { useWebSocket } from './hooks/useWebSocket';
import { useEngineStatus } from './hooks/useEngineStatus';
import { ArrowLeft, Send } from 'lucide-react';
import { AILab } from './ai-lab';
import Settings from './pages/Settings';
import { AuthExpiredError, avatarUrl, getMe } from './components/profileApi';

const AI_CHAT_ROOM = 'ai-deep-dive';

// The live chat room that goes with the Chain Security Lab.
const LAB_CHAT_ROOM = 'zeroday-websec';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');

  // Room & Chat states
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');

  const [playMode, setPlayMode] = useState<'off' | 'pick' | 'room'>('off');
  const [gameCode, setGameCode] = useState('');

  // Chain Security Lab room (runs in the browser, no server room needed)
  const [labOpen, setLabOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Profile & settings page, and the bits of the profile Home needs (the picture).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);

  // Check localStorage on initial load
  useEffect(() => {
    const savedToken = localStorage.getItem('jwt_token');
    const savedUser = localStorage.getItem('username');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUsername(savedUser);
    }
  }, []);

  // Load the profile picture once signed in. A 401 means the saved token is stale.
  useEffect(() => {
    if (!token || !username) return;
    let cancelled = false;
    getMe(token)
      .then((p) => {
        if (!cancelled) setAvatarVersion(p.avatar_version);
      })
      .catch((err) => {
        if (!cancelled && err instanceof AuthExpiredError) handleLogout();
        // Any other failure (server down...) just leaves the initial-letter avatar.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, username]);

  const { messages, sendMessage } = useWebSocket(selectedRoom);
  const engineStatus = useEngineStatus(Boolean(token && username));

  const handleLogout = () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('username');
    localStorage.removeItem('jwt_expires_at');
    setToken(null);
    setUsername(null);
    setSelectedRoom(null);
    setLabOpen(false);
    setAiOpen(false);
    setSettingsOpen(false);
    setAvatarVersion(0);
    setPlayMode('off');
  };

  // The server issues a fresh token when the username changes.
  const handleSessionChange = (newToken: string, newUser: string, expiresIn: number) => {
    localStorage.setItem('jwt_token', newToken);
    localStorage.setItem('username', newUser);
    localStorage.setItem('jwt_expires_at', String(Date.now() + expiresIn * 1000));
    setToken(newToken);
    setUsername(newUser);
  };

  // 1. If not authenticated, show Login or Signup
  if (!token || !username) {
    if (authView === 'signup') {
      return (
        <Signup
          onSignupSuccess={() => setAuthView('login')}
          onSwitchToLogin={() => setAuthView('login')}
        />
      );
    }
    return (
      <Login
        onLoginSuccess={(newToken, newUser) => {
          setToken(newToken);
          setUsername(newUser);
        }}
        onSwitchToSignup={() => setAuthView('signup')}
      />
    );
  }

  // 2. Authenticated, no chat room open: Home, the lab, or the arcade
  if (!selectedRoom) {
    if (settingsOpen) {
      return (
        <Settings
          token={token}
          username={username}
          onBack={() => setSettingsOpen(false)}
          onLogout={handleLogout}
          onSessionChange={handleSessionChange}
          onProfileChange={(patch) => {
            if (patch.avatarVersion !== undefined) setAvatarVersion(patch.avatarVersion);
          }}
        />
      );
    }
    if (playMode === 'pick') {
      return (
        <>
          <button onClick={() => setPlayMode('off')}
            className="fixed left-4 top-4 z-50 rounded-xl bg-slate-800 px-3 py-1.5 text-sm text-white">← Back</button>
          <RoomPicker token={token} onEnter={(c) => { setGameCode(c); setPlayMode('room'); }} />
        </>
      );
    }
    if (playMode === 'room') {
      return <GameRoom code={gameCode} token={token} onLeave={() => setPlayMode('pick')} onAuthExpired={handleLogout} />;
    }

    if (aiOpen) {
      return (
        <AILab
          username={username}
          onLeave={() => setAiOpen(false)}
          onDiscuss={() => setSelectedRoom(AI_CHAT_ROOM)}
        />
      );
    }

    if (labOpen) {
      return (
        <ChainSecurityLab
          username={username}
          onLeave={() => setLabOpen(false)}
          onDiscuss={() => setSelectedRoom(LAB_CHAT_ROOM)}
        />
      );
    }


    return (
      <Home
        username={username}
        engineStatus={engineStatus}
        onOpenLab={() => setLabOpen(true)}
        onOpenAILab={() => setAiOpen(true)}
        onOpenPlay={() => setPlayMode('pick')}
        onSelectRoom={(id) => setSelectedRoom(id)}
        onLogout={handleLogout}
        onOpenSettings={() => setSettingsOpen(true)}
        avatarSrc={avatarUrl(username, avatarVersion)}
      />
    );
  }

  // 3. Active chat room view. "Back" returns to wherever you came from
  //    (the lab stays open underneath if you opened the chat from it).
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl h-[85vh] bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <button
            onClick={() => setSelectedRoom(null)}
            className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl transition-colors"
          >
            <ArrowLeft size={16} /> {labOpen ? 'Back to the lab' : 'Back to Dashboard'}
          </button>
          <span className="font-semibold text-slate-200">Room: {selectedRoom}</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 py-4 pr-2">
          {messages.map((msg, index) => (
            <div key={index} className="p-3 bg-slate-950/60 border border-slate-800/60 rounded-xl">
              <span className="text-xs font-semibold text-blue-400">{msg.sender}</span>
              <p className="text-sm text-slate-200 mt-0.5">{msg.content}</p>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!inputMessage.trim()) return;
            sendMessage(inputMessage);
            setInputMessage('');
          }}
          className="flex gap-2 pt-4 border-t border-slate-800"
        >
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl transition-colors flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}