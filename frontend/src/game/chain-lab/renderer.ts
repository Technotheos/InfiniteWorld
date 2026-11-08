import { FLOOR, clamp, easeInOut, easeOut, glow, hash, lerp, makeProjector, rgba, ring, rot, strokePts, type Cam, type Hue, type Projector, type V3 } from './math';
import type { Actor, Mission } from './missions';
import { TRAVEL, actorFx, arriveAt, outcomeHue, packetHue, startAt, type EStep } from './timeline';

/* ========================================================================== */
/*  3D scene renderer (dependency-free canvas)                                */
/* ========================================================================== */

export function drawActor(
  ctx: CanvasRenderingContext2D,
  P: Projector,
  a: Actor,
  time: number,
  fx: { pulse: number; tint: Hue | null },
) {
  const c = P(a.pos);
  const U = c.s;
  const base: Hue = fx.tint ?? a.hue;
  const pulse = fx.pulse;

  // Floor tether and shadow ring give depth.
  const f = P([a.pos[0], FLOOR, a.pos[2]]);
  ctx.strokeStyle = rgba(a.hue, 0.12);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(f.x, f.y);
  ctx.stroke();
  strokePts(ctx, ring([a.pos[0], FLOOR, a.pos[2]], 1.3, 0, 0, 32).map(P), rgba(a.hue, 0.2), 1);

  if (a.kind === 'core') {
    glow(ctx, c.x, c.y, U * (2.6 + pulse * 1.5), base, 0.3 + 0.45 * pulse);
    const r = U * 0.62;
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, rgba('ice', 0.95));
    g.addColorStop(0.45, rgba(base, 0.95));
    g.addColorStop(1, rgba(base, 0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    strokePts(ctx, ring(a.pos, 1.15, 0.5 + time * 0.3, time * 0.4).map(P), rgba(base, 0.55), 1.2);
    strokePts(ctx, ring(a.pos, 1.55, 1.25, -time * 0.25).map(P), rgba(base, 0.35), 1);
  } else if (a.kind === 'gate') {
    const outer = ring(a.pos, 1.7, Math.PI / 2, 0, 56).map(P);
    glow(ctx, c.x, c.y, U * (2.4 + pulse * 1.2), base, 0.12 + 0.3 * pulse);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, U * 1.7);
    g.addColorStop(0, rgba(base, 0.1 + 0.3 * pulse));
    g.addColorStop(1, rgba(base, 0.02));
    ctx.fillStyle = g;
    ctx.beginPath();
    outer.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.fill();
    strokePts(ctx, outer, rgba(base, 0.95), 2.2);
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -time * 22;
    strokePts(ctx, ring(a.pos, 1.2, Math.PI / 2, 0, 44).map(P), rgba(base, 0.6), 1.2);
    ctx.setLineDash([]);
  } else if (a.kind === 'swarm') {
    glow(ctx, c.x, c.y, U * (2.2 + pulse), base, 0.12 + 0.3 * pulse);
    strokePts(ctx, ring(a.pos, 1.7, 0, 0, 40).map(P), rgba(base, 0.25), 1);
    const N = 19;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + time * 0.35;
      const q = P([
        a.pos[0] + Math.cos(ang) * 1.7,
        a.pos[1] + Math.sin(time * 1.1 + i) * 0.25,
        a.pos[2] + Math.sin(ang) * 1.7,
      ]);
      glow(ctx, q.x, q.y, U * (0.3 + pulse * 0.25), base, 0.85);
      ctx.fillStyle = rgba('ice', 0.95);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1, U * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // shard: a spinning octahedron
    glow(ctx, c.x, c.y, U * (2 + pulse * 1.2), base, 0.22 + 0.4 * pulse);
    const S = 0.85;
    const raw: V3[] = [[S, 0, 0], [-S, 0, 0], [0, S * 1.25, 0], [0, -S * 1.25, 0], [0, 0, S], [0, 0, -S]];
    const v = raw.map((p) => {
      const q = rot(p, time * 0.5, time * 0.9);
      return P([a.pos[0] + q[0], a.pos[1] + q[1], a.pos[2] + q[2]]);
    });
    ctx.strokeStyle = rgba(base, 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        if (Math.floor(i / 2) === Math.floor(j / 2)) continue; // skip opposite vertices
        ctx.moveTo(v[i].x, v[i].y);
        ctx.lineTo(v[j].x, v[j].y);
      }
    }
    ctx.stroke();
  }
}

