import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Volume2, VolumeX, SwitchCamera, Expand } from "lucide-react";
import { Avatar } from "../ui";

function Feed({ stream, mirror, videoRef }: { stream: MediaStream; mirror?: boolean; videoRef: React.RefObject<HTMLVideoElement> }) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
    return () => { v.srcObject = null; };
  }, [stream, videoRef]);
  // Muted on purpose: sound comes from the audio path in useVoice, never from here.
  return <video ref={videoRef} muted playsInline autoPlay className={mirror ? "mirror" : undefined} />;
}

interface Props {
  name: string;
  isMe: boolean;
  stream?: MediaStream | null;
  showVideo: boolean;
  micOn: boolean;
  talking: boolean;
  pinned: boolean;
  onPin: () => void;
  /** Remote tiles: the listener's own volume for this person, 0..1. */
  volume?: number;
  onVolume?: (v: number) => void;
  /** Local tile, phones: switch front/back camera. */
  onFlip?: () => void;
  /** "dock" is the strip over the 3D map: tighter controls. */
  variant?: "panel" | "dock";
}

/** One person in the voice chat: their camera (or avatar), a talking ring, and the controls for it. */
export function VoiceTile({ name, isMe, stream, showVideo, micOn, talking, pinned, onPin, volume = 1, onVolume, onFlip, variant = "panel" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const fullscreen = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (el.requestFullscreen) { void el.requestFullscreen().catch(() => undefined); return; }
    // iPhone Safari can only fullscreen a <video>
    (vid.current as unknown as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
  };

  return (
    <div ref={box} className={`vt vt-${variant}${talking ? " talking" : ""}${pinned ? " pinned" : ""}${full ? " full" : ""}`} onClick={onPin}>
      {showVideo && stream ? <Feed stream={stream} mirror={isMe} videoRef={vid} /> : <span className="vt-av"><Avatar name={name} size={variant === "dock" ? 34 : 48} /></span>}
      <span className="vt-name">{isMe ? "You" : name}</span>
      {!micOn && <span className="vt-mute" title="Muted"><VolumeX size={13} /></span>}
      <div className="vt-ctl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onPin} aria-pressed={pinned} aria-label={pinned ? `Shrink ${name}` : `Enlarge ${name}`} title={pinned ? "Shrink" : "Enlarge"}>
          {pinned ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {showVideo && (
          <button type="button" onClick={fullscreen} aria-label="Full screen video" title="Full screen video"><Expand size={14} /></button>
        )}
        {isMe && onFlip && showVideo && (
          <button type="button" onClick={onFlip} aria-label="Switch camera" title="Switch camera"><SwitchCamera size={14} /></button>
        )}
        {!isMe && onVolume && (
          <label className="vt-vol" title="Volume for you only">
            {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolume(Number(e.target.value))} aria-label={`${name} volume`} />
          </label>
        )}
      </div>
    </div>
  );
}
