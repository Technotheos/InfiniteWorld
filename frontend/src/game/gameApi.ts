import type { MapInfo } from "./types";

// Point these at your Go server. If VITE_API_URL is empty, same-origin is used.
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function wsUrl(code: string): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  const base = explicit ?? (API || window.location.origin).replace(/^http/, "ws");
  return `${base}/ws/game?room=${encodeURIComponent(code)}`;
}

async function call<T>(path: string, token: string | null, form?: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function listMaps(): Promise<MapInfo[]> {
  return (await call<{ maps: MapInfo[] }>("/api/maps", null)).maps;
}

/** Join (or open) a public lobby for this map. Returns the room code. */
export async function quickPlay(token: string, map: string): Promise<string> {
  return (await call<{ code: string }>("/api/rooms/quick", token, { map })).code;
}

/** Create a room. Private rooms are only reachable by code. */
export async function createRoom(token: string, map: string, isPrivate: boolean): Promise<string> {
  return (await call<{ code: string }>("/api/rooms", token, { map, private: isPrivate ? "1" : "0" })).code;
}
