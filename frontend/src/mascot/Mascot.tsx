import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import "./mascot.css";
import type { Pose } from "./pose";
import { slugSound, type SlugSound } from "../sound";

// Which noise goes with which pose. Poses not listed here stay quiet (walking, idling...).
const POSE_SOUND: Partial<Record<Pose, SlugSound>> = {
  wave: "chirp", cheer: "cheer", surprised: "squelch", dizzy: "dizzy", trip: "squelch",
};
import { CHARS, ORDER, isCharId, type Char, type CharId, type Lines } from "./characters";

export type { Pose } from "./pose";
export { Embo } from "./Embo";

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const KEY = "mascot:out";
const W = 96;

// ---------- Public API ----------
interface Api {
  /** Make the lead slug say something. */
  say: (text: string, ms?: number) => void;
  /** Make every slug that is out react with a pose (the lead also gets the line). */
  react: (pose: Pose, text?: string) => void;
  /** True when every slug is back in the basket. */
  hidden: boolean;
  setHidden: (h: boolean) => void;
  /** The lead slug's vocabulary (Embo's when nobody is out). */
  lines: Lines;
  /** Which slugs are currently out of the basket, in the order they came out. */
  out: CharId[];
  /** Let a slug out. `fromX` (screen px) is where it pops out, e.g. the basket. */
  release: (id: CharId, fromX?: number) => void;
  collect: (id: CharId) => void;
  releaseAll: () => void;
  collectAll: () => void;
}
const noop: Api = {
  say() {}, react() {}, hidden: false, setHidden() {}, lines: CHARS.embo.lines,
  out: [], release() {}, collect() {}, releaseAll() {}, collectAll() {},
};
const Ctx = createContext<Api>(noop);
export const useMascot = () => useContext(Ctx);

interface Brain { say: (t: string, ms?: number) => void; react: (p: Pose, t?: string) => void }

function loadOut(): CharId[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return Array.from(new Set(v.filter(isCharId)));
    }
    if (localStorage.getItem("embo:hidden") === "1") return []; // older versions
  } catch { /* storage unavailable */ }
  return ["embo"];
}

export function MascotProvider({ children, avoidRight = 170 }: { children: ReactNode; avoidRight?: number }) {
  const [out, setOut] = useState<CharId[]>(loadOut);
  const spawn = useRef<Partial<Record<CharId, number>>>({});
  const brains = useRef<Partial<Record<CharId, Brain>>>({});

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
  }, [out]);

  const release = useCallback((id: CharId, fromX?: number) => {
    slugSound(id, "chirp"); // popping out of the basket
    if (fromX !== undefined) spawn.current[id] = fromX;
    setOut((o) => (o.includes(id) ? o : [...o, id]));
  }, []);
  const collect = useCallback((id: CharId) => { slugSound(id, "squelch"); setOut((o) => o.filter((x) => x !== id)); }, []);
  const releaseAll = useCallback(() => setOut(ORDER.slice()), []);
  const collectAll = useCallback(() => setOut([]), []);
  const register = useCallback((id: CharId, b: Brain | null) => {
    if (b) brains.current[id] = b; else delete brains.current[id];
  }, []);

  const lead = out[0];
  const api = useMemo<Api>(() => ({
    say: (t, ms) => { if (lead) brains.current[lead]?.say(t, ms); },
    react: (p, t) => { out.forEach((id) => brains.current[id]?.react(p, id === lead ? t : undefined)); },
    hidden: out.length === 0,
    setHidden: (h) => setOut((o) => (h ? [] : o.length ? o : ["embo"])),
    lines: CHARS[lead ?? "embo"].lines,
    out, release, collect, releaseAll, collectAll,
  }), [out, lead, release, collect, releaseAll, collectAll]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {out.length === 0 ? (
        <button type="button" className="em-show" onClick={() => release("embo")} aria-label="Let a slug out" title="Let a slug out">🔥</button>
      ) : (
        out.map((id) => (
          <Wanderer key={id} char={CHARS[id]} avoidRight={avoidRight} startX={spawn.current[id]}
            onCollect={collect} register={register} />
        ))
      )}
    </Ctx.Provider>
  );
}

