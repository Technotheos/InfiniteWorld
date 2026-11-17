import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../ui";
import { Scene3D } from "../three/Scene3D";
import type { MissionProps, MyClaim, MysteryPhase, MysteryPlay, MysteryPrivate, MysteryRole } from "../types";
import type { MysterySceneState } from "../three/mysteryScene";
import "../rooms.css";

const loadScene = () => import("../three/mysteryScene").then((m) => m.createMysteryScene);

const COAT_CSS = ["#e63946", "#3a7bd5", "#2fbf71", "#f2c94c", "#8e5ad7", "#f28c28", "#ecebe6", "#1fb5b0"];

const PHASES: Array<[MysteryPhase, string]> = [
  ["intro", "Crime scene"], ["alibi", "Alibis"], ["investigate", "Investigate"],
  ["interrogate", "Interrogate"], ["vote", "Vote"], ["unmask", "Unmask"],
];

const PHASE_HELP: Record<MysteryPhase, string> = {
  intro: "Read your secret role. Nobody else can see it.",
  alibi: "Everyone's testimony is on the board. Read it carefully, then discuss in the chat. Tap a cell to look closer or press a claim.",
  investigate: "Use your tools. Camera readings are private: share them, or bend them. The Detective can verify a claim in public.",
  interrogate: "Debate. Whose story does not add up? Press claims that conflict with what others said.",
  vote: "Vote for who you think did it. A tie lets the culprit walk free.",
  unmask: "The truth comes out.",
};

const ROLES: Record<MysteryRole, { label: string; goal: string; power: string }> = {
  culprit: {
    label: "The Culprit",
    goal: "Do not be the most-voted suspect. Your testimony for the crime window is a cover story that names people who were not there.",
    power: "Plant one anonymous rumor that frames someone else. Lie in chat, but remember the board shows what you officially said.",
  },
  detective: {
    label: "The Detective",
    goal: "Expose the culprit and win the group's vote.",
    power: "Verify a claim (you get one, or two in a 6-player game). The result is posted for everyone, without your name.",
  },
  witness: {
    label: "The Witness",
    goal: "Help the group find the culprit with what you saw.",
    power: "You saw the coat colour of the person slipping out of the scene. Post it as an anonymous tip, or use it to steer the debate.",
  },
  trickster: {
    label: "The Trickster",
    goal: "You win if the group accuses the WRONG person. Sow doubt.",
    power: "One slot of your testimony is a private errand you will not explain. Spread one anonymous rumor.",
  },
  suspect: {
    label: "A Suspect",
    goal: "You are innocent. Cross-check statements and find the liar.",
    power: "Press claims that do not add up and pool your camera readings with the group.",
  },
};

function RoleCard({ role, big }: { role: MysteryRole; big: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!big) return;
    const id = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(id);
  }, [big]);
  const r = ROLES[role];
  return (
    <button type="button" className={`my-role ${role}${open ? " open" : ""}${big ? " big" : ""}`} aria-pressed={open}
      onClick={() => setOpen((o) => !o)} aria-label={open ? `Your role: ${r.label}. Tap to hide.` : "Tap to reveal your secret role"}>
      <span className="my-role-inner">
        <span className="my-role-face front"><b>SECRET ROLE</b><i>Tap to reveal</i></span>
        <span className="my-role-face back">
          <b>{r.label}</b>
          <span>{r.goal}</span>
          <em>{r.power}</em>
        </span>
      </span>
    </button>
  );
}

