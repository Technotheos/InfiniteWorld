import type { V3, Hue } from './math';

/* ========================================================================== */
/*  Mission data                                                              */
/*  Every incident below is a real, publicly documented post-mortem.          */
/*  Code is deliberately simplified for teaching; it is not the original.     */
/* ========================================================================== */

export type PacketKind = 'ok' | 'sig' | 'bad';

export interface Actor {
  id: string;
  label: string;
  sub?: string;
  pos: V3;
  kind: 'core' | 'gate' | 'swarm' | 'shard';
  hue: Hue;
}

export interface Step {
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

export interface Meter {
  id: string;
  label: string;
  start: number;
}

export interface Status {
  tone: 'idle' | 'ok' | 'bad';
  text: string;
}

export interface CodeLine {
  n: number;
  code: string;
  note?: string;
}

export interface Fix {
  id: string;
  title: string;
  body: string;
  correct: boolean;
  why: string;
}

export interface Mission {
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

export interface Teaser {
  id: string;
  title: string;
  date: string;
  loss: string;
  tagline: string;
}

export const MISSIONS: Mission[] = [
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

export const TEASERS: Teaser[] = [
  { id: 'nomad', title: 'Nomad', date: 'Aug 1, 2022', loss: '~$190M', tagline: 'A trusted root of zero made every message look valid.' },
  { id: 'ronin', title: 'Ronin', date: 'Mar 23, 2022', loss: '~$625M', tagline: 'Compromised validator keys, noticed six days later.' },
];

// Positions of the constellation nodes on the sector map (percent of the panel).
export const NODE_POS: Record<string, { x: number; y: number }> = {
  wormhole: { x: 20, y: 46 },
  aurora: { x: 42, y: 26 },
  nomad: { x: 66, y: 50 },
  ronin: { x: 84, y: 28 },
};
export const MAP_ORDER = ['wormhole', 'aurora', 'nomad', 'ronin'];

