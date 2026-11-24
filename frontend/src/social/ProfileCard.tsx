import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Loader2, MessageCircle, UserCheck, UserPlus, X } from 'lucide-react';
import { UserAvatar } from '../components/Avatar';
import { getSession, getToken } from '../session';
import { rankFor } from '../game/chain-lab/progress';
import { followUser, getCard, unfollowUser, type PeopleKind, type UserCard } from './socialApi';
import { PeopleList } from './PeopleList';
import { useSocial } from './socialCore';
import './social.css';

const BADGE_LABELS: Record<string, string> = {
  'streak-3': '3-day streak',
  'streak-7': '7-day streak',
  'streak-30': '30-day streak',
};

const BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872]';

/** A count. With `onClick` it opens the list behind it; without, it is just a number. */
function Stat({ n, label, onClick, hint }: { n: number; label: string; onClick?: () => void; hint?: string }) {
  const body = (
    <>
      <div className="text-lg font-semibold text-[#eee9dc]">{n}</div>
      <div className="text-[11px] uppercase tracking-wider text-[#a49fb0]">{label}</div>
    </>
  );
  if (!onClick) {
    return (
      <div className="flex-1 py-3 text-center" title={hint}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${n} ${label}. Show the list`}
      className="flex-1 py-3 text-center transition hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
    >
      {body}
    </button>
  );
}

export function ProfileCard({ name, onClose }: { name: string; onClose: () => void }) {
  const social = useSocial();
  const [card, setCard] = useState<UserCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [list, setList] = useState<PeopleKind | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    getCard(token, name)
      .then((c) => {
        setCard(c);
        setError('');
      })
      .catch((e: Error) => setError(e.message || 'Could not load that profile.'));
  }, [name]);

  useEffect(() => {
    setCard(null);
    setNotice('');
    setList(null);
    load();
  }, [load]);

  // Keep the friend's presence line live while the card is open.
  const live = social.friends.find((f) => f.name === name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice('');
    try {
      await fn();
      social.refreshFriends();
      load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const token = getToken() ?? '';
  const me = getSession()?.username;
  const rank = card ? rankFor(card.xp) : null;
  const presence = card?.is_friend ? (live ?? card.presence) : undefined;
  const canSeeLists = Boolean(card && (card.you || card.is_friend));
  const lockHint = 'Only friends can see this list';

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Profile of ${name}`}
        className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#0d0b16] p-6 text-[#eee9dc] shadow-2xl outline-none"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1 text-[#a49fb0] hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>

        {!card && !error && (
          <div className="grid place-items-center py-16" aria-busy="true">
            <Loader2 className="animate-spin text-[#e9b872]" />
          </div>
        )}
        {error && <p role="alert" className="py-10 text-center text-sm text-[#ffc9c2]">{error}</p>}

        {card && rank && (
          <>
            <div className="flex flex-col items-center text-center">
              <span className="pointer-events-none">
                <UserAvatar name={card.username} size={84} clickable={false} />
              </span>
              <h2 className="iw-display mt-3 text-3xl font-light capitalize">{card.username}</h2>
              <div className="mt-1 text-sm text-[#e9b872]">{rank.title}</div>
              <div className="text-xs text-[#a49fb0]">{card.xp} XP</div>
              <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className="h-full bg-gradient-to-r from-[#e9b872] to-[#9b8cff]" style={{ width: `${Math.round(rank.pct)}%` }} />
              </div>
              {presence && (
                <div className="mt-3 flex items-center gap-2 text-xs text-[#c9c4d2]">
                  <span className={`h-2 w-2 rounded-full ${presence.online ? 'bg-[#5eead4] shadow-[0_0_8px_#5eead4]' : 'bg-white/25'}`} />
                  {!presence.online ? 'Offline' : presence.room ? `In ${presence.room.name}` : 'Online'}
                  {presence.room?.joinable && presence.room.code && (
                    <button
                      type="button"
                      className="rounded-md bg-[#5eead4]/15 px-2 py-0.5 font-semibold text-[#5eead4] hover:bg-[#5eead4]/25"
                      onClick={() => {
                        social.joinRoom(presence.room!.code!);
                        onClose();
                      }}
                    >
                      Join
                    </button>
                  )}
                </div>
              )}
            </div>

            {card.bio && <p className="mt-4 whitespace-pre-line break-words text-center text-sm text-[#c9c4d2]">{card.bio}</p>}

            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <Flame size={16} className={card.streak > 0 ? 'text-[#ff9f4a]' : 'text-white/25'} />
              <span className={card.streak > 0 ? 'text-[#eee9dc]' : 'text-[#a49fb0]'}>
                {card.streak > 0 ? `${card.streak}-day streak` : 'No streak yet'}
              </span>
            </div>

            {card.badges.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {card.badges.map((b) => (
                  <span key={b} className="rounded-full border border-[#e9b872]/30 bg-[#e9b872]/10 px-2.5 py-0.5 text-xs text-[#e9b872]">
                    {BADGE_LABELS[b] ?? b}
                  </span>
                ))}
              </div>
            )}

            {/* The counts are public; the names behind them are for friends (and for you). */}
            <div className="mt-5 flex divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <Stat n={card.followers} label="Followers" onClick={canSeeLists ? () => setList('followers') : undefined} hint={lockHint} />
              <Stat n={card.following} label="Following" onClick={canSeeLists ? () => setList('following') : undefined} hint={lockHint} />
              <Stat n={card.friends} label="Friends" onClick={canSeeLists ? () => setList('friends') : undefined} hint={lockHint} />
            </div>
            {!canSeeLists && <p className="mt-2 text-center text-[11px] text-[#6f6a7c]">Only friends can see who is in these lists.</p>}

            {card.you || card.username === me ? (
              <p className="mt-5 text-center text-xs text-[#a49fb0]">This is you.</p>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={busy || !card.can_dm}
                  title={card.can_dm ? undefined : 'This player is not accepting messages from you'}
                  onClick={() =>
                    void act(async () => {
                      await social.openDM(card.username);
                      onClose();
                    })
                  }
                  className={`${BTN} bg-[#e9b872] text-[#1a1208] hover:brightness-110`}
                >
                  <MessageCircle size={16} /> Chat
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => (card.i_follow ? unfollowUser(token, card.username) : followUser(token, card.username)))}
                  className={`${BTN} border border-white/15 text-[#eee9dc] hover:bg-white/10`}
                >
                  {card.i_follow ? 'Unfollow' : card.follows_me ? 'Follow back' : 'Follow'}
                </button>
                {card.is_friend ? (
                  <span className={`${BTN} cursor-default border border-[#5eead4]/40 text-[#5eead4]`}>
                    <UserCheck size={16} /> Friends
                  </span>
                ) : (
                  <button
                    type="button"
                    // Friends are mutual follows: "Add friend" is a follow that tells them you want to be friends.
                    disabled={busy || card.i_follow}
                    title={card.i_follow ? 'Waiting for them to follow you back' : undefined}
                    onClick={() => void act(() => followUser(token, card.username))}
                    className={`${BTN} border border-[#9b8cff]/50 text-[#c9c1ff] hover:bg-[#9b8cff]/15`}
                  >
                    <UserPlus size={16} /> {card.i_follow ? 'Requested' : 'Add friend'}
                  </button>
                )}
              </div>
            )}
            {notice && <p role="alert" className="mt-3 text-center text-xs text-[#ffc9c2]">{notice}</p>}
          </>
        )}
      </div>
      {list && card && <PeopleList owner={card.username} kind={list} onClose={() => setList(null)} />}
    </div>
  );
}
