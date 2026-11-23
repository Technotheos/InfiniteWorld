import type { AnyRow, Artifact, Case, Question, Ref } from './types';
import { ref } from './types';

/* ------------------------------ persistence ------------------------------ */

export interface QState { linked: Ref[]; wrong: number; solved: boolean; locked: boolean; hint: boolean; earned: number; picked: number | null }
export interface CaseState {
  pins: Record<Ref, number>;
  notes: Record<Ref, string>;
  theory: string;
  scratch: string;
  timeline: Ref[];
  q: Record<string, QState>;
  scanned: Record<string, boolean>;
  closed: boolean;
  seen: boolean;
}
export const emptyCase = (): CaseState => ({ pins: {}, notes: {}, theory: '', scratch: '', timeline: [], q: {}, scanned: {}, closed: false, seen: false });
export const emptyQ = (): QState => ({ linked: [], wrong: 0, solved: false, locked: false, hint: false, earned: 0, picked: null });

const CASE_KEY = (id: string) => `iw.trace.case.${id}`;
const PROG_KEY = 'iw.trace.v1';

export function loadCase(id: string): CaseState {
  try {
    const raw = localStorage.getItem(CASE_KEY(id));
    return raw ? { ...emptyCase(), ...(JSON.parse(raw) as CaseState) } : emptyCase();
  } catch { return emptyCase(); }
}
export function saveCase(id: string, s: CaseState) { try { localStorage.setItem(CASE_KEY(id), JSON.stringify(s)); } catch { /* private mode */ } }

