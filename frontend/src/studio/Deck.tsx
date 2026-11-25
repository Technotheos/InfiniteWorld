import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadPrefs } from '../hooks/usePrefs';
import { Starfield } from '../components/Starfield';
import { useVoice } from '../game/voice/useVoice';
import type { StateView } from '../game/types';
import { createEngine, decode, ensureAudio, peaks as computePeaks, startRecording, setMasterVolume, type Recording } from './audio';
import { BeatBay } from './BeatBay';
import { Booth } from './Booth';
import { Lounge } from './Lounge';
import { Mixer } from './Mixer';
import { fetchAudio, reportItem, studioIce, uploadAudio, type IceConfig, type StudioTake } from './studioApi';
import { prefersReducedMotion, useBeat } from './useBeat';
import { useStudio } from './useStudio';

interface Props {
  code: string;
  onLeave: () => void;
  onAuthExpired: () => void;
}

interface Pending {
  blob: Blob;
  durMs: number;
  url: string;
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function Deck({ code, onLeave, onAuthExpired }: Props) {
  const { status, state, cells, trail, chat, lastTake, error, closeReason, clock, send, onRtc } = useStudio(code, onAuthExpired);
  const prefs = useMemo(loadPrefs, []);
  const animate = prefs.ambient && !prefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const step = useBeat(clock, root, animate);
  const engine = useRef(createEngine(clock)).current;

  const [boarded, setBoarded] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [ice, setIce] = useState<IceConfig>({ servers: [], relay_available: false });
  const [relayOnly, setRelayOnly] = useState(false);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const loaded = useRef(new Set<string>());

  const me = state?.members.find((m) => m.name === state.you);
  const role = state?.role ?? 'listener';
  const isHost = role === 'host';
  const canEdit = role === 'host' || role === 'producer';

  /* ---- audio engine follows the room ------------------------------------ */
  useEffect(() => {
    if (!boarded) return;
    engine.start();
    return () => engine.stop();
  }, [boarded, engine]);
  useEffect(() => {
    engine.setGrid(cells.map((row) => row.map((c) => c !== '')));
  }, [cells, engine]);
  useEffect(() => {
    if (!state) return;
    engine.setTakes(state.takes);
    const ids = new Set(state.takes.map((t) => t.id));
    for (const id of [...loaded.current]) {
      if (!ids.has(id)) {
        loaded.current.delete(id);
        engine.dropTake(id);
      }
    }
    if (!boarded) return;
    for (const t of state.takes) {
      if (t.kind !== 'take' || loaded.current.has(t.id)) continue;
      loaded.current.add(t.id);
      fetchAudio(t.id)
        .then(decode)
        .then((b) => {
          engine.setTakeBuffer(t.id, b);
          setPeaks((p) => ({ ...p, [t.id]: computePeaks(b) }));
        })
        .catch(() => loaded.current.delete(t.id)); // try again on the next update
    }
  }, [state, boarded, engine]);
  useEffect(() => setMasterVolume(volume), [volume]);

  /* ---- voice (the same WebRTC mesh as the game rooms, with server-issued ICE) ---- */
  useEffect(() => {
    studioIce().then(setIce).catch(() => undefined);
  }, []);
  const voiceState = useMemo(
    () =>
      state
        ? ({
            map: { voice: true },
            you: state.you,
            players: state.members.map((m) => ({ name: m.name, connected: m.connected, voice: m.voice })),
          } as unknown as StateView)
        : null,
    [state],
  );
  const voice = useVoice({
    state: voiceState,
    send,
    onRtc,
    ice: { servers: ice.servers, relayOnly: relayOnly && ice.relay_available },
  });
  useEffect(() => {
    if (me?.muted && voice.mic) voice.toggleMic();
  }, [me?.muted, voice]);

  /* ---- recording and Transmit -------------------------------------------- */
  const recRef = useRef<Recording | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [declared, setDeclared] = useState(false);
  const [takeTitle, setTakeTitle] = useState('');
  const [tx, setTx] = useState<{ phase: 'idle' | 'charging' | 'sending'; pct: number }>({ phase: 'idle', pct: 0 });
  const recording = me?.rec === 'recording';

  const stopRec = useCallback(async () => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    const { blob, durMs } = await r.stop();
    setPending({ blob, durMs, url: URL.createObjectURL(blob) });
    send('rec', { state: 'ready' });
  }, [send]);