export function drawLabel(ctx: CanvasRenderingContext2D, P: Projector, a: Actor) {
  const c = P(a.pos);
  const y = c.y + c.s * 1.95 + 12;
  ctx.textAlign = 'center';
  ctx.font = '600 12px Manrope, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(238,233,220,0.95)';
  ctx.fillText(a.label, c.x, y);
  if (a.sub) {
    ctx.font = '400 10px Manrope, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(164,159,176,0.9)';
    ctx.fillText(a.sub, c.x, y + 14);
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  cam: Cam,
  mission: Mission,
  steps: EStep[],
  t: number,
  reduce: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  const P = makeProjector(cam, w, h);
  const byId = new Map(mission.actors.map((a) => [a.id, a]));

  ctx.save();
  if (!reduce) {
    steps.forEach((s, i) => {
      const dt = t - arriveAt(i);
      if (s.impact && !s.blocked && dt >= 0 && dt < 0.6) {
        const k = (1 - dt / 0.6) * 5;
        const f = Math.floor(t * 60);
        ctx.translate((hash(f) - 0.5) * k, (hash(f + 9) - 0.5) * k);
      }
    });
  }

  ctx.globalCompositeOperation = 'lighter';

  // Ambient glow
  const amb = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, w * 0.6);
  amb.addColorStop(0, rgba('violet', 0.09));
  amb.addColorStop(1, rgba('violet', 0));
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, w, h);

  // Depth stars
  for (let i = 0; i < 90; i++) {
    const q = P([(hash(i * 3.1) - 0.5) * 34, (hash(i * 5.7) - 0.5) * 16, (hash(i * 7.9) - 0.5) * 26]);
    const a = 0.2 + 0.3 * Math.sin(time * 1.2 + i);
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(238,233,220,${a})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(0.5, q.s * 0.03), 0, Math.PI * 2);
    ctx.fill();
  }

  // Floor lattice
  ctx.strokeStyle = rgba('gold', 0.08);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -12; k <= 12; k += 3) {
    const a = P([k, FLOOR, -12]);
    const b = P([k, FLOOR, 12]);
    const c = P([-12, FLOOR, k]);
    const d = P([12, FLOOR, k]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();

  // Actors, far to near
  const order = [...mission.actors].sort((a, b) => P(b.pos).d - P(a.pos).d);
  order.forEach((a) => drawActor(ctx, P, a, time, actorFx(a.id, steps, t)));

  // Packets with trails
  steps.forEach((s, i) => {
    const st = startAt(i);
    if (t < st || t > arriveAt(i) + 0.02) return;
    const A = byId.get(s.from)!;
    const B = byId.get(s.to)!;
    const dist = Math.hypot(B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]);
    const H = Math.min(2.6, 0.3 * dist + 0.6);
    const hue = packetHue(s);
    const at = (tau: number, jit: number): V3 => [
      lerp(A.pos[0], B.pos[0], tau) + (hash(jit) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
      lerp(A.pos[1], B.pos[1], tau) + Math.sin(Math.PI * tau) * H + (hash(jit + 4) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
      lerp(A.pos[2], B.pos[2], tau) + (hash(jit + 8) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
    ];
    for (let j = 16; j >= 0; j--) {
      const tj = t - j * 0.035;
      if (tj < st) continue;
      const tau = easeInOut(clamp((tj - st) / TRAVEL));
      const q = P(at(tau, Math.floor(tj * 40) + j));
      const fade = Math.pow(1 - j / 17, 1.6);
      glow(ctx, q.x, q.y, q.s * (0.12 + 0.34 * fade), hue, 0.18 + 0.7 * fade);
    }
    const head = P(at(easeInOut(clamp((t - st) / TRAVEL)), Math.floor(t * 40)));
    glow(ctx, head.x, head.y, head.s * 0.6, hue, 0.95);
    ctx.fillStyle = rgba('ice', 1);
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(1.5, head.s * 0.09), 0, Math.PI * 2);
    ctx.fill();

    // Chip
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 11px Manrope, ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(s.chip).width + 16;
    const cx = head.x + 14;
    const cy = head.y - 26;
    ctx.fillStyle = 'rgba(6,5,11,0.82)';
    ctx.strokeStyle = rgba(hue, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx, cy, tw, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(hue, 1);
    ctx.textAlign = 'left';
    ctx.fillText(s.chip, cx + 8, cy + 14);
    ctx.globalCompositeOperation = 'lighter';
  });

  // Arrival effects
  steps.forEach((s, i) => {
    const dt = t - arriveAt(i);
    if (dt < 0 || dt > 1.7) return;
    const B = byId.get(s.to)!;
    const c = P(B.pos);
    const hue = outcomeHue(s);
    const k = clamp(dt / 1.1);
    ctx.strokeStyle = rgba(hue, (1 - k) * 0.9);
    ctx.lineWidth = s.blocked ? 3 : 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, (s.blocked ? 3.2 : 2.4) * easeOut(k) * c.s, 0, Math.PI * 2);
    ctx.stroke();
    const n = s.blocked ? 36 : s.impact ? 40 : 18;
    for (let j = 0; j < n; j++) {
      const th = hash(j * 12.9 + i * 3) * Math.PI * 2;
      const ph = Math.acos(2 * hash(j * 7.3 + i) - 1);
      const sp = 1.6 + hash(j * 3.7 + i) * 2.2;
      const d = sp * easeOut(clamp(dt / 1.4));
      const q = P([
        B.pos[0] + Math.sin(ph) * Math.cos(th) * d,
        B.pos[1] + Math.cos(ph) * d,
        B.pos[2] + Math.sin(ph) * Math.sin(th) * d,
      ]);
      glow(ctx, q.x, q.y, q.s * 0.16, hue, clamp(1 - dt / 1.7) * 0.9);
    }
    if (s.impact && !s.blocked && dt < 0.9) {
      ctx.fillStyle = rgba('ember', 0.14 * (1 - dt / 0.9));
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
    if (s.blocked) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '700 14px Manrope, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba('mint', clamp(1.4 - dt));
      ctx.fillText('Rejected', c.x, c.y - c.s * 2.2 - dt * 14);
      ctx.globalCompositeOperation = 'lighter';
    }
  });

  // Labels and vignette on top, without additive blending
  ctx.globalCompositeOperation = 'source-over';
  mission.actors.forEach((a) => drawLabel(ctx, P, a));
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(6,5,11,0)');
  vg.addColorStop(1, 'rgba(6,5,11,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(-20, -20, w + 40, h + 40);
  ctx.restore();
}

