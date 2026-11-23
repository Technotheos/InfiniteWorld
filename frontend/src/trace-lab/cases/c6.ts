import type { Case, ChainNode, ChainEdge, TableRow } from '../types';
import { T } from './util';

const E = (id: string, from: string, to: string, amt: string, asset: string, time: string, hash: string, extra: Partial<ChainEdge> = {}): ChainEdge => ({ id, from, to, amt, asset, time, hash, ...extra });

const nodes: ChainNode[] = [
  { id: 'vault', label: 'Vault 0x91c4…e07a', kind: 'victim', x: 8, y: 50 },
  { id: 'atk', label: '0xA7f3…21bd', kind: 'wallet', x: 24, y: 50 },
  { id: 'w1', label: '0x5d02…9ac1', kind: 'wallet', x: 40, y: 20 },
  { id: 'w2', label: '0xe18b…44f0', kind: 'wallet', x: 40, y: 50 },
  { id: 'w3', label: '0x07aa…c3d9', kind: 'wallet', x: 40, y: 80 },
  { id: 'mix', label: 'Mixer pool (100 ETH)', kind: 'mixer', x: 58, y: 20 },
  { id: 'bridge', label: 'Bridge ETH → BNB', kind: 'bridge', x: 58, y: 50, chain: 'BNB' },
  { id: 'w4', label: '0x33f1…b8e2 (BNB)', kind: 'wallet', x: 74, y: 50, chain: 'BNB' },
  { id: 'cex', label: 'Exchange X hot wallet', kind: 'exchange', x: 92, y: 50, chain: 'BNB' },
  { id: 'hold', label: '0x6bc9…0d17', kind: 'wallet', x: 58, y: 82 },
  { id: 'msig', label: 'Protocol multisig', kind: 'multisig', x: 8, y: 14 },
  { id: 'cold', label: 'Cold storage 0x2e5d…', kind: 'wallet', x: 24, y: 14 },
  { id: 'dex', label: 'DEX router', kind: 'dex', x: 92, y: 18 },
  { id: 'mev', label: 'MEV bot 0xbb00…', kind: 'wallet', x: 74, y: 82 },
];

const tx: ChainEdge[] = [
  E('x1', 'vault', 'atk', '4,820', 'ETH', '2026-05-02 11:04:12', '0x7a1f…c2d0', { role: 'key', step: 's_drain', touches: 'vault,atk', sum: '4,820 ETH leaves the vault to 0xA7f3…21bd' }),
  E('x2', 'atk', 'w1', '1,200', 'ETH', '2026-05-02 11:09:40', '0x1b4e…9a77', { role: 'key', step: 's_split', touches: 'atk,w1', sum: '1,200 ETH to 0x5d02…9ac1' }),
  E('x3', 'atk', 'w2', '2,200', 'ETH', '2026-05-02 11:09:58', '0x9c20…5be1', { role: 'key', step: 's_split', touches: 'atk,w2', sum: '2,200 ETH to 0xe18b…44f0' }),
  E('x4', 'atk', 'w3', '900', 'ETH', '2026-05-02 11:10:15', '0x44d8…01aa', { role: 'key', step: 's_split', touches: 'atk,w3', sum: '900 ETH to 0x07aa…c3d9' }),
  E('x5', 'atk', 'hold', '520', 'ETH', '2026-05-02 11:10:31', '0xaf33…7e10', { role: 'key', step: 's_split', touches: 'atk,hold', sum: '520 ETH to 0x6bc9…0d17 (never moves again)' }),
  E('x6', 'w1', 'mix', '1,000', 'ETH', '2026-05-02 12:31:05', '0x3e90…d4c2', { role: 'key', step: 's_mix', touches: 'w1,mix', sum: '1,000 ETH into the mixer in ten 100 ETH deposits', detail: { Pattern: '10 × 100 ETH deposits, 40 s apart: the pool only accepts 100 ETH notes' } }),
  E('x7', 'w2', 'bridge', '2,200', 'ETH', '2026-05-02 12:48:19', '0xd71b…aa03', { role: 'key', step: 's_bridge', touches: 'w2,bridge', sum: '2,200 ETH into the ETH→BNB bridge' }),
  E('x8', 'bridge', 'w4', '2,198', 'BNB-ETH', '2026-05-02 12:53:41', '0x5ee2…18b9', { role: 'key', step: 's_bridge', touches: 'bridge,w4', sum: '2,198 wrapped ETH appears at 0x33f1…b8e2 on BNB', detail: { Note: 'The 2 ETH difference is the bridge fee. Same time window, same amount.' } }),
  E('x9', 'w4', 'cex', '2,198', 'BNB-ETH', '2026-05-02 14:20:07', '0x80ac…f6d3', { role: 'key', step: 's_cash', touches: 'w4,cex', sum: '2,198 wrapped ETH deposited to Exchange X', detail: { Note: 'Exchanges know their customers. This is where the trail meets a real identity.' } }),
  E('x10', 'w3', 'dex', '900', 'ETH→USDT', '2026-05-02 13:02:50', '0x2fd5…c9e1', { role: 'key', step: 's_swap', touches: 'w3,dex', sum: '900 ETH swapped to USDT on a DEX' }),
  E('h1', 'msig', 'cold', '12,000', 'ETH', '2026-05-02 11:31:22', '0xc0de…0001', { role: 'herring', sum: 'Protocol multisig moves 12,000 ETH to cold storage', why: 'The protocol team’s own emergency response: a 3-of-5 multisig moving the remaining funds to safety. It starts at the protocol’s address, not the exploiter’s.' }),
  E('h2', 'mev', 'dex', '640', 'ETH', '2026-05-02 11:04:12', '0xbb00…c0de', { role: 'herring', sum: 'MEV bot swaps 640 ETH in the same block', why: 'MEV bots land in the same block as almost any large transaction. This address has traded on this router for months and has no link to the exploiter.' }),
];

