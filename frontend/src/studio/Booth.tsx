import { useEffect, useRef, useState } from 'react';
import { UserAvatar } from '../components/Avatar';
import type { VoiceApi } from '../game/voice/useVoice';
import { PRODUCER_COLORS, type StudioMember } from './studioApi';

/** A smooth 0..1 loudness for one person. Real level for you while recording, otherwise an envelope on "speaking". */
function useEnvelope(speaking: boolean, live?: () => number): number {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  const sp = useRef(speaking);
  sp.current = speaking;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const target = live ? live() : sp.current ? 0.55 + Math.random() * 0.4 : 0;
      cur.current += (target - cur.current) * (target > cur.current ? 0.5 : 0.12);
      setV(Math.round(cur.current * 100) / 100);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return v;
}

function VideoFeed({ stream, mirror }: { stream: MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`sp-feed${mirror ? ' mirror' : ''}`} />;
}

interface PortalProps {
  m: StudioMember;
  me: boolean;
  stream?: MediaStream | null;
  speaking: boolean;
  recLevel?: () => number;
}

function Portal({ m, me, stream, speaking, recLevel }: PortalProps) {
  const level = useEnvelope(speaking && m.voice?.mic !== false, m.rec === 'recording' && recLevel ? recLevel : undefined);
  const recording = m.rec === 'recording';
  const hasCam = Boolean(m.voice?.cam && stream && stream.getVideoTracks().length);
  const color = PRODUCER_COLORS[m.color % 8];
  return (
    <li className={`sp-portal${recording ? ' rec' : ''}${!m.connected ? ' away' : ''}`} style={{ ['--lvl' as string]: level, ['--pc' as string]: color }}>
      <div className="sp-ring" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" className="sp-ring-base" />
          <circle cx="50" cy="50" r="44" className="sp-ring-live" />
        </svg>
      </div>
      <div className="sp-disc">
        {hasCam && stream ? <VideoFeed stream={stream} mirror={me} /> : <UserAvatar name={m.name} size={72} clickable={false} />}
      </div>
      <div className="sp-portal-name">
        <b>{m.name}</b>
        {me && ' (you)'}
        <span className="sp-role">{m.role}</span>
      </div>
      <div className="sp-portal-flags">
        {recording && <span className="sp-recdot" role="status">● REC</span>}
        {m.rec === 'ready' && <span className="sp-ready">take ready</span>}
        {m.muted && <span className="sp-muted">muted by host</span>}
        {!m.connected && <span className="sp-muted">reconnecting…</span>}
        {m.voice?.on && !m.voice.mic && !m.muted && <span className="sp-muted">mic off</span>}
      </div>
    </li>
  );
}

interface Props {
  members: StudioMember[];
  you: string;
  voice: VoiceApi;
  recLevel?: () => number;
  relayAvailable: boolean;
  relayOnly: boolean;
  setRelayOnly: (v: boolean) => void;
  hostMuted: boolean;
}

/** The Booth: each person is a holographic portal. Cam if it is on, avatar if not. */
export function Booth({ members, you, voice, recLevel, relayAvailable, relayOnly, setRelayOnly, hostMuted }: Props) {
  return (
    <section className="sp-panel sp-booth" aria-label="The Booth">
      <header className="sp-panel-h">
        <h2>The Booth</h2>
        <span className="sp-sub">Cyan while you talk. Red-gold while someone records.</span>
      </header>
      <ul className="sp-portals">
        {members.map((m) => (
          <Portal
            key={m.name}
            m={m}
            me={m.name === you}
            stream={m.name === you ? voice.local : voice.remote[m.name]}
            speaking={Boolean(voice.speaking[m.name])}
            recLevel={m.name === you ? recLevel : undefined}
          />
        ))}
      </ul>
      <div className="sp-booth-ctl">
        {!voice.joined ? (
          <button type="button" className="sp-btn" disabled={!voice.supported || voice.busy} onClick={() => void voice.join()}>
            Join the booth (voice)
          </button>
        ) : (
          <>
            <button type="button" className={`sp-btn${voice.mic ? ' on' : ''}`} disabled={hostMuted} aria-pressed={voice.mic} onClick={voice.toggleMic}>
              {voice.mic ? 'Mic on' : 'Mic off'}
            </button>
            <button type="button" className={`sp-btn${voice.cam ? ' on' : ''}`} aria-pressed={voice.cam} onClick={() => void voice.toggleCam()}>
              {voice.cam ? 'Cam on' : 'Cam off'}
            </button>
            <button type="button" className="sp-btn ghost" onClick={voice.leave}>
              Leave booth
            </button>
          </>
        )}
        <label className={`sp-check${relayAvailable ? '' : ' dim'}`} title={relayAvailable ? '' : 'This server has no relay configured'}>
          <input type="checkbox" checked={relayOnly} disabled={!relayAvailable || voice.joined} onChange={(e) => setRelayOnly(e.target.checked)} />
          Relay only (hide my IP from others)
        </label>
        {voice.error && <p className="sp-err" role="alert">{voice.error}</p>}
        {!voice.canSend && voice.supported && <p className="sp-sub">Voice needs HTTPS to send; you can still listen.</p>}
        {voice.audioBlocked && (
          <button type="button" className="sp-btn" onClick={voice.enableAudio}>
            Tap to hear the room
          </button>
        )}
      </div>
    </section>
  );
}
