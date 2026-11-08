import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  BarChart2,
  Settings,
  Compass,
  LogOut,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Lock,
  Play,
  Pause,
  RotateCcw,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { Starfield, type StarfieldHandle } from '../components/Starfield';

/* ========================================================================== */
/*  Types & props                                                             */
/* ========================================================================== */

type EngineStatus = 'connected' | 'connecting' | 'offline';

interface HomeProps {
  username?: string | null;
  onSelectRoom: (roomId: string) => void;
  onLogout: () => void;
  /** Pass the real WebSocket/engine state so the badge never lies. */
  engineStatus?: EngineStatus;
}

const STATUS_STYLES: Record<EngineStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connected', dot: 'bg-[#5eead4]', text: 'text-[#5eead4]' },
  connecting: { label: 'Connecting…', dot: 'bg-[#e9b872]', text: 'text-[#e9b872]' },
  offline: { label: 'Offline', dot: 'bg-[#ff5d4a]', text: 'text-[#ff5d4a]' },
};

// Room ids must match the server's ^[A-Za-z0-9_-]{1,64}$ rule.
// The security lab reuses your existing 'zeroday-websec' room for live discussion.
const LAB_ROOM_ID = 'zeroday-websec';
const sideRooms = [
  { id: LAB_ROOM_ID, title: 'Chain Security Lab', icon: '🛡️' },
  { id: 'nasdaq-scalping', title: 'Nasdaq 1-Min Scalps', icon: '📈' },
  { id: 'crypto-alpha', title: 'Crypto Alpha & Flows', icon: '⚡' },
  { id: 'distributed-systems', title: 'Distributed Systems', icon: '⚙️' },
];

const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]';

/* ========================================================================== */
/*  Math, palette, 3D helpers                                                 */
/* ========================================================================== */

