import { useEffect, useRef, useState, type RefObject } from 'react';
import type { StudioClock } from './audio';

/** True when the person asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The room's heartbeat. Writes --b (0..1, a sharp pulse on every beat) and --phase (0..1 within the beat)
 * onto `root`, so every light in the deck pulses from one number. Returns the current 16th-note step.
 * With reduced motion, or the ambient preference off, the lights hold still; the step marker still moves
 * because that is information, not decoration.
 */
export function useBeat(clock: StudioClock, root: RefObject<HTMLElement | null>, animate: boolean): number {
  const [step, setStep] = useState(0);
  const last = useRef(-1);
  useEffect(() => {
    let raf = 0;
    const el = root.current;
    el?.style.setProperty('--b', '0.25');
    const loop = () => {
      const beat = clock.beat();
      const s = ((Math.floor(beat * 4) % 16) + 16) % 16;
      if (s !== last.current) {
        last.current = s;
        setStep(s);
      }
      if (animate && el && clock.playing) {
        const ph = beat - Math.floor(beat);
        el.style.setProperty('--b', Math.exp(-ph * 5).toFixed(3));
        el.style.setProperty('--phase', ph.toFixed(3));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, root, animate]);
  return step;
}
