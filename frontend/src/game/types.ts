// Mirrors backend-go/game_protocol.go. Keep the two in sync.

export type Phase = "lobby" | "countdown" | "briefing" | "playing" | "reveal" | "finished";
export type MissionKind = "reaction" | "math" | "typing" | "cipher" | "talk";

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
export type Play = ReactionPlay | MathPlay | TypingPlay | CipherPlay | TalkPlay;

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

export type ClientMsgType = "ready" | "start" | "chat" | "act" | "rematch";
export type SendFn = (type: ClientMsgType, payload?: unknown) => void;

export interface MissionProps<P, Q = unknown> {
  play: P;
  priv: Q | undefined;
  players: PlayerView[];
  you: string;
  send: SendFn;
}
