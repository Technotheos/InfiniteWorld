/*  Math, palette, 3D helpers                                                 */
/* ========================================================================== */

export type V3 = [number, number, number];
export interface Cam {
  yaw: number;
  pitch: number;
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
// Deterministic pseudo-random in [0,1): keeps every frame a pure function of time.
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export const RGB = {
  gold: [233, 184, 114],
  violet: [155, 140, 255],
  ember: [255, 93, 74],
  mint: [94, 234, 212],
  ice: [190, 214, 255],
} as const;
export type Hue = keyof typeof RGB;
export const rgba = (h: Hue, a: number) => `rgba(${RGB[h][0]},${RGB[h][1]},${RGB[h][2]},${a})`;

export const FLOOR = -2.6;

export function makeProjector(cam: Cam, w: number, h: number) {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const D = 22;
  const unit = w / 21;
  return (p: V3) => {
    const x1 = p[0] * cy - p[2] * sy;
    const z1 = p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp + z1 * sp;
    const z2 = -p[1] * sp + z1 * cp;
    const depth = D + z2;
    const s = (unit * D) / depth;
    return { x: w / 2 + x1 * s, y: h * 0.54 - y2 * s, s, d: depth };
  };
}
export type Projector = ReturnType<typeof makeProjector>;

export function rot(p: V3, rx: number, ry: number): V3 {
  const crx = Math.cos(rx);
  const srx = Math.sin(rx);
  const cry = Math.cos(ry);
  const sry = Math.sin(ry);
  const y1 = p[1] * crx - p[2] * srx;
  const z1 = p[1] * srx + p[2] * crx;
  return [p[0] * cry + z1 * sry, y1, -p[0] * sry + z1 * cry];
}

export function ring(c: V3, r: number, rx: number, ry: number, n = 40): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const q = rot([Math.cos(a) * r, 0, Math.sin(a) * r], rx, ry);
    pts.push([c[0] + q[0], c[1] + q[1], c[2] + q[2]]);
  }
  return pts;
}

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: Hue, a: number) {
  if (r <= 0.5) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hue, a));
  g.addColorStop(1, rgba(hue, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function strokePts(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: string,
  lw: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
  ctx.stroke();
}

