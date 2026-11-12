import { API_URL, readError } from './authApi';

export interface Profile {
  username: string;
  bio: string;
  created_at: string;
  /** 0 when the user has no picture; otherwise changes whenever it does. */
  avatar_version: number;
  /** ISO time; present only while a username change is on cooldown. */
  username_change_available_at?: string;
}

/** Thrown for 401s so the app can log the user out instead of showing an error. */
export class AuthExpiredError extends Error {}

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function request<T>(path: string, token: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeader(token), ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new AuthExpiredError('Your session has expired.');
  if (!res.ok) throw new Error(await readError(res, fallback));
  return (await res.json().catch(() => ({}))) as T;
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

export const getMe = (token: string) =>
  request<Profile>('/api/me', token, { method: 'GET' }, 'Could not load your profile.');

export const saveBio = (token: string, bio: string) =>
  request<{ bio: string }>('/api/me/profile', token, form({ bio }), 'Could not save your bio.');

export const uploadAvatar = (token: string, jpeg: Blob) =>
  request<{ avatar_version: number }>(
    '/api/me/avatar',
    token,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg },
    'Could not upload your picture.',
  );

export const removeAvatar = (token: string) =>
  request<{ avatar_version: number }>('/api/me/avatar/remove', token, { method: 'POST' }, 'Could not remove your picture.');

export const changeUsername = (token: string, username: string, password: string) =>
  request<{ token: string; username: string; expires_in: number }>(
    '/api/me/username',
    token,
    form({ username, password }),
    'Could not change your username.',
  );

export const changePassword = (token: string, current_password: string, new_password: string) =>
  request<{ message: string }>(
    '/api/me/password',
    token,
    form({ current_password, new_password }),
    'Could not change your password.',
  );

/** Public picture URL. `version` busts the cache when the picture changes. */
export const avatarUrl = (username: string, version: number) =>
  version > 0 ? `${API_URL}/api/avatar/${encodeURIComponent(username)}?v=${version}` : null;

/** Mirrors the server's username rule (usernames are lower-cased). */
export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 12;
export const MAX_BIO = 160;
