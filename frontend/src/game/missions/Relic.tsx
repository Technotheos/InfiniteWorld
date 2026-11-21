import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "../../sound";
import { useMascot, type Pose } from "../../mascot";
import { Scene3D } from "../three/Scene3D";
import { useVoiceContext } from "../voice/VoiceContext";
import type { MissionProps, RelicPlay, RelicPrivate } from "../types";
import type { RelicSceneState } from "../three/relicScene";
import "../relic.css";

const loadScene = () => import("../three/relicScene").then((m) => m.createRelicScene);

const HEAT = [
  { label: "Cold", hint: "Nothing stirs here.", color: "#4f6bff" },
  { label: "Cool", hint: "A faint pull. Keep moving.", color: "#38bdf8" },
  { label: "Warm", hint: "You are in the right area.", color: "#f5c14a" },
  { label: "Hot", hint: "Close. Circle and compare.", color: "#ff8a2a" },
  { label: "Burning", hint: "It is almost under your boots.", color: "#ff2a3a" },
];

const DIG_COOLDOWN_MS = 1800;

// What Embo says. Other slugs get the neutral line, because these jokes are Embo's.
const EMBO: Record<string, [Pose, string, string]> = {
  show: ["surprised", "Okay, that thing is giving me chills. And I am literally on fire.", "That relic looks cursed."],
  bury: ["surprised", "He's burying it! I can't look. …I'm looking.", "It is being buried."],
  hunt: ["wave", "Follow the lantern! Blue is cold, red is hot. I'd know, I'm always red.", "Follow the lantern."],
  burning: ["surprised", "BURNING! Dig! Dig dig dig!", "Burning! Dig here."],
  wail: ["dizzy", "The curse is lying to your lantern. Don't trust it right now!", "The curse is lying. Wait it out."],
  miss: ["trip", "Just dirt. …Surprisingly tasty dirt.", "Just dirt."],
  found: ["cheer", "YOU FOUND IT! Somebody call an exorcist, or a snack bar!", "You found it!"],
  beaten: ["sad", "Aw. Someone else got it. We'll haunt them later.", "Someone else found it."],
};

interface Props extends MissionProps<RelicPlay, RelicPrivate> {
  skew?: number;
  spectating?: boolean;
}

