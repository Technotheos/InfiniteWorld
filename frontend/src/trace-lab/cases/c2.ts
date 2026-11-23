import type { Case, PacketRow, TableRow } from '../types';
import { rng, b32enc, toHex, clock, hms } from '../gen';
import { T } from './util';

const R = rng(2202);
const START = '14:00:00';
const WS = '10.20.4.31', C2 = '203.0.113.77', DNS = '10.20.1.2', NTP = '10.20.1.5', MON = '10.20.1.10', BKP = '10.20.9.5';
const rand = (n: number) => Array.from({ length: n }, () => R.int(0, 255).toString(16).padStart(2, '0')).join('');

const rows: PacketRow[] = [];
let n = 0;
const add = (t: number, src: string, dst: string, proto: string, len: number, info: string, extra: Partial<PacketRow> = {}) => {
  rows.push({ id: `p${(n++).toString().padStart(3, '0')}`, t: Math.round(t * 1000) / 1000, src, dst, proto, len, info, ...extra });
};

/* 1. the beacon: HTTPS to the C2 every ~60 s, with only a little jitter */
let tb = 37.4;
for (let i = 0; i < 29; i++) {
  add(tb, WS, C2, 'TLSv1.2', 205 + R.int(0, 22), 'Application Data · POST /api/v2/poll (SNI cdn-update-static.net)', { role: 'key', step: 's_beacon', touches: 'ws,c2', sum: `HTTPS beacon to 203.0.113.77 at ${clock(hms(START) + tb)}`, payload: rand(48) });
  add(tb + 0.09, C2, WS, 'TLSv1.2', 96 + R.int(0, 6), 'Application Data');
  tb += R.jitter(60, 0.035);
}

/* 2. DNS tunnelling: base32 chunks of stolen data, one query every few seconds */
const stolen = 'HOST=WS-DEV-031;USER=jlin;DOMAIN=FINCO;CWD=C:\\src\\payments-api;FILE=.env;DB_HOST=10.20.7.14;DB_USER=payments;DB_PASS=Spring2026!;AWS_ACCESS_KEY_ID=AKIAXQ7TRACELAB04;REGION=eu-west-1;END';
const chunks: string[] = [];
for (let i = 0; i < stolen.length; i += 16) chunks.push(stolen.slice(i, i + 16));
let td = 421;
chunks.forEach((c, i) => {
  const q = `${i.toString(16).padStart(2, '0')}.${b32enc(c)}.t.cdn-update-static.net`;
  const step = i < 2 ? 's_recon' : 's_exfil';
  add(td, WS, DNS, 'DNS', 78 + q.length, `Standard query 0x${R.int(4096, 65535).toString(16)} TXT ${q}`, { role: 'key', step, touches: 'ws,dns,c2', sum: `DNS TXT query #${i}: ${q.slice(0, 34)}…`, payload: toHex(q) });
  add(td + 0.04, DNS, WS, 'DNS', 120, `Standard query response 0x0000 TXT ${q} TXT "ok"`);
  td += R.jitter(4, 0.4);
});

/* 3. regular but harmless: NTP, Nagios checks, the backup agent */
for (let t = 12; t < 1800; t += R.jitter(64, 0.004)) add(t, WS, NTP, 'NTP', 90, 'NTP Version 4, client', { role: 'herring', why: 'A time-sync poll to the internal NTP server every 64 seconds. It is perfectly regular because that is how NTP works, and the destination is a known internal server.', sum: 'NTP request to 10.20.1.5' });
for (let t = 5; t < 1800; t += R.jitter(30, 0.002)) add(t, MON, WS, 'TCP', 74, '5666 → 49812 [PSH, ACK] check_load', { role: 'herring', why: 'The monitoring server polls its agent every 30 seconds. The connection starts from the inside, to a known host, and the payload is a tiny status check.', sum: 'Nagios NRPE poll from 10.20.1.10' });
for (let t = 90; t < 1800; t += R.jitter(300, 0.01)) add(t, WS, BKP, 'TLSv1.3', 160, 'Application Data · agent heartbeat (SNI srv-bkp01.finco.local)', { role: 'herring', why: 'The backup agent checks in with its own server every five minutes. Internal destination, known software.', sum: 'Backup agent heartbeat to 10.20.9.5' });