const labels: TableRow[] = [
  T('l1', { addr: '0x91c4…e07a', label: 'Protocol vault (victim)', src: 'Protocol docs' }),
  T('l2', { addr: '0xA7f3…21bd', label: '— unlabelled —', src: 'First receiver of the drain' }, { role: 'key', step: 's_drain', touches: 'atk', sum: '0xA7f3…21bd is unlabelled: a fresh wallet' }),
  T('l3', { addr: '0x2e5d…', label: 'Protocol cold storage', src: 'Protocol docs' }),
  T('l4', { addr: 'Mixer pool', label: 'Mixer (100 ETH notes)', src: 'Chain analytics' }),
  T('l5', { addr: 'Bridge', label: 'ETH → BNB bridge contract', src: 'Etherscan label' }),
  T('l6', { addr: 'Exchange X hot wallet', label: 'Exchange X (KYC)', src: 'Chain analytics' }),
  T('l7', { addr: '0xbb00…', label: 'MEV bot (known)', src: 'Etherscan label' }),
  T('l8', { addr: 'DEX router', label: 'DEX router (public)', src: 'Etherscan label' }),
];

const sum: TableRow[] = [
  T('b1', { addr: '0xA7f3…21bd', eth: '0', note: 'Emptied within 6 minutes' }),
  T('b2', { addr: '0x6bc9…0d17', eth: '520', note: 'Has not moved since 11:10 (still holding)' }, { role: 'key', step: 's_split', touches: 'hold', sum: '0x6bc9…0d17 still holds 520 ETH' }),
  T('b3', { addr: '0x5d02…9ac1', eth: '200', note: 'Remainder after mixer deposits' }),
  T('b4', { addr: '0x07aa…c3d9', eth: '0', note: 'All swapped to USDT' }),
];