export interface Result { xp: number; pct: number; stars: number }
export type TraceProgress = Record<string, Result>;
export function loadProgress(): TraceProgress {
  try { const p = JSON.parse(localStorage.getItem(PROG_KEY) ?? '{}') as TraceProgress; return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}
export function saveProgress(p: TraceProgress) { try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
export const totalXp = (p: TraceProgress) => Object.values(p).reduce((a, b) => a + b.xp, 0);

export const RANKS = [
  { at: 0, title: 'Intern' }, { at: 150, title: 'Junior Analyst' }, { at: 400, title: 'Analyst' },
  { at: 700, title: 'Senior Analyst' }, { at: 1000, title: 'Lead Investigator' },
];
export function rankFor(xp: number) {
  let i = 0;
  RANKS.forEach((r, k) => { if (xp >= r.at) i = k; });
  const next = RANKS[i + 1] ?? null;
  return { title: RANKS[i]!.title, next, pct: next ? ((xp - RANKS[i]!.at) / (next.at - RANKS[i]!.at)) * 100 : 100 };
}

/* -------------------------------- lookups -------------------------------- */

export function findRow(c: Case, r: Ref): { art: Artifact; row: AnyRow } | null {
  const i = r.indexOf(':');
  const art = c.artifacts.find((a) => a.id === r.slice(0, i));
  const row = art ? (art.rows as AnyRow[]).find((x) => x.id === r.slice(i + 1)) : undefined;
  return art && row ? { art, row } : null;
}

export function rowText(art: Artifact, row: AnyRow): string {
  if (row.sum) return row.sum;
  switch (art.kind) {
    case 'table': { const cells = (row as { cells: Record<string, string> }).cells; return art.cols.slice(0, 3).map((c) => cells[c.k]).filter(Boolean).join(' · '); }
    case 'disk': return (row as { path: string }).path;
    case 'pcap': { const p = row as { src: string; dst: string; info: string }; return `${p.src} → ${p.dst} ${p.info}`; }
    case 'proc': { const p = row as { name: string; pid: number }; return `${p.name} (${p.pid})`; }
    case 'hex': return `offset 0x${(row as { off: number }).off.toString(16)}`;
    case 'chain': { const e = row as { from: string; to: string; amt: string; asset: string }; return `${e.from} → ${e.to} · ${e.amt} ${e.asset}`; }
  }
}

/** The time printed in the evidence itself (what a player can read off), for the timeline strip. */
export function rowTs(art: Artifact, row: AnyRow): string {
  switch (art.kind) {
    case 'table': { const c = (row as { cells: Record<string, string> }).cells; return c.time ?? c.when ?? c.first ?? c.start ?? c.created ?? ''; }
    case 'disk': return (row as { c: string }).c;
    case 'pcap': { const t = (row as { t: number }).t; return `+${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, '0')}s`; }
    case 'proc': return (row as { created: string }).created;
    case 'chain': return (row as { time: string }).time;
    default: return '';
  }
}

export const pinsOf = (s: CaseState): Ref[] => Object.keys(s.pins).sort((a, b) => (s.pins[a] ?? 0) - (s.pins[b] ?? 0));

/** Hosts the player has *proven* (by pinning a key row that touches them). */
export function provenHosts(c: Case, s: CaseState): Set<string> {
  const out = new Set<string>();
  for (const r of Object.keys(s.pins)) {
    const f = findRow(c, r);
    if (f?.row.role === 'key' && f.row.touches) f.row.touches.split(',').forEach((h) => out.add(h));
  }
  return out;
}

/* -------------------------------- answering ------------------------------- */

export type Verdict = 'noproof' | 'herring' | 'wrong' | 'locked' | 'ok';
export const MAX_ATTEMPTS = 2;
export const MAX_LINKS = 8;

export function answer(c: Case, s: CaseState, q: Question, choice: number): { s: CaseState; verdict: Verdict; msg: string } {
  const cur = s.q[q.id] ?? emptyQ();
  const linked = cur.linked.filter((r) => r in s.pins);
  const bad = linked.filter((r) => findRow(c, r)?.row.role === 'herring');
  if (bad.length) {
    return { s, verdict: 'herring', msg: 'Part of your proof does not hold up. Something you linked is routine activity. Compare it against the baseline and unlink it.' };
  }
  const good = new Set(linked.filter((r) => q.proof.includes(r)));
  if (good.size < q.need) {
    return { s, verdict: 'noproof', msg: good.size === 0 ? 'No proof, no answer. Pin the evidence that supports it and link it here.' : `Not enough proof yet. This question needs ${q.need} supporting pieces of evidence (you have ${good.size}).` };
  }
  if (choice === q.answer) {
    const earned = Math.round(q.points * (1 - 0.35 * cur.wrong) * (cur.hint ? 0.8 : 1));
    return { s: { ...s, q: { ...s.q, [q.id]: { ...cur, linked, solved: true, earned, picked: choice } } }, verdict: 'ok', msg: q.explain };
  }
  const wrong = cur.wrong + 1;
  const locked = wrong >= MAX_ATTEMPTS;
  return {
    s: { ...s, q: { ...s.q, [q.id]: { ...cur, linked, wrong, locked, picked: choice } } },
    verdict: locked ? 'locked' : 'wrong',
    msg: locked ? 'Out of attempts. This question is closed with no points. You will see the answer in the replay.' : 'Your evidence is real, but it does not support that conclusion. Look again. Each wrong answer costs 35 % of the points.',
  };
}

/* --------------------------------- scoring -------------------------------- */

export interface Score {
  pct: number; xp: number; stars: number;
  questions: number; completeness: number; accuracy: number; timeline: number;
  covered: string[]; missed: string[]; falsePositives: Ref[];
}

export function scoreCase(c: Case, s: CaseState): Score {
  const stepIdx = new Map(c.steps.map((st, i) => [st.id, i]));
  const covered = new Set<string>();
  const fps: Ref[] = [];
  for (const r of Object.keys(s.pins)) {
    const f = findRow(c, r);
    if (!f) continue;
    if (f.row.role === 'key' && f.row.step) covered.add(f.row.step);
    if (f.row.role === 'herring') fps.push(r);
  }
  const total = c.questions.reduce((a, q) => a + q.points, 0);
  const got = c.questions.reduce((a, q) => a + (s.q[q.id]?.earned ?? 0), 0);
  const qScore = total ? got / total : 0;
  const completeness = covered.size / c.steps.length;
  const accuracy = Math.max(0.4, 1 - 0.15 * fps.length);

  const placed = s.timeline.map((r) => findRow(c, r)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const tlSteps = new Set<string>();
  let pairs = 0, right = 0;
  const idx = placed.map((f) => (f.row.role === 'key' && f.row.step ? stepIdx.get(f.row.step) ?? -1 : -1));
  idx.forEach((v) => { if (v >= 0) tlSteps.add(c.steps[v]!.id); });
  for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
    if (idx[i]! < 0 || idx[j]! < 0 || idx[i] === idx[j]) continue;
    pairs++; if (idx[i]! < idx[j]!) right++;
  }
  const ordering = pairs ? right / pairs : tlSteps.size ? 1 : 0;
  const tl = 0.5 * ordering + 0.5 * (tlSteps.size / c.steps.length);

  const pct = 0.6 * qScore + 0.15 * completeness + 0.15 * tl + 0.1 * accuracy * (covered.size ? 1 : 0);
  const stars = pct >= 0.9 ? 3 : pct >= 0.7 ? 2 : 1;
  return {
    pct, xp: Math.round(c.base * pct), stars, questions: qScore, completeness, accuracy, timeline: tl,
    covered: [...covered], missed: c.steps.filter((st) => !covered.has(st.id)).map((st) => st.id), falsePositives: fps,
  };
}

export const allResolved = (c: Case, s: CaseState) => c.questions.every((q) => s.q[q.id]?.solved || s.q[q.id]?.locked);
export { ref };
