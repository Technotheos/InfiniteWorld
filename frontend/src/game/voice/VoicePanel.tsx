import { useEffect } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";
import type { PlayerView } from "../types";
import type { VoiceApi, CamQuality } from "./useVoice";
import type { VoiceUi, TileSize } from "./voiceUi";
import { VoiceTile } from "./VoiceTile";
import "./voice.css";

const SIZES: { id: TileSize; label: string }[] = [{ id: "s", label: "S" }, { id: "m", label: "M" }, { id: "l", label: "L" }];
const QUALITIES: { id: CamQuality; label: string }[] = [{ id: "low", label: "Low" }, { id: "med", label: "Medium" }, { id: "high", label: "High" }];
const isTouch = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Join, mute and camera controls plus a tile for everyone in the room's voice chat. */
export function VoicePanel({ voice, ui, players, you }: { voice: VoiceApi; ui: VoiceUi; players: PlayerView[]; you: string }) {
  const inVoice = players.filter((p) => p.voice?.on && p.connected);
  const mine = players.find((p) => p.name === you);

  // M toggles the mic, V the camera (never while typing)
  useEffect(() => {
    if (!voice.joined) return;
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
      if (e.key.toLowerCase() === "m") voice.toggleMic();
      if (e.key.toLowerCase() === "v") void voice.toggleCam();
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [voice]);

  const pinned = ui.pinned && inVoice.some((p) => p.name === ui.pinned) ? ui.pinned : null;

  const tile = (p: PlayerView, variant: "panel" | "dock" = "panel") => {
    const isMe = p.name === you;
    const stream = isMe ? voice.local : voice.remote[p.name];
    return (
      <VoiceTile key={p.name} name={p.name} isMe={isMe} stream={stream} showVideo={Boolean(p.voice?.cam) && Boolean(stream)}
        micOn={Boolean(p.voice?.mic)} talking={Boolean(voice.speaking[p.name])} pinned={pinned === p.name} onPin={() => ui.togglePin(p.name)}
        volume={voice.userVolumes[p.name] ?? 1} onVolume={(v) => voice.setUserVolume(p.name, v)}
        onFlip={isTouch() ? () => void voice.flipCamera() : undefined} variant={variant} />
    );
  };

  return (
    <section className="rg-card vc" aria-label="Voice and camera">
      <div className="vc-head">
        <h3 className="rg-h3">Voice &amp; camera</h3>
        {voice.joined && (
          <div className="vc-seg" role="group" aria-label="Camera size">
            {SIZES.map((s) => (
              <button key={s.id} type="button" className={ui.size === s.id ? "on" : ""} aria-pressed={ui.size === s.id} onClick={() => ui.setSize(s.id)}>{s.label}</button>
            ))}
          </div>
        )}
      </div>

      {!voice.supported ? (
        <p className="rg-dim rg-small">Voice needs a browser with WebRTC.</p>
      ) : !voice.joined ? (
        <>
          <p className="rg-dim rg-small">Talk with the room while you hunt. Voice and video go straight between players and are never recorded or stored by the server. Your browser will ask for permission.</p>
          {!voice.canSend && <p className="rg-warn rg-small">This page is not on HTTPS, so your mic and camera are blocked. You can still join to listen and watch.</p>}
          <button type="button" className="rg-btn small" onClick={() => void voice.join()} disabled={voice.busy || !mine}>
            {voice.busy ? "Joining…" : voice.canSend ? "Join voice" : "Join to listen"}
          </button>
          {inVoice.length > 0 && <p className="rg-dim rg-small vc-count">{inVoice.length} in voice now</p>}
        </>
      ) : (
        <>
          <div className="vc-bar">
            <button type="button" className={`vc-btn${voice.mic ? " on" : ""}`} onClick={voice.toggleMic} aria-pressed={voice.mic} title="Mic (M)">
              {voice.mic ? <Mic size={16} /> : <MicOff size={16} />}<span>{voice.mic ? "Mic on" : "Muted"}</span>
            </button>
            <button type="button" className={`vc-btn${voice.cam ? " on" : ""}`} onClick={() => void voice.toggleCam()} aria-pressed={voice.cam} title="Camera (V)">
              {voice.cam ? <Video size={16} /> : <VideoOff size={16} />}<span>{voice.cam ? "Cam on" : "Cam off"}</span>
            </button>
            {voice.cam && isTouch() && (
              <button type="button" className="vc-btn" onClick={() => void voice.flipCamera()} title="Switch camera"><SwitchCamera size={16} /><span>Flip</span></button>
            )}
            <button type="button" className="vc-btn leave" onClick={voice.leave} title="Leave voice"><PhoneOff size={16} /><span>Leave</span></button>
          </div>

          {voice.cam && (
            <label className="vc-q">
              <span className="rg-dim rg-small">Your camera quality</span>
              <select value={voice.camQuality} onChange={(e) => voice.setCamQuality(e.target.value as CamQuality)} aria-label="Camera quality">
                {QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
              </select>
            </label>
          )}

          {voice.audioBlocked && (
            <button type="button" className="vc-tap" onClick={voice.enableAudio}>Tap to turn the sound on</button>
          )}

          {pinned && <div className="vc-spot">{inVoice.filter((p) => p.name === pinned).map((p) => tile(p))}</div>}
          <ul className="vc-tiles" data-size={ui.size}>
            {inVoice.filter((p) => p.name !== pinned).map((p) => <li key={p.name}>{tile(p)}</li>)}
          </ul>
          {!voice.canSend && <p className="rg-dim rg-small">Listening only: this page is not on HTTPS.</p>}
          {voice.error && <p className="rg-warn rg-small" role="status">{voice.error}</p>}
        </>
      )}
      {voice.error && !voice.joined && <p className="rg-warn rg-small" role="status">{voice.error}</p>}
    </section>
  );
}
