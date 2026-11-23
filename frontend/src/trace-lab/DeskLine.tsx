import { useEffect, useState } from 'react';
import { Copy, Headphones, LogOut, PhoneCall, X } from 'lucide-react';
import { createRoom } from '../game/gameApi';
import { useGameSocket } from '../game/useGameSocket';
import { useVoice } from '../game/voice/useVoice';
import { useVoiceUi } from '../game/voice/voiceUi';
import { VoiceDock } from '../game/voice/VoiceDock';
import { VoicePanel } from '../game/voice/VoicePanel';
import { Chat } from '../game/Chat';
import '../game/game.css';
import '../game/voice/voice.css';

export interface LineStatus { code: string | null; connected: boolean; inVoice: boolean; others: number }
export const OFFLINE: LineStatus = { code: null, connected: false, inVoice: false, others: 0 };

interface Props { token: string; open: boolean; onClose: () => void; onStatus: (s: LineStatus) => void; onAuthExpired?: () => void }

/**
 * The desk line: the same mic, camera and chat as the Cursed Relic room, for working a case with others.
 * It joins a private "trace-lab" room and stays in its lobby, so the room only carries voice, video and chat.
 */
export function DeskLine({ token, open, onClose, onStatus, onAuthExpired }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!code) onStatus(OFFLINE); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true); setErr(null);
    try { setCode(await createRoom(token, 'trace-lab', true)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not open a line. Is the server running?'); }
    finally { setBusy(false); }
  };

  if (code) return <Connected code={code} token={token} open={open} onClose={onClose} onLeave={() => setCode(null)} onStatus={onStatus} onAuthExpired={onAuthExpired} />;
  if (!open) return null;
  return (
    <Sheet onClose={onClose} title="Desk line">
      <p className="tl-dimtxt">Work a case with a partner. You get the same mic, camera and chat as the Cursed Relic room. Voice and video go straight between players and are never recorded or stored.</p>
      <button type="button" className="tl-btn primary" onClick={() => void create()} disabled={busy}><PhoneCall size={15} /> {busy ? 'Opening…' : 'Open a new line'}</button>
      <form className="tl-join" onSubmit={(e) => { e.preventDefault(); const c = typed.trim().toUpperCase(); if (c) setCode(c); }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} maxLength={8} placeholder="ROOM CODE" autoComplete="off" aria-label="Room code" />
        <button type="submit" className="tl-btn" disabled={!typed.trim()}>Join</button>
      </form>
      {err && <p className="tl-warn" role="alert">{err}</p>}
    </Sheet>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="tl-sheetwrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="tl-backdrop" aria-label="Close" onClick={onClose} />
      <div className="tl-sheet">
        <header><Headphones size={16} /> <h3>{title}</h3><button type="button" className="tl-x" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

function Connected({ code, token, open, onClose, onLeave, onStatus, onAuthExpired }: Props & { code: string; onLeave: () => void }) {
  const { status, state, chat, typing, send, onRtc, closeReason, authExpired } = useGameSocket(code, token);
  const voice = useVoice({ state, send, onRtc });
  const ui = useVoiceUi();
  const [copied, setCopied] = useState(false);
  const others = state ? state.players.filter((p) => p.connected && p.name !== state.you).length : 0;

  useEffect(() => { if (authExpired) onAuthExpired?.(); }, [authExpired, onAuthExpired]);
  useEffect(() => { onStatus({ code, connected: Boolean(state) && status === 'open', inVoice: voice.joined, others }); }, [code, state, status, voice.joined, others]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving the lab must also hang up
  useEffect(() => () => onStatus(OFFLINE), []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }); };

  return (
    <>
      {state?.map.voice && voice.supported && (
        <div className="rg-root tl-rg tl-dock"><VoiceDock voice={voice} ui={ui} players={state.players} you={state.you} /></div>
      )}
      {open && (
        <Sheet title="Desk line" onClose={onClose}>
          <div className="tl-linehead">
            <button type="button" className="tl-code" onClick={copy} title="Copy the room code to share">{copied ? 'Copied' : code} <Copy size={13} /></button>
            <span className={`tl-dot ${status === 'open' ? 'ok' : 'wait'}`}>{status === 'open' ? 'Connected' : status === 'closed' ? 'Disconnected' : 'Connecting…'}</span>
            <button type="button" className="tl-btn small ghost" onClick={() => { voice.leave(); onLeave(); }}><LogOut size={14} /> Leave</button>
          </div>
          {status === 'closed' && <p className="tl-warn" role="alert">{authExpired ? 'Your session expired. Sign in again.' : closeReason ?? 'The line dropped.'}</p>}
          {!state && status !== 'closed' && <p className="tl-dimtxt">Dialling…</p>}
          {state && (
            <div className="rg-root tl-rg">
              <p className="tl-dimtxt">Share the code. Anyone who joins can talk with you here while you each work the case in your own browser.</p>
              <VoicePanel voice={voice} ui={ui} players={state.players} you={state.you} />
              <div className="tl-chat"><Chat messages={chat} you={state.you} send={send} typing={typing} /></div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
