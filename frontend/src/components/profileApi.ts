import { API_URL, readError } from './authApi';
import { getToken, refreshSession } from '../session';

export interface Profile {
  username: string;
  bio: string;
  created_at: string;
  /** 0 when the user has no picture; otherwise changes whenever it does. */
  avatar_version: number;
  /** ISO time; present only while a username change is on cooldown. */
  username_change_available_at?: string;
  role: 'user' | 'moderator' | 'admin';
  permissions: string[];
}

export interface SessionInfo {
  id: string;
  started_at: string;
  last_used: string;
  user_agent: string;
  ip: string;
  current: boolean;
}

/** Thrown for 401s so the app can log the user out instead of showing an error. */
export class AuthExpiredError extends Error {}

/** Any other non-2xx answer, with the HTTP status for callers that care (404, 403...). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Authenticated JSON request. On a 401 it asks the session layer for a fresh
 * access token once and retries, so an expired 15-minute token never surfaces
 * as an error. Cookies are included so Set-Cookie (new refresh token) works.
 */
export async function apiRequest<T>(path: string, token: string, init: RequestInit, fallback: string): Promise<T> {
  const send = (tok: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { Authorization: `Bearer ${tok}`, ...(init.headers ?? {}) },
    });

  let res = await send(getToken() ?? token);
  if (res.status === 401 && (await refreshSession())) {
    res = await send(getToken() ?? token);
  }
  if (res.status === 401) throw new AuthExpiredError('Your session has expired.');
  if (!res.ok) throw new ApiError(await readError(res, fallback), res.status);
  return (await res.json().catch(() => ({}))) as T;
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

export const getMe = (token: string) =>
  apiRequest<Profile>('/api/me', token, { method: 'GET' }, 'Could not load your profile.');

export const saveBio = (token: string, bio: string) =>
  apiRequest<{ bio: string }>('/api/me/profile', token, form({ bio }), 'Could not save your bio.');

export const uploadAvatar = (token: string, jpeg: Blob) =>
  apiRequest<{ avatar_version: number }>(
    '/api/me/avatar',
    token,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg },
    'Could not upload your picture.',
  );

export const removeAvatar = (token: string) =>
  apiRequest<{ avatar_version: number }>('/api/me/avatar/remove', token, { method: 'POST' }, 'Could not remove your picture.');

interface TokenResponse {
  token: string;
  username: string;
  expires_in: number;
}

export const changeUsername = (token: string, username: string, password: string) =>
  apiRequest<TokenResponse>('/api/me/username', token, form({ username, password }), 'Could not change your username.');

/** Changing the password signs out every other device; this one gets a fresh token. */
export const changePassword = (token: string, current_password: string, new_password: string) =>
  apiRequest<TokenResponse & { message: string }>(
    '/api/me/password',
    token,
    form({ current_password, new_password }),
    'Could not change your password.',
  );

export const listSessions = (token: string) =>
  apiRequest<{ sessions: SessionInfo[] }>('/api/auth/sessions', token, { method: 'GET' }, 'Could not load your devices.');

export const revokeSession = (token: string, id: string) =>
  apiRequest<{ ok: boolean }>('/api/auth/sessions/revoke', token, form({ id }), 'Could not sign that device out.');

export const logoutEverywhere = (token: string) =>
  apiRequest<{ ok: boolean }>('/api/auth/logout-all', token, { method: 'POST' }, 'Could not sign out of all devices.');

/** Public picture URL. `version` busts the cache when the picture changes. */
export const avatarUrl = (username: string, version: number) =>
  version > 0 ? `${API_URL}/api/avatar/${encodeURIComponent(username)}?v=${version}` : null;

/** Mirrors the server's username rule (usernames are lower-cased). */
export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 12;
export const MAX_BIO = 160;
