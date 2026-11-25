import { useEffect, useState } from 'react';
import { Starfield } from '../components/Starfield';
import { loadPrefs } from '../hooks/usePrefs';
import { Deck } from './Deck';
import { createStudio, quickStudio, studioInvites, type Invite } from './studioApi';
import './studio.css';

interface Props {
  onExit: () => void;
  onAuthExpired: () => void;
  /** Open straight into this studio (an invite, or a code). */
  initialCode?: string | null;
}

/** Starship Studio: the lobby (find or make a session) and, once you are in, the deck. */
export function StudioLab({ onExit, onAuthExpired, initialCode }: Props) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    if (code) return;
    let live = true;
    studioInvites().then((i) => live && setInvites(i)).catch(() => undefined);
    return () => void (live = false);
  }, [code]);

  const go = async (make: () => Promise<string>) => {
    setBusy(true);
    setErr(null);
    try {
      setCode(await make());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (code) {
    return <Deck key={code} code={code} onLeave={() => setCode(null)} onAuthExpired={onAuthExpired} />;
  }
  const prefs = loadPrefs();
  return (
    <div className="sp-root sp-center">
      {prefs.starfield && <Starfield />}
      <div className="sp-nebula" aria-hidden="true" />
      <div className="sp-card sp-lobby">
        <h1>Starship Studio</h1>
        <p className="sp-sub">Beats are born here, voices are layered, and nobody leaves until the track is done.</p>
        {invites.map((i) => (
          <button key={i.code} type="button" className="sp-btn big invite" disabled={busy} onClick={() => setCode(i.code)}>
            {i.from} invited you to a private session
          </button>
        ))}
        <button type="button" className="sp-btn big" disabled={busy} onClick={() => void go(quickStudio)}>Quick join</button>
        <div className="sp-rec-row">
          <button type="button" className="sp-btn" disabled={busy} onClick={() => void go(() => createStudio(false))}>New public studio</button>
          <button type="button" className="sp-btn" disabled={busy} onClick={() => void go(() => createStudio(true))}>New private studio</button>
        </div>
        <form className="sp-rec-row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setCode(typed.trim().toUpperCase()); }}>
          <input className="sp-input" placeholder="Studio code" maxLength={8} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Studio code" />
          <button type="submit" className="sp-btn" disabled={!typed.trim()}>Join</button>
        </form>
        {err && <p className="sp-err" role="alert">{err}</p>}
        <button type="button" className="sp-link" onClick={onExit}>← Back home</button>
      </div>
    </div>
  );
}
