import type { Case, ChainEdge, ChainNode, DiskRow, PacketRow, ProcRow, TableRow } from '../types';
import { rng, clock, hms } from '../gen';
import { D, T, byKey, KB, MB } from './util';

const R = rng(7707);
const DAY = '2026-05-12';
const t = (s: string) => `${DAY} ${s}`;
const WS = '10.30.4.44', FILE = '10.30.2.30', C2 = '198.51.100.88', DNS = '10.30.1.2', NTP = '10.30.1.5';

/* ---- mail gateway ---- */
const mail: TableRow[] = byKey([
  T('m_phish', { time: t('09:04:51'), from: 'hr-benefits@finc0-benefits.example', to: 'pkaur@finco.example', subject: 'Updated org chart (ENG) – please review', attach: 'OrgChart_Q2.zip (ISO inside)', spf: 'FAIL', action: 'Delivered' }, { role: 'key', step: 's_mail', touches: 'mail,ws', sum: 'Lookalike sender finc0-benefits.example, ZIP/ISO, SPF fail, delivered to pkaur', detail: { Note: 'The domain has a zero instead of an “o”, and was registered 3 days ago.' } }),
  T('h_ics', { time: t('08:30:00'), from: 'it-notices@finco.example', to: 'all-eng@finco.example', subject: 'Planned maintenance Saturday', attach: 'maintenance.ics', spf: 'PASS', action: 'Delivered' }, { role: 'herring', sum: 'IT maintenance notice with an .ics', why: 'Sent from the company domain with SPF pass, and a calendar file is not executable.' }),
  T('h_sign', { time: t('09:40:10'), from: 'dse@docusign.net', to: 'pkaur@finco.example', subject: 'Please sign: NDA – Turbine supplier', attach: '—', spf: 'PASS', action: 'Delivered' }, { role: 'herring', sum: 'DocuSign request with a link', why: 'A real DocuSign envelope: valid SPF/DKIM from the vendor’s own domain, and pkaur was expecting an NDA from procurement.' }),
  T('m1', { time: t('08:02:19'), from: 'news@vendor-weekly.example', to: 'pkaur@finco.example', subject: 'Weekly vendor digest', attach: '—', spf: 'PASS', action: 'Delivered' }),
], 'time');

/* ---- process list from the workstation ---- */
const P = (pid: number, ppid: number, name: string, at: string, cmd: string, extra: Partial<ProcRow> = {}): ProcRow =>
  ({ id: `pid${pid}`, pid, ppid, name, user: pid < 1000 ? 'NT AUTHORITY\\SYSTEM' : 'FINCO\\pkaur', created: t(at), cmd, ...extra });
const procs: ProcRow[] = [
  P(640, 0, 'services.exe', '06:01:10', 'C:\\Windows\\system32\\services.exe'),
  P(880, 640, 'svchost.exe', '06:01:14', 'C:\\Windows\\system32\\svchost.exe -k DcomLaunch -p'),
  P(1288, 640, 'svchost.exe', '06:01:19', 'C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule'),
  P(2480, 640, 'ccmexec.exe', '06:01:55', 'C:\\Windows\\CCM\\CcmExec.exe'),
  P(3320, 2480, 'powershell.exe', '09:00:02', 'powershell.exe -ExecutionPolicy Bypass -File C:\\Windows\\CCM\\SystemTemp\\hw_inventory.ps1', { role: 'herring', sum: 'powershell -ExecutionPolicy Bypass', why: 'Launched by the endpoint-management agent, signed, from the CCM folder. Its parent is exactly who it should be.' }),
  P(3984, 0, 'explorer.exe', '07:50:12', 'C:\\Windows\\Explorer.EXE'),
  P(4021, 3984, 'OUTLOOK.EXE', '07:52:20', '"C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE"'),
  P(4088, 3984, 'rundll32.exe', '08:44:44', 'rundll32.exe shell32.dll,Control_RunDLL main.cpl', { role: 'herring', sum: 'rundll32 Control_RunDLL', why: 'The standard way Windows opens a Control Panel applet. The DLL is a system one and the parent is Explorer.' }),
  P(6120, 3984, 'cmd.exe', '09:07:03', 'cmd.exe /c rundll32.exe C:\\Users\\pkaur\\AppData\\Local\\Temp\\OrgChart\\update.dll,Run', { role: 'key', step: 's_exec', touches: 'ws', sum: 'cmd.exe /c rundll32 …\\OrgChart\\update.dll,Run', detail: { Note: 'Started by Explorer when the user double-clicked a shortcut inside the mounted ISO.' } }),
  P(6188, 6120, 'rundll32.exe', '09:07:04', 'rundll32.exe C:\\Users\\pkaur\\AppData\\Local\\Temp\\OrgChart\\update.dll,Run', { role: 'key', step: 's_exec', touches: 'ws', sum: 'rundll32 loads update.dll from a Temp folder' }),
  P(7712, 3984, 'RuntimeBroker.exe', '09:14:20', 'C:\\Windows\\System32\\RuntimeBroker.exe -Embedding', { role: 'key', step: 's_inject', touches: 'ws', creator: 6188, hidden: true, sum: 'RuntimeBroker 7712 unlinked; real creator is rundll32 6188' }),
];

