import { useCallback, useState } from "react";

export type TileSize = "s" | "m" | "l";

export interface VoiceUi {
  /** How big camera tiles are (remembered on this device). */
  size: TileSize;
  setSize: (s: TileSize) => void;
  /** Whose tile is enlarged right now. */
  pinned: string | null;
  togglePin: (name: string) => void;
  /** The little camera strip over the 3D map can be tucked away. */
  dockHidden: boolean;
  setDockHidden: (h: boolean) => void;
}

const KEY = "iw:voice-ui";

function load(): { size: TileSize; dockHidden: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { size?: string; dockHidden?: boolean };
    return { size: v.size === "s" || v.size === "l" ? v.size : "m", dockHidden: Boolean(v.dockHidden) };
  } catch {
    return { size: "m", dockHidden: false };
  }
}

export function useVoiceUi(): VoiceUi {
  const [prefs, setPrefs] = useState(load);
  const [pinned, setPinned] = useState<string | null>(null);
  const save = (p: { size: TileSize; dockHidden: boolean }) => {
    setPrefs(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: keep it in memory */ }
  };
  const setSize = useCallback((size: TileSize) => save({ ...prefs, size }), [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDockHidden = useCallback((dockHidden: boolean) => save({ ...prefs, dockHidden }), [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePin = useCallback((name: string) => setPinned((p) => (p === name ? null : name)), []);
  return { size: prefs.size, setSize, pinned, togglePin, dockHidden: prefs.dockHidden, setDockHidden };
}
