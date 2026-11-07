import type { MapInfo, PlayerView, StateView, ChatMsg } from "../types";

// Hand-written states that mirror what the Go server sends, for the preview page and tests.

export const ARENA: MapInfo = {
  id: "arena", name: "Quick Arena", tagline: "Three fast games. Best total score wins.", theme: "nebula", mode: "versus",
  min_players: 1, max_players: 8,
  missions: [
    { kind: "reaction", title: "Reflex", brief: "Wait for the orb to turn green, then click. Click early and that round scores zero." },
    { kind: "math", title: "Math Sprint", brief: "Solve as many as you can. Right answers +100, wrong answers -50." },
    { kind: "typing", title: "Type Storm", brief: "Type the passage exactly as shown. Finishing early earns a bonus." },
  ],
};
export const CIPHER_LAB: MapInfo = {
  id: "cipher-lab", name: "Cipher Lab", tagline: "Crack encodings the way attackers do.", theme: "matrix", mode: "versus",
  min_players: 1, max_players: 8,
  missions: [
    { kind: "cipher", title: "Caesar Shift", brief: "Shift every letter back." },
    { kind: "cipher", title: "Base64", brief: "This is an encoding, not a lock." },
    { kind: "cipher", title: "Hex Bytes", brief: "Two hex digits per byte." },
    { kind: "cipher", title: "Binary", brief: "Eight bits per letter." },
  ],
};
export const SPARK: MapInfo = {
  id: "spark", name: "Social Spark", tagline: "Get a mission, talk it out together, and complete it as a team.", theme: "aurora", mode: "coop",
  min_players: 2, max_players: 6,
  missions: [
    { kind: "talk", title: "Warm-up", brief: "Chat about the prompt, then everyone presses the button." },
    { kind: "talk", title: "Deep Dive", brief: "Take your time." },
    { kind: "talk", title: "Wild Card", brief: "Be creative." },
  ],
};

const P = (name: string, extra: Partial<PlayerView> = {}): PlayerView => ({
  name, ready: false, connected: true, spectator: false, host: false, score: 0, gain: 0, progress: 0, ...extra,
});

function base(map: MapInfo, phase: StateView["phase"], over: Partial<StateView>): StateView {
  return { code: "K7QM2", map, phase, you: "neo", spectating: false, players: [], mission: -1, deadline: 0, now: Date.now(), ...over };
}
const inMs = (ms: number) => Date.now() + ms;

export const SAMPLE_CHAT: ChatMsg[] = [
  { from: "trinity", text: "ready when you are", at: Date.now() - 20000 },
  { from: "neo", text: "gl hf", at: Date.now() - 10000 },
];

const crew = (over: Partial<PlayerView>[] = []) =>
  ["neo", "trinity", "morpheus"].map((n, i) => P(n, { host: i === 0, ...(over[i] ?? {}) }));