/* ---- packet capture (WS-ENG-044, 09:10–09:30) ---- */
const pk: PacketRow[] = [];
const addP = (tm: number, src: string, dst: string, proto: string, len: number, info: string, extra: Partial<PacketRow> = {}) => pk.push({ id: '', t: Math.round(tm * 1000) / 1000, src, dst, proto, len, info, ...extra });
let tb = 41.2;
for (let i = 0; i < 24; i++) { addP(tb, WS, C2, 'TLSv1.3', 180 + R.int(0, 30), 'Application Data · POST /v1/sync (SNI cdn-sync-eu.example)', { role: 'key', step: 's_c2', touches: 'ws,c2', sum: `HTTPS beacon to 198.51.100.88 at ${clock(hms('09:10:00') + tb)}` }); addP(tb + 0.1, C2, WS, 'TLSv1.3', 100, 'Application Data'); tb += R.jitter(45, 0.03); }
for (let x = 10; x < 1200; x += R.jitter(64, 0.004)) addP(x, WS, NTP, 'NTP', 90, 'NTP Version 4, client', { role: 'herring', sum: 'NTP request to 10.30.1.5', why: 'Time sync to the internal NTP server every 64 seconds. Regular by design, internal, and tiny.' });
for (let x = 8; x < 1200; x += R.jitter(120, 0.003)) addP(x, '10.30.1.20', WS, 'TCP', 74, '5666 → 50221 check_load', { role: 'herring', sum: 'Monitoring poll from 10.30.1.20', why: 'The monitoring server polls its agent every two minutes. The connection comes from inside, to a known host.' });
for (let i = 0; i < 40; i++) { const tm = R.next() * 1190 + 5; addP(tm, WS, R.pick(['140.82.121.4', '52.97.201.34', '104.16.92.34', '142.250.74.35']), 'TLSv1.3', R.int(120, 1400), 'Application Data'); }
pk.sort((a, b) => a.t - b.t).forEach((r, i) => { r.id = `p${i.toString().padStart(3, '0')}`; });
const beacons = pk.filter((r) => r.step === 's_c2').map((r) => `ev-pcap:${r.id}`);

