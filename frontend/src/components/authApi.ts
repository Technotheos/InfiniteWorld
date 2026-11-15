// Set VITE_API_URL in a .env file for other environments, e.g.
//   VITE_API_URL=https://api.example.com
export const API_URL: string =
  (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:8080';

/** Base URL for WebSockets: VITE_WS_URL, else the API address with ws:// or wss://. */
export const WS_URL: string =
  (import.meta as any).env?.VITE_WS_URL ?? API_URL.replace(/^http/, 'ws');

/**
 * Turns a failed response into a user-friendly message.
 * The backend returns {"error": "..."}; fall back to status-based text
 * if the body isn't JSON (proxy errors, crashes, etc.).
 */
export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string' && data.error) return data.error;
  } catch {
    /* not JSON, use fallbacks below */
  }
  if (res.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (res.status >= 500) return 'The server had a problem. Please try again shortly.';
  return fallback;
}

/** True when fetch itself failed (server down, CORS blocked, offline). */
export const isNetworkError = (err: unknown): boolean => err instanceof TypeError;