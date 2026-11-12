import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

/** On-screen size of the circular crop area, and the size of the saved picture. */
const VIEW = 248;
const OUT = 256;

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';

interface Props {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  /** Receives a square JPEG, ready to upload. */
  onDone: (jpeg: Blob) => void;
}

/** Drag to reposition, slide to zoom. Exports a 256×256 JPEG. */
export function AvatarCropper({ file, busy = false, onCancel, onDone }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // `stale` stops a superseded load (StrictMode runs effects twice) from
    // reporting an error after its URL was revoked.
    let stale = false;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      if (!stale) {
        setError('');
        setImg(im);
      }
    };
    im.onerror = () => {
      if (!stale) setError("That image couldn't be read. Try a JPG, PNG or WebP.");
    };
    im.src = url;
    return () => {
      stale = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const nw = img?.naturalWidth ?? 1;
  const nh = img?.naturalHeight ?? 1;
  const base = VIEW / Math.min(nw, nh); // "cover" scale
  const scale = base * zoom;

  /** Keep the picture covering the whole circle. */
  const clamp = (o: { x: number; y: number }, z: number) => {
    const s = base * z;
    const mx = Math.max(0, (nw * s - VIEW) / 2);
    const my = Math.max(0, (nh * s - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };

  const changeZoom = (z: number) => {
    const next = Math.min(3, Math.max(1, z));
    setZoom(next);
    setOff((o) => clamp(o, next));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }, zoom));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 12;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setOff((o) => clamp({ x: o.x + m[0], y: o.y + m[1] }, zoom));
  };

  const save = () => {
    if (!img) return;
    const side = VIEW / scale; // visible square, in source pixels
    const cx = nw / 2 - off.x / scale;
    const cy = nh / 2 - off.y / scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Your browser could not prepare the image.');
      return;
    }
    ctx.fillStyle = '#0d0b16'; // behind any transparent pixels
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, OUT, OUT);
    canvas.toBlob(
      (b) => (b ? onDone(b) : setError('Could not prepare the image. Try another one.')),
      'image/jpeg',
      0.88,
    );
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[#06050b]/80 p-4 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Adjust your profile picture"
        className="w-[min(92vw,380px)] rounded-3xl border border-white/10 bg-[#0d0b16]/95 p-6 shadow-[0_0_60px_rgba(233,184,114,0.08)]"
      >
        <h2 className="iw-display text-3xl font-light">Adjust your photo</h2>
        <p className="mt-1 text-xs text-[#a49fb0]">Drag to reposition. Use the slider to zoom.</p>

        <div className="mt-6 grid place-items-center">
          <div className="relative" style={{ width: VIEW + 16, height: VIEW + 16 }}>
            <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 iw-spin" aria-hidden="true">
              <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(233,184,114,0.4)" strokeDasharray="1 3" strokeWidth="0.5" />
            </svg>
            <div
              ref={areaRef}
              tabIndex={0}
              role="img"
              aria-label="Photo preview. Drag, or use the arrow keys, to reposition."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
              className={`absolute left-2 top-2 cursor-grab touch-none select-none overflow-hidden rounded-full bg-black/40 active:cursor-grabbing ${FOCUS}`}
              style={{ width: VIEW, height: VIEW }}
            >
              {img && (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                  style={{
                    width: nw * scale,
                    height: nh * scale,
                    transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px)`,
                  }}
                />
              )}
              <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgba(233,184,114,0.55)]" />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => changeZoom(zoom - 0.25)}
            className={`rounded-lg p-1.5 text-[#a49fb0] hover:text-[#eee9dc] ${FOCUS}`}
          >
            <Minus size={16} />
          </button>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 cursor-pointer accent-[#e9b872]"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => changeZoom(zoom + 0.25)}
            className={`rounded-lg p-1.5 text-[#a49fb0] hover:text-[#eee9dc] ${FOCUS}`}
          >
            <Plus size={16} />
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-xs text-[#ff5d4a]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`rounded-xl border border-white/10 px-4 py-2.5 text-sm text-[#c9c4d2] transition hover:bg-white/5 hover:text-[#eee9dc] disabled:opacity-50 ${FOCUS}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!img || busy}
            className={`rounded-xl bg-[#e9b872] px-5 py-2.5 text-sm font-bold text-[#1a1208] transition hover:brightness-110 disabled:opacity-60 ${FOCUS}`}
          >
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
