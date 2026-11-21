import { Mic, MicOff, Video, VideoOff, PhoneOff, Headphones, ChevronUp, ChevronDown } from "lucide-react";
import type { PlayerView } from "../types";
import type { VoiceApi } from "./useVoice";
import type { VoiceUi } from "./voiceUi";
import { VoiceTile } from "./VoiceTile";
import "./voice.css";

const isTouch = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * The strip of cameras and quick controls that floats over the 3D map, so on a phone you never have to
 * scroll away from the game to mute yourself or see who is talking.
 */
export function VoiceDock({ voice, ui, players, you }: { voice: VoiceApi; ui: VoiceUi; players: PlayerView[]; you: string }) {
  if (!voice.supported) return null;
  const inVoice = players.filter((p) => p.voice?.on && p.connected);
  const pinned = ui.pinned && inVoice.some((p) => p.name === ui.pinned) ? ui.pinned : null;

  if (!voice.joined) {
    return (
      <div className="vd">
        <button type="button" className="vd-join" onClick={() => void voice.join()} disabled={voice.busy}>
          <Headphones size={15} /> {voice.busy ? "Joining…" : voice.canSend ? "Join voice" : "Listen in"}
          {inVoice.length > 0 && <span className="vd-n">{inVoice.length}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="vd" data-size={ui.size}>
      <div className="vd-bar">
        <button type="button" className={`vd-b${voice.mic ? " on" : " off"}`} onClick={voice.toggleMic} aria-pressed={voice.mic} aria-label={voice.mic ? "Mute mic" : "Unmute mic"}>
          {voice.mic ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button type="button" className={`vd-b${voice.cam ? " on" : ""}`} onClick={() => void voice.toggleCam()} aria-pressed={voice.cam} aria-label={voice.cam ? "Camera off" : "Camera on"}>
          {voice.cam ? <Video size={16} /> : <VideoOff size={16} />}
        </button>
        <button type="button" className="vd-b" onClick={() => ui.setDockHidden(!ui.dockHidden)} aria-expanded={!ui.dockHidden} aria-label={ui.dockHidden ? "Show cameras" : "Hide cameras"}>
          {ui.dockHidden ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button type="button" className="vd-b leave" onClick={voice.leave} aria-label="Leave voice"><PhoneOff size={15} /></button>
      </div>
      {voice.audioBlocked && <button type="button" className="vd-tap" onClick={voice.enableAudio}>Tap for sound</button>}
      {!ui.dockHidden && (
        <div className="vd-tiles">
          {inVoice.map((p) => {
            const isMe = p.name === you;
            const stream = isMe ? voice.local : voice.remote[p.name];
            return (
              <VoiceTile key={p.name} variant="dock" name={p.name} isMe={isMe} stream={stream} showVideo={Boolean(p.voice?.cam) && Boolean(stream)}
                micOn={Boolean(p.voice?.mic)} talking={Boolean(voice.speaking[p.name])} pinned={pinned === p.name} onPin={() => ui.togglePin(p.name)}
                volume={voice.userVolumes[p.name] ?? 1} onVolume={(v) => voice.setUserVolume(p.name, v)}
                onFlip={isTouch() ? () => void voice.flipCamera() : undefined} />
            );
          })}
        </div>
      )}
    </div>
  );
}
