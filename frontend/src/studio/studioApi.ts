import { API_URL, WS_URL } from '../components/authApi';
import { getToken } from '../session';

/* -------------------------------------------------------------------------- */
/*  Wire types (match backend-go/studio_room.go)                              */
/* -------------------------------------------------------------------------- */

export type StudioRole = 'host' | 'producer' | 'listener';
export type RecState = 'idle' | 'recording' | 'ready';

export interface StudioMember {
  name: string;
  role: StudioRole;
  color: number;
  connected: boolean;
  rec: RecState;
  muted: boolean;
  voice?: { on: boolean; mic: boolean; cam: boolean };
}

export interface StudioTake {
  id: string;
  by: string;
  kind: 'take' | 'track';
  title: string;
  start_beat: number;
  len_beats: number;
  dur_ms: number;
  at: number;
  published: boolean;
  need?: string[];
  agreed?: string[];
}

export interface QueueItem {
  id: string;
  src: string;
  title: string;
  by: string;
}

export interface NowPlaying {
  id: string;
  src: string;
  title: string;
  by: string;
  since: number;
  len: number;
}

export interface StudioChatMsg {
  id: number;
  from: string;
  text: string;
  at: number;
}

export interface StudioState {
  code: string;
  you: string;
  role: StudioRole;
  host: string;
  public: boolean;
  invite_only: boolean;
  friends_only: boolean;
  locked: boolean;
  held: boolean;
  held_by: string[];
  bpm: number;
  epoch: number;
  offset: number;
  playing: boolean;
  now: number;
  members: StudioMember[];
  owners: string[];
  /** -1 empty, 0 starter pad, n = owners[n-1] */
  grid: number[][];
  /** 0 where the pad is off, else 1..127 */
  vel: number[][];
  /** kit id per track; '' for the synth tracks (bass, lead) */
  kits: string[];
  /** fader per track, 0..100 */
  vol: number[];
  mute: boolean[];
  /** percent: 50 straight, 66 triplet feel */
  swing: number;
  queue: QueueItem[];
  now_playing?: NowPlaying;
  takes: StudioTake[];
  chat: StudioChatMsg[];
  invited?: string[];
  tracks: number;
  steps: number;
}

export type StudioSend = (type: string, payload?: unknown) => void;

/* -------------------------------------------------------------------------- */
/*  HTTP                                                                      */
/* -------------------------------------------------------------------------- */

async function call<T>(path: string, form?: Record<string, string>): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: form ? 'POST' : 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const createStudio = async (isPrivate: boolean) =>
  (await call<{ code: string }>('/api/studio/rooms', { private: isPrivate ? '1' : '0' })).code;

export const quickStudio = async () => (await call<{ code: string }>('/api/studio/quick', {})).code;

export const studioTicket = async (code: string) => (await call<{ ticket: string }>('/api/studio/join', { code })).ticket;

export interface IceConfig {
  servers: RTCIceServer[];
  relay_available: boolean;
}

export const studioIce = async (): Promise<IceConfig> => {
  const r = await call<{ servers?: RTCIceServer[]; relay_available?: boolean }>('/api/studio/ice');
  return { servers: r.servers ?? [], relay_available: Boolean(r.relay_available) };
};

export interface Invite {
  from: string;
  code: string;
}

export const studioInvites = async (): Promise<Invite[]> => (await call<{ invites: Invite[] }>('/api/studio/invites')).invites ?? [];

export interface PublishedTrack {
  id: string;
  title: string;
  owner: string;
  contributors: string[];
  dur_ms: number;
}

export const publishedTracks = async (): Promise<PublishedTrack[]> =>
  (await call<{ tracks: PublishedTrack[] }>('/api/studio/published')).tracks ?? [];

export const reportItem = (id: string, reason: 'copyright' | 'abuse' | 'other', detail: string) =>
  call<{ ok: boolean }>('/api/studio/report', { id, reason, detail });

/** Short-lived signed URL. Membership is checked again when the bytes are fetched. */
export async function fetchAudio(id: string): Promise<ArrayBuffer> {
  const { url } = await call<{ url: string }>(`/api/studio/media-url?id=${encodeURIComponent(id)}`);
  const res = await fetch(`${API_URL}${url}`);
  if (!res.ok) throw new Error('Could not load that audio.');
  return res.arrayBuffer();
}

export function studioWsUrl(code: string): string {
  return `${WS_URL}/ws/studio?room=${encodeURIComponent(code)}`;
}

/** Upload with progress (fetch cannot report upload progress). Fields go first, the file last. */
export function uploadAudio(opts: {
  room: string;
  kind: 'take' | 'track';
  title: string;
  file: Blob;
  onProgress?: (fraction: number) => void;
}): Promise<{ id: string; dur_ms: number }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('room', opts.room);
    fd.append('kind', opts.kind);
    fd.append('title', opts.title);
    fd.append('declare', '1'); // the copyright declaration the person ticked
    fd.append('file', opts.file, 'upload'); // the server never uses this name
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/studio/upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection.'));
    xhr.onload = () => {
      let data: { error?: string; id?: string; dur_ms?: number } = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve({ id: data.id, dur_ms: data.dur_ms ?? 0 });
      else reject(new Error(data.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.send(fd);
  });
}

/* -------------------------------------------------------------------------- */
/*  Colours: one per producer, used for pads, trails and ribbons               */
/* -------------------------------------------------------------------------- */

export const PRODUCER_COLORS = ['#e9b872', '#9b8cff', '#5eead4', '#f472b6', '#7dd3fc', '#fbbf24', '#a3e635', '#fb7185'];
export const colorOf = (i: number) => PRODUCER_COLORS[((i % 8) + 8) % 8]!;