export function Mystery({ play, priv, you, send }: MissionProps<MysteryPlay, MysteryPrivate>) {
  const [sel, setSel] = useState<{ name: string; slot: number } | null>(null);
  const [room, setRoom] = useState(1);
  const [slot, setSlot] = useState(0);
  const [pickVote, setPickVote] = useState<string>("");
  const [frame, setFrame] = useState<string>("");

  const phase = play.phase;
  const role = priv?.role ?? "suspect";
  const names = play.suspects.map((s) => s.name);
  const claims = play.claims;
  const pressFeed = play.feed.filter((f) => f.kind === "press");
  const lastPress = pressFeed[pressFeed.length - 1];

  useEffect(() => {
    setSel(null);
    setPickVote("");
    setFrame("");
  }, [play.title]);

  const focus = phase === "vote" ? pickVote : sel?.name ?? lastPress?.target ?? "";
  const scene = useMemo<MysterySceneState>(() => ({
    suspects: play.suspects.map((s) => ({ name: s.name, coat: s.coat })),
    theme: play.theme, phase, focus, you, pressCount: pressFeed.length,
    culprit: play.unmask?.culprit ?? "", caught: play.unmask?.caught ?? false, votes: play.unmask?.votes ?? {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [play.suspects, play.theme, phase, focus, you, pressFeed.length, play.unmask]);

  const room0 = play.rooms[0] ?? "";
  const send_ = (op: string, extra: Record<string, unknown> = {}) => send("act", { op, ...extra });
  const canPress = (phase === "alibi" || phase === "investigate" || phase === "interrogate") && (priv?.press ?? 0) > 0;
  const selClaim: MyClaim | undefined = sel ? claims?.[sel.name]?.[sel.slot] : undefined;
  const companions = new Set<string>(selClaim?.with ?? []);
  const feedText = (f: MysteryPlay["feed"][number]) =>
    f.kind === "press"
      ? `${f.who} presses ${f.target} about ${play.slots[f.slot]}.`
      : f.text ?? "";

  return (
    <div className="my">
      <div className="my-stage-wrap">
        <Scene3D load={loadScene} state={scene} className="my-stage" label="A noir interrogation room with the suspects around a table" />
        <ol className="my-steps" aria-label="Case progress">
          {PHASES.map(([p, label]) => (
            <li key={p} className={p === phase ? "on" : PHASES.findIndex((x) => x[0] === p) < PHASES.findIndex((x) => x[0] === phase) ? "done" : ""}>{label}</li>
          ))}
        </ol>
      </div>

      <p className="my-help" role="status">{PHASE_HELP[phase]}</p>

      <div className="my-top">
        <article className="my-case">
          <p className="rg-eyebrow">{play.title}</p>
          <p>{play.setting}</p>
          <p className="rg-dim">{play.crime}</p>
          <p className="my-window">Door opened during: <b>{play.slots[play.crime_slot]}</b> · Scene: <b>{room0}</b></p>
        </article>
        <RoleCard role={role} big={phase === "intro"} />
      </div>

      {claims && phase !== "unmask" && (
        <section className="my-board" aria-label="Testimony board">
          <h5 className="rg-h3">Testimony board</h5>
          <div className="my-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Suspect</th>
                  {play.slots.map((s, i) => <th key={s} scope="col" className={i === play.crime_slot ? "crime" : ""}>{s}{i === play.crime_slot ? " · door" : ""}</th>)}
                </tr>
              </thead>
              <tbody>
                {play.suspects.map((s) => (
                  <tr key={s.name} className={s.name === you ? "me" : ""}>
                    <th scope="row">
                      <span className="my-swatch" style={{ background: COAT_CSS[s.coat % 8] }} title={`${play.coats[s.coat]} coat`} />
                      <span>{s.name}{s.name === you ? " (you)" : ""}<small>{play.jobs[s.job]} · {play.coats[s.coat]} coat</small></span>
                    </th>
                    {(claims[s.name] ?? []).map((c, i) => {
                      const v = play.verified[`${s.name}|${i}`];
                      const isSel = sel?.name === s.name && sel.slot === i;
                      const linked = sel?.slot === i && companions.has(s.name);
                      const truth = s.name === you && priv?.truth ? priv.truth[i] : undefined;
                      const lie = truth !== undefined && truth !== c.room;
                      return (
                        <td key={i}>
                          <button type="button" className={`my-cell${isSel ? " sel" : ""}${linked ? " link" : ""}${v ? ` v-${v}` : ""}${i === play.crime_slot ? " crime" : ""}`}
                            aria-pressed={isSel} onClick={() => setSel(isSel ? null : { name: s.name, slot: i })}>
                            {c.hidden ? <i>private errand</i> : <b>{play.rooms[c.room]}</b>}
                            {!c.hidden && c.with.length > 0 && <small>with {c.with.join(", ")}</small>}
                            {v === "ok" && <em className="ok">verified</em>}
                            {v === "bad" && <em className="bad">refuted</em>}
                            {lie && <em className="lie">truth: {play.rooms[truth!]}</em>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sel && (
            <div className="my-sel">
              <span>
                <b>{sel.name}</b> at <b>{play.slots[sel.slot]}</b>
                {selClaim?.with.length ? <> names {selClaim.with.join(" and ")}: find their own cells in that column.</> : null}
              </span>
              <span className="my-sel-actions">
                <button type="button" className="rg-btn small" disabled={!canPress || sel.name === you}
                  onClick={() => send_("press", { target: sel.name, slot: sel.slot })}>
                  Press ({priv?.press ?? 0} left)
                </button>
                {role === "detective" && phase === "investigate" && (
                  <button type="button" className="rg-btn small ghost" disabled={(priv?.verify ?? 0) <= 0 || sel.name === you}
                    onClick={() => send_("verify", { target: sel.name, slot: sel.slot })}>
                    Verify ({priv?.verify ?? 0} left)
                  </button>
                )}
              </span>
            </div>
          )}
        </section>
      )}

      {phase === "investigate" && (
        <section className="my-tools">
          <div className="my-tool">
            <h5 className="rg-h3">Security cameras · {priv?.inquiries ?? 0} left</h5>
            <div className="my-row">
              <select className="rg-input" value={room} onChange={(e) => setRoom(Number(e.target.value))} aria-label="Room">
                {play.rooms.map((r, i) => <option key={r} value={i}>{r}</option>)}
              </select>
              <select className="rg-input" value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="Time">
                {play.slots.map((s, i) => <option key={s} value={i}>{s}</option>)}
              </select>
              <button type="button" className="rg-btn small" disabled={(priv?.inquiries ?? 0) <= 0}
                onClick={() => send_("inquire", { room, slot })}>Check</button>
            </div>
            <ul className="my-log">
              {(priv?.log ?? []).map((l, i) => <li key={i}>{l}</li>)}
              {(priv?.log ?? []).length === 0 && <li className="rg-dim">Readings are private. Share them in the chat, or do not.</li>}
            </ul>
          </div>
          {(role === "witness" || role === "culprit" || role === "trickster") && (
            <div className="my-tool">
              <h5 className="rg-h3">{role === "witness" ? "Your tip" : "Anonymous rumor"}</h5>
              {role === "witness" && priv?.saw !== undefined && (
                <p>You saw a figure in a <b style={{ color: COAT_CSS[priv.saw % 8] }}>{play.coats[priv.saw]}</b> coat slipping out of the {room0}.</p>
              )}
              {role === "culprit" && (
                <select className="rg-input" value={frame} onChange={(e) => setFrame(e.target.value)} aria-label="Who to frame">
                  <option value="">Frame a random suspect</option>
                  {names.filter((n) => n !== you).map((n) => <option key={n} value={n}>Frame {n}</option>)}
                </select>
              )}
              {role === "trickster" && <p className="rg-dim">Posts a rumor about a random coat colour. It may or may not be true.</p>}
              <button type="button" className="rg-btn small" disabled={priv?.tip_used}
                onClick={() => send_("tip", role === "culprit" && frame ? { target: frame } : {})}>
                {priv?.tip_used ? "Posted" : "Post anonymously"}
              </button>
              <p className="rg-dim rg-small">Tips are anonymous, so nobody knows which are true. Check them against the testimony.</p>
            </div>
          )}
        </section>
      )}

      {(play.tips.length > 0 || play.feed.length > 0) && phase !== "unmask" && (
        <section className="my-feed" aria-label="Public evidence">
          <h5 className="rg-h3">Public evidence</h5>
          <ul>
            {play.tips.map((t) => (
              <li key={`t${t.id}`} className="tip"><span className="my-swatch" style={{ background: COAT_CSS[t.coat % 8] }} /> <i>Anonymous tip:</i> {t.text}</li>
            ))}
            {[...play.feed].reverse().slice(0, 8).map((f, i) => (
              <li key={i} className={f.kind === "verify" ? (f.text?.startsWith("REFUTED") ? "bad" : "ok") : ""}>{feedText(f)}</li>
            ))}
          </ul>
        </section>
      )}

      {phase === "vote" && (
        <section className="my-vote" aria-label="Vote">
          <h5 className="rg-h3">Who did it?</h5>
          <div className="my-vote-grid">
            {play.suspects.filter((s) => s.name !== you).map((s) => (
              <button key={s.name} type="button" className={`my-suspect${(priv?.vote || pickVote) === s.name ? " on" : ""}`}
                aria-pressed={(priv?.vote || pickVote) === s.name}
                onMouseEnter={() => setPickVote(s.name)} onFocus={() => setPickVote(s.name)}
                onClick={() => { setPickVote(s.name); send_("vote", { target: s.name }); }}>
                <span className="my-swatch big" style={{ background: COAT_CSS[s.coat % 8] }} />
                <b>{s.name}</b><small>{play.jobs[s.job]}</small>
                {play.voted.includes(s.name) && <em>voted</em>}
              </button>
            ))}
          </div>
          <p className="rg-dim rg-small">{play.voted.length}/{names.length} have voted. You can change your vote until time is up.</p>
        </section>
      )}

      {phase === "unmask" && play.unmask && <Unmask play={play} u={play.unmask} you={you} />}
    </div>
  );
}

function Unmask({ play, u, you }: { play: MysteryPlay; u: NonNullable<MysteryPlay["unmask"]>; you: string }) {
  const k = play.crime_slot;
  return (
    <section className="my-unmask" aria-live="polite">
      <p className="rg-eyebrow">The truth</p>
      <h4 className="my-verdict">
        {u.caught ? `${u.culprit} is caught!` : u.accused ? `The group accused ${u.accused}. It was ${u.culprit}.` : `Nobody was accused. ${u.culprit} walks free.`}
      </h4>
      <ul className="my-roles">
        {play.suspects.map((s) => (
          <li key={s.name} className={s.name === u.culprit ? "culprit" : ""}>
            <Avatar name={s.name} size={26} />
            <div><b>{s.name}{s.name === you ? " (you)" : ""}</b><span className="rg-dim rg-small">{u.roles[s.name]}{u.votes[s.name] ? ` · voted ${u.votes[s.name]}` : ""}</span></div>
          </li>
        ))}
      </ul>
      <div className="my-scroll">
        <table className="my-truth">
          <caption className="rg-small rg-dim">Where everyone really was</caption>
          <thead><tr><th scope="col">Suspect</th>{play.slots.map((s, i) => <th key={s} scope="col" className={i === k ? "crime" : ""}>{s}</th>)}</tr></thead>
          <tbody>
            {play.suspects.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                {(u.truth[s.name] ?? []).map((r, i) => {
                  const said = play.claims?.[s.name]?.[i];
                  const lied = !!said && !said.hidden && said.room !== r;
                  return <td key={i} className={lied ? "lied" : ""}>{play.rooms[r]}{lied ? <small>said {play.rooms[said!.room]}</small> : null}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rg-note"><b>How it could be solved</b><br />{u.why}</p>
    </section>
  );
}
