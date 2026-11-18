import { useEffect, useState } from 'react';
import { MessageCircle, Search } from 'lucide-react';
import { UserAvatar } from '../components/Avatar';
import { getToken } from '../session';
import { searchUsers } from './socialApi';
import { useSocial } from './socialCore';
import { UserName } from './UserName';
import './social.css';

/** Friends with live presence (friends only), plus a small "find a player" box. */
export function FriendsPanel() {
  const social = useSocial();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<string[]>([]);
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    const term = q.trim().toLowerCase();
    const token = getToken();
    if (term.length < 2 || !token) {
      setFound([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchUsers(token, term)
        .then((r) => !cancelled && setFound(r.users))
        .catch(() => !cancelled && setFound([]));
    }, 250); // wait for a pause in typing
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const online = social.friends.filter((f) => f.online).length;

  return (
    <section aria-label="Friends" className="space-y-4">
      <div>
        <div className="font-mono text-[11px] tracking-[0.25em] text-[#5eead4]">// CREW</div>
        <h3 className="iw-display mt-1 text-3xl font-light">Friends</h3>
        <p className="mt-1 text-sm text-[#a49fb0]">
          Follow someone and, when they follow you back, you become friends. Only friends can see when you are online.
        </p>
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#0d0b16]/75 p-4 backdrop-blur-md">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#a49fb0]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a player by name"
            aria-label="Find a player by name"
            autoComplete="off"
            maxLength={32}
            style={{ colorScheme: 'dark', color: '#f1f5f9', backgroundColor: '#06050b' }}
            className="w-full rounded-xl border border-white/10 py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 focus:border-[#e9b872]/60 focus:outline-none"
          />
        </label>
        {found.length > 0 && (
          <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10">
            {found.map((n) => (
              <li key={n} className="flex items-center gap-3 px-3 py-2">
                <UserAvatar name={n} size={28} />
                <UserName name={n} className="text-sm capitalize" />
              </li>
            ))}
          </ul>
        )}

        {chatError && <p role="alert" className="mt-3 text-xs text-[#ffc9c2]">{chatError}</p>}

        {social.friends.length === 0 ? (
          <p className="mt-4 text-sm text-[#a49fb0]">
            No friends yet. Tap any avatar or name in a room to see a profile and follow them.
          </p>
        ) : (
          <>
            <p className="mt-4 text-xs text-[#a49fb0]">{online} online</p>
            <ul className="mt-2 space-y-1">
              {social.friends.map((f) => (
                <li key={f.name} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
                  <span className="relative">
                    <UserAvatar name={f.name} size={36} />
                    <span
                      aria-label={f.online ? 'Online' : 'Offline'}
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d0b16] ${f.online ? 'bg-[#5eead4]' : 'bg-white/25'}`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <UserName name={f.name} className="block truncate text-sm font-semibold capitalize" />
                    <div className="truncate text-xs text-[#a49fb0]">
                      {!f.online ? 'Offline' : f.room ? `In ${f.room.name}${f.room.joinable ? '' : ' (private)'}` : 'Online'}
                    </div>
                  </div>
                  {f.room?.joinable && f.room.code && (
                    <button
                      type="button"
                      onClick={() => social.joinRoom(f.room!.code!)}
                      className="rounded-lg bg-[#5eead4]/15 px-3 py-1 text-xs font-semibold text-[#5eead4] hover:bg-[#5eead4]/25"
                    >
                      Join
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Chat with ${f.name}`}
                    onClick={() => {
                      setChatError('');
                      social.openDM(f.name).catch((e: Error) => setChatError(e.message));
                    }}
                    className="rounded-lg p-2 text-[#a49fb0] hover:bg-white/10 hover:text-[#e9b872]"
                  >
                    <MessageCircle size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