/* ---- DC02 and file server logs ---- */
const logs: TableRow[] = byKey([
  T('k1', { time: t('10:30:11'), host: 'DC02', id: '4769', acct: 'pkaur', src: WS, detail: 'TGS MSSQLSvc/SRV-ENGDB.finco.local:1433 · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 pkaur: RC4 ticket for MSSQLSvc/SRV-ENGDB' }),
  T('k2', { time: t('10:30:12'), host: 'DC02', id: '4769', acct: 'pkaur', src: WS, detail: 'TGS HTTP/plm.finco.local · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 pkaur: RC4 ticket for HTTP/plm' }),
  T('k3', { time: t('10:30:14'), host: 'DC02', id: '4769', acct: 'pkaur', src: WS, detail: 'TGS CIFS/SRV-FILE-03.finco.local · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 pkaur: RC4 ticket for CIFS/SRV-FILE-03' }),
  T('l1', { time: t('10:48:09'), host: 'SRV-FILE-03', id: '4624', acct: 'svc_eng', src: WS, detail: 'Logon type 3 · NTLM · workstation WS-ENG-044' }, { role: 'key', step: 's_lat', touches: 'ws,file', sum: '4624 svc_eng on SRV-FILE-03 from the engineer’s PC', detail: { Note: 'A service account should log on from its own server, not from a laptop.' } }),
  T('p1', { time: t('11:02:31'), host: 'SRV-FILE-03', id: '4698', acct: 'svc_eng', src: '—', detail: 'Scheduled task created: \\Microsoft\\Windows\\UpdateOrchestrator\\Reboot_Chk · Action C:\\ProgramData\\Intel\\svcupd.exe · Trigger: at startup' }, { role: 'key', step: 's_persist', touches: 'file', sum: '4698: task “Reboot_Chk” starts C:\\ProgramData\\Intel\\svcupd.exe at boot' }),
  T('r1', { time: t('16:19:58'), host: 'SRV-FILE-03', id: '4688', acct: 'svc_eng', src: '—', detail: 'C:\\ProgramData\\Intel\\svcupd.exe --enc D:\\Engineering --ext .nsh' }, { role: 'key', step: 's_ransom', touches: 'file', sum: '4688: svcupd.exe --enc D:\\Engineering' }),
  T('h1', { time: t('02:00:15'), host: 'SRV-FILE-03', id: '4624', acct: 'svc_scan', src: '10.30.8.8', detail: 'Logon type 3 · NTLM · workstation VULNSCAN' }, { role: 'herring', sum: 'svc_scan logon at 02:00', why: 'The nightly vulnerability scanner, same account and source address every night.' }),
  T('h2', { time: t('03:30:00'), host: 'SRV-FILE-03', id: '4698', acct: 'SYSTEM', src: '—', detail: 'Scheduled task updated: \\Microsoft\\Windows\\Windows Defender\\Windows Defender Scheduled Scan' }, { role: 'herring', sum: 'Defender scheduled scan task updated', why: 'Windows Defender maintains its own scheduled task. It is written by SYSTEM under the Defender folder and points to MpCmdRun.exe.' }),
  T('o1', { time: t('09:12:00'), host: 'SRV-FILE-03', id: '4624', acct: 'tpatel', src: '10.30.3.44', detail: 'Logon type 3 · Kerberos · workstation WS-FIN-044' }),
  T('o2', { time: t('09:40:00'), host: 'DC02', id: '4768', acct: 'pkaur', src: WS, detail: 'TGT requested · etype 0x12 (AES256) · lifetime 10h' }),
], 'time');