type V3 = [number, number, number];
interface Cam {
  yaw: number;
  pitch: number;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
// Deterministic pseudo-random in [0,1): keeps every frame a pure function of time.
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const RGB = {
  gold: [233, 184, 114],
  violet: [155, 140, 255],
  ember: [255, 93, 74],
  mint: [94, 234, 212],
  ice: [190, 214, 255],
} as const;
type Hue = keyof typeof RGB;
const rgba = (h: Hue, a: number) => `rgba(${RGB[h][0]},${RGB[h][1]},${RGB[h][2]},${a})`;

const FLOOR = -2.6;

function makeProjector(cam: Cam, w: number, h: number) {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const D = 22;
  const unit = w / 21;
  return (p: V3) => {
    const x1 = p[0] * cy - p[2] * sy;
    const z1 = p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp + z1 * sp;
    const z2 = -p[1] * sp + z1 * cp;
    const depth = D + z2;
    const s = (unit * D) / depth;
    return { x: w / 2 + x1 * s, y: h * 0.54 - y2 * s, s, d: depth };
  };
}
type Projector = ReturnType<typeof makeProjector>;

function rot(p: V3, rx: number, ry: number): V3 {
  const crx = Math.cos(rx);
  const srx = Math.sin(rx);
  const cry = Math.cos(ry);
  const sry = Math.sin(ry);
  const y1 = p[1] * crx - p[2] * srx;
  const z1 = p[1] * srx + p[2] * crx;
  return [p[0] * cry + z1 * sry, y1, -p[0] * sry + z1 * cry];
}

function ring(c: V3, r: number, rx: number, ry: number, n = 40): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const q = rot([Math.cos(a) * r, 0, Math.sin(a) * r], rx, ry);
    pts.push([c[0] + q[0], c[1] + q[1], c[2] + q[2]]);
  }
  return pts;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: Hue, a: number) {
  if (r <= 0.5) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hue, a));
  g.addColorStop(1, rgba(hue, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function strokePts(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  color: string,
  lw: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
  ctx.stroke();
}

/* ========================================================================== */
/*  Mission data                                                              */
/*  Every incident below is a real, publicly documented post-mortem.          */
/*  Code is deliberately simplified for teaching; it is not the original.     */
/* ========================================================================== */

type PacketKind = 'ok' | 'sig' | 'bad';

interface Actor {
  id: string;
  label: string;
  sub?: string;
  pos: V3;
  kind: 'core' | 'gate' | 'swarm' | 'shard';
  hue: Hue;
}

interface Step {
  from: string;
  to: string;
  kind: PacketKind;
  title: string;
  chip: string;
  detail: string;
  /** In the patched replay the exploit is stopped at this step. */
  blockable?: boolean;
  blockedText?: string;
  impact?: boolean;
  /** Meter values that are set when this step lands. */
  after?: Record<string, number>;
}

interface Meter {
  id: string;
  label: string;
  start: number;
}

interface Status {
  tone: 'idle' | 'ok' | 'bad';
  text: string;
}

interface CodeLine {
  n: number;
  code: string;
  note?: string;
}

interface Fix {
  id: string;
  title: string;
  body: string;
  correct: boolean;
  why: string;
}

interface Mission {
  id: string;
  title: string;
  chain: string;
  date: string;
  loss: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  tagline: string;
  story: string[];
  facts: { k: string; v: string }[];
  watchFor: string[];
  actors: Actor[];
  steps: Step[];
  meters: Meter[];
  status: (m: Record<string, number>) => Status;
  code: {
    title: string;
    lines: CodeLine[];
    vulnerable: number[];
    hint: string;
    explain: string;
  };
  fixes: Fix[];
  lessons: string[];
  sources: string;
}

interface Teaser {
  id: string;
  title: string;
  date: string;
  loss: string;
  tagline: string;
}

const MISSIONS: Mission[] = [
  {
    id: 'wormhole',
    title: 'Wormhole',
    chain: 'Ethereum ↔ Solana',
    date: 'Feb 2, 2022',
    loss: '~$320M',
    difficulty: 'Intermediate',
    tagline: 'A forged signature check mints 120,000 wETH from nothing.',
    story: [
      'Wormhole is a bridge. You lock ETH on Ethereum, a group of guardians signs a message saying so, and Solana mints the same amount of wrapped ETH (wETH).',
      'On February 2, 2022, an attacker convinced the Solana program that the guardians had approved a deposit that never happened, then minted 120,000 wETH. Wormhole’s backer, Jump Trading, replaced the missing ETH.',
      'Replay the incident, find the line that trusted the wrong thing, and patch it.',
    ],
    facts: [
      { k: 'Stolen', v: '120,000 wETH, about $320M' },
      { k: 'Root cause', v: 'An account that was never checked' },
      { k: 'Outcome', v: 'Funds replaced by the backer' },
    ],
    watchFor: [
      'Follow the violet packet: the guardians sign, the gate verifies.',
      'Compare the two meters: ETH locked versus wETH minted.',
      'The red packet never passes through the guardians.',
    ],
    actors: [
      { id: 'eth', label: 'Ethereum vault', sub: 'locks real ETH', pos: [-7, 0, 0], kind: 'core', hue: 'gold' },
      { id: 'guard', label: 'Guardians', sub: 'sign deposit messages', pos: [-2.6, 2.4, -3], kind: 'swarm', hue: 'violet' },
      { id: 'gate', label: 'verify_signatures', sub: 'Solana program', pos: [2.4, 0, 0], kind: 'gate', hue: 'violet' },
      { id: 'mint', label: 'wETH mint', sub: 'Solana', pos: [7, 0, 0], kind: 'core', hue: 'mint' },
      { id: 'atk', label: 'Attacker', pos: [0.8, 1.4, 5], kind: 'shard', hue: 'ember' },
    ],
    steps: [
      {
        from: 'eth', to: 'guard', kind: 'ok', title: 'A real deposit', chip: '1 ETH locked',
        detail: 'A user locks 1 ETH in the Ethereum vault. The guardians watch the vault and see the deposit.',
        after: { locked: 1 },
      },
      {
        from: 'guard', to: 'gate', kind: 'sig', title: 'Guardians sign', chip: 'signed message',
        detail: 'The guardians sign a message that says “1 ETH was locked”. Solana’s verify_signatures instruction checks those signatures.',
      },
      {
        from: 'gate', to: 'mint', kind: 'ok', title: 'Honest mint', chip: 'mint 1 wETH',
        detail: 'The signatures check out, so Solana mints 1 wETH. One ETH locked, one wETH minted: the bridge is solvent.',
        after: { minted: 1 },
      },
      {
        from: 'atk', to: 'gate', kind: 'bad', title: 'The forgery', chip: 'fake sysvar account',
        blockable: true,
        blockedText: 'Rejected. The account passed in is not the real system Instructions account, so the call stops before any data is read.',
        detail: 'The attacker calls verify_signatures but passes their own account where the system Instructions account should be. The program never checks it, so fake data says “the signature check already ran”.',
      },
      {
        from: 'gate', to: 'mint', kind: 'bad', title: 'The mint obeys', chip: 'mint 120,000 wETH', impact: true,
        detail: 'The forged signature set now counts as verified. The attacker posts a message asking for 120,000 wETH and the mint authority obeys.',
        after: { minted: 120001 },
      },
      {
        from: 'mint', to: 'atk', kind: 'bad', title: 'Unbacked tokens', chip: '120,000 wETH',
        detail: 'The attacker holds 120,000 wETH that is backed by nothing. Only 1 ETH is actually locked on Ethereum.',
      },
    ],
    meters: [
      { id: 'locked', label: 'ETH locked on Ethereum', start: 0 },
      { id: 'minted', label: 'wETH minted on Solana', start: 0 },
    ],
    status: (m) =>
      m.minted - m.locked > 0.5
        ? { tone: 'bad', text: `${Math.round(m.minted - m.locked).toLocaleString()} wETH with no ETH behind it` }
        : m.locked > 0
          ? { tone: 'ok', text: 'Every wETH is backed by locked ETH' }
          : { tone: 'idle', text: 'Bridge idle' },
    code: {
      title: 'verify_signatures (simplified)',
      lines: [
        { n: 1, code: 'pub fn verify_signatures(ctx: Context<VerifySigs>, sigs: Vec<Sig>) -> Result<()> {', note: 'This is just the function signature.' },
        { n: 2, code: '    let ix_account = &ctx.accounts.instructions;   // chosen by the caller' },
        { n: 3, code: '    // Did a secp256k1 check run in the instruction just before this one?', note: 'Comments do not run, so they cannot be the bug.' },
        { n: 4, code: '    let idx  = load_current_index(ix_account);' },
        { n: 5, code: '    let prev = load_instruction_at(idx - 1, ix_account)?;' },
        { n: 6, code: '    require!(prev.program_id == SECP256K1_PROGRAM);', note: 'This check is fine, but it reads data from an account the attacker controls.' },
        { n: 7, code: '    require!(prev.data == encode(&sigs));', note: 'Also fine on its own. It trusts whatever prev contains.' },
        { n: 8, code: '    ctx.accounts.signature_set.mark_verified(&sigs);', note: 'Marking signatures verified is correct if the checks above can be trusted.' },
        { n: 9, code: '    Ok(())', note: 'Nothing wrong here.' },
        { n: 10, code: '}', note: 'Nothing wrong here.' },
      ],
      vulnerable: [2, 4, 5],
      hint: 'Ask where ix_account comes from, and what proves it is the real system account.',
      explain:
        'The program learns “what ran before me” from ix_account, but never checks that ix_account is the real Instructions sysvar. The attacker supplied their own account holding fake data saying the signature check had already happened.',
    },
    fixes: [
      {
        id: 'cap', correct: false, title: 'Cap how much wETH can be minted per hour',
        body: 'Add a rate limit to the mint.',
        why: 'A rate limit would have shrunk the loss, but forged signatures would still be accepted. Useful as an extra layer, not the fix.',
      },
      {
        id: 'addr', correct: true, title: 'Check the account’s address',
        body: 'Require that the instructions account is the real system Instructions sysvar, or use the checked loader that does this for you.',
        why: 'Fake accounts are rejected before any data is read, which closes the hole at its root.',
      },
      {
        id: 'more', correct: false, title: 'Require more guardian signatures',
        body: 'Raise the number of signatures needed.',
        why: 'The signatures were never really checked. Asking for more of them changes nothing when the check itself can be bypassed.',
      },
    ],
    lessons: [
      'Treat every account a program receives as untrusted until its address and owner are verified.',
      'A helper that reads caller-supplied data is only as safe as the source you validated.',
      'Layer your defences: mint limits and monitoring shrink the blast radius when something slips through.',
    ],
    sources: 'Based on public post-mortems, including CertiK’s Wormhole incident analysis.',
  },
  {
    id: 'aurora',
    title: 'Aurora Rainbow Bridge',
    chain: 'Ethereum ↔ NEAR ↔ Aurora EVM',
    date: 'Reported Apr 26, 2022',
    loss: '$6M bounty',
    difficulty: 'Advanced',
    tagline: 'A DELEGATECALL tricks the bridge into paying twice.',
    story: [
      'Aurora is an EVM that runs on NEAR. To withdraw, a contract sends ETH to a built-in contract called ExitToNear. It writes a log, and the engine turns that log into a payout on NEAR.',
      'In April 2022 a whitehat known as pwning.eth found that the precompile believed any call carrying a value had really received that value. A DELEGATECALL inherits the value without sending anything. Aurora patched it and paid a $6M bounty. No funds were lost.',
      'Replay what an attacker could have done, then find the trust mistake.',
    ],
    facts: [
      { k: 'At risk', v: 'About 70k ETH plus other assets' },
      { k: 'Root cause', v: 'Inherited msg.value was trusted' },
      { k: 'Outcome', v: 'Responsible disclosure, $6M bounty' },
    ],
    watchFor: [
      'Compare the honest withdrawal with the exploit: where does ETH actually move?',
      'The exploit contract never sends ETH to the precompile.',
      'Watch the meters: ETH debited versus nETH paid out.',
    ],
    actors: [
      { id: 'user', label: 'Honest user', pos: [-7, -0.4, 2.4], kind: 'core', hue: 'gold' },
      { id: 'atk', label: 'Attacker', pos: [-7, 1.6, -2.4], kind: 'shard', hue: 'ember' },
      { id: 'ctr', label: 'Exploit contract', sub: 'uses DELEGATECALL', pos: [-3.4, 1.2, -1.2], kind: 'shard', hue: 'ember' },
      { id: 'pre', label: 'ExitToNear', sub: 'built-in precompile', pos: [0.6, 0, 0], kind: 'gate', hue: 'violet' },
      { id: 'eng', label: 'Aurora Engine', sub: 'turns logs into payouts', pos: [1.2, 2.8, -2.8], kind: 'core', hue: 'violet' },
      { id: 'near', label: 'NEAR bridge', sub: 'holds the real funds', pos: [7, 0, 0], kind: 'core', hue: 'mint' },
    ],
    steps: [
      {
        from: 'user', to: 'pre', kind: 'ok', title: 'Honest withdrawal', chip: 'sends 1 ETH',
        detail: 'A user withdraws by sending 1 ETH straight to the ExitToNear precompile. The ETH really moves, so their Aurora balance drops by 1.',
        after: { debited: 1 },
      },
      {
        from: 'pre', to: 'eng', kind: 'ok', title: 'Exit log', chip: 'exit event',
        detail: 'The precompile writes an exit log with the amount. The engine turns logs from this address into NEAR payouts.',
      },
      {
        from: 'eng', to: 'near', kind: 'ok', title: 'Payout', chip: 'release 1 nETH',
        detail: 'NEAR pays out 1 nETH. One ETH debited, one nETH paid: the books balance.',
        after: { paid: 1 },
      },
      {
        from: 'atk', to: 'ctr', kind: 'bad', title: 'The setup', chip: 'exploit(1 ETH)',
        detail: 'The attacker calls their own contract with 1 ETH attached. Nothing unusual has happened yet.',
      },
      {
        from: 'ctr', to: 'pre', kind: 'bad', title: 'DELEGATECALL', chip: 'delegatecall',
        blockable: true,
        blockedText: 'Rejected. The call context does not match the precompile’s own address, so it returns an error and nothing is scheduled.',
        detail: 'The contract uses DELEGATECALL instead of a normal call. The precompile runs in the contract’s context and inherits msg.value, but no ETH is transferred to it.',
      },
      {
        from: 'pre', to: 'eng', kind: 'bad', title: 'A log for ETH that never moved', chip: 'exit event: 1',
        detail: 'The precompile trusts the inherited value and writes an exit log for 1 ETH, even though it received none.',
      },
      {
        from: 'eng', to: 'near', kind: 'bad', title: 'Paid twice', chip: 'release 1 nETH', impact: true,
        detail: 'The engine trusts any log from the precompile’s address and schedules a payout. NEAR pays 1 nETH while nothing was debited on Aurora.',
        after: { paid: 2 },
      },
      {
        from: 'near', to: 'atk', kind: 'bad', title: 'Repeat', chip: '1 nETH, bridge back',
        detail: 'The attacker bridges the nETH back to Aurora, doubling their balance, and could repeat it. This one was reported by a whitehat instead.',
      },
    ],
    meters: [
      { id: 'debited', label: 'ETH debited on Aurora', start: 0 },
      { id: 'paid', label: 'nETH paid out on NEAR', start: 0 },
    ],
    status: (m) =>
      m.paid - m.debited > 0.5
        ? { tone: 'bad', text: `Paid out ${Math.round(m.paid - m.debited)} nETH that was never debited` }
        : m.paid > 0
          ? { tone: 'ok', text: 'Payouts match debits' }
          : { tone: 'idle', text: 'Waiting for a withdrawal' },
    code: {
      title: 'exit_to_near precompile (simplified)',
      lines: [
        { n: 1, code: 'fn exit_to_near(ctx: &CallContext, input: &[u8]) -> Result<Log> {', note: 'This is just the function signature.' },
        { n: 2, code: '    // value attached to the current call frame', note: 'Comments do not run, so they cannot be the bug.' },
        { n: 3, code: '    let amount = ctx.apparent_value;' },
        { n: 4, code: '    let dest   = parse_destination(input)?;', note: 'Parsing the destination is fine.' },
        { n: 5, code: '    // describe the withdrawal for the engine', note: 'Comments do not run, so they cannot be the bug.' },
        { n: 6, code: '    Ok(Log::exit_to_near(ctx.sender, dest, amount))', note: 'Logging is fine. The amount it logs is the problem.' },
        { n: 7, code: '}', note: 'Nothing wrong here.' },
        { n: 8, code: '// engine: every log from EXIT_ADDRESS becomes a NEAR transfer of that amount' },
      ],
      vulnerable: [3, 8],
      hint: 'Which value does the precompile read, and what does DELEGATECALL do to msg.value?',
      explain:
        'apparent_value is the value of the call frame, and a DELEGATECALL inherits it without moving any ETH. The precompile trusted it, and the engine trusted any log from the precompile’s address, so a payout was scheduled for ETH that was never sent.',
    },
    fixes: [
      {
        id: 'cap', correct: false, title: 'Cap withdrawals per transaction',
        body: 'Limit how much one transaction can withdraw.',
        why: 'The attacker can simply loop, and honest users get blocked. The trust mistake is still there.',
      },
      {
        id: 'eoa', correct: false, title: 'Only let externally owned accounts call it',
        body: 'Block contracts from using the precompile.',
        why: 'ERC-20 wrappers legitimately call this precompile, so normal withdrawals would break while the underlying bug stays.',
      },
      {
        id: 'ctx', correct: true, title: 'Reject calls that are not a direct call to the precompile',
        body: 'Return an error unless the call context’s address matches the precompile’s own address, which rules out DELEGATECALL-style entry.',
        why: 'This matches the shape of the real fix: the precompile now refuses to run inside someone else’s context.',
      },
    ],
    lessons: [
      'Never treat a context value like msg.value as proof that value moved. Check the real balance change.',
      'Built-in contracts must defend against every calling mode: CALL, DELEGATECALL and CALLCODE.',
      'Bug bounties work. A $6M payout was far cheaper than an incident of this size.',
      'Add a regression test for every fixed bug so it cannot quietly return.',
    ],
    sources: 'Based on Aurora’s disclosure and Immunefi’s bugfix review.',
  },
];

const TEASERS: Teaser[] = [
  { id: 'nomad', title: 'Nomad', date: 'Aug 1, 2022', loss: '~$190M', tagline: 'A trusted root of zero made every message look valid.' },
  { id: 'ronin', title: 'Ronin', date: 'Mar 23, 2022', loss: '~$625M', tagline: 'Compromised validator keys, noticed six days later.' },
];

// Positions of the constellation nodes on the sector map (percent of the panel).
const NODE_POS: Record<string, { x: number; y: number }> = {
  wormhole: { x: 20, y: 46 },
  aurora: { x: 42, y: 26 },
  nomad: { x: 66, y: 50 },
  ronin: { x: 84, y: 28 },
};
const MAP_ORDER = ['wormhole', 'aurora', 'nomad', 'ronin'];

/* ========================================================================== */
/*  Timeline (every frame is a pure function of time t)                       */
/* ========================================================================== */

const STEP = 3.4;
const LEAD = 0.4;
const TRAVEL = 1.7;
const TAIL = 1.4;

interface EStep extends Step {
  blocked: boolean;
}

function buildSteps(m: Mission, patched: boolean): EStep[] {
  if (!patched) return m.steps.map((s) => ({ ...s, blocked: false }));
  const idx = m.steps.findIndex((s) => s.blockable);
  const cut = idx === -1 ? m.steps.length : idx + 1;
  return m.steps.slice(0, cut).map((s, i) => ({ ...s, blocked: idx !== -1 && i === idx }));
}
const startAt = (i: number) => i * STEP + LEAD;
const arriveAt = (i: number) => startAt(i) + TRAVEL;
const totalTime = (n: number) => (n - 1) * STEP + LEAD + TRAVEL + TAIL;

function metricsAt(m: Mission, steps: EStep[], t: number) {
  const cur: Record<string, number> = {};
  m.meters.forEach((x) => (cur[x.id] = x.start));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.after || s.blocked) continue;
    const at = arriveAt(i);
    if (t < at) break;
    const e = easeOut(clamp((t - at) / 0.9));
    Object.keys(s.after).forEach((k) => {
      cur[k] = cur[k] + (s.after![k] - cur[k]) * e;
    });
  }
  return cur;
}

