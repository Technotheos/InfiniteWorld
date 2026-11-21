import { useEffect, useRef } from "react";
import { Avatar } from "../ui";
import type { PlayerView } from "../types";
import type { VoiceApi } from "./useVoice";
import "./voice.css";

function Feed({ stream, mirror }: { stream: MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    return () => { v.srcObject = null; };
  }, [stream]);
  // Muted on purpose: the sound comes from the Web Audio graph (so it can fade with distance), never from here.
  return <video ref={ref} muted playsInline autoPlay className={mirror ? "mirror" : undefined} />;
}

const MicIcon = ({ off }: { off?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />{off && <path d="M4 4l16 16" />}
  </svg>
);
const CamIcon = ({ off }: { off?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="12" height="12" rx="2.5" /><path d="m15 10 6-3v10l-6-3" />{off && <path d="M3 3l18 18" />}
  </svg>
);

/** Join, mute and camera controls plus a tile for everyone in the room's voice chat. */
export function VoicePanel({ voice, players, you }: { voice: VoiceApi; players: PlayerView[]; you: string }) {
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

  return (
    <section className="rg-card vc" aria-label="Voice and camera">
      <h3 className="rg-h3">Voice &amp; camera</h3>
      {!voice.supported ? (
        <p className="rg-dim rg-small">Voice needs a secure connection (HTTPS or localhost) and a browser with WebRTC.</p>
      ) : !voice.joined ? (
        <>
          <p className="rg-dim rg-small">Talk with the room while you hunt. Voice and video go straight between players and are never recorded or stored by the server. Your browser will ask for permission.</p>
          <button type="button" className="rg-btn small" onClick={() => void voice.join()} disabled={voice.busy || !mine}>
            {voice.busy ? "Joining…" : "Join voice"}
          </button>
          {inVoice.length > 0 && <p className="rg-dim rg-small vc-count">{inVoice.length} in voice now</p>}
        </>
      ) : (
        <>
          <div className="vc-bar">
            <button type="button" className={`vc-btn${voice.mic ? " on" : ""}`} onClick={voice.toggleMic} aria-pressed={voice.mic} title="Mic (M)">
              <MicIcon off={!voice.mic} /><span>{voice.mic ? "Mic on" : "Muted"}</span>
            </button>
            <button type="button" className={`vc-btn${voice.cam ? " on" : ""}`} onClick={() => void voice.toggleCam()} aria-pressed={voice.cam} title="Camera (V)">
              <CamIcon off={!voice.cam} /><span>{voice.cam ? "Cam on" : "Cam off"}</span>
            </button>
            <button type="button" className="vc-btn leave" onClick={voice.leave} title="Leave voice"><span>Leave</span></button>
          </div>
          <ul className="vc-tiles">
            {inVoice.map((p) => {
              const isMe = p.name === you;
              const stream = isMe ? voice.local : voice.remote[p.name];
              const showVideo = Boolean(p.voice?.cam) && Boolean(stream);
              return (
                <li key={p.name} className={`vc-tile${voice.speaking[p.name] ? " talking" : ""}`}>
                  {showVideo && stream ? <Feed stream={stream} mirror={isMe} /> : <span className="vc-av"><Avatar name={p.name} size={44} /></span>}
                  <span className="vc-name">{isMe ? "You" : p.name}</span>
                  {!p.voice?.mic && <span className="vc-mute" title="Muted"><MicIcon off /></span>}
                </li>
              );
            })}
          </ul>
          {voice.error && <p className="rg-warn rg-small" role="status">{voice.error}</p>}
        </>
      )}
      {voice.error && !voice.joined && <p className="rg-warn rg-small" role="status">{voice.error}</p>}
    </section>
  );
}
