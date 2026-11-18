import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { UserAvatar } from '../components/Avatar';
import { useWebSocket } from '../hooks/useWebSocket';
import { getSession } from '../session';
import { UserName } from './UserName';
import './social.css';

interface DMMessage {
  sender?: string;
  content?: string;
}

/**
 * A direct message is an ordinary chat room (see useWebSocket / ws.go) whose id
 * the server derived from the two usernames, so this reuses the chat code as-is.
 * It floats above whatever you are doing, so opening one never drops you out of a game.
 */
export function DMDrawer({ peer, roomId, onClose }: { peer: string; roomId: string; onClose: () => void }) {
  const { messages, sendMessage } = useWebSocket(roomId);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const me = getSession()?.username;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = (messages as DMMessage[]).filter((m) => typeof m.content === 'string' && m.content);

  return (
    <aside
      aria-label={`Chat with ${peer}`}
      className="fixed inset-x-0 bottom-0 z-[75] flex h-[70dvh] flex-col rounded-t-3xl border border-white/10 bg-[#0d0b16] text-[#eee9dc] shadow-2xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[26rem] sm:w-[22rem] sm:rounded-3xl"
    >
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <UserAvatar name={peer} size={32} />
        <UserName name={peer} className="min-w-0 flex-1 truncate text-sm font-semibold capitalize" />
        <button type="button" onClick={onClose} aria-label="Close chat" className="rounded-lg p-1 text-[#a49fb0] hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
        {list.length === 0 && (
          <p className="pt-6 text-center text-xs text-[#a49fb0]">
            Say hi to {peer}. Messages are live only: they are not saved, so you both need to have the chat open.
          </p>
        )}
        {list.map((m, i) => {
          const mine = m.sender === me;
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[80%] break-words rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-md bg-[#e9b872]/15 border border-[#e9b872]/30' : 'rounded-bl-md bg-white/5 border border-white/10'}`}>
                {m.content}
              </p>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          sendMessage(t);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="Message"
          aria-label="Message"
          style={{ colorScheme: 'dark', color: '#f1f5f9', backgroundColor: '#06050b' }}
          className="min-w-0 flex-1 rounded-xl border border-white/15 px-3 py-2 text-base placeholder:text-slate-500 focus:border-[#e9b872] focus:outline-none"
        />
        <button type="submit" aria-label="Send" className="rounded-xl bg-[#e9b872] px-3 text-[#1a1208] hover:brightness-110">
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
