import { createContext, useContext } from 'react';
import type { Friend } from './socialApi';

export interface DMInvite {
  from: string;
  room_id: string;
}

export interface SocialApi {
  friends: Friend[];
  /** Players per game map id. Missing means nobody. */
  counts: Record<string, number>;
  /** Open the profile card of any player. */
  openCard: (name: string) => void;
  /** Open a direct message drawer. Rejects with the server's message if not allowed. */
  openDM: (name: string) => Promise<void>;
  refreshFriends: () => void;
  /** App registers how to jump into a room by code (the "Join" shortcut). */
  setJoinHandler: (fn: ((code: string) => void) | null) => void;
  joinRoom: (code: string) => void;
  invite: DMInvite | null;
  dismissInvite: () => void;
}

export const Ctx = createContext<SocialApi | null>(null);

/** Null outside the provider (dev previews, tests): callers simply skip the social bits. */
export const useSocialOptional = () => useContext(Ctx);

export function useSocial(): SocialApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside <SocialProvider>');
  return v;
}

