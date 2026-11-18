import { apiRequest } from '../components/profileApi';

export type Policy = 'everyone' | 'friends' | 'nobody';

export interface RoomRef {
  /** Empty for private rooms: the server never reveals their code. */
  code?: string;
  map: string;
  name: string;
  /** True when the room is public, so a "Join" shortcut makes sense. */
  joinable: boolean;
}

export interface Friend {
  name: string;
  online: boolean;
  room?: RoomRef;
}

export interface UserCard {
  username: string;
  bio: string;
  created_at: string;
  avatar_version: number;
  xp: number;
  streak: number;
  badges: string[];
  followers: number;
  following: number;
  friends: number;
  you: boolean;
  // Only present when looking at someone else:
  i_follow?: boolean;
  follows_me?: boolean;
  is_friend?: boolean;
  can_dm?: boolean;
  /** Only present for friends. */
  presence?: Friend;
}

export interface Privacy {
  hide_presence: boolean;
  dm: Policy;
  find: Policy;
}

export interface Relation {
  i_follow: boolean;
  follows_me: boolean;
  is_friend: boolean;
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

export const getCard = (token: string, name: string) =>
  apiRequest<UserCard>(`/api/user?name=${encodeURIComponent(name)}`, token, { method: 'GET' }, 'Could not load that profile.');

export const followUser = (token: string, username: string) =>
  apiRequest<Relation>('/api/follow', token, form({ username }), 'Could not follow that player.');

export const unfollowUser = (token: string, username: string) =>
  apiRequest<Relation>('/api/unfollow', token, form({ username }), 'Could not unfollow that player.');

export const getFriends = (token: string) =>
  apiRequest<{ friends: Friend[] }>('/api/me/friends', token, { method: 'GET' }, 'Could not load your friends.');

export const getPrivacy = (token: string) =>
  apiRequest<Privacy>('/api/me/privacy', token, { method: 'GET' }, 'Could not load your privacy settings.');

/** Send only the fields that changed. */
export const savePrivacy = (token: string, patch: Partial<Privacy>) => {
  const f: Record<string, string> = {};
  if (patch.hide_presence !== undefined) f.hide_presence = patch.hide_presence ? '1' : '0';
  if (patch.dm) f.dm = patch.dm;
  if (patch.find) f.find = patch.find;
  return apiRequest<Privacy>('/api/me/privacy', token, form(f), 'Could not save your privacy settings.');
};

export const searchUsers = (token: string, q: string) =>
  apiRequest<{ users: string[] }>(`/api/users/search?q=${encodeURIComponent(q)}`, token, { method: 'GET' }, 'Search failed.');

export const openDM = (token: string, username: string) =>
  apiRequest<{ room_id: string; with: string }>('/api/dm/open', token, form({ username }), 'Could not open that chat.');
