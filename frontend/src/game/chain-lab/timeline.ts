import { clamp, easeOut, type Hue } from './math';
import type { Mission, Step } from './missions';

/* ========================================================================== */
/*  Timeline (every frame is a pure function of time t)                       */
/* ========================================================================== */

export const STEP = 3.4;
export const LEAD = 0.4;
export const TRAVEL = 1.7;
export const TAIL = 1.4;

export interface EStep extends Step {
  blocked: boolean;
}

export function buildSteps(m: Mission, patched: boolean): EStep[] {
  if (!patched) return m.steps.map((s) => ({ ...s, blocked: false }));
  const idx = m.steps.findIndex((s) => s.blockable);
  const cut = idx === -1 ? m.steps.length : idx + 1;
  return m.steps.slice(0, cut).map((s, i) => ({ ...s, blocked: idx !== -1 && i === idx }));
}
export const startAt = (i: number) => i * STEP + LEAD;
export const arriveAt = (i: number) => startAt(i) + TRAVEL;
export const totalTime = (n: number) => (n - 1) * STEP + LEAD + TRAVEL + TAIL;

export function metricsAt(m: Mission, steps: EStep[], t: number) {
  const cur: Record<string, number> = {};
  m.meters.forEach((x) => (cur[x.id] = x.start));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.after || s.blocked) continue;
    const at = arriveAt(i);
    if (t < at) break;
    const e = easeOut(clamp((t - at) / 0.9));
    Object.keys(s.after).forEach((k) => {
      cur[k] = cur[k] + (s.after![k] - cur[k]) * e;
    });
  }
  return cur;
}

export const packetHue = (s: EStep): Hue => (s.kind === 'ok' ? 'gold' : s.kind === 'sig' ? 'violet' : 'ember');
export const outcomeHue = (s: EStep): Hue => (s.blocked ? 'mint' : packetHue(s));

export function actorFx(id: string, steps: EStep[], t: number) {
  let pulse = 0;
  let tint: Hue | null = null;
  steps.forEach((s, i) => {
    const a = arriveAt(i);
    const st = startAt(i);
    if (s.to === id && t >= a) {
      pulse = Math.max(pulse, clamp(1 - (t - a) / 1.3));
      tint = outcomeHue(s);
    }
    if (s.from === id && t >= st) pulse = Math.max(pulse, clamp(1 - (t - st) / 0.7) * 0.7);
  });
  return { pulse, tint: tint as Hue | null };
}