export function Relic({ play, priv, you, players, send, skew = 0, spectating = false }: Props) {
  const voice = useVoiceContext();
  const mascot = useMascot();
  const mref = useRef(mascot);
  mref.current = mascot;

  const joy = useRef({ x: 0, y: 0 });
  const [digCount, setDigCount] = useState(0);
  const [cool, setCool] = useState(0);
  const lastDig = useRef(0);
  const local = useRef({ x: 0, z: 0 });
  const [proximity, setProximity] = useState(true);

  const hunting = play.phase === "hunt";
  const heat = priv?.heat ?? 0;
  const digs = priv?.digs ?? 0;
  const found = Boolean(priv?.found);
  const canDig = hunting && !spectating && !found && digs > 0 && cool <= 0;

  const dig = useCallback(() => {
    const now = performance.now();
    if (!hunting || spectating || found || digs <= 0 || now - lastDig.current < DIG_COOLDOWN_MS) return;
    lastDig.current = now;
    setCool(1);
    setDigCount((n) => n + 1);
    sfx("click");
    send("act", { op: "dig" });
  }, [digs, found, hunting, send, spectating]);

  // cooldown ring
  useEffect(() => {
    if (cool <= 0) return;
    const id = window.setInterval(() => setCool(Math.max(0, 1 - (performance.now() - lastDig.current) / DIG_COOLDOWN_MS)), 60);
    return () => window.clearInterval(id);
  }, [cool > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space" || e.key.toLowerCase() === "f") { e.preventDefault(); dig(); }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [dig]);

  // ---- Embo and the sound effects react to what is happening ----
  const said = useRef<Record<string, number>>({});
  const react = useCallback((key: keyof typeof EMBO, gapMs = 4000) => {
    const now = Date.now();
    if ((said.current[key] ?? 0) + gapMs > now) return;
    said.current[key] = now;
    const [pose, embo, plain] = EMBO[key]!;
    const m = mref.current;
    m.react(pose, m.out[0] === "embo" ? embo : plain);
  }, []);
  const prev = useRef({ phase: "", wail: false, heat: 0, found: false, foundBy: 0, digs: digs, msg: "" });
  useEffect(() => {
    const p = prev.current;
    if (play.phase !== p.phase) {
      if (play.phase === "show") react("show", 0);
      if (play.phase === "bury") react("bury", 0);
      if (play.phase === "hunt") { react("hunt", 0); sfx("go"); said.current.burning = 0; }
    }
    if (play.wail && !p.wail) { react("wail", 0); sfx("whoosh"); }
    if (hunting && heat === 4 && p.heat < 4 && !play.wail) { react("burning", 15000); sfx("ping"); }
    else if (hunting && heat > p.heat && !play.wail) sfx("tick");
    if (found && !p.found) react("found", 0);
    else if (!found && play.found.length > p.foundBy && !spectating) react("beaten", 0);
    if (priv && priv.digs < p.digs && !found && priv.msg !== "You unearthed it!") react("miss", 7000);
    prev.current = { phase: play.phase, wail: play.wail, heat, found, foundBy: play.found.length, digs: priv?.digs ?? digs, msg: priv?.msg ?? "" };
  }, [play.phase, play.wail, play.found.length, heat, found, priv, digs, hunting, spectating, react]);

  // ---- proximity voice: volume follows distance in the map ----
  useEffect(() => {
    if (!voice?.joined) return;
    const mine = play.pos[you];
    for (const [name, p] of Object.entries(play.pos)) {
      if (name === you) continue;
      if (!proximity || !mine || !hunting) { voice.setVolume(name, 1); continue; }
      const d = Math.hypot(p[0] - mine[0], p[1] - mine[1]);
      voice.setVolume(name, Math.max(0.1, Math.min(1, 1 - (d - 7) / 26)));
    }
  }, [play.pos, you, voice, proximity, hunting]);

  const onMove = useCallback((x: number, z: number, ry: number) => send("act", { op: "move", x, z, ry }), [send]);
  const onLocal = useCallback((x: number, z: number) => { local.current.x = x; local.current.z = z; }, []);

  const names = useMemo(() => Object.keys(play.pos), [play.pos]);
  const cams = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const n of names) out[n] = n === you ? Boolean(voice?.cam) : Boolean(players.find((p) => p.name === n)?.voice?.cam);
    return out;
  }, [names, you, voice?.cam, players]);

  const localVideo = useMemo(() => {
    if (!voice?.local) return null;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = voice.local;
    void v.play().catch(() => undefined);
    return v;
  }, [voice?.local]);

  const sceneState: RelicSceneState = {
    play, priv, you, skew, spectating, joy: joy.current, digCount, cams,
    speaking: voice?.speaking ?? {}, videos: voice?.videos ?? {}, localVideo, onMove, onLocal,
  };

  const zone = play.zone !== undefined ? play.zones[play.zone] : null;
  const r = play.relic;
  const H = HEAT[Math.max(0, Math.min(4, heat))]!;
  const lying = hunting && Boolean(priv?.lying);

  return (
    <div className={`rl${play.wail && hunting ? " wail" : ""}`} style={{ ["--heat" as string]: H.color }}>
      <div className="rl-stage">
        <Scene3D<RelicSceneState> load={loadScene} state={sceneState} className="rl-canvas" label="A haunted graveyard at night, seen from behind your character" />
        <div className="rl-flash" aria-hidden="true" />
        {hunting && !found && <div className="rl-vignette" style={{ opacity: 0.12 + heat * 0.12 }} aria-hidden="true" />}

        {(play.phase === "show" || play.phase === "bury") && (
          <div className="rl-lore" key={play.phase}>
            <p className="rg-eyebrow">{play.phase === "show" ? "Behold" : "The burial"}</p>
            <h3>{r.name}</h3>
            {play.phase === "show" ? (
              <>
                <p>{r.lore}</p>
                <p className="rl-curse">{r.curse}</p>
              </>
            ) : (
              <p>{zone ? <>The keeper carries it into the <b>{zone.name}</b>. Mist swallows the ground. Nobody sees where it goes in.</> : "The keeper carries it away."}</p>
            )}
          </div>
        )}

        {hunting && zone && (
          <div className="rl-chips">
            <span className="rl-chip">Buried near: <b>{zone.name}</b></span>
            <span className="rl-chip dim">{play.found.length ? `${play.found.length} found it` : "Nobody has found it"}</span>
          </div>
        )}

        {lying && <div className="rl-wailbar" role="alert">THE CURSE IS LYING. Your lantern cannot be trusted.</div>}
        {play.phase === "found" && (
          <div className="rl-found" role="status">
            {play.found.length ? <><b>{play.found[0]}</b> unearthed {r.name}!</> : <>Nobody found {r.name}. It sinks back into the earth.</>}
          </div>
        )}

        {hunting && !spectating && (
          <>
            <Joystick joy={joy.current} />
            <div className="rl-hud">
              <div className="rl-heat" aria-label={`Lantern reading: ${lying ? "unreliable" : H.label}`}>
                <div className="rl-heat-bars" aria-hidden="true">
                  {HEAT.map((h, i) => <i key={h.label} className={i <= heat ? "on" : ""} style={{ background: i <= heat ? h.color : undefined }} />)}
                </div>
                <b style={{ color: lying ? "#ff5d73" : H.color }}>{lying ? "???" : H.label}</b>
                <span className="rg-dim rg-small">{lying ? "Readings scrambled." : H.hint}</span>
              </div>
              <button type="button" className="rl-dig" onClick={dig} disabled={!canDig} aria-label={`Dig here. ${digs} digs left`}
                style={{ ["--cool" as string]: cool }}>
                <span className="rl-dig-icon" aria-hidden="true">⛏</span>
                <span className="rl-dig-n">{found ? "✓" : digs}</span>
                <span className="rl-dig-l">{found ? "found" : "Dig (Space)"}</span>
              </button>
            </div>
          </>
        )}
      </div>

      <div className="rl-foot">
        {hunting ? (
          <p className="rg-dim rg-small" aria-live="polite">
            {priv?.msg ? <b className="rl-msg">{priv.msg} </b> : null}
            WASD or arrows to walk, drag to look, Space to dig. Hot and cold readings steer you; a dig only counts where you stand.
          </p>
        ) : (
          <p className="rg-dim rg-small">Watch closely. The ground will not tell you twice.</p>
        )}
        {voice?.joined && (
          <label className="rl-prox">
            <input type="checkbox" checked={proximity} onChange={(e) => setProximity(e.target.checked)} /> Proximity voice
          </label>
        )}
      </div>
    </div>
  );
}

/** Touch joystick: writes into a mutable vector the 3D scene reads every frame. */
function Joystick({ joy }: { joy: { x: number; y: number } }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const set = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    joy.x = x; joy.y = -y; setKnob({ x, y });
  };
  const end = () => { active.current = null; joy.x = 0; joy.y = 0; setKnob({ x: 0, y: 0 }); };
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rl-joy" ref={base} role="presentation"
      onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); set(e); e.stopPropagation(); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) set(e); }}
      onPointerUp={end} onPointerCancel={end}>
      <i style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}
