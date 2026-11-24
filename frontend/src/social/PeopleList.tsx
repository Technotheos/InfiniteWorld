import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { UserAvatar } from '../components/Avatar';
import { getSession, getToken } from '../session';
import { getPeople, type PeopleKind } from './socialApi';
import { useSocial } from './socialCore';
import './social.css';

const TITLE: Record<PeopleKind, string> = { followers: 'Followers', following: 'Following', friends: 'Friends' };
const EMPTY: Record<PeopleKind, string> = {
  followers: 'No followers yet.',
  following: 'Not following anyone yet.',
  friends: 'No friends yet. Friends are people you follow who follow you back.',
};

/**
 * A dialog with the followers / following / friends of `owner`.
 * The server only answers for yourself and your friends; anyone else gets a message instead.
 * Tapping a person closes the dialog and opens their profile card.
 */
export function PeopleList({ owner, kind, onClose }: { owner: string; kind: PeopleKind; onClose: () => void }) {
  const social = useSocial();
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const mine = getSession()?.username === owner;

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setNames(null);
    setError('');
    getPeople(token, owner, kind)
      .then((r) => !cancelled && setNames(r.users ?? []))
      .catch((e: Error) => !cancelled && setError(e.message || 'Could not load that list.'));
    return () => {
      cancelled = true;
    };
  }, [owner, kind]);

  // Escape closes only this dialog, not the profile card underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const online = new Set(social.friends.filter((f) => f.online).map((f) => f.name));

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${TITLE[kind]}${mine ? '' : ` of ${owner}`}`}
        className="relative flex max-h-[80vh] w-full max-w-sm flex-col rounded-3xl border border-white/10 bg-[#0d0b16] p-5 text-[#eee9dc] shadow-2xl outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1 text-[#a49fb0] hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
        <h2 className="iw-display text-2xl font-light">{TITLE[kind]}</h2>
        {!mine && <p className="mt-0.5 text-xs capitalize text-[#a49fb0]">{owner}</p>}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {!names && !error && (
            <div className="grid place-items-center py-10" aria-busy="true">
              <Loader2 className="animate-spin text-[#e9b872]" />
            </div>
          )}
          {error && (
            <p role="alert" className="py-8 text-center text-sm text-[#ffc9c2]">
              {error}
            </p>
          )}
          {names && names.length === 0 && <p className="py-8 text-center text-sm text-[#a49fb0]">{EMPTY[kind]}</p>}
          {names && names.length > 0 && (
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/10">
              {names.map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      social.openCard(n);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                  >
                    <span className="relative pointer-events-none">
                      <UserAvatar name={n} size={34} clickable={false} />
                      {online.has(n) && (
                        <span
                          aria-label="Online"
                          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d0b16] bg-[#5eead4]"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold capitalize">{n}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
