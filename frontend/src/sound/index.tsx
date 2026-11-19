import { useEffect } from 'react';
import { requestAmbience } from './engine';

export { initSound, sfx, slugSound, unlockSound } from './engine';
export type { Sfx, SlugSound, SlugVoiceId } from './engine';
export { useSoundPrefs } from './prefs';

/** Plays the ambience loop for `scene` while it is on screen. Renders nothing. */
export function Ambient({ scene }: { scene: string }) {
  useEffect(() => requestAmbience(scene), [scene]);
  return null;
}
