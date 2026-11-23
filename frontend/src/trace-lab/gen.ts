/** Tiny helpers for building believable synthetic evidence. Everything is seeded, so a case is identical on every run. */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    jitter: (base: number, pct: number) => base * (1 + (next() * 2 - 1) * pct),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "2026-03-04 22:41:07" from a base date string plus seconds. */
export function stamp(day: string, secs: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const base = Date.UTC(y, m - 1, d) + Math.round(secs) * 1000;
  const t = new Date(base);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`;
}
/** seconds since midnight from "HH:MM:SS". */
export const hms = (s: string): number => { const [h, m, x] = s.split(':').map(Number) as [number, number, number]; return h * 3600 + m * 60 + (x ?? 0); };
export const clock = (secs: number): string => { const s = Math.max(0, Math.round(secs)); return `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`; };

export const toHex = (s: string): string => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): string => {
  const out: number[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return new TextDecoder().decode(new Uint8Array(out));
};

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** DNS-safe base32 (lower case, no padding): what a DNS tunnel hides data in. */
export function b32enc(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32dec(s: string): string {
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.toLowerCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new TextDecoder().decode(new Uint8Array(out));
}

/** Hex rows of 16 bytes from raw text or a hex string. */
export function hexRows(data: Uint8Array | string, base = 0): { off: number; bytes: string }[] {
  const u = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const rows: { off: number; bytes: string }[] = [];
  for (let i = 0; i < u.length; i += 16) {
    rows.push({ off: base + i, bytes: Array.from(u.slice(i, i + 16), (b) => b.toString(16).padStart(2, '0')).join('') });
  }
  return rows;
}
export const asciiOf = (bytes: string): string => {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) { const c = parseInt(bytes.slice(i, i + 2), 16); s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.'; }
  return s;
};
export const hex8 = (n: number) => n.toString(16).padStart(8, '0');

export const ipOf = (r: ReturnType<typeof rng>, net: string) => `${net}.${r.int(2, 250)}`;
