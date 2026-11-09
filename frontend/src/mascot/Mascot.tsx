import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import "./mascot.css";

export type Pose =
  | "idle" | "walk" | "wave" | "surprised" | "sleep" | "trip" | "dizzy" | "cheer" | "juggle" | "sad";

// ---------- Embo's vocabulary (add your own jokes here!) ----------
const L = {
  hello: ["Hi! I'm Embo. I'm 40% flame, 60% bad ideas.", "Embo reporting for duty. Mostly."],
  idle: [
    "Is it hot in here or is it just me? (it's me)",
    "I tried to cool off once. We don't talk about it.",
    "Fun fact: I have no fun facts.",
    "Nobody's watching. Time to practice my cool pose. 😎",
    "I'm basically a tiny sun with commitment issues.",
    "Psst. You're doing great. Probably.",
    "Don't mind me, just warming the pixels.",
    "I could go for some marshmallows right now…",
  ],
  poke: ["Hey! Watch the flame!", "Ow! …no wait, that tickled.", "Careful, I'm hot property.", "Boop received."],
  giggle: ["Hehehe stop, I'll ignite!", "Okay that's three. I'm counting.", "Ticklish! I'm made of fire and I'm ticklish!"],
  dizzy: ["Everything is… orange… more than usual…", "I see two of you. Both are poking me.", "Spinning… in a good way… no… bad way…"],
  egg: "Fine, you win! Secret: I'm not a flame, I'm a sunrise that got lost. 🌅",
  wake: ["I wasn't sleeping! I was… resting my flicker.", "Huh?! What?! Who?! …oh. Hi.", "Five more minutes of glowing…"],
  trip: ["Whoa— I meant to do that.", "The floor started it.", "Gravity again. Rude."],
  sleepy: "*yawn* …I'm gonna rest my flicker for a sec…",
  win: ["VICTORY! I'm so hot right now!", "You're on fire! …I mean, I'm on fire. Always. But you too!"],
  lose: ["Aw… even losers get s'mores. Probably.", "That's okay. Ashes lead to new fires."],
  err: ["Oops. That one wasn't me. I swear.", "Hmm. Something fizzled."],
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

// ---------- Public API ----------
interface Api {
  /** Make Embo say something. */
  say: (text: string, ms?: number) => void;
  /** Make Embo react with a pose (and optionally a line). */
  react: (pose: Pose, text?: string) => void;
  hidden: boolean;
  setHidden: (h: boolean) => void;
  lines: typeof L;
}
const noop: Api = { say() {}, react() {}, hidden: false, setHidden() {}, lines: L };
const Ctx = createContext<Api>(noop);
export const useMascot = () => useContext(Ctx);

const W = 96;

export function MascotProvider({ children, avoidRight = 170 }: { children: ReactNode; avoidRight?: number }) {
  const [pose, setPose] = useState<Pose>("idle");
  const [x, setX] = useState(24);
  const [dir, setDir] = useState<1 | -1>(1);
  const [dur, setDur] = useState(0);
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null);
  const [hidden, setHiddenState] = useState(() => {
    try { return localStorage.getItem("embo:hidden") === "1"; } catch { return false; }
  });

  const el = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const bubbleT = useRef(0);
  const poseRef = useRef<Pose>("idle");
  const xRef = useRef(24);
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

  const setHidden = useCallback((h: boolean) => {
    setHiddenState(h);
    try { localStorage.setItem("embo:hidden", h ? "1" : "0"); } catch { /* storage unavailable */ }
  }, []);

  // ----- the brain: a tiny state machine with random behaviour -----
  useEffect(() => {
    if (hidden) return;
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const to = (p: Pose) => { poseRef.current = p; setPose(p); };

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
      const tx = 16 + Math.random() * (max - 16);
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
        else if (r < 0.66) act("juggle", 3400, "Look ma, no hands! …well, tiny hands.");
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

    const hi = window.setTimeout(() => brain.current.react("wave", pick(L.hello)), 1200);
    think();
    return () => {
      clear(); clearTimeout(hi); cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onPress);
      window.removeEventListener("keydown", onPress);
    };
  }, [hidden, reduce, avoidRight, say]);

  const api = useMemo<Api>(() => ({
    say,
    react: (p, t) => { lastAct.current = Date.now(); brain.current.react(p, t); },
    hidden, setHidden, lines: L,
  }), [say, hidden, setHidden]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {hidden ? (
        <button type="button" className="em-show" onClick={() => setHidden(false)} aria-label="Bring Embo back" title="Bring Embo back">🔥</button>
      ) : (
        <div ref={el} className="em-wrap" style={{ left: x, transition: dur ? `left ${dur}s linear` : "none" }}>
          {bubble && (
            <div key={bubble.id} className={`em-bubble${x < 130 ? " em-left" : ""}`} role="status">{bubble.text}</div>
          )}
          <button type="button" className="em-hide" onClick={() => setHidden(true)} aria-label="Hide Embo" title="Hide Embo">×</button>
          <button type="button" className="em-body" onClick={() => brain.current.poke()}
            aria-label="Embo, the flame mascot. Click to poke.">
            <Embo pose={pose} dir={dir} />
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}

// ---------- The character itself (original design: fire / sun palette) ----------
import { Embo } from "./Embo";
export { Embo };