  const startRec = async () => {
    setRecErr(null);
    ensureAudio();
    try {
      // The browser's own permission prompt appears here, only because you pressed Record.
      recRef.current = await startRecording(() => void stopRec());
      send('rec', { state: 'recording' });
    } catch (e) {
      setRecErr(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start the microphone.');
    }
  };
  const discard = () => {
    recRef.current?.cancel();
    recRef.current = null;
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setTx({ phase: 'idle', pct: 0 });
    send('rec', { state: 'idle' });
  };
  const transmit = async () => {
    if (!pending || !declared || tx.phase !== 'idle') return;
    setRecErr(null);
    setTx({ phase: 'charging', pct: 0 });
    await new Promise((r) => setTimeout(r, animate ? 1100 : 150)); // the charge-up
    setTx({ phase: 'sending', pct: 0 });
    try {
      await uploadAudio({ room: code, kind: 'take', title: takeTitle.trim() || 'Take', file: pending.blob, onProgress: (pct) => setTx({ phase: 'sending', pct }) });
      URL.revokeObjectURL(pending.url);
      setPending(null);
      setTakeTitle('');
      setTx({ phase: 'idle', pct: 0 });
    } catch (e) {
      setRecErr((e as Error).message);
      setTx({ phase: 'idle', pct: 0 });
    }
  };
  // Nothing may keep recording if you leave.
  useEffect(() => () => recRef.current?.cancel(), []);
  useEffect(() => {
    if (!recording && !pending) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [recording, pending]);

  /* ---- announcements ------------------------------------------------------ */
  useEffect(() => {
    if (!lastTake) return;
    setPulse(lastTake.n);
    setToast(`${lastTake.by} transmitted “${lastTake.title}”`);
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [lastTake]);
  useEffect(() => {
    if (error && error.code !== 'held') {
      setToast(error.message);
      const t = window.setTimeout(() => setToast(null), 4000);
      return () => window.clearTimeout(t);
    }
  }, [error]);

  /* ---- dialogs ------------------------------------------------------------ */
  const [reporting, setReporting] = useState<StudioTake | null>(null);
  const [reason, setReason] = useState<'copyright' | 'abuse' | 'other'>('copyright');
  const [detail, setDetail] = useState('');
  const [closeAsk, setCloseAsk] = useState<string[] | null>(null);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [chatText, setChatText] = useState('');
  useEffect(() => {
    if (error?.code === 'held') setCloseAsk(error.held_by ?? []);
  }, [error]);

  const tryLeave = () => (recording || pending ? setLeaveAsk(true) : leave());
  const leave = () => {
    recRef.current?.cancel();
    onLeave();
  };

  if (status === 'closed' || !state) {
    return (
      <div className="sp-root sp-center" ref={root}>
        <div className="sp-card">
          <h1>{status === 'closed' ? 'Off the air' : 'Docking…'}</h1>
          <p className="sp-sub" role="status">{status === 'closed' ? closeReason ?? 'The connection to the studio ended.' : status === 'reconnecting' ? 'Reconnecting…' : 'Opening the airlock…'}</p>
          <button type="button" className="sp-btn" onClick={leave}>Back to the hangar</button>
        </div>
      </div>
    );
  }

  const heldNames = state.held_by;
  return (
    <div className={`sp-root${animate ? ' anim' : ''}`} ref={root}>
      {prefs.starfield && <Starfield />}
      <div className="sp-nebula" aria-hidden="true" />
      <div className="sp-kick" aria-hidden="true" />
      {pulse > 0 && <div className="sp-announce" key={pulse} aria-hidden="true" />}

      {!boarded && (
        <div className="sp-gate" role="dialog" aria-modal="true" aria-label="Board the deck">
          <div className="sp-card">
            <h1>Starship Studio</h1>
            <p className="sp-sub">{state.members.length} aboard · {state.bpm} BPM. Audio starts when you board.</p>
            <button type="button" className="sp-btn big" autoFocus onClick={() => { ensureAudio(); setBoarded(true); }}>Board the deck</button>
            <button type="button" className="sp-link" onClick={leave}>Not now</button>
          </div>
        </div>
      )}

      <header className="sp-top">
        <button type="button" className="sp-btn ghost" onClick={tryLeave}>← Leave</button>
        <h1 className="sp-title">Starship Studio</h1>
        <span className="sp-code" title="Studio code">{state.code}</span>
        {status !== 'open' && <span className="sp-warn" role="status">Reconnecting…</span>}
        <div className={`sp-beacon${state.held ? ' lit' : ''}`} role="status" aria-live="polite">
          <i aria-hidden="true" />
          {state.held ? <>Session Held · waiting on {heldNames.join(', ')}</> : 'Session open'}
        </div>
        <span className="sp-bpm">{state.bpm} BPM{!state.playing && ' · paused'}</span>
        <label className="sp-vol">Master <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Master volume" /></label>
      </header>

      {toast && <div className="sp-toast" role="status">{toast}</div>}

      <main className="sp-deck">
        <div className="sp-col main">
          <BeatBay cells={cells} trail={trail} members={state.members} step={step} canEdit={canEdit} send={send} onPreview={(t, s) => boarded && engine.preview(t, s)} />

          {canEdit && (
            <section className="sp-panel sp-rec" aria-label="Record a take">
              <header className="sp-panel-h"><h2>Record</h2><span className="sp-sub">Only you can start your own recording.</span></header>
              {!pending ? (
                <div className="sp-rec-row">
                  {!recording ? (
                    <button type="button" className="sp-btn rec" disabled={me?.muted} onClick={() => void startRec()}>● Record a take</button>
                  ) : (
                    <button type="button" className="sp-btn rec live" onClick={() => void stopRec()}>■ Stop</button>
                  )}
                  <span className="sp-sub">{recording ? 'Recording on your device. It snaps to the beat it started on.' : 'Captured locally; nothing leaves your device until you Transmit.'}</span>
                </div>
              ) : (
                <div className={`sp-tx${tx.phase !== 'idle' ? ' ' + tx.phase : ''}`}>
                  <audio controls src={pending.url} className="sp-audio" />
                  <p className="sp-sub">{fmt(pending.durMs)} recorded on this device.</p>
                  <input className="sp-input" placeholder="Name this take" maxLength={60} value={takeTitle} onChange={(e) => setTakeTitle(e.target.value)} />
                  <label className="sp-check"><input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />This is my own recording, or I have the right to share it here.</label>
                  <div className="sp-rec-row">
                    <button type="button" className="sp-btn transmit" disabled={!declared || tx.phase !== 'idle'} onClick={() => void transmit()}>
                      <span className="sp-charge" style={{ ['--p' as string]: tx.phase === 'sending' ? tx.pct : tx.phase === 'charging' ? 1 : 0 }} aria-hidden="true" />
                      {tx.phase === 'charging' ? 'Charging…' : tx.phase === 'sending' ? `Transmitting ${Math.round(tx.pct * 100)}%` : 'Transmit to the deck'}
                    </button>
                    <button type="button" className="sp-btn ghost" disabled={tx.phase !== 'idle'} onClick={discard}>Discard</button>
                  </div>
                </div>
              )}
              {recErr && <p className="sp-err" role="alert">{recErr}</p>}
            </section>
          )}

          <Mixer
            takes={state.takes}
            members={state.members}
            you={state.you}
            isHost={isHost}
            clock={clock}
            peaks={peaks}
            muted={muted}
            onMute={(id) => {
              const next = new Set(muted);
              next.has(id) ? next.delete(id) : next.add(id);
              setMuted(next);
              engine.setTakeMuted(id, next.has(id));
            }}
            onReport={setReporting}
            send={send}
            animate={animate}
          />
        </div>

        <div className="sp-col side">
          <Booth members={state.members} you={state.you} voice={voice} recLevel={recRef.current?.level} relayAvailable={ice.relay_available} relayOnly={relayOnly} setRelayOnly={setRelayOnly} hostMuted={Boolean(me?.muted)} />
          <Lounge state={state} clock={clock} canQueue={canEdit} send={send} animate={animate} onReport={setReporting} />

          {isHost && (
            <section className="sp-panel sp-host" aria-label="Host controls">
              <header className="sp-panel-h"><h2>Host controls</h2></header>
              <div className="sp-host-row">
                <button type="button" className="sp-btn" onClick={() => send('transport', { playing: !state.playing })}>{state.playing ? 'Pause' : 'Play'}</button>
                <label className="sp-vol">Tempo {state.bpm}<input type="range" min={60} max={180} value={state.bpm} onChange={(e) => send('bpm', { bpm: Number(e.target.value) })} /></label>
                <button type="button" className="sp-btn ghost" onClick={() => send('clear')}>Clear grid</button>
              </div>
              <label className="sp-check"><input type="checkbox" checked={state.locked} onChange={(e) => send('host', { op: 'lock', on: e.target.checked })} />Lock (no new arrivals)</label>
              <label className="sp-check"><input type="checkbox" checked={state.invite_only} onChange={(e) => send('host', { op: 'invite_only', on: e.target.checked })} />Invite-only (private session)</label>
              <label className="sp-check"><input type="checkbox" checked={state.friends_only} onChange={(e) => send('host', { op: 'friends_only', on: e.target.checked })} />Friends only</label>
              <form className="sp-host-row" onSubmit={(e) => { e.preventDefault(); if (inviteName.trim()) { send('host', { op: 'invite', name: inviteName.trim() }); setInviteName(''); } }}>
                <input className="sp-input" placeholder="Invite by username" value={inviteName} maxLength={32} onChange={(e) => setInviteName(e.target.value)} />
                <button type="submit" className="sp-btn">Invite</button>
              </form>
              {state.invited && state.invited.length > 0 && <p className="sp-sub">Invited: {state.invited.join(', ')}</p>}
              <ul className="sp-members">
                {state.members.filter((m) => m.name !== state.you).map((m) => (
                  <li key={m.name}>
                    <span>{m.name} <em className="sp-tag">{m.role}</em></span>
                    <span className="sp-actions">
                      <button type="button" className="sp-link" onClick={() => send('host', { op: 'mute', name: m.name, on: !m.muted })}>{m.muted ? 'Unmute' : 'Mute'}</button>
                      <button type="button" className="sp-link" onClick={() => send('host', { op: 'role', name: m.name, role: m.role === 'producer' ? 'listener' : 'producer' })}>{m.role === 'producer' ? 'Make listener' : 'Make producer'}</button>
                      <button type="button" className="sp-link danger" onClick={() => send('host', { op: 'kick', name: m.name })}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className="sp-btn danger" onClick={() => send('host', { op: 'close' })}>Close the studio…</button>
            </section>
          )}

          <section className="sp-panel sp-chat" aria-label="Chat">
            <header className="sp-panel-h"><h2>Comms</h2></header>
            <ul className="sp-chatlog" aria-live="polite">
              {chat.map((c) => (
                <li key={c.id}><b>{c.from}</b> {c.text}</li>
              ))}
            </ul>
            <form className="sp-host-row" onSubmit={(e) => { e.preventDefault(); if (chatText.trim()) { send('chat', { text: chatText }); setChatText(''); } }}>
              <input className="sp-input" placeholder="Say something" maxLength={160} value={chatText} onChange={(e) => setChatText(e.target.value)} />
              <button type="submit" className="sp-btn">Send</button>
            </form>
          </section>
        </div>
      </main>

      {closeAsk && (
        <Dialog title="Someone is still recording" onClose={() => setCloseAsk(null)}>
          <p>{closeAsk.join(', ')} {closeAsk.length > 1 ? 'are' : 'is'} still holding the session open. Closing now ends the studio for everyone and untransmitted takes are lost.</p>
          <div className="sp-rec-row">
            <button type="button" className="sp-btn" onClick={() => setCloseAsk(null)}>Keep it open</button>
            <button type="button" className="sp-btn danger" onClick={() => { send('host', { op: 'close', force: true }); setCloseAsk(null); }}>Close anyway</button>
          </div>
        </Dialog>
      )}
      {leaveAsk && (
        <Dialog title="You have an untransmitted take" onClose={() => setLeaveAsk(false)}>
          <p>Leaving now discards it. The room stays held open until you Transmit or discard.</p>
          <div className="sp-rec-row">
            <button type="button" className="sp-btn" onClick={() => setLeaveAsk(false)}>Stay</button>
            <button type="button" className="sp-btn danger" onClick={() => { discard(); leave(); }}>Discard and leave</button>
          </div>
        </Dialog>
      )}
      {reporting && (
        <Dialog title={`Report “${reporting.title}”`} onClose={() => setReporting(null)}>
          <label className="sp-check">Reason
            <select className="sp-input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="copyright">Copyright: I hold the rights or this copies someone's work</option>
              <option value="abuse">Abusive or harmful</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <textarea className="sp-input" rows={3} maxLength={300} placeholder="Details (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <div className="sp-rec-row">
            <button type="button" className="sp-btn ghost" onClick={() => setReporting(null)}>Cancel</button>
            <button type="button" className="sp-btn" onClick={() => { void reportItem(reporting.id, reason, detail).then(() => setToast('Thanks. A moderator will review it.')).catch((e: Error) => setToast(e.message)); setReporting(null); setDetail(''); }}>Send report</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="sp-gate" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sp-card">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
