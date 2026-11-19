import { useSyncExternalStore } from 'react';

/** Sound choices, stored per browser. Volumes are 0 to 1. */
export interface SoundPrefs {
  muted: boolean;
  /** Room and page ambience loops. */
  ambience: number;
  /** Clicks, tones, whooshes and slug voices. */
  effects: number;
}

const KEY = 'iw.sound.v1';
export const DEFAULT_SOUND: SoundPrefs = { muted: false, ambience: 0.5, effects: 0.7 };

const clamp = (n: unknown, fallback: number) => (typeof n === 'number' && n >= 0 && n <= 1 ? n : fallback);

function load(): SoundPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<SoundPrefs>) : {};
    return {
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULT_SOUND.muted,
      ambience: clamp(p.ambience, DEFAULT_SOUND.ambience),
      effects: clamp(p.effects, DEFAULT_SOUND.effects),
    };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

let current: SoundPrefs = load();
const listeners = new Set<() => void>();

export const getSoundPrefs = () => current;

export function setSoundPref<K extends keyof SoundPrefs>(key: K, value: SoundPrefs[K]) {
  current = { ...current, [key]: value }; // a new object each time, so React sees the change
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSoundPrefs(): [SoundPrefs, typeof setSoundPref] {
  return [useSyncExternalStore(subscribeSound, getSoundPrefs, getSoundPrefs), setSoundPref];
}
