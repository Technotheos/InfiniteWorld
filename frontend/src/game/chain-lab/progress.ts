/** Mission progress, stored per browser. Shared by the room and the Home hub. */
export const STORAGE_KEY = 'iw.missions.v1';

/** mission id -> XP earned */
export type Progress = Record<string, number>;

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Progress) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress simply won't persist */
  }
}

export const totalXp = (p: Progress) => Object.values(p).reduce((a, b) => a + b, 0);

export const RANKS = [
  { at: 0, title: 'Stargazer' },
  { at: 100, title: 'Navigator' },
  { at: 300, title: 'Cartographer' },
  { at: 600, title: 'Astronomer' },
];

export function rankFor(xp: number) {
  let i = 0;
  RANKS.forEach((r, idx) => {
    if (xp >= r.at) i = idx;
  });
  const next = RANKS[i + 1] ?? null;
  const pct = next ? ((xp - RANKS[i].at) / (next.at - RANKS[i].at)) * 100 : 100;
  return { title: RANKS[i].title, next, pct };
}
