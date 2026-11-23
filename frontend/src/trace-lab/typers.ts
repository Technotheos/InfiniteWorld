/** Trace Lab data model. Every case is plain data: artifacts (evidence), questions, and the true attack (replay). */

export type ToolId = 'logs' | 'disk' | 'packets' | 'hex' | 'proc' | 'chain' | 'map' | 'timeline';
export type Tactic =
  | 'Initial Access' | 'Execution' | 'Persistence' | 'Privilege Escalation' | 'Defense Evasion'
  | 'Credential Access' | 'Discovery' | 'Lateral Movement' | 'Collection' | 'Command and Control'
  | 'Exfiltration' | 'Impact';

/** Fields every evidence row carries. `role` is hidden from the player until the reveal. */
export interface RowBase {
  id: string;
  /** key = part of the real attack; herring = suspicious-looking but normal. Unset = background noise. */
  role?: 'key' | 'herring';
  /** key rows: the replay step this row proves. */
  step?: string;
  /** key rows: the host the attacker touched (lights it on the network map when pinned). */
  touches?: string;
  /** herring rows: why this is actually normal (shown at the reveal). */
  why?: string;
  /** short label for the notebook (falls back to the row's own text). */
  sum?: string;
  /** extra fields shown when the row is opened. */
  detail?: Record<string, string>;
}

export interface Col { k: string; label: string; w?: number; mono?: boolean }
export interface TableRow extends RowBase { cells: Record<string, string> }
export interface TableArt { kind: 'table'; id: string; label: string; sub: string; cols: Col[]; rows: TableRow[]; sortKey?: string }

export interface DiskRow extends RowBase {
  path: string; size: number;
  m: string; a: string; c: string;         // $STANDARD_INFORMATION modified / accessed / created
  fn: string;                              // $FILE_NAME created (cannot be changed by user-mode tools)
  state: 'live' | 'deleted' | 'hidden';    // deleted and hidden entries only show after the UV scan
  cell?: number;                           // position on the sector grid (derived when absent)
}
export interface DiskArt { kind: 'disk'; id: string; label: string; sub: string; rows: DiskRow[] }

export interface PacketRow extends RowBase {
  t: number; src: string; dst: string; proto: string; len: number; info: string;
  /** hex payload (no spaces) for the hex pane. */
  payload?: string;
}
export interface PcapArt { kind: 'pcap'; id: string; label: string; sub: string; rows: PacketRow[]; inventory?: Record<string, string> }

export interface ProcRow extends RowBase {
  pid: number; ppid: number; name: string; user: string; created: string; cmd: string;
  /** who really created it (only visible after the deep scan). */
  creator?: number;
  /** unlinked from the active list: only the deep scan finds it. */
  hidden?: boolean;
}
export interface ProcArt { kind: 'proc'; id: string; label: string; sub: string; rows: ProcRow[] }

export interface HexRow extends RowBase { off: number; bytes: string }
export interface HexArt { kind: 'hex'; id: string; label: string; sub: string; rows: HexRow[] }

export interface ChainNode { id: string; label: string; kind: 'victim' | 'wallet' | 'mixer' | 'bridge' | 'exchange' | 'dex' | 'multisig'; x: number; y: number; chain?: string }
export interface ChainEdge extends RowBase { from: string; to: string; amt: string; asset: string; time: string; hash: string }
export interface ChainArt { kind: 'chain'; id: string; label: string; sub: string; nodes: ChainNode[]; rows: ChainEdge[] }

export type Artifact = TableArt | DiskArt | PcapArt | ProcArt | HexArt | ChainArt;
export type AnyRow = TableRow | DiskRow | PacketRow | ProcRow | HexRow | ChainEdge;

export interface Host { id: string; label: string; ip?: string; x: number; y: number; kind: 'ws' | 'server' | 'dc' | 'cloud' | 'usb' | 'net' | 'wallet' | 'attacker' }

export interface Question {
  id: string; prompt: string; options: string[]; answer: number;
  /** evidence refs ("artifact:row") that count as proof. */
  proof: string[];
  /** how many distinct proof refs must be linked. */
  need: number;
  points: number;
  hint: string;
  /** one sentence shown after solving. */
  explain: string;
}

export interface Step {
  id: string; t: string; from: string; to: string; title: string; text: string;
  attack: { id: string; name: string; tactic: Tactic };
}

export interface Case {
  id: string; no: number; kind: string; title: string; tagline: string; icon: string;
  briefing: string[]; base: number;
  tools: ToolId[]; newTools: ToolId[];
  artifacts: Artifact[];
  hosts: Host[];
  /** a red string joins the two ends of an edge once both hosts are proven. */
  edges: [string, string][];
  questions: Question[];
  steps: Step[];
}

export type Ref = string; // `${artifactId}:${rowId}`
export const ref = (a: string, r: string): Ref => `${a}:${r}`;