const packetHue = (s: EStep): Hue => (s.kind === 'ok' ? 'gold' : s.kind === 'sig' ? 'violet' : 'ember');
const outcomeHue = (s: EStep): Hue => (s.blocked ? 'mint' : packetHue(s));

function actorFx(id: string, steps: EStep[], t: number) {
  let pulse = 0;
  let tint: Hue | null = null;
  steps.forEach((s, i) => {
    const a = arriveAt(i);
    const st = startAt(i);
    if (s.to === id && t >= a) {
      pulse = Math.max(pulse, clamp(1 - (t - a) / 1.3));
      tint = outcomeHue(s);
    }
    if (s.from === id && t >= st) pulse = Math.max(pulse, clamp(1 - (t - st) / 0.7) * 0.7);
  });
  return { pulse, tint: tint as Hue | null };
}

/* ========================================================================== */
/*  3D scene renderer (dependency-free canvas)                                */
/* ========================================================================== */

function drawActor(
  ctx: CanvasRenderingContext2D,
  P: Projector,
  a: Actor,
  time: number,
  fx: { pulse: number; tint: Hue | null },
) {
  const c = P(a.pos);
  const U = c.s;
  const base: Hue = fx.tint ?? a.hue;
  const pulse = fx.pulse;

  // Floor tether and shadow ring give depth.
  const f = P([a.pos[0], FLOOR, a.pos[2]]);
  ctx.strokeStyle = rgba(a.hue, 0.12);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(f.x, f.y);
  ctx.stroke();
  strokePts(ctx, ring([a.pos[0], FLOOR, a.pos[2]], 1.3, 0, 0, 32).map(P), rgba(a.hue, 0.2), 1);

  if (a.kind === 'core') {
    glow(ctx, c.x, c.y, U * (2.6 + pulse * 1.5), base, 0.3 + 0.45 * pulse);
    const r = U * 0.62;
    const g = ctx.createRadialGradient(c.x - r * 0.35, c.y - r * 0.35, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, rgba('ice', 0.95));
    g.addColorStop(0.45, rgba(base, 0.95));
    g.addColorStop(1, rgba(base, 0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    strokePts(ctx, ring(a.pos, 1.15, 0.5 + time * 0.3, time * 0.4).map(P), rgba(base, 0.55), 1.2);
    strokePts(ctx, ring(a.pos, 1.55, 1.25, -time * 0.25).map(P), rgba(base, 0.35), 1);
  } else if (a.kind === 'gate') {
    const outer = ring(a.pos, 1.7, Math.PI / 2, 0, 56).map(P);
    glow(ctx, c.x, c.y, U * (2.4 + pulse * 1.2), base, 0.12 + 0.3 * pulse);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, U * 1.7);
    g.addColorStop(0, rgba(base, 0.1 + 0.3 * pulse));
    g.addColorStop(1, rgba(base, 0.02));
    ctx.fillStyle = g;
    ctx.beginPath();
    outer.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.fill();
    strokePts(ctx, outer, rgba(base, 0.95), 2.2);
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -time * 22;
    strokePts(ctx, ring(a.pos, 1.2, Math.PI / 2, 0, 44).map(P), rgba(base, 0.6), 1.2);
    ctx.setLineDash([]);
  } else if (a.kind === 'swarm') {
    glow(ctx, c.x, c.y, U * (2.2 + pulse), base, 0.12 + 0.3 * pulse);
    strokePts(ctx, ring(a.pos, 1.7, 0, 0, 40).map(P), rgba(base, 0.25), 1);
    const N = 19;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + time * 0.35;
      const q = P([
        a.pos[0] + Math.cos(ang) * 1.7,
        a.pos[1] + Math.sin(time * 1.1 + i) * 0.25,
        a.pos[2] + Math.sin(ang) * 1.7,
      ]);
      glow(ctx, q.x, q.y, U * (0.3 + pulse * 0.25), base, 0.85);
      ctx.fillStyle = rgba('ice', 0.95);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1, U * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // shard: a spinning octahedron
    glow(ctx, c.x, c.y, U * (2 + pulse * 1.2), base, 0.22 + 0.4 * pulse);
    const S = 0.85;
    const raw: V3[] = [[S, 0, 0], [-S, 0, 0], [0, S * 1.25, 0], [0, -S * 1.25, 0], [0, 0, S], [0, 0, -S]];
    const v = raw.map((p) => {
      const q = rot(p, time * 0.5, time * 0.9);
      return P([a.pos[0] + q[0], a.pos[1] + q[1], a.pos[2] + q[2]]);
    });
    ctx.strokeStyle = rgba(base, 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        if (Math.floor(i / 2) === Math.floor(j / 2)) continue; // skip opposite vertices
        ctx.moveTo(v[i].x, v[i].y);
        ctx.lineTo(v[j].x, v[j].y);
      }
    }
    ctx.stroke();
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, P: Projector, a: Actor) {
  const c = P(a.pos);
  const y = c.y + c.s * 1.95 + 12;
  ctx.textAlign = 'center';
  ctx.font = '600 12px Manrope, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(238,233,220,0.95)';
  ctx.fillText(a.label, c.x, y);
  if (a.sub) {
    ctx.font = '400 10px Manrope, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(164,159,176,0.9)';
    ctx.fillText(a.sub, c.x, y + 14);
  }
}

function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  cam: Cam,
  mission: Mission,
  steps: EStep[],
  t: number,
  reduce: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  const P = makeProjector(cam, w, h);
  const byId = new Map(mission.actors.map((a) => [a.id, a]));

  ctx.save();
  if (!reduce) {
    steps.forEach((s, i) => {
      const dt = t - arriveAt(i);
      if (s.impact && !s.blocked && dt >= 0 && dt < 0.6) {
        const k = (1 - dt / 0.6) * 5;
        const f = Math.floor(t * 60);
        ctx.translate((hash(f) - 0.5) * k, (hash(f + 9) - 0.5) * k);
      }
    });
  }

  ctx.globalCompositeOperation = 'lighter';

  // Ambient glow
  const amb = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, w * 0.6);
  amb.addColorStop(0, rgba('violet', 0.09));
  amb.addColorStop(1, rgba('violet', 0));
  ctx.fillStyle = amb;
  ctx.fillRect(0, 0, w, h);

  // Depth stars
  for (let i = 0; i < 90; i++) {
    const q = P([(hash(i * 3.1) - 0.5) * 34, (hash(i * 5.7) - 0.5) * 16, (hash(i * 7.9) - 0.5) * 26]);
    const a = 0.2 + 0.3 * Math.sin(time * 1.2 + i);
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(238,233,220,${a})`;
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(0.5, q.s * 0.03), 0, Math.PI * 2);
    ctx.fill();
  }

  // Floor lattice
  ctx.strokeStyle = rgba('gold', 0.08);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -12; k <= 12; k += 3) {
    const a = P([k, FLOOR, -12]);
    const b = P([k, FLOOR, 12]);
    const c = P([-12, FLOOR, k]);
    const d = P([12, FLOOR, k]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();

  // Actors, far to near
  const order = [...mission.actors].sort((a, b) => P(b.pos).d - P(a.pos).d);
  order.forEach((a) => drawActor(ctx, P, a, time, actorFx(a.id, steps, t)));

  // Packets with trails
  steps.forEach((s, i) => {
    const st = startAt(i);
    if (t < st || t > arriveAt(i) + 0.02) return;
    const A = byId.get(s.from)!;
    const B = byId.get(s.to)!;
    const dist = Math.hypot(B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]);
    const H = Math.min(2.6, 0.3 * dist + 0.6);
    const hue = packetHue(s);
    const at = (tau: number, jit: number): V3 => [
      lerp(A.pos[0], B.pos[0], tau) + (hash(jit) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
      lerp(A.pos[1], B.pos[1], tau) + Math.sin(Math.PI * tau) * H + (hash(jit + 4) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
      lerp(A.pos[2], B.pos[2], tau) + (hash(jit + 8) - 0.5) * (s.kind === 'bad' ? 0.18 : 0),
    ];
    for (let j = 16; j >= 0; j--) {
      const tj = t - j * 0.035;
      if (tj < st) continue;
      const tau = easeInOut(clamp((tj - st) / TRAVEL));
      const q = P(at(tau, Math.floor(tj * 40) + j));
      const fade = Math.pow(1 - j / 17, 1.6);
      glow(ctx, q.x, q.y, q.s * (0.12 + 0.34 * fade), hue, 0.18 + 0.7 * fade);
    }
    const head = P(at(easeInOut(clamp((t - st) / TRAVEL)), Math.floor(t * 40)));
    glow(ctx, head.x, head.y, head.s * 0.6, hue, 0.95);
    ctx.fillStyle = rgba('ice', 1);
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(1.5, head.s * 0.09), 0, Math.PI * 2);
    ctx.fill();

    // Chip
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 11px Manrope, ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(s.chip).width + 16;
    const cx = head.x + 14;
    const cy = head.y - 26;
    ctx.fillStyle = 'rgba(6,5,11,0.82)';
    ctx.strokeStyle = rgba(hue, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx, cy, tw, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(hue, 1);
    ctx.textAlign = 'left';
    ctx.fillText(s.chip, cx + 8, cy + 14);
    ctx.globalCompositeOperation = 'lighter';
  });

  // Arrival effects
  steps.forEach((s, i) => {
    const dt = t - arriveAt(i);
    if (dt < 0 || dt > 1.7) return;
    const B = byId.get(s.to)!;
    const c = P(B.pos);
    const hue = outcomeHue(s);
    const k = clamp(dt / 1.1);
    ctx.strokeStyle = rgba(hue, (1 - k) * 0.9);
    ctx.lineWidth = s.blocked ? 3 : 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, (s.blocked ? 3.2 : 2.4) * easeOut(k) * c.s, 0, Math.PI * 2);
    ctx.stroke();
    const n = s.blocked ? 36 : s.impact ? 40 : 18;
    for (let j = 0; j < n; j++) {
      const th = hash(j * 12.9 + i * 3) * Math.PI * 2;
      const ph = Math.acos(2 * hash(j * 7.3 + i) - 1);
      const sp = 1.6 + hash(j * 3.7 + i) * 2.2;
      const d = sp * easeOut(clamp(dt / 1.4));
      const q = P([
        B.pos[0] + Math.sin(ph) * Math.cos(th) * d,
        B.pos[1] + Math.cos(ph) * d,
        B.pos[2] + Math.sin(ph) * Math.sin(th) * d,
      ]);
      glow(ctx, q.x, q.y, q.s * 0.16, hue, clamp(1 - dt / 1.7) * 0.9);
    }
    if (s.impact && !s.blocked && dt < 0.9) {
      ctx.fillStyle = rgba('ember', 0.14 * (1 - dt / 0.9));
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
    if (s.blocked) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '700 14px Manrope, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba('mint', clamp(1.4 - dt));
      ctx.fillText('Rejected', c.x, c.y - c.s * 2.2 - dt * 14);
      ctx.globalCompositeOperation = 'lighter';
    }
  });

  // Labels and vignette on top, without additive blending
  ctx.globalCompositeOperation = 'source-over';
  mission.actors.forEach((a) => drawLabel(ctx, P, a));
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(6,5,11,0)');
  vg.addColorStop(1, 'rgba(6,5,11,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(-20, -20, w + 40, h + 40);
  ctx.restore();
}

/* ========================================================================== */
/*  SimStage: canvas + HUD + transport controls                               */
/* ========================================================================== */

function SimStage({
  mission,
  patched,
  autoPlay,
  runToken,
}: {
  mission: Mission;
  patched: boolean;
  autoPlay: boolean;
  runToken: number;
}) {
  const reduce = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const steps = useMemo(() => buildSteps(mission, patched), [mission, patched]);
  const total = totalTime(steps.length);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tRef = useRef(0);
  const camRef = useRef({ yaw: -0.3, pitch: 0.42, dragging: false, x: 0, y: 0 });
  const [playing, setPlaying] = useState(autoPlay && !reduce);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [, setTick] = useState(0);

  // Restart whenever the parent asks for a new run.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    tRef.current = 0;
    setPlaying(true);
  }, [runToken]);

  // HUD refresh (the canvas runs its own loop).
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let time = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      if (playingRef.current) {
        tRef.current = Math.min(total, tRef.current + dt);
        if (tRef.current >= total) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = camRef.current;
      const sway = reduce || c.dragging ? 0 : Math.sin(time * 0.18) * 0.22;
      renderScene(ctx, w, h, time, { yaw: c.yaw + sway, pitch: c.pitch }, mission, steps, tRef.current, reduce);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mission, steps, total, reduce]);

  const t = tRef.current;
  const idx = Math.min(steps.length - 1, Math.floor(t / STEP));
  const step = steps[idx];
  const metrics = metricsAt(mission, steps, t);
  const last = steps.length - 1;
  const rejected = steps[last].blocked && t >= arriveAt(last);
  const status: Status = rejected ? { tone: 'ok', text: 'Attack rejected, bridge stays solvent' } : mission.status(metrics);

  const toneClass =
    status.tone === 'bad'
      ? 'text-[#ff5d4a] border-[#ff5d4a]/40 bg-[#ff5d4a]/10'
      : status.tone === 'ok'
        ? 'text-[#5eead4] border-[#5eead4]/40 bg-[#5eead4]/10'
        : 'text-[#a49fb0] border-white/10 bg-white/5';

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    Object.assign(camRef.current, { dragging: true, x: e.clientX, y: e.clientY });
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = camRef.current;
    if (!c.dragging) return;
    c.yaw -= (e.clientX - c.x) * 0.006;
    c.pitch = clamp(c.pitch + (e.clientY - c.y) * 0.004, 0.08, 1.0);
    c.x = e.clientX;
    c.y = e.clientY;
  };
  const up = () => {
    camRef.current.dragging = false;
  };
  const key = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const c = camRef.current;
    if (e.key === 'ArrowLeft') c.yaw -= 0.1;
    else if (e.key === 'ArrowRight') c.yaw += 0.1;
    else if (e.key === 'ArrowUp') c.pitch = clamp(c.pitch + 0.05, 0.08, 1.0);
    else if (e.key === 'ArrowDown') c.pitch = clamp(c.pitch - 0.05, 0.08, 1.0);
  };

  const togglePlay = () => {
    if (!playing && tRef.current >= total) tRef.current = 0;
    setPlaying(!playing);
  };

  return (
    <div>
      <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#06050b]">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          tabIndex={0}
          role="img"
          aria-label={`3D replay of the ${mission.title} incident. Drag to rotate, or use the arrow keys. The captions below describe each step.`}
          className={`block w-full aspect-[16/11] cursor-grab active:cursor-grabbing touch-none ${FOCUS}`}
        />

        {/* Meters */}
        <div className="pointer-events-none absolute left-3 top-3 space-y-2">
          {mission.meters.map((m) => (
            <div key={m.id} className="px-3 py-2 rounded-xl bg-[#06050b]/75 border border-white/10 backdrop-blur-md">
              <div className="text-[11px] text-[#a49fb0]">{m.label}</div>
              <div className="text-lg font-semibold tabular-nums leading-tight">
                {Math.round(metrics[m.id]).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Status */}
        <div
          className={`pointer-events-none absolute right-3 top-3 max-w-[55%] px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 backdrop-blur-md ${toneClass}`}
        >
          {status.tone === 'bad' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
          {status.text}
        </div>

        {/* Caption */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pt-10 pb-3 bg-gradient-to-t from-[#06050b] via-[#06050b]/85 to-transparent"
          aria-live="polite"
        >
          <div className="text-[11px] text-[#a49fb0]">
            Step {idx + 1} of {steps.length}
          </div>
          <div className="text-sm font-semibold text-[#eee9dc]">{step.title}</div>
          <p className="text-xs text-[#c9c4d2] leading-relaxed mt-0.5">
            {step.blocked && t >= arriveAt(idx) ? step.blockedText : step.detail}
          </p>
        </div>
      </div>

      {/* Transport */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          className={`w-10 h-10 rounded-full flex items-center justify-center bg-[#e9b872] text-[#1a1208] hover:brightness-110 transition ${FOCUS}`}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={() => {
            tRef.current = 0;
            setPlaying(true);
          }}
          aria-label="Restart replay"
          className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/10 text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 transition ${FOCUS}`}
        >
          <RotateCcw size={15} />
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={t}
          onChange={(e) => {
            tRef.current = parseFloat(e.target.value);
            setPlaying(false);
          }}
          aria-label="Replay position"
          className={`flex-1 accent-[#e9b872] ${FOCUS}`}
        />
        <span className="text-xs text-[#a49fb0] tabular-nums w-20 text-right">
          {t.toFixed(1)}s / {total.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Mission flow: brief, replay, audit, patch, debrief                        */
/* ========================================================================== */

type Stage = 'brief' | 'replay' | 'audit' | 'patch' | 'debrief';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'brief', label: 'Briefing' },
  { id: 'replay', label: 'Replay' },
  { id: 'audit', label: 'Audit' },
  { id: 'patch', label: 'Patch' },
  { id: 'debrief', label: 'Debrief' },
];
const BASE_XP = 100;
const BONUS_XP = 25;

