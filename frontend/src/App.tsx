import React, { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { GameRoom, createRoom, quickPlay } from './game';
import { Signup } from './components/Signup';
import Home from './pages/Home';
import { ChainSecurityLab } from './game/chain-lab';
import { useWebSocket } from './hooks/useWebSocket';
import { useEngineStatus } from './hooks/useEngineStatus';
import { ArrowLeft, Send } from 'lucide-react';
import { AILab } from './ai-lab';
import { TraceLab } from './trace-lab';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import { Logo } from './components/Logo';
import { UserAvatar } from './components/Avatar';
import { AuthExpiredError, avatarUrl, getMe } from './components/profileApi';
import { SocialProvider, useSocial } from './social/SocialContext';
import { UserName } from './social/UserName';
import { Ambient } from './sound';
import { clearSession, getSession, logoutRemote, refreshSession, setSession, subscribe, type Session } from './session';

const AI_CHAT_ROOM = 'ai-deep-dive';

// The live chat room that goes with the Chain Security Lab.
const LAB_CHAT_ROOM = 'zeroday-websec';

// The live chat room that goes with the Trace Lab.
const TRACE_CHAT_ROOM = 'trace-forensics';

/** The social layer (friends, presence, profile cards, DMs) wraps the whole signed-in app. */
export default function App() {
  return (
    <SocialProvider>
      <AppInner />
    </SocialProvider>
  );
}

function AppInner() {
  // The session lives in memory (see session.ts). `booting` is true until we have
  // asked the server whether the refresh cookie still holds a valid login.
  const [session, setSessionState] = useState<Session | null>(getSession());
  const [booting, setBooting] = useState(true);
  const token = session?.token ?? null;
  const username = session?.username ?? null;
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');

  // Room & Chat states
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');

  const [playMode, setPlayMode] = useState<'off' | 'room'>('off');
  const [gameCode, setGameCode] = useState('');

  // Chain Security Lab room (runs in the browser, no server room needed)
  const [labOpen, setLabOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  // Profile & settings page, and the bits of the profile Home needs (the picture).
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);

  useEffect(() => subscribe(setSessionState), []);

  // The "Join" shortcut on friends and profile cards jumps straight into a room.
  const { setJoinHandler } = useSocial();
  useEffect(() => {
    setJoinHandler((code) => {
      setSelectedRoom(null);
      setProfileOpen(false);
      setSettingsOpen(false);
      setAdminOpen(false);
      setLabOpen(false);
      setAiOpen(false);
      setTraceOpen(false);
      setGameCode(code);
      setPlayMode('room');
    });
    return () => setJoinHandler(null);
  }, [setJoinHandler]);

  // On load, resume the login from the HttpOnly refresh cookie (if there is one).
  useEffect(() => {
    void refreshSession().finally(() => setBooting(false));
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
    void logoutRemote(); // ends this device's session on the server and clears the cookie
    clearSession();
    setSelectedRoom(null);
    setAdminOpen(false);
    setLabOpen(false);
    setAiOpen(false);
    setTraceOpen(false);
    setProfileOpen(false);
    setSettingsOpen(false);
    setAvatarVersion(0);
    setPlayMode('off');
  };

  // The server issues a fresh token when the username changes.
  const handleSessionChange = (newToken: string, newUser: string, expiresIn: number) => {
    setSession(newToken, newUser, expiresIn);
  };

  // Resuming a saved login: avoid flashing the login form while we check.
  if (booting) {
    return (
      <div className="min-h-screen bg-[#06050b] grid place-items-center" aria-busy="true" aria-label="Loading">
        <Logo size={64} animated />
      </div>
    );
  }

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
        onLoginSuccess={() => {
          /* Login already stored the session; App re-renders through subscribe(). */
        }}
        onSwitchToSignup={() => setAuthView('signup')}
      />
    );
  }

  // 2. Authenticated, no chat room open: Home, the lab, or the arcade
  if (!selectedRoom) {
    if (adminOpen) {
      return <Admin token={token} username={username} onBack={() => setAdminOpen(false)} onAuthExpired={handleLogout} />;
    }
    if (settingsOpen) {
      // Back goes to wherever Settings was opened from: your profile, or Home.
      return (
        <Settings
          token={token}
          username={username}
          onBack={() => setSettingsOpen(false)}
          onLogout={handleLogout}
          onSessionChange={handleSessionChange}
          onOpenAdmin={() => setAdminOpen(true)}
        />
      );
    }
    if (profileOpen) {
      return (
        <Profile
          token={token}
          username={username}
          onBack={() => setProfileOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onAuthExpired={handleLogout}
          onSessionChange={handleSessionChange}
          onAvatarChange={setAvatarVersion}
        />
      );
    }
    if (playMode === 'room') {
      return <GameRoom code={gameCode} token={token} onLeave={() => setPlayMode('off')} onAuthExpired={handleLogout} />;
    }

    if (aiOpen) {
      return (
        <>
          <Ambient scene="ai-lab" />
          <AILab
            username={username}
            onLeave={() => setAiOpen(false)}
            onDiscuss={() => setSelectedRoom(AI_CHAT_ROOM)}
          />
        </>
      );
    }

    if (traceOpen) {
      return (
        <>
          <Ambient scene="trace-lab" />
          <TraceLab
            username={username}
            token={token}
            onLeave={() => setTraceOpen(false)}
            onDiscuss={() => setSelectedRoom(TRACE_CHAT_ROOM)}
            onAuthExpired={handleLogout}
          />
        </>
      );
    }

    if (labOpen) {
      return (
        <>
          <Ambient scene="chain-lab" />
          <ChainSecurityLab
            username={username}
            onLeave={() => setLabOpen(false)}
            onDiscuss={() => setSelectedRoom(LAB_CHAT_ROOM)}
          />
        </>
      );
    }


    return (
      <Home
        username={username}
        engineStatus={engineStatus}
        onOpenLab={() => setLabOpen(true)}
        onOpenAILab={() => setAiOpen(true)}
        onOpenTrace={() => setTraceOpen(true)}
        onPlayMap={(mapId, isPrivate) => (isPrivate ? createRoom(token, mapId, true) : quickPlay(token, mapId))}
        onJoinCode={(code) => {
          setGameCode(code);
          setPlayMode('room');
        }}
        onLogout={handleLogout}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        avatarSrc={avatarUrl(username, avatarVersion)}
      />
    );
  }

  // 3. Active chat room view. "Back" returns to wherever you came from
  //    (the lab stays open underneath if you opened the chat from it).
  const roomTitle = selectedRoom.replace(/[-_]+/g, ' ');
  return (
    <div className="h-[100dvh] bg-[#06050b] text-slate-100 flex flex-col items-center justify-center sm:p-4">
      <Ambient scene="home" />
      <div className="w-full sm:max-w-2xl h-full sm:h-[88vh] bg-[#0d0b16] sm:border border-white/10 sm:rounded-3xl p-3 sm:p-6 shadow-2xl flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-3 pb-3 sm:pb-4 border-b border-white/10">
          <button
            onClick={() => setSelectedRoom(null)}
            className="flex shrink-0 items-center gap-2 text-sm bg-white/5 hover:bg-white/10 px-3 py-2 rounded-xl transition-colors"
          >
            <ArrowLeft size={16} /> {labOpen || traceOpen ? 'Back to the lab' : 'Back'}
          </button>
          <span className="font-semibold text-slate-200 capitalize truncate">{roomTitle}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-4 pr-1">
          {messages.length === 0 && <p className="text-center text-sm text-slate-400 pt-6">No messages yet. Say hi.</p>}
          {messages.map((msg, index) => {
            const mine = msg.sender === username;
            return (
              <div key={index} className={`flex items-end gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <UserAvatar name={String(msg.sender ?? '?')} size={32} />
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 border ${
                    mine ? 'bg-[#e9b872]/15 border-[#e9b872]/30 rounded-br-md' : 'bg-white/5 border-white/10 rounded-bl-md'
                  }`}
                >
                  <UserName name={String(msg.sender ?? '?')} className={`text-xs font-semibold ${mine ? 'text-[#e9b872]' : 'text-cyan-300'}`} />
                  <p className="text-sm text-slate-100 mt-0.5 break-words">{msg.content}</p>
                </div>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!inputMessage.trim()) return;
            sendMessage(inputMessage);
            setInputMessage('');
          }}
          className="flex gap-2 pt-3 sm:pt-4 border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
        >
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message..."
            autoComplete="off"
            enterKeyHint="send"
            style={{ colorScheme: 'dark', color: '#f1f5f9', backgroundColor: '#06050b' }}
            className="flex-1 min-w-0 border border-white/15 rounded-xl px-4 py-2.5 text-base placeholder:text-slate-500 focus:outline-none focus:border-[#e9b872]"
          />
          <button
            type="submit"
            aria-label="Send"
            className="bg-[#e9b872] hover:brightness-110 text-[#1a1208] px-4 py-2.5 rounded-xl transition flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
