import { API_URL } from './components/authApi';

/**
 * Login session, held in MEMORY only.
 *
 * - The short-lived access token lives in a module variable. It is never written
 *   to localStorage, so a script injected into the page cannot read it later.
 * - The long-lived credential is an HttpOnly cookie the browser keeps and
 *   JavaScript can never see. On page load we ask the server to trade that
 *   cookie for a fresh access token (refreshSession), which is how "stay signed
 *   in" works.
 */
export interface Session {
  token: string;
  username: string;
  /** epoch ms */
  expiresAt: number;
}

type Listener = (s: Session | null) => void;

let session: Session | null = null;
let timer: number | undefined;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const getSession = (): Session | null => session;
export const getToken = (): string | null => session?.token ?? null;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((l) => l(session));
}

/** Refresh a minute before expiry (but never in a tight loop). */
function schedule(retryInMs?: number) {
  window.clearTimeout(timer);
  if (!session) return;
  const wait = retryInMs ?? Math.max(5_000, session.expiresAt - Date.now() - 60_000);
  timer = window.setTimeout(() => void refreshSession(), wait);
}

export function setSession(token: string, username: string, expiresInSeconds: number): void {
  session = { token, username, expiresAt: Date.now() + expiresInSeconds * 1000 };
  schedule();
  emit();
}

export function clearSession(): void {
  window.clearTimeout(timer);
  if (session === null) return;
  session = null;
  emit();
}

/**
 * Trade the refresh cookie for a new access token. Concurrent callers share one
 * request. Resolves true when a session is (still) active afterwards.
 */
export function refreshSession(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      } catch {
        // Server unreachable: keep what we have and try again shortly.
        if (session) schedule(15_000);
        return session !== null;
      }
      if (res.status === 409 && attempt === 0) {
        await sleep(600); // another tab just rotated the cookie; use the new one
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        clearSession(); // the server says this session is over
        return false;
      }
      if (!res.ok) {
        if (session) schedule(15_000);
        return session !== null;
      }
      const d = (await res.json().catch(() => null)) as { token?: string; username?: string; expires_in?: number } | null;
      if (!d || typeof d.token !== 'string' || typeof d.username !== 'string') return session !== null;
      setSession(d.token, d.username, typeof d.expires_in === 'number' ? d.expires_in : 900);
      return true;
    }
    return session !== null;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Ends this device's session on the server (the cookie is cleared by the response). */
export async function logoutRemote(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* offline: the local session is cleared regardless */
  }
}

// A throttled background tab may have slept past expiry: check when it wakes.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session && session.expiresAt - Date.now() < 90_000) {
      void refreshSession();
    }
  });
}
