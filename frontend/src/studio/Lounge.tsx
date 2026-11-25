import { useEffect, useRef, useState } from 'react';
import { createLounge, decode, ensureAudio, renderHouse, setLoungeVolume, type StudioClock } from './audio';
import { fetchAudio, publishedTracks, uploadAudio, type PublishedTrack, type StudioState, type StudioSend, type StudioTake } from './studioApi';

export const HOUSE_LOOPS: { id: string; title: string }[] = [
  { id: 'nebula-drift', title: 'Nebula Drift' },
  { id: 'ion-storm', title: 'Ion Storm' },
  { id: 'orbital-lounge', title: 'Orbital Lounge' },
  { id: 'cargo-bay-funk', title: 'Cargo Bay Funk' },
  { id: 'pulsar-run', title: 'Pulsar Run' },
  { id: 'deep-field', title: 'Deep Field' },
];

interface Props {
  state: StudioState;
  clock: StudioClock;
  canQueue: boolean;
  send: StudioSend;
  animate: boolean;
  onReport: (t: StudioTake) => void;
}

/** Listening Lounge: a floating orbital playlist (generated house loops + uploaded tracks) with a shared queue. */
export function Lounge({ state, clock, canQueue, send, animate, onReport }: Props) {
  const lounge = useRef(createLounge()).current;
  const playingId = useRef<string | null>(null);
  const [vol, setVol] = useState(0.7);
  const [published, setPublished] = useState<PublishedTrack[]>([]);
  const [up, setUp] = useState<{ busy: boolean; pct: number; err: string | null }>({ busy: false, pct: 0, err: null });
  const [declared, setDeclared] = useState(false);
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const np = state.now_playing;
  const tracks = state.takes.filter((t) => t.kind === 'track');

  useEffect(() => {
    setLoungeVolume(vol);
  }, [vol]);
  useEffect(() => () => lounge.stop(), [lounge]);
  useEffect(() => {
    let live = true;
    publishedTracks().then((p) => live && setPublished(p)).catch(() => undefined);
    return () => void (live = false);
  }, [state.takes.length]);

  // Everyone hears the same track at the same point: start where the server says it started.
  useEffect(() => {
    if (!np) {
      lounge.stop();
      playingId.current = null;
      return;
    }
    playingId.current = np.id;
    let cancelled = false;
    (async () => {
      try {
        ensureAudio();
        const off = Math.max(0, (clock.serverNow() - np.since) / 1000);
        if (np.src.startsWith('house:')) {
          const b = await renderHouse(np.src.slice(6));
          if (b && !cancelled) lounge.play(b, off, true);
        } else {
          const b = await decode(await fetchAudio(np.src.slice(6)));
          if (!cancelled) lounge.play(b, Math.max(0, (clock.serverNow() - np.since) / 1000), false);
        }
      } catch {
        playingId.current = null;
      }
    })();
    return () => void (cancelled = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [np?.id, clock, lounge]);

  const upload = async (file: File) => {
    setUp({ busy: true, pct: 0, err: null });
    try {
      await uploadAudio({ room: state.code, kind: 'track', title: title.trim() || file.name.replace(/\.[^.]+$/, ''), file, onProgress: (f) => setUp((u) => ({ ...u, pct: f })) });
      setUp({ busy: false, pct: 1, err: null });
      setTitle('');
    } catch (e) {
      setUp({ busy: false, pct: 0, err: (e as Error).message });
    }
  };

  const items = [
    ...HOUSE_LOOPS.map((h) => ({ src: `house:${h.id}`, title: h.title, kind: 'house' as const })),
    ...tracks.map((t) => ({ src: `track:${t.id}`, title: t.title, kind: 'upload' as const })),
  ];

  return (
    <section className="sp-panel sp-lounge" aria-label="Listening Lounge">
      <header className="sp-panel-h">
        <h2>Listening Lounge</h2>
        <span className="sp-sub">House loops are generated here: royalty-free. Uploads are yours.</span>
      </header>

      <div className={`sp-orbit${animate ? '' : ' still'}`} aria-hidden="true">
        <div className="sp-orbit-core">{np ? <b>{np.title}</b> : <span>silent</span>}</div>
        {items.slice(0, 10).map((it, i, a) => (
          <span key={it.src} className={`sp-moon${np?.src === it.src ? ' now' : ''}`} style={{ ['--a' as string]: `${(360 / a.length) * i}deg` }}>
            <i />
          </span>
        ))}
      </div>

      <div className="sp-now" aria-live="polite">
        {np ? <>Now playing: <b>{np.title}</b> <span className="sp-sub">queued by {np.by}</span></> : 'Nothing playing. Queue something.'}
        {canQueue && np && <button type="button" className="sp-link" onClick={() => send('queue', { op: 'next' })}>Skip</button>}
        {canQueue && np && <button type="button" className="sp-link" onClick={() => send('queue', { op: 'stop' })}>Stop</button>}
      </div>
      <label className="sp-vol">Lounge volume <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} /></label>

      <h3 className="sp-h3">Library</h3>
      <ul className="sp-list">
        {items.map((it) => (
          <li key={it.src}>
            <span>{it.title} {it.kind === 'upload' && <em className="sp-tag">uploaded</em>}</span>
            {canQueue && <button type="button" className="sp-link" onClick={() => send('queue', { op: 'add', src: it.src })}>+ Queue</button>}
            {it.kind === 'upload' && (() => { const t = tracks.find((x) => `track:${x.id}` === it.src); return t && t.by !== state.you ? <button type="button" className="sp-link" onClick={() => onReport(t)}>Report</button> : null; })()}
          </li>
        ))}
      </ul>

      <h3 className="sp-h3">Shared queue ({state.queue.length})</h3>
      {state.queue.length === 0 ? <p className="sp-sub">Empty.</p> : (
        <ol className="sp-list">
          {state.queue.map((q) => (
            <li key={q.id}>
              <span>{q.title} <span className="sp-sub">· {q.by}</span></span>
              {(q.by === state.you || state.role === 'host') && <button type="button" className="sp-link" onClick={() => send('queue', { op: 'remove', id: q.id })}>Remove</button>}
            </li>
          ))}
        </ol>
      )}

      {canQueue && (
        <div className="sp-upload">
          <h3 className="sp-h3">Upload a track</h3>
          <input className="sp-input" placeholder="Title" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="sp-check">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            I made this or have the right to share it here.
          </label>
          <input ref={fileRef} type="file" accept=".wav,.mp3,.ogg,.flac,.webm,audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
          <button type="button" className="sp-btn" disabled={!declared || up.busy} onClick={() => fileRef.current?.click()}>
            {up.busy ? `Uploading ${Math.round(up.pct * 100)}%` : 'Choose audio file'}
          </button>
          <p className="sp-sub">WAV, MP3, OGG, FLAC or WebM, up to 24 MB. It is re-encoded on the server.</p>
          {up.err && <p className="sp-err" role="alert">{up.err}</p>}
        </div>
      )}

      {published.length > 0 && (
        <>
          <h3 className="sp-h3">Published by their makers</h3>
          <ul className="sp-list">{published.map((p) => <li key={p.id}><span>{p.title} <span className="sp-sub">· {p.contributors.join(', ')}</span></span></li>)}</ul>
        </>
      )}
    </section>
  );
}
