import { useEffect, useRef } from "react";

/** Drifting neural-field background: nodes, links and travelling signal pulses. */
export function NeuralBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, g = cv.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const N = 70, P = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 4e-4, vy: (Math.random() - 0.5) * 4e-4, hue: Math.random() < 0.5 ? 190 : 265 }));
    const fit = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; };
    const draw = (t: number) => {
      g.clearRect(0, 0, w, h);
      for (const p of P) { p.x = (p.x + p.vx + 1) % 1; p.y = (p.y + p.vy + 1) % 1; }
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = P[i], b = P[j], d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
        if (d > 170) continue;
        g.strokeStyle = `hsla(${a.hue},90%,65%,${(1 - d / 170) * 0.22})`; g.beginPath(); g.moveTo(a.x * w, a.y * h); g.lineTo(b.x * w, b.y * h); g.stroke();
        const k = (t / 1800 + i * 0.37) % 1; // signal pulse
        if (k < 0.5 && d < 120) { g.fillStyle = `hsla(${b.hue},95%,75%,.8)`; g.beginPath(); g.arc(a.x * w + (b.x - a.x) * w * k * 2, a.y * h + (b.y - a.y) * h * k * 2, 1.6, 0, 6.3); g.fill(); }
      }
      for (const p of P) { g.fillStyle = `hsla(${p.hue},95%,70%,.9)`; g.beginPath(); g.arc(p.x * w, p.y * h, 2, 0, 6.3); g.fill(); }
      if (!still) raf = requestAnimationFrame(draw);
    };
    fit(); addEventListener("resize", fit); raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
  }, []);
  return <canvas ref={ref} className="ail-backdrop" aria-hidden="true" />;
}
