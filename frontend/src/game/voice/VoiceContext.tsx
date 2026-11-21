import { createContext, useContext } from "react";
import type { VoiceApi } from "./useVoice";
import type { VoiceUi } from "./voiceUi";

export interface VoiceCtx {
  voice: VoiceApi;
  ui: VoiceUi;
}

/** Lets a mission (the 3D map) read the room's voice chat without prop-drilling through GameView. */
export const VoiceContext = createContext<VoiceCtx | null>(null);
export const useVoiceContext = () => useContext(VoiceContext);