/* ---- file server disk ---- */
const disk: DiskRow[] = [
  D('d_svc', 'C:\\ProgramData\\Intel\\svcupd.exe', 612 * KB, t('11:02:00'), t('11:02:31'), t('11:01:50'), t('11:01:50'), 'hidden', { role: 'key', step: 's_persist', touches: 'file', sum: 'Hidden svcupd.exe in ProgramData\\Intel', detail: { Note: 'The Intel folder has no such program. The hidden attribute was set by hand.' } }),
  D('d_deploy', 'D:\\Engineering\\build\\deploy.ps1', 2 * KB, '2026-02-02 11:02:10', t('11:15:44'), '2025-12-01 09:00:00', '2025-12-01 09:00:00', 'live', { role: 'key', step: 's_loot', touches: 'file', sum: 'deploy.ps1 read at 11:15 (holds a cloud key)', detail: { Contents: '$env:AWS_ACCESS_KEY_ID = "AKIAXQ7ENGARCHIVE1"  # svc-eng, read-only on finco-eng-archive' } }),
  D('d_tool', 'C:\\Users\\Public\\x64.exe', 1180 * KB, t('11:12:03'), t('11:14:40'), t('11:12:03'), t('11:12:03'), 'deleted', { role: 'key', step: 's_loot', touches: 'file', sum: 'Deleted x64.exe in Public, 11:14', detail: { Note: 'Created 11:12, deleted 11:14. Short-lived tools usually mean credential tooling.' } }),
  D('d_note', 'D:\\Engineering\\README_RESTORE.txt', 3 * KB, t('16:20:05'), t('16:20:05'), t('16:20:05'), t('16:20:05'), 'live', { role: 'key', step: 's_ransom', touches: 'file', sum: 'README_RESTORE.txt appears at 16:20:05', detail: { Contents: 'All engineering files are encrypted. Contact restore-help@mail.example. Pay 12.4 BTC to bc1q…lab7.' } }),
  D('d_enc', 'D:\\Engineering\\specs\\turbine_v7.dwg.nsh', 48 * MB, t('16:20:31'), t('16:20:31'), '2026-01-12 10:00:00', '2026-01-12 10:00:00', 'live', { role: 'key', step: 's_ransom', touches: 'file', sum: 'turbine_v7.dwg renamed to .nsh at 16:20' }),
  D('h_thumb', 'C:\\Users\\svc_eng\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_idx.db', 24 * KB, t('08:00:02'), t('08:00:02'), '2025-10-01 08:03:00', '2025-10-01 08:03:00', 'hidden', { role: 'herring', sum: 'thumbcache_idx.db (hidden)', why: 'Windows hides its own thumbnail cache. A hidden attribute alone proves nothing.' }),
  D('h_bak', 'E:\\BackupAgent\\eng_20260512.bak', 9200 * MB, t('02:00:44'), t('02:00:44'), t('02:00:11'), t('02:00:11'), 'live', { role: 'herring', sum: 'Nightly backup, 9.2 GB at 02:00', why: 'The backup agent writes this file every night at 02:00 with the same size.' }),
  D('n1', 'D:\\Engineering\\specs\\bracket_v3.dwg', 22 * MB, '2026-03-02 10:00:00', '2026-04-20 10:00:00', '2025-09-03 10:00:00', '2025-09-03 10:00:00'),
  D('n2', 'D:\\Engineering\\build\\pipeline.yml', 4 * KB, '2026-04-02 15:00:00', '2026-05-11 17:10:00', '2025-12-01 09:00:00', '2025-12-01 09:00:00'),
];

/* ---- cloud audit ---- */
const cloud: TableRow[] = byKey([
  T('c1', { time: t('14:19:40'), event: 'ListBuckets', who: 'svc-eng', key: 'AKIAXQ7ENGARCHIVE1', ip: C2, agent: 'Boto3/1.34.69', res: 's3' }, { role: 'key', step: 's_cloud', touches: 'c2,cloud', sum: 'ListBuckets with svc-eng key from 198.51.100.88' }),
  T('c2', { time: t('14:20:05'), event: 'GetObject', who: 'svc-eng', key: 'AKIAXQ7ENGARCHIVE1', ip: C2, agent: 'Boto3/1.34.69', res: 'finco-eng-archive/turbine_cad_full.tar (31 GB)' }, { role: 'key', step: 's_cloud', touches: 'c2,cloud', sum: 'GetObject turbine_cad_full.tar (31 GB) from 198.51.100.88' }),
  T('c3', { time: t('14:26:51'), event: 'GetObject', who: 'svc-eng', key: 'AKIAXQ7ENGARCHIVE1', ip: C2, agent: 'Boto3/1.34.69', res: 'finco-eng-archive/supplier_contracts.zip (4 GB)' }, { role: 'key', step: 's_cloud', touches: 'c2,cloud', sum: 'GetObject supplier_contracts.zip (4 GB)' }),
  T('h1', { time: t('03:00:09'), event: 'ReplicateObject', who: 'backup-role (AWS Backup)', key: 'ASIA…assumed-role', ip: 'backup.amazonaws.com', agent: 'AWS Internal', res: 'finco-eng-archive → finco-eng-dr (eu-central-1)' }, { role: 'herring', sum: 'AWS Backup replicates the bucket at 03:00', why: 'The managed disaster-recovery copy runs nightly from an AWS service principal, not an internet address.' }),
  T('o1', { time: t('13:58:02'), event: 'PutObject', who: 'svc-ci', key: 'AKIAXQ7CIJOBKEY001', ip: '192.0.2.44', agent: 'Terraform/1.7.4', res: 'finco-build-cache' }),
], 'time');