/* 4. everything else: ordinary browsing and lookups */
const sites: [string, string][] = [['github.com', '140.82.121.4'], ['slack.com', '3.123.44.10'], ['outlook.office365.com', '52.97.201.34'], ['registry.npmjs.org', '104.16.92.34'], ['fonts.gstatic.com', '142.250.74.35'], ['api.datadoghq.eu', '34.107.215.17'], ['pypi.org', '151.101.0.223']];
for (let i = 0; i < 95; i++) {
  const t = R.next() * 1790 + 4;
  const [d, ip] = R.pick(sites);
  if (R.next() < 0.45) {
    add(t, WS, DNS, 'DNS', 74, `Standard query 0x${R.int(4096, 65535).toString(16)} A ${d}`);
    add(t + 0.02, DNS, WS, 'DNS', 90, `Standard query response A ${ip}`);
  } else {
    add(t, WS, ip, 'TLSv1.3', R.int(120, 1400), `Application Data (SNI ${d})`);
    add(t + R.next() * 0.3, ip, WS, 'TLSv1.3', R.int(300, 1450), 'Application Data');
  }
}
rows.sort((a, b) => a.t - b.t);
rows.forEach((r, i) => { r.id = `p${i.toString().padStart(3, '0')}`; });

const inv: Record<string, string> = {
  [WS]: 'WS-DEV-031 · developer laptop (J. Lin)', [DNS]: 'SRV-DNS01 · internal resolver', [NTP]: 'SRV-NTP01 · internal time server',
  [MON]: 'SRV-MON01 · Nagios monitoring', [BKP]: 'SRV-BKP01 · backup server', '140.82.121.4': 'GitHub', '3.123.44.10': 'Slack', '52.97.201.34': 'Microsoft 365',
  '104.16.92.34': 'npm registry', '142.250.74.35': 'Google Fonts', '34.107.215.17': 'Datadog', '151.101.0.223': 'PyPI',
};
const assets: TableRow[] = Object.entries(inv).map(([ip, d], i) => T(`a${i}`, { ip, desc: d, owner: d.includes('·') ? 'IT Operations' : 'Public service' }));
assets.push(T('a_c2', { ip: C2, desc: '— not in the asset register —', owner: 'Unknown' }, { role: 'key', step: 's_beacon', touches: 'c2', sum: '203.0.113.77 is not in the asset register' }));

const beaconRefs = rows.filter((r) => r.step === 's_beacon').map((r) => `ev-pcap:${r.id}`);
const dnsRows = rows.filter((r) => r.step === 's_recon' || r.step === 's_exfil');
const dnsRefs = dnsRows.map((r) => `ev-pcap:${r.id}`);

