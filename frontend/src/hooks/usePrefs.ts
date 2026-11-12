import { useCallback, useState } from 'react';

/** Visual preferences, stored per browser. */
export interface Prefs {
  /** Animated starfield behind every screen. */
  starfield: boolean;
  /** The hyperspace jump when entering a room. */
  warp: boolean;
  /** Slow drifting nebula, rotating rings and pulses. */
  ambient: boolean;
}

const KEY = 'iw.prefs.v1';
export const DEFAULT_PREFS: Prefs = { starfield: true, warp: true, ambient: true };

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return {
      starfield: typeof parsed.starfield === 'boolean' ? parsed.starfield : DEFAULT_PREFS.starfield,
      warp: typeof parsed.warp === 'boolean' ? parsed.warp : DEFAULT_PREFS.warp,
      ambient: typeof parsed.ambient === 'boolean' ? parsed.ambient : DEFAULT_PREFS.ambient,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function usePrefs(): [Prefs, <K extends keyof Prefs>(key: K, value: Prefs[K]) => void] {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      return next;
    });
  }, []);
  return [prefs, set];
}