function MissionView({
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

/* ========================================================================== */
/*  Sector map                                                                */
/* ========================================================================== */

function SectorMap({
  done,
  onLaunch,
}: {
  done: Record<string, number>;
  onLaunch: (id: string) => void;
}) {
  const firstOpen = MISSIONS.find((m) => !(m.id in done))?.id ?? MISSIONS[0].id;
  const [focusId, setFocusId] = useState(firstOpen);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Parallax: writes CSS vars directly, so the pointer never triggers a re-render.
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  const mission = MISSIONS.find((m) => m.id === focusId);
  const teaser = TEASERS.find((x) => x.id === focusId);

  const ticks = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        const a = (i / 72) * Math.PI * 2;
        const r1 = 292;
        const r2 = i % 6 === 0 ? 308 : 300;
        return { x1: 500 + Math.cos(a) * r1, y1: 300 + Math.sin(a) * r1, x2: 500 + Math.cos(a) * r2, y2: 300 + Math.sin(a) * r2 };
      }),
    [],
  );

  return (
    <div
      ref={boxRef}
      onPointerMove={onMove}
      className="relative h-[560px] rounded-3xl overflow-hidden border border-white/10 bg-[#08060f]/70 backdrop-blur-md"
    >
      {/* Layer 1: astrolabe */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * -14px), calc(var(--py,0) * -10px), 0)', transition: 'transform .3s ease-out' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          {[120, 200, 280, 360].map((r) => (
            <circle key={r} cx="500" cy="300" r={r} fill="none" stroke="rgba(238,233,220,0.07)" />
          ))}
          <line x1="0" y1="300" x2="1000" y2="300" stroke="rgba(238,233,220,0.05)" />
          <line x1="500" y1="0" x2="500" y2="600" stroke="rgba(238,233,220,0.05)" />
          <g className="iw-spin-slow" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <circle cx="500" cy="300" r="292" fill="none" stroke="rgba(233,184,114,0.22)" strokeDasharray="1 6" />
            {ticks.map((tk, i) => (
              <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} stroke="rgba(233,184,114,0.35)" />
            ))}
          </g>
        </svg>
      </div>

      {/* Layer 2: constellation lines */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * 8px), calc(var(--py,0) * 6px), 0)', transition: 'transform .3s ease-out' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          {MAP_ORDER.slice(0, -1).map((id, i) => {
            const a = NODE_POS[id];
            const b = NODE_POS[MAP_ORDER[i + 1]];
            const lit = id in done;
            return (
              <line
                key={id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={lit ? 'rgba(233,184,114,0.8)' : 'rgba(238,233,220,0.22)'}
                strokeDasharray={lit ? undefined : '1.2 1.6'}
                vectorEffect="non-scaling-stroke"
                strokeWidth="1.2"
              />
            );
          })}
        </svg>
      </div>

      {/* Layer 3: nodes */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(calc(var(--px,0) * 18px), calc(var(--py,0) * 12px), 0)', transition: 'transform .3s ease-out' }}
      >
        {MAP_ORDER.map((id) => {
          const pos = NODE_POS[id];
          const m = MISSIONS.find((x) => x.id === id);
          const tz = TEASERS.find((x) => x.id === id);
          const locked = !m;
          const completed = id in done;
          const title = m?.title ?? tz?.title ?? id;
          const meta = m ? `${m.date.replace('Reported ', '')} · ${m.loss}` : `${tz?.date} · ${tz?.loss}`;
          const focused = focusId === id;
          return (
            <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <button
                onClick={() => setFocusId(id)}
                aria-pressed={focused}
                aria-label={`${title}${locked ? ', coming soon' : completed ? ', completed' : ''}`}
                className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-300 hover:scale-110 ${FOCUS} ${
                  locked
                    ? 'border border-dashed border-white/25 bg-black/50 text-[#6d6880]'
                    : completed
                      ? 'bg-[#e9b872] text-[#1a1208] shadow-[0_0_40px_rgba(233,184,114,0.55)]'
                      : 'border border-[#9b8cff]/70 bg-[#9b8cff]/15 text-[#d6d0ff] shadow-[0_0_40px_rgba(155,140,255,0.4)]'
                }`}
              >
                {!locked && !completed && !focused && (
                  <span className="absolute inset-0 rounded-full border border-[#9b8cff]/60 iw-ping" aria-hidden="true" />
                )}
                {focused && <span className="absolute -inset-2 rounded-full border border-[#e9b872]/60" aria-hidden="true" />}
                {locked ? <Lock size={18} /> : completed ? <Check size={22} /> : <ShieldAlert size={22} />}
              </button>
              <div className="mt-3 text-center pointer-events-none">
                <div className="iw-display text-xl leading-tight text-[#eee9dc]">{title}</div>
                <div className="text-[11px] text-[#a49fb0] mt-0.5">{meta}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Focus card */}
      <div className="absolute left-4 bottom-4 right-4 sm:right-auto sm:w-[380px] rounded-2xl border border-white/10 bg-[#06050b]/85 backdrop-blur-xl p-4">
        {mission ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="iw-display text-2xl leading-tight">{mission.title}</div>
              {mission.id in done && (
                <span className="text-[11px] px-2.5 py-1 rounded-full border border-[#e9b872]/40 text-[#e9b872]">
                  Charted · {done[mission.id]} XP
                </span>
              )}
            </div>
            <p className="text-xs text-[#a49fb0] mt-1">{mission.tagline}</p>
            <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-[#c9c4d2]">
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">{mission.difficulty}</span>
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">{mission.chain}</span>
            </div>
            <button
              onClick={() => onLaunch(mission.id)}
              className={`mt-4 w-full py-2.5 rounded-xl bg-[#e9b872] text-[#1a1208] font-bold text-sm hover:brightness-110 transition ${FOCUS}`}
            >
              {mission.id in done ? 'Replay mission' : 'Launch mission'}
            </button>
          </>
        ) : (
          teaser && (
            <>
              <div className="iw-display text-2xl leading-tight">{teaser.title}</div>
              <p className="text-xs text-[#a49fb0] mt-1">{teaser.tagline}</p>
              <button disabled className="mt-4 w-full py-2.5 rounded-xl border border-white/10 text-sm text-[#6d6880] cursor-not-allowed">
                Coming soon
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Identity header                                                           */
/* ========================================================================== */

const RANKS = [
  { at: 0, title: 'Stargazer' },
  { at: 100, title: 'Navigator' },
  { at: 300, title: 'Cartographer' },
  { at: 600, title: 'Astronomer' },
];

function rankFor(xp: number) {
  let i = 0;
  RANKS.forEach((r, idx) => {
    if (xp >= r.at) i = idx;
  });
  const next = RANKS[i + 1] ?? null;
  const pct = next ? ((xp - RANKS[i].at) / (next.at - RANKS[i].at)) * 100 : 100;
  return { title: RANKS[i].title, next, pct };
}

function Sigil() {
  return (
    <div className="relative w-20 h-20 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="absolute inset-0 iw-spin">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(233,184,114,0.45)" strokeWidth="1" strokeDasharray="2 5" />
        <circle cx="50" cy="4" r="3" fill="#e9b872" />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute inset-0">
        <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(238,233,220,0.22)" />
        <path d="M50 22 L55 45 L78 50 L55 55 L50 78 L45 55 L22 50 L45 45 Z" fill="rgba(233,184,114,0.92)" />
      </svg>
    </div>
  );
}

/* ========================================================================== */
/*  Home                                                                      */
/* ========================================================================== */

const STORAGE_KEY = 'iw.missions.v1';

function loadProgress(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function Home({
  username,
  onSelectRoom,
  onLogout,
  engineStatus = 'connected',
}: HomeProps) {
  const displayName = username || 'Explorer';
  const starfield = useRef<StarfieldHandle | null>(null);
  const [warping, setWarping] = useState(false);
  const [done, setDone] = useState<Record<string, number>>(loadProgress);
  const [activeId, setActiveId] = useState<string | null>(null);
  const status = STATUS_STYLES[engineStatus];

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    } catch {
      /* storage unavailable: progress simply won't persist */
    }
  }, [done]);

  const xp = Object.values(done).reduce((a, b) => a + b, 0);
  const rank = rankFor(xp);
  const activeMission = MISSIONS.find((m) => m.id === activeId) ?? null;

  const enterRoom = useCallback(
    async (roomId: string) => {
      if (warping) return;
      setWarping(true);
      try {
        await starfield.current?.warp();
        onSelectRoom(roomId);
      } finally {
        setWarping(false);
      }
    },
    [warping, onSelectRoom],
  );

  const randomRoom = () => {
    const room = sideRooms[Math.floor(Math.random() * sideRooms.length)];
    void enterRoom(room.id);
  };

  const completeMission = useCallback((id: string, earned: number) => {
    setDone((d) => (id in d ? d : { ...d, [id]: earned }));
  }, []);

  const fade = `transition-all duration-700 ${warping ? 'opacity-0 scale-[1.03]' : 'opacity-100'}`;

  return (
    <div className="iw-root relative min-h-screen flex overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,500;1,300&family=Manrope:wght@400;500;600;700&display=swap');
        .iw-root { --dim:#a49fb0; background:#06050b; color:#eee9dc;
          font-family:'Manrope', ui-sans-serif, system-ui, sans-serif; }
        .iw-display { font-family:'Cormorant Garamond', ui-serif, Georgia, serif; }
        @keyframes iw-drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px,30px); } }
        @keyframes iw-rotate { to { transform: rotate(360deg); } }
        @keyframes iw-ping { 0% { transform: scale(1); opacity:.7; } 100% { transform: scale(1.7); opacity:0; } }
        .iw-spin { animation: iw-rotate 40s linear infinite; transform-origin: center; }
        .iw-spin-slow { animation: iw-rotate 240s linear infinite; }
        .iw-ping { animation: iw-ping 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .iw-anim, .iw-spin, .iw-spin-slow, .iw-ping { animation: none !important; }
        }
      `}</style>

      <Starfield ref={starfield} />

      {/* Ambient nebula */}
      <div
        className="iw-anim absolute top-[-10%] left-[-10%] w-[520px] h-[520px] bg-[#2a1750]/30 rounded-full blur-[150px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 26s ease-in-out infinite' }}
      />
      <div
        className="iw-anim absolute bottom-[-12%] right-[-10%] w-[620px] h-[620px] bg-[#5a3b12]/20 rounded-full blur-[170px] pointer-events-none z-0"
        style={{ animation: 'iw-drift 32s ease-in-out infinite reverse' }}
      />

      {/* Warp flash */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-50 bg-white transition-opacity duration-700 ${
          warping ? 'opacity-20' : 'opacity-0'
        }`}
      />

      {/* Sidebar */}
      <nav
        aria-label="Main"
        className={`relative z-10 hidden md:flex w-64 shrink-0 bg-[#06050b]/80 backdrop-blur-xl border-r border-white/10 flex-col p-6 justify-between ${fade}`}
      >
        <div>
          <div className="flex items-center gap-2 mb-10">
            <span className="text-xl" aria-hidden="true">🫍</span>
            <h1 className="iw-display text-2xl font-medium tracking-wide text-[#e9b872]">Infinite World</h1>
          </div>

          <div className="space-y-1.5">
            <button
              aria-current="page"
              onClick={() => setActiveId(null)}
              className={`w-full flex items-center gap-3 px-4 py-3 bg-[#e9b872]/12 text-[#e9b872] rounded-2xl font-medium text-sm border border-[#e9b872]/30 ${FOCUS}`}
            >
              <LayoutDashboard size={18} /> Sector map
            </button>
            {[
              { icon: <MessageSquare size={18} />, label: 'Chat Rooms' },
              { icon: <BarChart2 size={18} />, label: 'Analytics' },
              { icon: <Settings size={18} />, label: 'Settings' },
            ].map((item) => (
              <button
                key={item.label}
                className={`w-full flex items-center gap-3 px-4 py-3 text-[#a49fb0] hover:text-[#eee9dc] hover:bg-white/5 rounded-2xl font-medium text-sm transition-colors ${FOCUS}`}
              >
                {item.icon} {item.label}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="text-xs font-semibold text-[#a49fb0]">Live rooms</h2>
              <button
                onClick={randomRoom}
                disabled={warping}
                title="Warp to a random room"
                aria-label="Warp to a random room"
                className={`p-1.5 rounded-lg text-[#a49fb0] hover:text-[#e9b872] hover:bg-white/5 transition-colors ${FOCUS}`}
              >
                <Compass size={15} />
              </button>
            </div>
            <ul className="space-y-1">
              {sideRooms.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => void enterRoom(r.id)}
                    disabled={warping}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left text-[13px] text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 transition-colors ${FOCUS}`}
                  >
                    <span className="truncate">
                      <span aria-hidden="true">{r.icon}</span> {r.title}
                    </span>
                    <ArrowUpRight size={14} className="shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-4 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#e9b872]/25 to-[#9b8cff]/25 border border-[#e9b872]/40 flex items-center justify-center font-bold text-[#e9b872]">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-[#eee9dc] capitalize">{displayName}</div>
              <div className="text-xs text-[#5eead4] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5eead4]" /> Online
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Logout"
            aria-label="Log out"
            className={`p-2 text-[#a49fb0] hover:text-[#ff5d4a] hover:bg-white/5 rounded-xl transition-colors ${FOCUS}`}
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className={`relative z-10 flex-1 min-w-0 flex flex-col overflow-y-auto ${fade}`}>
        <header className="px-5 sm:px-10 pt-8 pb-6 flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-5">
            <Sigil />
            <div>
              <p className="text-xs text-[#a49fb0]">
                {rank.title} · {Object.keys(done).length} of {MISSIONS.length} missions charted
              </p>
              <h2 className="iw-display text-5xl sm:text-6xl font-light tracking-wide capitalize leading-tight">
                {displayName}
              </h2>
              <div className="mt-2 flex items-center gap-3">
                <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(rank.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next rank">
                  <div className="h-full bg-gradient-to-r from-[#e9b872] to-[#9b8cff] transition-all duration-700" style={{ width: `${rank.pct}%` }} />
                </div>
                <span className="text-xs text-[#a49fb0] tabular-nums">
                  {xp} XP{rank.next ? ` · ${rank.next.at - xp} to ${rank.next.title}` : ''}
                </span>
              </div>
            </div>
          </div>

          <div
            role="status"
            className="px-4 py-2 bg-black/50 border border-white/10 rounded-2xl text-xs text-[#c9c4d2] flex items-center gap-2.5 backdrop-blur-md"
          >
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${status.dot}`} />
            <div>
              <div className="text-[11px] text-[#a49fb0]">Engine status</div>
              <div className={`font-semibold ${status.text}`}>{status.label}</div>
            </div>
          </div>
        </header>

        <p className="iw-display italic font-light text-xl leading-relaxed text-[#b9b3c4] px-5 sm:px-10 max-w-4xl">
          “Time is not a currency to be spent, but an orbit—choose to revolve around what anchors your spirit, deepens your bonds, and expands your universe.”
        </p>

        <div className="px-5 sm:px-10 py-8">
          {activeMission ? (
            <MissionView
              key={activeMission.id}
              mission={activeMission}
              alreadyDone={activeMission.id in done}
              onBack={() => setActiveId(null)}
              onComplete={completeMission}
            />
          ) : (
            <section aria-label="Chain Security Lab" className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="iw-display text-3xl font-light">Chain Security Lab</h3>
                  <p className="text-sm text-[#a49fb0] mt-1">
                    Replay famous bridge exploits in 3D, find the flaw, and ship the fix.
                  </p>
                </div>
                <button
                  onClick={() => void enterRoom(LAB_ROOM_ID)}
                  disabled={warping}
                  className={`px-4 py-2.5 rounded-xl border border-white/10 text-sm text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 flex items-center gap-2 transition ${FOCUS}`}
                >
                  Open live room <ArrowUpRight size={15} />
                </button>
              </div>
              <SectorMap done={done} onLaunch={setActiveId} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}