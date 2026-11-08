import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { clamp } from './math';
import type { Mission, Status } from './missions';
import { renderScene } from './renderer';
import { STEP, arriveAt, buildSteps, metricsAt, totalTime } from './timeline';
import { FOCUS } from './ui';

/* ========================================================================== */
/*  SimStage: canvas + HUD + transport controls                               */
/* ========================================================================== */

export function SimStage({
  mission,
  patched,
  autoPlay,
  runToken,
}: {
  mission: Mission;
  patched: boolean;
  autoPlay: boolean;
  runToken: number;
}) {
  const reduce = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const steps = useMemo(() => buildSteps(mission, patched), [mission, patched]);
  const total = totalTime(steps.length);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tRef = useRef(0);
  const camRef = useRef({ yaw: -0.3, pitch: 0.42, dragging: false, x: 0, y: 0 });
  const [playing, setPlaying] = useState(autoPlay && !reduce);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [, setTick] = useState(0);

  // Restart whenever the parent asks for a new run.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    tRef.current = 0;
    setPlaying(true);
  }, [runToken]);

  // HUD refresh (the canvas runs its own loop).
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let time = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      if (playingRef.current) {
        tRef.current = Math.min(total, tRef.current + dt);
        if (tRef.current >= total) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = camRef.current;
      const sway = reduce || c.dragging ? 0 : Math.sin(time * 0.18) * 0.22;
      renderScene(ctx, w, h, time, { yaw: c.yaw + sway, pitch: c.pitch }, mission, steps, tRef.current, reduce);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mission, steps, total, reduce]);

  const t = tRef.current;
  const idx = Math.min(steps.length - 1, Math.floor(t / STEP));
  const step = steps[idx];
  const metrics = metricsAt(mission, steps, t);
  const last = steps.length - 1;
  const rejected = steps[last].blocked && t >= arriveAt(last);
  const status: Status = rejected ? { tone: 'ok', text: 'Attack rejected, bridge stays solvent' } : mission.status(metrics);

  const toneClass =
    status.tone === 'bad'
      ? 'text-[#ff5d4a] border-[#ff5d4a]/40 bg-[#ff5d4a]/10'
      : status.tone === 'ok'
        ? 'text-[#5eead4] border-[#5eead4]/40 bg-[#5eead4]/10'
        : 'text-[#a49fb0] border-white/10 bg-white/5';

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    Object.assign(camRef.current, { dragging: true, x: e.clientX, y: e.clientY });
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = camRef.current;
    if (!c.dragging) return;
    c.yaw -= (e.clientX - c.x) * 0.006;
    c.pitch = clamp(c.pitch + (e.clientY - c.y) * 0.004, 0.08, 1.0);
    c.x = e.clientX;
    c.y = e.clientY;
  };
  const up = () => {
    camRef.current.dragging = false;
  };
  const key = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const c = camRef.current;
    if (e.key === 'ArrowLeft') c.yaw -= 0.1;
    else if (e.key === 'ArrowRight') c.yaw += 0.1;
    else if (e.key === 'ArrowUp') c.pitch = clamp(c.pitch + 0.05, 0.08, 1.0);
    else if (e.key === 'ArrowDown') c.pitch = clamp(c.pitch - 0.05, 0.08, 1.0);
  };

  const togglePlay = () => {
    if (!playing && tRef.current >= total) tRef.current = 0;
    setPlaying(!playing);
  };

  return (
    <div>
      <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#06050b]">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          tabIndex={0}
          role="img"
          aria-label={`3D replay of the ${mission.title} incident. Drag to rotate, or use the arrow keys. The captions below describe each step.`}
          className={`block w-full aspect-[16/11] cursor-grab active:cursor-grabbing touch-none ${FOCUS}`}
        />

        {/* Meters */}
        <div className="pointer-events-none absolute left-3 top-3 space-y-2">
          {mission.meters.map((m) => (
            <div key={m.id} className="px-3 py-2 rounded-xl bg-[#06050b]/75 border border-white/10 backdrop-blur-md">
              <div className="text-[11px] text-[#a49fb0]">{m.label}</div>
              <div className="text-lg font-semibold tabular-nums leading-tight">
                {Math.round(metrics[m.id]).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Status */}
        <div
          className={`pointer-events-none absolute right-3 top-3 max-w-[55%] px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 backdrop-blur-md ${toneClass}`}
        >
          {status.tone === 'bad' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
          {status.text}
        </div>

        {/* Caption */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pt-10 pb-3 bg-gradient-to-t from-[#06050b] via-[#06050b]/85 to-transparent"
          aria-live="polite"
        >
          <div className="text-[11px] text-[#a49fb0]">
            Step {idx + 1} of {steps.length}
          </div>
          <div className="text-sm font-semibold text-[#eee9dc]">{step.title}</div>
          <p className="text-xs text-[#c9c4d2] leading-relaxed mt-0.5">
            {step.blocked && t >= arriveAt(idx) ? step.blockedText : step.detail}
          </p>
        </div>
      </div>

      {/* Transport */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          className={`w-10 h-10 rounded-full flex items-center justify-center bg-[#e9b872] text-[#1a1208] hover:brightness-110 transition ${FOCUS}`}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={() => {
            tRef.current = 0;
            setPlaying(true);
          }}
          aria-label="Restart replay"
          className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/10 text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 transition ${FOCUS}`}
        >
          <RotateCcw size={15} />
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={t}
          onChange={(e) => {
            tRef.current = parseFloat(e.target.value);
            setPlaying(false);
          }}
          aria-label="Replay position"
          className={`flex-1 accent-[#e9b872] ${FOCUS}`}
        />
        <span className="text-xs text-[#a49fb0] tabular-nums w-20 text-right">
          {t.toFixed(1)}s / {total.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

