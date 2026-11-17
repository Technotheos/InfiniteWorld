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

export const BAZAAR: MapInfo = {
  id: "brain-bazaar", name: "Brain Bazaar", tagline: "Bet on what you know. Bold bets pay double, bad ones sting.", theme: "bazaar", mode: "versus",
  min_players: 1, max_players: 8,
  missions: [
    { kind: "bazaar", title: "Estimate It", brief: "Guess the number and stake coins on it." },
    { kind: "bazaar", title: "Fact or Fib", brief: "Four statements, one is a fib." },
    { kind: "bazaar", title: "Chain Reaction", brief: "One link in a chain of ideas is missing." },
  ],
};
export const MYSTERY: MapInfo = {
  id: "midnight-mystery", name: "Midnight Mystery", tagline: "A crime, a secret role for everyone, and one liar.", theme: "noir", mode: "versus",
  min_players: 4, max_players: 6,
  missions: [
    { kind: "mystery", title: "Case 1: The Orion Diamond", brief: "Compare alibis, use your tools, then vote." },
    { kind: "mystery", title: "Case 2: The Helix Serum", brief: "New case, new roles." },
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

  "bazaar: fib (ask)": () => base(BAZAAR, "playing", {
    players: crew([{ progress: 0.2 }, {}, { progress: 0.2 }]), mission: 1, deadline: inMs(15000), private: { answered: false, net: 150 },
    brief: { index: 1, total: 3, kind: "bazaar", title: "Fact or Fib", brief: "" },
    play: { kind: "bazaar", variant: "fib", round: 2, rounds: 5, status: "ask", event: "tip", prompt: "Spot the fib. Exactly one statement is false. Topic: Computing",
      unit: "", locked: ["trinity"], net: { neo: 150, trinity: 300, morpheus: -50 }, struck: 3, hint: "Insider tip: one wrong answer has been struck out.",
      options: ["HTTP is stateless by design.", "Base64 is a form of encryption.", "A hash function turns input of any size into a fixed-size output.", "Binary numbers use only the digits 0 and 1."] },
  }),
  "bazaar: estimate (between)": () => base(BAZAAR, "playing", {
    players: crew(), mission: 0, deadline: inMs(3000), private: { answered: true, net: 240, bet: 2, value: 8850 },
    brief: { index: 0, total: 3, kind: "bazaar", title: "Estimate It", brief: "" },
    play: { kind: "bazaar", variant: "estimate", round: 1, rounds: 5, status: "between", event: "bull", prompt: "How tall is Mount Everest?", unit: "m",
      locked: ["neo", "trinity", "morpheus"], net: { neo: 240, trinity: 50, morpheus: -200 }, answer: "8849 m",
      explain: "Its height was re-measured in 2020 by Nepal and China: 8,848.86 m above sea level.",
      results: [{ name: "neo", answer: "8850 m", bet: 2, delta: 240, right: true }, { name: "trinity", answer: "9500 m", bet: 1, delta: 50, right: true }, { name: "morpheus", answer: "5000 m", bet: 3, delta: -200, right: false }],
      penalty: { name: "morpheus", text: "Type your next chat message like a pirate." } },
  }),
  "bazaar: chain": () => base(BAZAAR, "playing", {
    players: crew(), mission: 2, deadline: inMs(18000), private: { answered: false, net: 0 },
    brief: { index: 2, total: 3, kind: "bazaar", title: "Chain Reaction", brief: "" },
    play: { kind: "bazaar", variant: "chain", round: 1, rounds: 5, status: "ask", event: "crash", prompt: "Password storage: which link is missing?", unit: "",
      locked: [], net: { neo: 0, trinity: 0, morpheus: 0 }, chain: ["User sends password", "Server adds a salt", "?", "Compare with the stored hash"], blank: 2,
      options: ["Email it back to the user", "Hash the salted password", "Store it in plain text", "Encrypt it with the user's own key"] },
  }),
  ...mysteryScenarios(),
};

function mysteryScenarios(): Record<string, () => StateView> {
  const names = ["neo", "trinity", "morpheus", "cypher", "tank"];
  const ps = () => names.map((n, i) => P(n, { host: i === 0 }));
  const rooms = ["Vault", "Gallery", "Cafe", "Library", "Garden", "Security Office"];
  const slots = ["9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM"];
  const jobs = ["Curator", "Guard", "Chef", "Archivist", "Florist", "Auditor", "Violinist", "Restorer"];
  const coats = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "White", "Teal"];
  const claims = (): Record<string, { room: number; with: string[]; hidden?: boolean }[]> => ({
    neo: [{ room: 1, with: ["trinity"] }, { room: 2, with: [] }, { room: 3, with: ["tank", "cypher"] }, { room: 4, with: [] }],
    trinity: [{ room: 1, with: ["neo"] }, { room: 5, with: [] }, { room: 4, with: ["morpheus"] }, { room: 2, with: [] }],
    morpheus: [{ room: 3, with: [] }, { room: 1, with: [] }, { room: 4, with: ["trinity"] }, { room: 5, with: [] }],
    cypher: [{ room: 2, with: [] }, { room: 5, with: [] }, { room: 1, with: [], hidden: false }, { room: 2, with: ["tank"] }],
    tank: [{ room: 2, with: ["cypher"] }, { room: 3, with: [] }, { room: 5, with: ["neo", "cypher"] }, { room: -1, with: [], hidden: true }],
  });
  const play = (phase: string, extra: Record<string, unknown> = {}) => ({
    kind: "mystery", phase, theme: "museum", title: "The Orion Diamond",
    setting: "The Aurelian Museum, night of the winter gala. The chandeliers dim, the music stops, and a silent alarm lights up in the Vault.",
    crime: "The Orion Diamond has vanished from the Vault. The door log shows it was opened once, during the time marked below.",
    rooms, slots, coats, jobs, crime_slot: 2,
    suspects: names.map((name, i) => ({ name, coat: i, job: i })), voted: [], tips: [], feed: [], verified: {},
    ...(phase === "intro" ? {} : { claims: claims() }), ...extra,
  });
  const st = (phase: string, p: Record<string, unknown>, priv: Record<string, unknown>) => () => base(MYSTERY, "playing", {
    players: ps(), mission: 0, deadline: inMs(30000),
    brief: { index: 0, total: 2, kind: "mystery", title: "Case 1: The Orion Diamond", brief: "" },
    play: play(phase, p) as unknown as StateView["play"], private: priv,
  });
  const role = { role: "detective", inquiries: 2, log: [], press: 2, verify: 1, tip_used: false, vote: "" };
  return {
    "mystery: intro": st("intro", {}, role),
    "mystery: alibi": st("alibi", {}, role),
    "mystery: investigate": st("investigate", {
      tips: [{ id: 1, coat: 2, text: "A figure in a green coat was seen slipping out of the Vault around 10:00 PM." }],
      feed: [{ kind: "press", who: "tank", target: "morpheus", slot: 2 }, { kind: "verify", target: "trinity", slot: 0, text: "VERIFIED: trinity really was in the Gallery at 9:00 PM." }],
      verified: { "trinity|0": "ok" },
    }, { ...role, log: ["Camera in the Cafe at 10:00 PM: 1 person on screen."], inquiries: 1 }),
    "mystery: vote": st("vote", { voted: ["trinity", "tank"] }, { ...role, role: "witness", saw: 2, vote: "" }),
    "mystery: unmask": st("unmask", {
      unmask: {
        culprit: "morpheus", accused: "morpheus", caught: true,
        roles: { neo: "suspect", trinity: "detective", morpheus: "culprit", cypher: "witness", tank: "suspect" },
        truth: { neo: [1, 2, 3, 4], trinity: [1, 5, 4, 2], morpheus: [3, 1, 0, 5], cypher: [2, 5, 1, 2], tank: [2, 3, 5, 1] },
        votes: { neo: "morpheus", trinity: "morpheus", morpheus: "tank", cypher: "morpheus", tank: "morpheus" },
        why: "morpheus was really in the Vault at 10:00 PM, but their testimony put them in the Garden with trinity. They said they were elsewhere.",
        lesson: "Alibis are testable. Cross-validate testimony.",
      },
    }, { ...role, role: "suspect" }),
  };
}