export const case2: Case = {
  id: 'beacon', no: 2, kind: 'Network forensics', title: 'Beacon', icon: 'pcap', base: 120,
  tagline: 'Something on a developer laptop is phoning home. Find the heartbeat.',
  briefing: [
    'The firewall flagged nothing, but a threat hunter noticed WS-DEV-031 was “quiet in a strange way”. You have a 30 minute packet capture from the laptop.',
    'Malware tends to call home on a timer. Look at how long the gaps between packets are, but remember that plenty of legitimate software is just as regular.',
    'New tools: the packet table with an interval analyser and a hex pane. Open a DNS packet and try Decode.',
  ],
  tools: ['logs', 'packets', 'hex', 'map', 'timeline'], newTools: ['packets', 'hex'],
  artifacts: [
    { kind: 'pcap', id: 'ev-pcap', label: 'Packet capture', sub: 'WS-DEV-031 · 14:00–14:30 · 1 interface', rows, inventory: inv },
    { kind: 'table', id: 'ev-assets', label: 'Asset register', sub: 'CMDB export · 10.20.0.0/16', cols: [{ k: 'ip', label: 'IP', mono: true }, { k: 'desc', label: 'Description', w: 280 }, { k: 'owner', label: 'Owner' }], rows: assets, sortKey: 'ip' },
  ],
  hosts: [
    { id: 'ws', label: 'WS-DEV-031', ip: WS, x: 22, y: 58, kind: 'ws' },
    { id: 'dns', label: 'SRV-DNS01', ip: DNS, x: 50, y: 22, kind: 'server' },
    { id: 'c2', label: 'C2 server', ip: C2, x: 80, y: 62, kind: 'attacker' },
  ],
  edges: [['ws', 'c2'], ['ws', 'dns'], ['dns', 'c2']],
  questions: [
    { id: 'q1', prompt: 'Which host is infected?', options: ['WS-DEV-031 (10.20.4.31)', 'SRV-NTP01 (10.20.1.5)', 'SRV-MON01 (10.20.1.10)', 'SRV-BKP01 (10.20.9.5)'], answer: 0, proof: [...beaconRefs, 'ev-assets:a_c2'], need: 1, points: 25, hint: 'The infected machine is the one that starts the connection to something it should not know.', explain: 'Every call to 203.0.113.77 starts at the developer laptop.' },
    { id: 'q2', prompt: 'How often does the malware beacon?', options: ['Every 30 seconds', 'About every 60 seconds, with a little jitter', 'Exactly every 64 seconds', 'Every 5 minutes'], answer: 1, proof: beaconRefs, need: 3, points: 25, hint: 'Pin three beacon packets in a row and compare their gaps. 64 s, 30 s and 300 s belong to something else.', explain: 'The gaps are 60 s give or take two seconds. That small jitter is how malware tries to look less mechanical.' },
    { id: 'q3', prompt: 'How is the stolen data leaving the network?', options: ['HTTPS POSTs to the C2 server', 'DNS queries with data encoded in the name', 'ICMP echo payloads', 'An SMB copy to the file server'], answer: 1, proof: dnsRefs, need: 2, points: 25, hint: 'Look for a burst of strange, long, high-entropy names under one domain.', explain: 'Each query carries 16 bytes of stolen data, base32 encoded, as a subdomain of t.cdn-update-static.net.' },
    { id: 'q4', prompt: 'What does the very first tunnelled message reveal? (Decode it.)', options: ['The victim’s host name and user name', 'The source code of payments-api', 'The domain admin password hash', 'Random padding, nothing readable'], answer: 0, proof: dnsRefs.slice(0, 2), need: 1, points: 25, hint: 'Open the first query (sequence 00) and press Decode.', explain: 'Decoded, it reads HOST=WS-DEV-031;USER=jlin. The malware is announcing who it is. Later chunks leak a database password and a cloud key.' },
  ],
  steps: [
    { id: 's_beacon', t: '14:00:37', from: 'ws', to: 'c2', title: 'The laptop calls home', text: 'An HTTPS poll to 203.0.113.77 about once a minute, with ±2 s jitter. The server answers with tiny replies: “nothing to do”.', attack: { id: 'T1071.001', name: 'Application Layer Protocol: Web Protocols', tactic: 'Command and Control' } },
    { id: 's_recon', t: '14:07:01', from: 'ws', to: 'dns', title: 'It introduces itself over DNS', text: 'Short TXT queries under t.cdn-update-static.net carry the host and user name, base32 encoded.', attack: { id: 'T1082', name: 'System Information Discovery', tactic: 'Discovery' } },
    { id: 's_exfil', t: '14:07:09', from: 'dns', to: 'c2', title: 'Secrets leave through DNS', text: 'The resolver forwards every query to the attacker’s name server. A .env file leaks a database password and a cloud access key.', attack: { id: 'T1048.003', name: 'Exfiltration Over Unencrypted Non-C2 Protocol', tactic: 'Exfiltration' } },
  ],
};
