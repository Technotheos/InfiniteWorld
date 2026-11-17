// Mirrors backend-go/game_protocol.go. Keep the two in sync.

export type Phase = "lobby" | "countdown" | "briefing" | "playing" | "reveal" | "finished";
export type MissionKind = "reaction" | "math" | "typing" | "cipher" | "talk" | "bazaar" | "mystery";

export interface MissionInfo {
  kind: MissionKind;
  title: string;
  brief: string;
}

export interface MapInfo {
  id: string;
  name: string;
  tagline: string;
  theme: string;
  mode: "versus" | "coop";
  min_players: number;
  max_players: number;
  missions: MissionInfo[];
}

export interface PlayerView {
  name: string;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
  host: boolean;
  score: number;
  gain: number;
  progress: number;
}

export interface BriefView {
  index: number;
  total: number;
  kind: MissionKind;
  title: string;
  brief: string;
}

export interface RevealView {
  kind: MissionKind;
  title: string;
  note: string;
  stats: Record<string, string>;
  points: Record<string, number>;
}

export interface RankRow {
  name: string;
  score: number;
  place: number;
}

export interface FinalView {
  mode: "versus" | "coop";
  won: boolean;
  ranking: RankRow[];
}

// ---- public mission data (state.play) and private data (state.private) ----

export interface ReactionPlay {
  kind: "reaction";
  round: number;
  rounds: number;
  status: "wait" | "go" | "between";
  results?: Record<string, number>; // ms; -1 false start; -2 no click
}
export interface MathPlay {
  kind: "math";
}
export interface TypingPlay {
  kind: "typing";
  text: string;
}
export interface CipherPlay {
  kind: "cipher";
  variant: "caesar" | "base64" | "hex" | "binary";
  round: number;
  rounds: number;
  status: "play" | "between";
  challenge: string;
  hint?: string;
  answer?: string;
  solved: string[];
}
export interface TalkPlay {
  kind: "talk";
  prompt: string;
  done: string[];
  total: number;
}

// ---- Brain Bazaar ----
export interface BazaarResult {
  name: string;
  answer: string;
  bet: number;
  delta: number;
  right: boolean;
}
export interface BazaarPlay {
  kind: "bazaar";
  variant: "estimate" | "fib" | "chain";
  round: number;
  rounds: number;
  status: "ask" | "between";
  event: "none" | "bull" | "crash" | "tip";
  prompt: string;
  unit: string;
  locked: string[];
  net: Record<string, number>;
  options?: string[];
  struck?: number;
  chain?: string[];
  blank?: number;
  hint?: string;
  answer?: string;
  correct?: number;
  explain?: string;
  results?: BazaarResult[];
  penalty?: { name: string; text: string };
}
export interface BazaarPrivate {
  answered: boolean;
  net: number;
  bet?: number;
  value?: number;
}

// ---- Midnight Mystery ----
export type MysteryRole = "culprit" | "detective" | "witness" | "trickster" | "suspect";
export type MysteryPhase = "intro" | "alibi" | "investigate" | "interrogate" | "vote" | "unmask";
export interface MyClaim {
  room: number;
  with: string[];
  hidden?: boolean;
}
export interface MySuspect {
  name: string;
  coat: number;
  job: number;
}
export interface MyTip {
  id: number;
  coat: number;
  text: string;
}
export interface MyFeed {
  kind: "press" | "verify";
  who?: string;
  target?: string;
  slot: number;
  text?: string;
}
export interface MysteryUnmask {
  culprit: string;
  accused: string;
  caught: boolean;
  roles: Record<string, MysteryRole>;
  truth: Record<string, number[]>;
  votes: Record<string, string>;
  why: string;
  lesson: string;
}
export interface MysteryPlay {
  kind: "mystery";
  phase: MysteryPhase;
  theme: string;
  title: string;
  setting: string;
  crime: string;
  rooms: string[];
  slots: string[];
  coats: string[];
  jobs: string[];
  crime_slot: number;
  suspects: MySuspect[];
  voted: string[];
  tips: MyTip[];
  feed: MyFeed[];
  verified: Record<string, "ok" | "bad" | "hidden">;
  claims?: Record<string, MyClaim[]>;
  unmask?: MysteryUnmask;
}
export interface MysteryPrivate {
  role: MysteryRole;
  inquiries: number;
  log: string[];
  press: number;
  verify: number;
  tip_used: boolean;
  vote: string;
  truth?: number[];
  saw?: number;
}

export type Play = ReactionPlay | MathPlay | TypingPlay | CipherPlay | TalkPlay | BazaarPlay | MysteryPlay;

export interface ReactionPrivate {
  acted: boolean;
}
export interface MathPrivate {
  q: string;
  index: number;
  correct: number;
  wrong: number;
}
export interface CipherPrivate {
  solved: boolean;
  attempts: number;
}
export interface TalkPrivate {
  done: boolean;
}

export interface StateView {
  code: string;
  map: MapInfo;
  phase: Phase;
  you: string;
  spectating: boolean;
  players: PlayerView[];
  mission: number;
  deadline: number; // unix ms, 0 if none
  now: number; // server unix ms
  brief?: BriefView;
  play?: Play;
  private?: unknown;
  reveal?: RevealView;
  result?: FinalView;
}

export interface ChatMsg {
  from: string;
  text: string;
  at: number;
}

export interface Hello {
  protocol: number;
  you: string;
  chat: ChatMsg[] | null;
}

export type ClientMsgType = "ready" | "start" | "chat" | "act" | "rematch" | "reauth";
export type SendFn = (type: ClientMsgType, payload?: unknown) => void;

export interface MissionProps<P, Q = unknown> {
  play: P;
  priv: Q | undefined;
  players: PlayerView[];
  you: string;
  send: SendFn;
}
