import { useRef, useState } from 'react';
import { ArrowLeft, Check, Lightbulb } from 'lucide-react';
import type { Mission } from './missions';
import { SimStage } from './SimStage';
import { FOCUS } from './ui';

/* ========================================================================== */
/*  Mission flow: brief, replay, audit, patch, debrief                        */
/* ========================================================================== */

export type Stage = 'brief' | 'replay' | 'audit' | 'patch' | 'debrief';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'brief', label: 'Briefing' },
  { id: 'replay', label: 'Replay' },
  { id: 'audit', label: 'Audit' },
  { id: 'patch', label: 'Patch' },
  { id: 'debrief', label: 'Debrief' },
];
export const BASE_XP = 100;
export const BONUS_XP = 25;

export function MissionView({
  mission,
  alreadyDone,
  onBack,
  onComplete,
}: {
  mission: Mission;
  alreadyDone: boolean;
  onBack: () => void;
  onComplete: (id: string, xp: number) => void;
}) {
  const [stage, setStage] = useState<Stage>('brief');
  const [unlocked, setUnlocked] = useState(0);
  const [runToken, setRunToken] = useState(0);
  const [patched, setPatched] = useState(false);

  const [picked, setPicked] = useState<number[]>([]);
  const [auditTries, setAuditTries] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [auditSolved, setAuditSolved] = useState(false);
  const [auditMsg, setAuditMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const [chosen, setChosen] = useState<string | null>(null);
  const [patchTries, setPatchTries] = useState(0);
  const [patchSolved, setPatchSolved] = useState(false);
  const [patchMsg, setPatchMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const earned = alreadyDone
    ? 0
    : BASE_XP + (auditTries === 0 && !hintUsed ? BONUS_XP : 0) + (patchTries === 0 ? BONUS_XP : 0);
  const reported = useRef(false);

  const go = (s: Stage) => {
    const i = STAGES.findIndex((x) => x.id === s);
    setUnlocked((u) => Math.max(u, i));
    setStage(s);
    if (s === 'debrief' && !reported.current) {
      reported.current = true;
      onComplete(mission.id, earned);
    }
  };

  const toggleLine = (n: number) => {
    if (auditSolved) return;
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  };

  const submitAudit = () => {
    const v = new Set(mission.code.vulnerable);
    const wrong = picked.filter((n) => !v.has(n));
    const hit = picked.some((n) => v.has(n));
    if (picked.length && !wrong.length && hit) {
      setAuditSolved(true);
      setAuditMsg({ tone: 'ok', text: mission.code.explain });
      return;
    }
    setAuditTries((n) => n + 1);
    if (wrong.length) {
      const note = mission.code.lines.find((l) => l.n === wrong[0])?.note;
      setAuditMsg({ tone: 'bad', text: note ?? 'That line is not the root cause. Look at what the code trusts.' });
    } else {
      setAuditMsg({ tone: 'bad', text: 'Select at least one line where untrusted input is accepted without a check.' });
    }
  };

  const applyFix = () => {
    const fix = mission.fixes.find((f) => f.id === chosen);
    if (!fix) return;
    if (fix.correct) {
      setPatchSolved(true);
      setPatchMsg({ tone: 'ok', text: fix.why });
    } else {
      setPatchTries((n) => n + 1);
      setPatchMsg({ tone: 'bad', text: fix.why });
    }
  };

  const watchPatched = () => {
    setPatched(true);
    setStage('patch');
  };

  const panel = 'rounded-2xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md p-5';
  const primary = `px-5 py-2.5 rounded-xl bg-[#e9b872] text-[#1a1208] font-bold text-sm hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition ${FOCUS}`;
  const ghost = `px-4 py-2.5 rounded-xl border border-white/10 text-sm text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 transition ${FOCUS}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button onClick={onBack} className={`flex items-center gap-2 text-sm text-[#a49fb0] hover:text-[#eee9dc] ${FOCUS} rounded-lg`}>
          <ArrowLeft size={16} /> Sector map
        </button>
        <ol className="flex flex-wrap items-center gap-2" aria-label="Mission progress">
          {STAGES.map((s, i) => {
            const active = stage === s.id;
            const done = i < unlocked;
            return (
              <li key={s.id}>
                <button
                  disabled={i > unlocked}
                  onClick={() => setStage(s.id)}
                  aria-current={active ? 'step' : undefined}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition ${FOCUS} ${
                    active
                      ? 'border-[#e9b872] text-[#e9b872] bg-[#e9b872]/10'
                      : i > unlocked
                        ? 'border-white/5 text-[#5b576a] cursor-not-allowed'
                        : 'border-white/10 text-[#a49fb0] hover:text-[#eee9dc]'
                  }`}
                >
                  {done && <Check size={12} />} {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <h3 className="iw-display text-4xl font-light tracking-wide">{mission.title}</h3>
        <p className="text-sm text-[#a49fb0] mt-1">
          {mission.chain} · {mission.date}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
        {/* Left: stage */}
        <div className="xl:col-span-3 space-y-3">
          {patchSolved && (
            <div className="inline-flex rounded-xl border border-white/10 p-1 bg-black/40" role="group" aria-label="Replay version">
              {[
                { v: false, label: 'Original incident' },
                { v: true, label: 'With your patch' },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setPatched(o.v)}
                  aria-pressed={patched === o.v}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${FOCUS} ${
                    patched === o.v ? 'bg-[#e9b872] text-[#1a1208]' : 'text-[#a49fb0] hover:text-[#eee9dc]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <SimStage
            key={`${mission.id}-${patched ? 'patched' : 'original'}`}
            mission={mission}
            patched={patched}
            autoPlay={patched}
            runToken={runToken}
          />
        </div>

        {/* Right: stage content */}
        <div className="xl:col-span-2 space-y-4">
          {stage === 'brief' && (
            <div className={panel}>
              <div className="space-y-3 text-sm leading-relaxed text-[#d8d3df]">
                {mission.story.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-2">
                {mission.facts.map((f) => (
                  <div key={f.k} className="flex justify-between gap-4 text-xs border-t border-white/10 pt-2">
                    <dt className="text-[#a49fb0]">{f.k}</dt>
                    <dd className="text-[#eee9dc] text-right">{f.v}</dd>
                  </div>
                ))}
              </dl>
              <button
                className={`${primary} mt-5`}
                onClick={() => {
                  setRunToken((n) => n + 1);
                  go('replay');
                }}
              >
                Watch the replay
              </button>
            </div>
          )}

          {stage === 'replay' && (
            <div className={panel}>
              <h4 className="text-sm font-semibold mb-3">What to watch for</h4>
              <ul className="space-y-2 text-sm text-[#d8d3df] leading-relaxed list-disc pl-5 marker:text-[#e9b872]">
                {mission.watchFor.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="text-xs text-[#a49fb0] mt-4">
                This is an educational simulation of a public incident. Drag the scene to look around, or scrub the timeline.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className={primary} onClick={() => go('audit')}>
                  Find the flaw
                </button>
                <button className={ghost} onClick={() => setRunToken((n) => n + 1)}>
                  Replay again
                </button>
              </div>
            </div>
          )}

          {stage === 'audit' && (
            <div className={panel}>
              <h4 className="text-sm font-semibold">Audit: {mission.code.title}</h4>
              <p className="text-xs text-[#a49fb0] mt-1 mb-3">Select the line or lines that make the exploit possible.</p>
              <div className="rounded-xl bg-black/50 border border-white/10 py-2 overflow-x-auto font-mono text-[12px]" role="group" aria-label="Code lines">
                {mission.code.lines.map((l) => {
                  const sel = picked.includes(l.n);
                  const bug = auditSolved && mission.code.vulnerable.includes(l.n);
                  return (
                    <button
                      key={l.n}
                      onClick={() => toggleLine(l.n)}
                      aria-pressed={sel}
                      className={`w-full flex gap-3 px-3 py-1 text-left whitespace-pre transition-colors ${FOCUS} ${
                        bug
                          ? 'bg-[#ff5d4a]/15 text-[#ffb4aa]'
                          : sel
                            ? 'bg-[#e9b872]/15 text-[#f5dcb4]'
                            : 'text-[#c9c4d2] hover:bg-white/5'
                      }`}
                    >
                      <span className="w-5 shrink-0 text-right text-[#5b576a]">{l.n}</span>
                      <span>{l.code}</span>
                    </button>
                  );
                })}
              </div>
              {auditMsg && (
                <p
                  className={`mt-3 text-sm leading-relaxed rounded-xl border px-3 py-2 ${
                    auditMsg.tone === 'ok'
                      ? 'border-[#5eead4]/40 bg-[#5eead4]/10 text-[#c8f7ef]'
                      : 'border-[#ff5d4a]/40 bg-[#ff5d4a]/10 text-[#ffc9c2]'
                  }`}
                  role="status"
                >
                  {auditMsg.text}
                </p>
              )}
              {hintUsed && !auditSolved && (
                <p className="mt-3 text-xs text-[#e9b872]">Hint: {mission.code.hint}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {!auditSolved ? (
                  <>
                    <button className={primary} onClick={submitAudit} disabled={picked.length === 0}>
                      Submit finding
                    </button>
                    <button className={ghost} onClick={() => setHintUsed(true)}>
                      <span className="inline-flex items-center gap-1.5">
                        <Lightbulb size={14} /> Hint
                      </span>
                    </button>
                  </>
                ) : (
                  <button className={primary} onClick={() => go('patch')}>
                    Write the fix
                  </button>
                )}
              </div>
            </div>
          )}

          {stage === 'patch' && (
            <div className={panel}>
              <h4 className="text-sm font-semibold">Choose the patch</h4>
              <p className="text-xs text-[#a49fb0] mt-1 mb-3">Pick the change that fixes the root cause.</p>
              <div className="space-y-2" role="radiogroup" aria-label="Patch options">
                {mission.fixes.map((f) => (
                  <button
                    key={f.id}
                    role="radio"
                    aria-checked={chosen === f.id}
                    disabled={patchSolved}
                    onClick={() => setChosen(f.id)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition ${FOCUS} ${
                      chosen === f.id
                        ? 'border-[#e9b872] bg-[#e9b872]/10'
                        : 'border-white/10 hover:bg-white/5'
                    } ${patchSolved && !f.correct ? 'opacity-40' : ''}`}
                  >
                    <div className="text-sm font-semibold text-[#eee9dc]">{f.title}</div>
                    <div className="text-xs text-[#a49fb0] mt-0.5 leading-relaxed">{f.body}</div>
                  </button>
                ))}
              </div>
              {patchMsg && (
                <p
                  className={`mt-3 text-sm leading-relaxed rounded-xl border px-3 py-2 ${
                    patchMsg.tone === 'ok'
                      ? 'border-[#5eead4]/40 bg-[#5eead4]/10 text-[#c8f7ef]'
                      : 'border-[#ff5d4a]/40 bg-[#ff5d4a]/10 text-[#ffc9c2]'
                  }`}
                  role="status"
                >
                  {patchMsg.text}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {!patchSolved ? (
                  <button className={primary} onClick={applyFix} disabled={!chosen}>
                    Apply patch
                  </button>
                ) : (
                  <>
                    <button className={primary} onClick={watchPatched}>
                      Run the patched replay
                    </button>
                    <button className={ghost} onClick={() => go('debrief')}>
                      Continue to debrief
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {stage === 'debrief' && (
            <div className={panel}>
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">Mission charted</h4>
                <span className="text-xs px-3 py-1 rounded-full border border-[#e9b872]/40 text-[#e9b872] bg-[#e9b872]/10">
                  {alreadyDone ? 'Already charted' : `+${earned} XP`}
                </span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-[#d8d3df] leading-relaxed list-disc pl-5 marker:text-[#e9b872]">
                {mission.lessons.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="text-xs text-[#a49fb0] mt-4">{mission.sources}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className={primary} onClick={onBack}>
                  Back to the sector map
                </button>
                <button
                  className={ghost}
                  onClick={() => {
                    setPatched(false);
                    setRunToken((n) => n + 1);
                    setStage('replay');
                  }}
                >
                  Watch it again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