export const case6: Case = {
  id: 'follow-the-money', no: 6, kind: 'Blockchain forensics', title: 'Follow the Money', icon: 'chain', base: 200,
  tagline: 'Four thousand eight hundred ETH. Four hours. One graph.',
  briefing: [
    'A lending protocol lost 4,820 ETH from its vault at 11:04. Your job is to follow the funds: who got them first, how they were split, which hops hide the trail, and where they left the chain.',
    'On a public chain every transfer is visible, but wallets have no names. You work with labels, amounts, timing and patterns such as peeling, mixing and bridging.',
    'Two other flows look alarming. Check who starts them before you accuse anyone.',
  ],
  tools: ['logs', 'chain', 'map', 'timeline'], newTools: ['chain'],
  artifacts: [
    { kind: 'chain', id: 'ev-tx', label: 'Fund flow graph', sub: 'Ethereum + BNB Chain · 2 May 2026 · 12 transfers', nodes, rows: tx },
    { kind: 'table', id: 'ev-labels', label: 'Address labels', sub: 'Chain analytics + explorer tags', cols: [{ k: 'addr', label: 'Address', mono: true }, { k: 'label', label: 'Label', w: 260 }, { k: 'src', label: 'Source' }], rows: labels },
    { kind: 'table', id: 'ev-bal', label: 'Balances now', sub: 'Snapshot 20:00 UTC', cols: [{ k: 'addr', label: 'Address', mono: true }, { k: 'eth', label: 'ETH', mono: true }, { k: 'note', label: 'Note', w: 300 }], rows: sum },
  ],
  hosts: [
    { id: 'vault', label: 'Protocol vault', ip: '0x91c4…', x: 8, y: 50, kind: 'wallet' },
    { id: 'atk', label: 'Exploiter wallet', ip: '0xA7f3…', x: 26, y: 50, kind: 'attacker' },
    { id: 'w1', label: 'Peel wallet 1', ip: '0x5d02…', x: 44, y: 18, kind: 'wallet' },
    { id: 'mix', label: 'Mixer', ip: '100 ETH notes', x: 62, y: 18, kind: 'net' },
    { id: 'w2', label: 'Peel wallet 2', ip: '0xe18b…', x: 44, y: 50, kind: 'wallet' },
    { id: 'bridge', label: 'Bridge', ip: 'ETH → BNB', x: 62, y: 50, kind: 'net' },
    { id: 'w4', label: 'BNB wallet', ip: '0x33f1…', x: 78, y: 50, kind: 'wallet' },
    { id: 'cex', label: 'Exchange X', ip: 'KYC', x: 93, y: 50, kind: 'server' },
    { id: 'w3', label: 'Peel wallet 3', ip: '0x07aa…', x: 44, y: 82, kind: 'wallet' },
    { id: 'dex', label: 'DEX', ip: 'router', x: 78, y: 82, kind: 'net' },
    { id: 'hold', label: 'Holding wallet', ip: '0x6bc9…', x: 62, y: 82, kind: 'wallet' },
  ],
  edges: [['vault', 'atk'], ['atk', 'w1'], ['atk', 'w2'], ['atk', 'w3'], ['atk', 'hold'], ['w1', 'mix'], ['w2', 'bridge'], ['bridge', 'w4'], ['w4', 'cex'], ['w3', 'dex']],
  questions: [
    { id: 'q1', prompt: 'Which wallet received the drained funds first?', options: ['0xA7f3…21bd', '0x5d02…9ac1', '0x6bc9…0d17', 'Protocol cold storage'], answer: 0, proof: ['ev-tx:x1', 'ev-labels:l2'], need: 1, points: 25, hint: 'Start at the vault’s address and look at the first outgoing transfer.', explain: 'The 4,820 ETH went in one transfer to a fresh, unlabelled wallet.' },
    { id: 'q2', prompt: 'Which hop used a bridge, and to which chain?', options: ['0xe18b…44f0, bridged to BNB Chain', '0x5d02…9ac1, bridged to Arbitrum', '0x07aa…c3d9, bridged to Polygon', 'No bridge was used'], answer: 0, proof: ['ev-tx:x7', 'ev-tx:x8'], need: 2, points: 25, hint: 'Match the amount going into the bridge with the amount that appears on the other side minutes later.', explain: '2,200 ETH goes in and 2,198 comes out on BNB Chain, five minutes later. The two ETH are the fee.' },
    { id: 'q3', prompt: 'Where were the bridged funds cashed out?', options: ['Exchange X hot wallet on BNB Chain', 'The mixer pool', 'The DEX router', 'Protocol cold storage'], answer: 0, proof: ['ev-tx:x9'], need: 1, points: 25, hint: 'Follow the BNB wallet’s outgoing transfer.', explain: 'A deposit at a regulated exchange is where the trail meets a KYC identity. This is the freeze request target.' },
    { id: 'q4', prompt: 'Which wallet still holds unmoved funds that could be frozen?', options: ['0x6bc9…0d17 with 520 ETH', '0x5d02…9ac1 with 1,000 ETH', '0x07aa…c3d9 with 900 ETH', '0xA7f3…21bd with 4,820 ETH'], answer: 0, proof: ['ev-tx:x5', 'ev-bal:b2'], need: 1, points: 25, hint: 'Look at the balances snapshot and at who has no outgoing transfers.', explain: 'The 520 ETH sent to 0x6bc9 never moved again. That is where the attacker plans to wait.' },
  ],
  steps: [
    { id: 's_drain', t: '11:04:12', from: 'vault', to: 'atk', title: 'The vault is drained', text: '4,820 ETH leave in a single transfer to a brand-new wallet.', attack: { id: 'T1657', name: 'Financial Theft', tactic: 'Impact' } },
    { id: 's_split', t: '11:09:40', from: 'atk', to: 'w2', title: 'The funds are split', text: 'Four transfers in 40 seconds break the amount into pieces, a peel chain that starts layering.', attack: { id: 'T1657', name: 'Financial Theft: layering', tactic: 'Impact' } },
    { id: 's_mix', t: '12:31:05', from: 'w1', to: 'mix', title: 'Into the mixer', text: 'Ten identical 100 ETH deposits, 40 seconds apart, into a fixed-denomination mixer.', attack: { id: 'T1657', name: 'Financial Theft: obfuscation', tactic: 'Impact' } },
    { id: 's_bridge', t: '12:48:19', from: 'w2', to: 'bridge', title: 'Across the bridge', text: 'The largest share crosses to BNB Chain, where the explorer and tooling are different.', attack: { id: 'T1657', name: 'Financial Theft: chain hopping', tactic: 'Impact' } },
    { id: 's_swap', t: '13:02:50', from: 'w3', to: 'dex', title: 'Swapped to a stablecoin', text: '900 ETH is swapped into USDT on a decentralised exchange.', attack: { id: 'T1657', name: 'Financial Theft: swap', tactic: 'Impact' } },
    { id: 's_cash', t: '14:20:07', from: 'w4', to: 'cex', title: 'Cash-out', text: 'The wrapped ETH is deposited at Exchange X. The first place with a name behind the address.', attack: { id: 'T1657', name: 'Financial Theft: cash-out', tactic: 'Impact' } },
  ],
};