/* ---- blockchain: the ransom ---- */
const cn: ChainNode[] = [
  { id: 'payer', label: 'Insurer escrow', kind: 'wallet', x: 8, y: 50 },
  { id: 'rw', label: 'Ransom wallet bc1q…lab7', kind: 'wallet', x: 30, y: 50 },
  { id: 'p1', label: 'Peel wallet A', kind: 'wallet', x: 54, y: 24 },
  { id: 'p2', label: 'Peel wallet B', kind: 'wallet', x: 54, y: 76 },
  { id: 'mix', label: 'Mixer', kind: 'mixer', x: 76, y: 24 },
  { id: 'cex', label: 'Exchange Y', kind: 'exchange', x: 92, y: 62 },
  { id: 'whale', label: 'Unrelated whale', kind: 'wallet', x: 76, y: 90 },
];
const ce: ChainEdge[] = [
  { id: 'y1', from: 'payer', to: 'rw', amt: '12.4', asset: 'BTC', time: '2026-05-14 10:12:40', hash: '0xa11e…d0', role: 'key', step: 's_pay', touches: 'payer,rw', sum: '12.4 BTC paid to the address in the ransom note' },
  { id: 'y2', from: 'rw', to: 'p1', amt: '6.2', asset: 'BTC', time: '2026-05-14 10:41:03', hash: '0xb22f…e1', role: 'key', step: 's_pay', touches: 'rw,p1', sum: '6.2 BTC to Peel wallet A' },
  { id: 'y3', from: 'rw', to: 'p2', amt: '6.2', asset: 'BTC', time: '2026-05-14 10:41:30', hash: '0xc33a…f2', role: 'key', step: 's_pay', touches: 'rw,p2', sum: '6.2 BTC to Peel wallet B' },
  { id: 'y4', from: 'p1', to: 'mix', amt: '6.2', asset: 'BTC', time: '2026-05-14 12:05:11', hash: '0xd44b…03', role: 'key', step: 's_pay', touches: 'p1,mix', sum: 'Peel wallet A deposits into a mixer' },
  { id: 'y5', from: 'p2', to: 'cex', amt: '6.2', asset: 'BTC', time: '2026-05-14 13:48:57', hash: '0xe55c…14', role: 'key', step: 's_pay', touches: 'p2,cex', sum: 'Peel wallet B deposits 6.2 BTC at Exchange Y' },
  { id: 'h1', from: 'whale', to: 'cex', amt: '310', asset: 'BTC', time: '2026-05-14 13:49:02', hash: '0xf66d…25', role: 'herring', sum: 'A 310 BTC deposit to Exchange Y seconds later', why: 'A large deposit to the same exchange, but its source is an unrelated wallet with years of history. Timing coincidence is not a link.' },
];

const refsOf = (rows: { id: string; step?: string }[], a: string, ...steps: string[]) => rows.filter((r) => r.step && steps.includes(r.step)).map((r) => `${a}:${r.id}`);

