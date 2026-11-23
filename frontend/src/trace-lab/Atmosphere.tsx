import { useEffect, useRef } from 'react';

/** The room itself: a rain-streaked window, a single desk lamp, CRT glow. Pure decoration, never blocks input. */
export function Atmosphere({ calm }: { calm: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const flash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (calm) return;
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let w = 0, h = 0, raf = 0, last = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener('resize', resize);
    const n = w < 640 ? 70 : 130;
    const drops = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, l: 8 + Math.random() * 18, v: 380 + Math.random() * 420, a: 0.08 + Math.random() * 0.16 }));
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      for (const d of drops) {
        d.y += d.v * dt; d.x -= d.v * dt * 0.18;
        if (d.y > h || d.x < -20) { d.y = -20; d.x = Math.random() * (w + 80); }
        ctx.strokeStyle = `rgba(160,200,230,${d.a})`;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.18, d.y - d.l); ctx.stroke();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // a far-off flash of lightning now and then
    let t = window.setTimeout(function boom() {
      const el = flash.current;
      if (el) { el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
      t = window.setTimeout(boom, 22000 + Math.random() * 30000);
    }, 9000);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.clearTimeout(t); };
  }, [calm]);

  return (
    <div className="tl-atmo" aria-hidden="true">
      <canvas ref={cv} className="tl-rain" />
      <div className="tl-lamp" />
      <div className="tl-vignette" />
      <div ref={flash} className="tl-flash" />
      <div className="tl-scan" />
    </div>
  );
}
