import { createContext, useContext } from "react";
import type { VoiceApi } from "./useVoice";

/** Lets a mission (the 3D map) read the room's voice chat without prop-drilling through GameView. */
export const VoiceContext = createContext<VoiceApi | null>(null);
export const useVoiceContext = () => useContext(VoiceContext);