export const case7: Case = {
  id: 'full-intrusion', no: 7, kind: 'Finale · every evidence type', title: 'Full Intrusion', icon: 'all', base: 300,
  tagline: 'One company, one day, six kinds of evidence. Write the report.',
  briefing: [
    'Finco Engineering was hit by ransomware at 16:20. Management wants a report by morning: how did they get in, how did they move, what did they take, and where did the money go?',
    'You have mail logs, a process list from the first PC, a network capture, domain and server logs, the file server’s disk, a cloud audit log and a blockchain trace of the ransom. All of it points to one attacker, but each source shows only one angle.',
    'Your report is scored on completeness (how much of the attack you proved), accuracy (how many false leads you chased) and the order you put it in.',
  ],
  tools: ['logs', 'disk', 'packets', 'hex', 'proc', 'chain', 'map', 'timeline'], newTools: [],
  artifacts: [
    { kind: 'table', id: 'ev-mail', label: 'Mail gateway', sub: 'Inbound delivery log · 12 May', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'from', label: 'From', w: 220 }, { k: 'to', label: 'To' }, { k: 'subject', label: 'Subject', w: 260 }, { k: 'attach', label: 'Attachment' }, { k: 'spf', label: 'SPF' }, { k: 'action', label: 'Action' }], rows: mail, sortKey: 'time' },
    { kind: 'proc', id: 'ev-proc', label: 'Workstation RAM', sub: 'WS-ENG-044 · pslist + psscan', rows: procs },
    { kind: 'pcap', id: 'ev-pcap', label: 'Packet capture', sub: 'WS-ENG-044 · 09:10–09:30', rows: pk, inventory: { [WS]: 'WS-ENG-044 · engineer PC (P. Kaur)', [DNS]: 'SRV-DNS02 · resolver', [NTP]: 'SRV-NTP02 · time server', '10.30.1.20': 'SRV-MON02 · monitoring', [C2]: '— not in the asset register —' } },
    { kind: 'table', id: 'ev-logs', label: 'Domain + server logs', sub: 'DC02 and SRV-FILE-03 · Security', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'host', label: 'Host' }, { k: 'id', label: 'ID', mono: true }, { k: 'acct', label: 'Account' }, { k: 'src', label: 'Source', mono: true }, { k: 'detail', label: 'Detail', w: 440 }], rows: logs, sortKey: 'time' },
    { kind: 'disk', id: 'ev-disk', label: 'File server disk', sub: 'SRV-FILE-03 · NTFS listing', rows: disk },
    { kind: 'table', id: 'ev-cloud', label: 'Cloud audit log', sub: 'finco-eng-archive · S3 + CloudTrail', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'event', label: 'Event', mono: true }, { k: 'who', label: 'Principal' }, { k: 'key', label: 'Key', mono: true }, { k: 'ip', label: 'IP', mono: true }, { k: 'agent', label: 'Agent' }, { k: 'res', label: 'Resource', w: 280 }], rows: cloud, sortKey: 'time' },
    { kind: 'chain', id: 'ev-chain', label: 'Ransom trace', sub: 'Bitcoin · 14 May 2026', nodes: cn, rows: ce },
  ],
  hosts: [
    { id: 'mail', label: 'Phishing mail', ip: 'finc0-benefits', x: 7, y: 20, kind: 'net' },
    { id: 'ws', label: 'WS-ENG-044', ip: WS, x: 24, y: 50, kind: 'ws' },
    { id: 'c2', label: 'Attacker C2', ip: C2, x: 24, y: 86, kind: 'attacker' },
    { id: 'dc', label: 'DC02', ip: '10.30.0.2', x: 52, y: 18, kind: 'dc' },
    { id: 'file', label: 'SRV-FILE-03', ip: FILE, x: 56, y: 56, kind: 'server' },
    { id: 'cloud', label: 'Cloud archive', ip: 'finco-eng-archive', x: 82, y: 82, kind: 'cloud' },
    { id: 'payer', label: 'Insurer escrow', ip: 'BTC', x: 80, y: 28, kind: 'wallet' },
    { id: 'rw', label: 'Ransom wallet', ip: 'bc1q…lab7', x: 94, y: 52, kind: 'wallet' },
    { id: 'p1', label: 'Peel A', ip: 'BTC', x: 66, y: 8, kind: 'wallet' },
    { id: 'p2', label: 'Peel B', ip: 'BTC', x: 92, y: 8, kind: 'wallet' },
    { id: 'mix', label: 'Mixer', ip: 'BTC', x: 76, y: 8, kind: 'net' },
    { id: 'cex', label: 'Exchange Y', ip: 'KYC', x: 98, y: 30, kind: 'server' },
  ],
  edges: [['mail', 'ws'], ['ws', 'c2'], ['ws', 'dc'], ['ws', 'file'], ['c2', 'cloud'], ['payer', 'rw'], ['rw', 'p1'], ['rw', 'p2'], ['p1', 'mix'], ['p2', 'cex']],
  questions: [
    { id: 'q1', prompt: 'How did the attacker get in?', options: ['A phishing email with a ZIP/ISO and a shortcut', 'An exposed RDP port', 'A vulnerable VPN appliance', 'A poisoned npm package'], answer: 0, proof: ['ev-mail:m_phish', 'ev-proc:pid6120', 'ev-proc:pid6188'], need: 2, points: 14, hint: 'Find the message that fails SPF, and the process that ran right after the user opened it.', explain: 'A lookalike domain sent an ISO. Explorer started cmd.exe, which loaded update.dll through rundll32.' },
    { id: 'q2', prompt: 'Which host is patient zero?', options: ['WS-ENG-044', 'SRV-FILE-03', 'DC02', 'SRV-NTP02'], answer: 0, proof: [...beacons.slice(0, 6), 'ev-mail:m_phish', 'ev-proc:pid6188'], need: 1, points: 14, hint: 'Where did the first malicious process run and where did the first beacon start?', explain: 'Everything starts at P. Kaur’s PC: the phish, the DLL, the beacons.' },
    { id: 'q3', prompt: 'What is the command-and-control address and beacon rhythm?', options: ['198.51.100.88, about every 45 s', '10.30.1.5, every 64 s', '198.51.100.88, every 5 minutes', '10.30.1.20, every 2 minutes'], answer: 0, proof: beacons, need: 3, points: 14, hint: 'Pin three consecutive packets to the same unknown external address, and rule out the regular internal ones.', explain: 'A steady poll about every 45 s with 3 % jitter to an address that is not in the asset register.' },
    { id: 'q4', prompt: 'How did they move from the workstation to the file server?', options: ['Kerberoasted a service account, then logged on with it', 'An SMB exploit', 'A forged golden ticket', 'RDP with the engineer’s own password'], answer: 0, proof: [...refsOf(logs, 'ev-logs', 's_roast'), 'ev-logs:l1'], need: 3, points: 14, hint: 'Three RC4 tickets in three seconds, then a service account on a server it never visits from a laptop.', explain: 'RC4 service tickets were cracked offline, then svc_eng was used from the PC with NTLM.' },
    { id: 'q5', prompt: 'How was the engineering data stolen?', options: ['A cloud key from deploy.ps1 was used from the C2 address', 'Copied to a USB stick', 'Tunnelled out over DNS', 'Emailed as attachments'], answer: 0, proof: [...refsOf(cloud, 'ev-cloud', 's_cloud'), 'ev-disk:d_deploy'], need: 2, points: 14, hint: 'A script on the file server contained a key. Where does that key reappear?', explain: 'deploy.ps1 held a read-only key. 35 GB left through GetObject calls from 198.51.100.88.' },
    { id: 'q6', prompt: 'What persistence mechanism was installed?', options: ['A scheduled task starting a hidden svcupd.exe at boot', 'A new local administrator account', 'A WMI event subscription', 'A Run key in the registry'], answer: 0, proof: ['ev-logs:p1', 'ev-disk:d_svc'], need: 1, points: 14, hint: 'Look for event 4698 and a hidden file the task points to.', explain: 'Task “Reboot_Chk” under UpdateOrchestrator started C:\\ProgramData\\Intel\\svcupd.exe, the same binary that later encrypted the share.' },
    { id: 'q7', prompt: 'Where did the paid ransom end up?', options: ['Half to a mixer, half deposited at Exchange Y', 'All of it to a cold wallet', 'Back to the insurer', 'Split between three exchanges'], answer: 0, proof: ['ev-chain:y1', 'ev-chain:y4', 'ev-chain:y5'], need: 2, points: 16, hint: 'Follow the ransom wallet’s outgoing transfers. Do not be distracted by the 310 BTC deposit.', explain: 'A classic peel: the amount is split in two, one half mixed, one half deposited where it can be traced to an identity.' },
  ],
  steps: [
    { id: 's_mail', t: '09:04:51', from: 'mail', to: 'ws', title: 'A convincing org chart', text: 'A lookalike domain delivers OrgChart_Q2.zip to an engineer. SPF fails but the gateway delivers it anyway.', attack: { id: 'T1566.001', name: 'Phishing: Spearphishing Attachment', tactic: 'Initial Access' } },
    { id: 's_exec', t: '09:07:03', from: 'ws', to: 'ws', title: 'The shortcut is opened', text: 'Explorer runs cmd.exe, which loads update.dll through rundll32 from the user’s Temp folder.', attack: { id: 'T1204.002', name: 'User Execution: Malicious File', tactic: 'Execution' } },
    { id: 's_c2', t: '09:10:41', from: 'ws', to: 'c2', title: 'The implant checks in', text: 'HTTPS beacons to 198.51.100.88 about every 45 seconds, with small jitter.', attack: { id: 'T1071.001', name: 'Application Layer Protocol: Web Protocols', tactic: 'Command and Control' } },
    { id: 's_inject', t: '09:14:20', from: 'ws', to: 'ws', title: 'A hidden process', text: 'A fake RuntimeBroker is created by rundll32 and then unlinked from the process list.', attack: { id: 'T1055', name: 'Process Injection', tactic: 'Defense Evasion' } },
    { id: 's_roast', t: '10:30:11', from: 'ws', to: 'dc', title: 'Service tickets are harvested', text: 'Three RC4 tickets in three seconds, taken to be cracked offline.', attack: { id: 'T1558.003', name: 'Steal or Forge Kerberos Tickets: Kerberoasting', tactic: 'Credential Access' } },
    { id: 's_lat', t: '10:48:09', from: 'ws', to: 'file', title: 'The file server', text: 'svc_eng logs on from an engineer’s laptop using NTLM.', attack: { id: 'T1021.002', name: 'Remote Services: SMB/Windows Admin Shares', tactic: 'Lateral Movement' } },
    { id: 's_persist', t: '11:02:31', from: 'file', to: 'file', title: 'A task to survive reboots', text: 'A hidden svcupd.exe is started at boot by a task named to look like Windows Update.', attack: { id: 'T1053.005', name: 'Scheduled Task/Job: Scheduled Task', tactic: 'Persistence' } },
    { id: 's_loot', t: '11:12:03', from: 'file', to: 'file', title: 'A key in a script', text: 'A short-lived tool runs and is deleted. deploy.ps1 is read: it holds a cloud access key.', attack: { id: 'T1552.001', name: 'Unsecured Credentials: Credentials In Files', tactic: 'Credential Access' } },
    { id: 's_cloud', t: '14:20:05', from: 'c2', to: 'cloud', title: 'The archive leaves', text: 'From the C2 address the stolen key downloads 35 GB of CAD and supplier contracts.', attack: { id: 'T1530', name: 'Data from Cloud Storage', tactic: 'Collection' } },
    { id: 's_ransom', t: '16:19:58', from: 'file', to: 'file', title: 'The share is encrypted', text: 'svcupd.exe encrypts D:\\Engineering and leaves a ransom note.', attack: { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact' } },
    { id: 's_pay', t: '+2 days', from: 'payer', to: 'cex', title: 'The ransom is laundered', text: '12.4 BTC is paid, split in two, half mixed and half deposited at an exchange.', attack: { id: 'T1657', name: 'Financial Theft', tactic: 'Impact' } },
  ],
};