// ---------- One roaming slug: a tiny state machine with random behaviour ----------
function Wanderer({ char, avoidRight, startX, onCollect, register }: {
  char: Char; avoidRight: number; startX?: number;
  onCollect: (id: CharId) => void; register: (id: CharId, b: Brain | null) => void;
}) {
  const L = char.lines;
  const Art = char.Art;
  const [pose, setPose] = useState<Pose>("idle");
  const [x, setX] = useState(() => {
    const maxX = Math.max(16, (typeof window === "undefined" ? 800 : window.innerWidth) - W - 8);
    const nav = typeof document === "undefined" ? null : document.querySelector('nav[aria-label="Main"]');
    const lo = 24 + (nav ? Math.max(0, nav.getBoundingClientRect().right) : 0);
    return Math.min(maxX, startX !== undefined ? Math.max(8, startX) : lo + ORDER.indexOf(char.id) * 230);
  });
  const [dir, setDir] = useState<1 | -1>(1);
  const [dur, setDur] = useState(0);
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null);
  const [fresh, setFresh] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const el = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const bubbleT = useRef(0);
  const poseRef = useRef<Pose>("idle");
  const snoreT = useRef(0);
  useEffect(() => () => window.clearInterval(snoreT.current), []);
  const xRef = useRef(x);
  // The page's left navigation mounts after the slugs do: step clear of it once, right after mount.
  useEffect(() => {
    if (startX !== undefined) return; // released from the basket on purpose
    const nav = document.querySelector('nav[aria-label="Main"]');
    const lo = nav ? nav.getBoundingClientRect().right + 16 : 0;
    if (lo && xRef.current < lo) { xRef.current = lo; setX(lo); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastAct = useRef(Date.now());
  const pokes = useRef({ n: 0, t: 0 });
  const brain = useRef({ react: (_p: Pose, _t?: string) => {}, poke: () => {} });
  const reduce = useMemo(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const say = useCallback((text: string, ms?: number) => {
    window.clearTimeout(bubbleT.current);
    setBubble({ id: Date.now(), text });
    bubbleT.current = window.setTimeout(() => setBubble(null), ms ?? 2800 + text.length * 45);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setFresh(false), 700);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    register(char.id, {
      say,
      react: (p, t) => { lastAct.current = Date.now(); brain.current.react(p, t); },
    });
    return () => register(char.id, null);
  }, [char.id, register, say]);

  // ----- the brain -----
  useEffect(() => {
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const to = (p: Pose) => {
      const changed = poseRef.current !== p;
      poseRef.current = p; setPose(p);
      window.clearInterval(snoreT.current);
      if (p === "sleep") { // sleepy breathing for as long as it naps
        slugSound(char.id, "snore");
        snoreT.current = window.setInterval(() => slugSound(char.id, "snore"), 3600);
      } else if (changed) {
        const s = POSE_SOUND[p];
        if (s) slugSound(char.id, s);
      }
    };

    const freeze = () => { // stop mid-walk exactly where we are
      const r = el.current?.getBoundingClientRect();
      if (r) { xRef.current = r.left; setX(r.left); }
      setDur(0);
    };
    const act = (p: Pose, ms: number, text?: string) => {
      to(p); if (text) say(text);
      later(() => { to("idle"); think(); }, ms);
    };
    const walk = () => {
      const max = Math.max(60, window.innerWidth - W - avoidRight);
      // Stay out of the left navigation when there is one on screen (the Home page sidebar).
      const nav = document.querySelector('nav[aria-label="Main"]');
      const lo = 16 + (nav ? Math.max(0, nav.getBoundingClientRect().right) : 0);
      const tx = lo + Math.random() * Math.max(0, max - lo);
      const secs = Math.abs(tx - xRef.current) / 80;
      setDir(tx > xRef.current ? 1 : -1); setDur(secs); xRef.current = tx; setX(tx); to("walk");
      later(() => { setDur(0); to("idle"); think(); }, secs * 1000 + 60);
    };
    function think() {
      clear();
      if (Date.now() - lastAct.current > 45000) { // nobody around: nap
        to("sleep"); say(L.sleepy, 3000); return;
      }
      later(() => {
        const r = Math.random();
        if (r < 0.38 && !reduce) walk();
        else if (r < 0.52) act("wave", 1600);
        else if (r < 0.66) act("juggle", 3400, L.juggle);
        else if (r < 0.76) act("trip", 1200, pick(L.trip));
        else { say(pick(L.idle)); later(think, 3800); }
      }, 2500 + Math.random() * 4500);
    }

    brain.current.react = (p, text) => {
      clear(); freeze(); to(p); if (text) say(text);
      later(() => { to("idle"); think(); }, p === "trip" ? 1300 : 2400);
    };
    brain.current.poke = () => {
      const now = Date.now(), k = pokes.current;
      k.n = now - k.t < 2500 ? k.n + 1 : 1; k.t = now;
      if (k.n >= 10) { k.n = 0; brain.current.react("cheer", L.egg); }
      else if (k.n >= 5) brain.current.react("dizzy", pick(L.dizzy));
      else if (k.n >= 3) brain.current.react("cheer", pick(L.giggle));
      else brain.current.react("surprised", pick(L.poke));
    };

    // wake up on real interaction; track the cursor for the eyes
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      lastAct.current = Date.now();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const n = el.current; if (!n) return;
        const r = n.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.4);
        const m = Math.hypot(dx, dy) || 1, s = Math.min(1, m / 200);
        n.style.setProperty("--lx", String((dx / m) * s));
        n.style.setProperty("--ly", String((dy / m) * s));
      });
    };
    const onPress = () => {
      lastAct.current = Date.now();
      if (poseRef.current === "sleep") brain.current.react("surprised", pick(L.wake));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onPress);
    window.addEventListener("keydown", onPress);

    // a slug that was just let out of the basket greets you faster
    const hi = window.setTimeout(
      () => brain.current.react("wave", startX !== undefined ? pick([L.basketOut, ...L.hello]) : pick(L.hello)),
      startX !== undefined ? 500 : 1200 + ORDER.indexOf(char.id) * 2200);
    think();
    return () => {
      clear(); clearTimeout(hi); cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onPress);
      window.removeEventListener("keydown", onPress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, avoidRight, say, L]);

  const leave = () => {
    window.clearTimeout(bubbleT.current);
    setBubble(null);
    setLeaving(true);
    window.setTimeout(() => onCollect(char.id), 260);
  };

  const vars = { ["--ga"]: char.glowA, ["--gb"]: char.glowB, ["--bc"]: char.border, ["--bt"]: char.text } as CSSProperties;

  return (
    <div ref={el} className={`em-wrap${fresh ? " em-spawn" : ""}${leaving ? " em-leave" : ""}`}
      style={{ left: x, transition: dur ? `left ${dur}s linear` : "none", ...vars }}>
      {bubble && (
        <div key={bubble.id} className={`em-bubble${x < 130 ? " em-left" : ""}`} role="status">{bubble.text}</div>
      )}
      <button type="button" className="em-hide" onClick={leave}
        aria-label={`Put ${char.name} back in the basket`} title="Back to the basket">×</button>
      <button type="button" className="em-body" onClick={() => brain.current.poke()}
        aria-label={`${char.name}, the ${char.kind.toLowerCase()} mascot. Click to poke.`}>
        <Art pose={pose} dir={dir} />
      </button>
    </div>
  );
}
