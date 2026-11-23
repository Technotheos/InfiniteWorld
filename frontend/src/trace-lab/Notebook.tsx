import { useState } from 'react';
import { BookOpen, CheckCircle2, Lightbulb, Link2, Lock, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import type { Case, Question, Ref } from './types';
import { MAX_ATTEMPTS, MAX_LINKS, answer, emptyQ, findRow, pinsOf, rowText, rowTs, type CaseState, type Verdict } from './store';
import { sfx } from '../sound';

type Setter = (fn: (s: CaseState) => CaseState) => void;
interface Props { c: Case; s: CaseState; setS: Setter; onJump: (artId: string) => void; readOnly?: boolean }
type Fb = { verdict: Verdict; msg: string };

const STAMP: Record<Verdict, string> = { ok: 'VERIFIED', wrong: 'NOT SUPPORTED', locked: 'CLOSED', noproof: 'NO PROOF', herring: 'FALSE LEAD' };

export function Notebook({ c, s, setS, onJump, readOnly }: Props) {
  const [tab, setTab] = useState<'q' | 'e' | 't'>('q');
  const pins = pinsOf(s);
  const done = c.questions.filter((q) => s.q[q.id]?.solved || s.q[q.id]?.locked).length;
  return (
    <div className="tl-notebook">
      <div className="tl-seg" role="tablist" aria-label="Notebook sections">
        {([['q', `Questions ${done}/${c.questions.length}`], ['e', `Evidence ${pins.length}`], ['t', 'Theory & notes']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'q' && <div className="tl-qlist">{c.questions.map((q, i) => <QCard key={q.id} c={c} s={s} setS={setS} q={q} n={i + 1} onSwitch={() => setTab('e')} readOnly={readOnly} />)}</div>}
      {tab === 'e' && (
        <div className="tl-pinlist">
          {!pins.length && <p className="tl-empty-note"><BookOpen size={18} /> Nothing pinned yet. Open an evidence bag in the workbench and pin the rows that matter. Everything you pin collects here.</p>}
          {pins.map((r) => {
            const f = findRow(c, r);
            if (!f) return null;
            return (
              <article key={r} className="tl-pincard">
                <header>
                  <button type="button" className="tag" onClick={() => onJump(f.art.id)} title="Open in the workbench">{f.art.label}</button>
                  <span className="ts">{rowTs(f.art, f.row)}</span>
                  {!readOnly && <button type="button" className="tl-x" aria-label="Unpin" onClick={() => setS((st) => unpin(st, r))}><Trash2 size={14} /></button>}
                </header>
                <p>{rowText(f.art, f.row)}</p>
                <input className="note" placeholder="Your note on this evidence…" value={s.notes[r] ?? ''} disabled={readOnly} maxLength={200}
                  onChange={(e) => setS((st) => ({ ...st, notes: { ...st.notes, [r]: e.target.value } }))} />
              </article>
            );
          })}
        </div>
      )}
      {tab === 't' && (
        <div className="tl-theory">
          <label>Your theory of the attack<textarea rows={6} value={s.theory} disabled={readOnly} maxLength={1500} placeholder="Who did what, in what order, and how did they get in?" onChange={(e) => setS((st) => ({ ...st, theory: e.target.value }))} /></label>
          <label>Scratch notes<textarea rows={4} value={s.scratch} disabled={readOnly} maxLength={1500} placeholder="Serial numbers, times, hunches…" onChange={(e) => setS((st) => ({ ...st, scratch: e.target.value }))} /></label>
        </div>
      )}
    </div>
  );
}

export function unpin(st: CaseState, r: Ref): CaseState {
  const pins = { ...st.pins }; delete pins[r];
  const q = Object.fromEntries(Object.entries(st.q).map(([k, v]) => [k, { ...v, linked: v.linked.filter((x) => x !== r) }]));
  return { ...st, pins, q, timeline: st.timeline.filter((x) => x !== r) };
}

function QCard({ c, s, setS, q, n, onSwitch, readOnly }: { c: Case; s: CaseState; setS: Setter; q: Question; n: number; onSwitch: () => void; readOnly?: boolean }) {
  const qs = s.q[q.id] ?? emptyQ();
  const [pick, setPick] = useState<number | null>(qs.picked);
  const [fb, setFb] = useState<Fb | null>(null);
  const [linking, setLinking] = useState(false);
  const closed = qs.solved || qs.locked || readOnly;
  const pins = pinsOf(s);
  const linked = qs.linked.filter((r) => r in s.pins);
  const toggle = (r: Ref) => setS((st) => {
    const cur = st.q[q.id] ?? emptyQ();
    const has = cur.linked.includes(r);
    if (!has && cur.linked.length >= MAX_LINKS) return st;
    return { ...st, q: { ...st.q, [q.id]: { ...cur, linked: has ? cur.linked.filter((x) => x !== r) : [...cur.linked, r] } } };
  });

  const submit = () => {
    if (pick === null) { setFb({ verdict: 'noproof', msg: 'Choose an answer first.' }); return; }
    const res = answer(c, s, q, pick);
    setS(() => res.s);
    setFb({ verdict: res.verdict, msg: res.msg });
    sfx(res.verdict === 'ok' ? 'success' : 'fail');
  };

  return (
    <section className={`tl-q${qs.solved ? ' solved' : ''}${qs.locked ? ' locked' : ''}`}>
      <header>
        <span className="n">Q{n}</span>
        <h4>{q.prompt}</h4>
        <span className="pts">{qs.solved ? `+${qs.earned}` : `${q.points} pts`}</span>
      </header>
      <div className="opts" role="radiogroup" aria-label={q.prompt}>
        {q.options.map((o, i) => (
          <label key={i} className={`${pick === i ? 'on' : ''}${(qs.solved || qs.locked) && i === q.answer ? ' right' : ''}${qs.locked && qs.picked === i ? ' wrongpick' : ''}`}>
            <input type="radio" name={q.id} checked={pick === i} disabled={closed} onChange={() => setPick(i)} />
            <span>{o}</span>
          </label>
        ))}
      </div>

      {!closed && (
        <>
          <div className="proof">
            <div className="ph"><Link2 size={14} /> Proof ({linked.length}/{MAX_LINKS}) · needs {q.need === 1 ? 'at least 1 piece' : `${q.need} pieces`} of supporting evidence</div>
            <div className="chips">
              {linked.map((r) => { const f = findRow(c, r); return f && <button key={r} type="button" className="chip" onClick={() => toggle(r)} title="Unlink">{rowText(f.art, f.row).slice(0, 48)} ×</button>; })}
              {!linked.length && <span className="tl-dimtxt">Nothing linked yet.</span>}
            </div>
            <button type="button" className="tl-btn small" onClick={() => (pins.length ? setLinking(!linking) : onSwitch())}>{linking ? 'Done linking' : pins.length ? 'Link pinned evidence' : 'Pin evidence first'}</button>
            {linking && (
              <ul className="picker">
                {pins.map((r) => { const f = findRow(c, r); if (!f) return null; return (
                  <li key={r}><label><input type="checkbox" checked={linked.includes(r)} onChange={() => toggle(r)} /><span><b>{f.art.label}</b> {rowText(f.art, f.row)}</span></label></li>
                ); })}
              </ul>
            )}
          </div>
          <div className="actions">
            <button type="button" className="tl-btn primary" onClick={submit}>Submit with proof</button>
            <button type="button" className="tl-btn small ghost" disabled={qs.hint} onClick={() => setS((st) => ({ ...st, q: { ...st.q, [q.id]: { ...(st.q[q.id] ?? emptyQ()), hint: true } } }))}><Lightbulb size={14} /> {qs.hint ? 'Hint used' : 'Hint (−20 %)'}</button>
            <span className="tl-dimtxt">{MAX_ATTEMPTS - qs.wrong} attempt{MAX_ATTEMPTS - qs.wrong === 1 ? '' : 's'} left</span>
          </div>
          {qs.hint && <p className="hint"><Lightbulb size={14} /> {q.hint}</p>}
        </>
      )}

      {fb && !qs.solved && (
        <div className={`fb ${fb.verdict}`} key={`${fb.verdict}${qs.wrong}`}>
          <span className="stamp">{fb.verdict === 'herring' ? <ShieldAlert size={14} /> : fb.verdict === 'locked' ? <Lock size={14} /> : <XCircle size={14} />} {STAMP[fb.verdict]}</span>
          <p>{fb.msg}</p>
        </div>
      )}
      {qs.solved && <div className="fb ok"><span className="stamp"><CheckCircle2 size={14} /> VERIFIED</span><p>{q.explain}</p></div>}
      {qs.locked && !qs.solved && <div className="fb locked"><span className="stamp"><Lock size={14} /> CLOSED</span><p>Answer: {q.options[q.answer]}. {q.explain}</p></div>}
    </section>
  );
}