export const SCENARIOS: Record<string, () => StateView> = {
  "lobby (arena)": () => base(ARENA, "lobby", { players: crew([{ ready: true }, {}, { ready: true }]) }),
  "countdown": () => base(ARENA, "countdown", { players: crew(), deadline: inMs(2400) }),
  "briefing": () => base(ARENA, "briefing", {
    players: crew(), mission: 0, deadline: inMs(4000),
    brief: { index: 0, total: 3, kind: "reaction", title: "Reflex", brief: ARENA.missions[0]!.brief },
  }),
  "reaction: wait": () => base(ARENA, "playing", {
    players: crew(), mission: 0, private: { acted: false },
    brief: { index: 0, total: 3, kind: "reaction", title: "Reflex", brief: "" },
    play: { kind: "reaction", round: 1, rounds: 3, status: "wait" },
  }),
  "reaction: GO": () => base(ARENA, "playing", {
    players: crew(), mission: 0, deadline: inMs(2200), private: { acted: false },
    brief: { index: 0, total: 3, kind: "reaction", title: "Reflex", brief: "" },
    play: { kind: "reaction", round: 2, rounds: 3, status: "go" },
  }),
  "reaction: between": () => base(ARENA, "playing", {
    players: crew(), mission: 0, private: { acted: true },
    brief: { index: 0, total: 3, kind: "reaction", title: "Reflex", brief: "" },
    play: { kind: "reaction", round: 2, rounds: 3, status: "between", results: { neo: 231, trinity: 187, morpheus: -1 } },
  }),
  "math sprint": () => base(ARENA, "playing", {
    players: crew([{ progress: 0.4 }, { progress: 0.6 }, { progress: 0.2 }]), mission: 1, deadline: inMs(21000),
    private: { q: "7 * 8 + 12", index: 8, correct: 8, wrong: 1 },
    brief: { index: 1, total: 3, kind: "math", title: "Math Sprint", brief: "" }, play: { kind: "math" },
  }),
  "typing race": () => base(ARENA, "playing", {
    players: crew([{ progress: 0.35 }, { progress: 0.55 }, { progress: 0.15 }]), mission: 2, deadline: inMs(30000),
    brief: { index: 2, total: 3, kind: "typing", title: "Type Storm", brief: "" },
    play: { kind: "typing", text: "Every secure system starts with a simple rule: never trust input that you did not generate yourself." },
  }),
  "reveal": () => base(ARENA, "reveal", {
    players: crew([{ score: 1000, gain: 1000 }, { score: 620, gain: 620 }, { score: 0, gain: 0 }]), mission: 0, deadline: inMs(5000),
    brief: { index: 0, total: 3, kind: "reaction", title: "Reflex", brief: "" },
    reveal: { kind: "reaction", title: "Reflex", note: "Most people react in 200-300 ms. Guessing early is punished, so the skill is staying calm and watching.",
      stats: { neo: "avg 212 ms · best 187 ms", trinity: "avg 380 ms · best 301 ms", morpheus: "no valid clicks · 3 false starts" },
      points: { neo: 1000, trinity: 620, morpheus: 0 } },
  }),
  "cipher lab": () => base(CIPHER_LAB, "playing", {
    players: crew([{ progress: 0.5 }, {}, { progress: 0.5 }]), mission: 0, deadline: inMs(24000), private: { solved: false, attempts: 2 },
    brief: { index: 0, total: 4, kind: "cipher", title: "Caesar Shift", brief: "" },
    play: { kind: "cipher", variant: "caesar", round: 1, rounds: 2, status: "play", challenge: "MPYLDHSS",
      hint: "Every letter was shifted forward by 7. Shift each one back.", solved: ["morpheus"] },
  }),
  "cipher: between": () => base(CIPHER_LAB, "playing", {
    players: crew(), mission: 1, deadline: inMs(2000), private: { solved: true, attempts: 1 },
    brief: { index: 1, total: 4, kind: "cipher", title: "Base64", brief: "" },
    play: { kind: "cipher", variant: "base64", round: 1, rounds: 2, status: "between", challenge: "cGF5bG9hZA==", answer: "payload", solved: ["neo", "trinity"] },
  }),
  "social spark (coop)": () => base(SPARK, "playing", {
    players: crew([{ progress: 1 }, {}, { progress: 1 }]), mission: 0, deadline: inMs(70000), private: { done: true },
    brief: { index: 0, total: 3, kind: "talk", title: "Warm-up", brief: "" },
    play: { kind: "talk", prompt: "Tell the group about a small thing that always improves your day, and find one that two of you share.", done: ["neo", "morpheus"], total: 3 },
  }),
  "final (versus)": () => base(ARENA, "finished", {
    players: crew([{ score: 2750 }, { score: 2210 }, { score: 980 }]), mission: 2,
    result: { mode: "versus", won: true, ranking: [
      { name: "neo", score: 2750, place: 1 }, { name: "trinity", score: 2210, place: 2 }, { name: "morpheus", score: 980, place: 3 } ] },
  }),
  "final (coop)": () => base(SPARK, "finished", {
    players: crew([{ score: 3000 }, { score: 3000 }, { score: 3000 }]), mission: 2,
    result: { mode: "coop", won: true, ranking: [
      { name: "neo", score: 3000, place: 1 }, { name: "trinity", score: 3000, place: 1 }, { name: "morpheus", score: 3000, place: 1 } ] },
  }),
};
