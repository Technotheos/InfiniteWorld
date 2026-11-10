// A tiny neural net written from scratch: tanh hidden layers, sigmoid output,
// binary cross-entropy loss, full-batch SGD or Adam. No libraries.
export type Opt = "sgd" | "adam";
export type DataKind = "circles" | "xor" | "spiral";
export interface Net { sizes: number[]; W: Float64Array[]; b: Float64Array[]; mW: Float64Array[]; vW: Float64Array[]; mb: Float64Array[]; vb: Float64Array[]; t: number }
export type Pt = { x: number; y: number; c: number };

const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const z = (n: number) => new Float64Array(n);

export function makeNet(sizes: number[]): Net {
  const W: Float64Array[] = [], b: Float64Array[] = [];
  for (let l = 1; l < sizes.length; l++) {
    const i = sizes[l - 1], o = sizes[l];
    W.push(Float64Array.from({ length: o * i }, () => randn() * Math.sqrt(1 / i)));
    b.push(z(o));
  }
  return { sizes, W, b, mW: W.map((w) => z(w.length)), vW: W.map((w) => z(w.length)), mb: b.map((v) => z(v.length)), vb: b.map((v) => z(v.length)), t: 0 };
}

/** a[0] = input, a[l] = activations of layer l */
export function forward(n: Net, x: number[]): Float64Array[] {
  const a: Float64Array[] = [Float64Array.from(x)], L = n.sizes.length - 1;
  for (let l = 1; l <= L; l++) {
    const i = n.sizes[l - 1], o = n.sizes[l], out = z(o);
    for (let j = 0; j < o; j++) {
      let s = n.b[l - 1][j];
      for (let k = 0; k < i; k++) s += n.W[l - 1][j * i + k] * a[l - 1][k];
      out[j] = l === L ? 1 / (1 + Math.exp(-s)) : Math.tanh(s);
    }
    a.push(out);
  }
  return a;
}

/** d[l] = dLoss/d(pre-activation of layer l). Output: yhat - y. Hidden: (W^T d_next) * (1 - a^2) */
export function backward(n: Net, a: Float64Array[], y: number): Float64Array[] {
  const L = n.sizes.length - 1, d: Float64Array[] = Array(L + 1).fill(null as unknown as Float64Array);
  d[L] = Float64Array.of(a[L][0] - y);
  for (let l = L - 1; l >= 1; l--) {
    const o = n.sizes[l], nxt = n.sizes[l + 1], out = z(o);
    for (let k = 0; k < o; k++) {
      let s = 0;
      for (let j = 0; j < nxt; j++) s += n.W[l][j * o + k] * d[l + 1][j];
      out[k] = s * (1 - a[l][k] * a[l][k]);
    }
    d[l] = out;
  }
  return d;
}

export function trainStep(n: Net, data: Pt[], opt: Opt, lr: number): number {
  const L = n.sizes.length - 1;
  const gW = n.W.map((w) => z(w.length)), gb = n.b.map((v) => z(v.length));
  let loss = 0;
  for (const p of data) {
    const a = forward(n, [p.x, p.y]), d = backward(n, a, p.c);
    const yh = Math.min(1 - 1e-9, Math.max(1e-9, a[L][0]));
    loss -= p.c * Math.log(yh) + (1 - p.c) * Math.log(1 - yh);
    for (let l = 1; l <= L; l++) {
      const i = n.sizes[l - 1];
      for (let j = 0; j < n.sizes[l]; j++) {
        gb[l - 1][j] += d[l][j];
        for (let k = 0; k < i; k++) gW[l - 1][j * i + k] += d[l][j] * a[l - 1][k];
      }
    }
  }
  const N = data.length; n.t++;
  const upd = (w: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array) => {
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] / N;
      if (opt === "sgd") { w[i] -= lr * gi; continue; }
      m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      w[i] -= (lr * (m[i] / (1 - 0.9 ** n.t))) / (Math.sqrt(v[i] / (1 - 0.999 ** n.t)) + 1e-8);
    }
  };
  for (let l = 0; l < L; l++) { upd(n.W[l], gW[l], n.mW[l], n.vW[l]); upd(n.b[l], gb[l], n.mb[l], n.vb[l]); }
  return loss / N;
}

export const predict = (n: Net, x: number, y: number) => forward(n, [x, y])[n.sizes.length - 1][0];

export function makeData(kind: DataKind, n = 140): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % 2, j = () => (Math.random() - 0.5) * 0.12;
    if (kind === "xor") { const x = (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.8), y = (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.8); out.push({ x, y, c: x * y > 0 ? 1 : 0 }); }
    else if (kind === "circles") { const r = (c ? 0.35 : 0.8) + j(), t = Math.random() * 6.283; out.push({ x: r * Math.cos(t), y: r * Math.sin(t), c }); }
    else { const t = (i / n) * 2 * 3.2 + 0.3, r = t / 4, s = c ? 0 : Math.PI; out.push({ x: r * Math.cos(t * 1.6 + s) + j(), y: r * Math.sin(t * 1.6 + s) + j(), c }); }
  }
  return out;
}
