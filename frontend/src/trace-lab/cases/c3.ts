import type { Case, ProcRow, TableRow, HexRow } from '../types';
import { hexRows } from '../gen';
import { T } from './util';

const D = '2026-03-25';
const P = (pid: number, ppid: number, name: string, user: string, at: string, cmd: string, extra: Partial<ProcRow> = {}): ProcRow =>
  ({ id: `pid${pid}`, pid, ppid, name, user, created: `${D} ${at}`, cmd, ...extra });
const SYS = 'NT AUTHORITY\\SYSTEM', LS = 'NT AUTHORITY\\LOCAL SERVICE', NS = 'NT AUTHORITY\\NETWORK SERVICE', U = 'FINCO\\acarter';
const SVC = 'C:\\Windows\\system32\\svchost.exe -k';

const procs: ProcRow[] = [
  P(4, 0, 'System', SYS, '06:02:01', ''),
  P(388, 4, 'smss.exe', SYS, '06:02:03', '\\SystemRoot\\System32\\smss.exe'),
  P(520, 0, 'csrss.exe', SYS, '06:02:08', '%SystemRoot%\\system32\\csrss.exe ObjectDirectory=\\Windows'),
  P(600, 0, 'wininit.exe', SYS, '06:02:09', 'wininit.exe'),
  P(640, 600, 'services.exe', SYS, '06:02:10', 'C:\\Windows\\system32\\services.exe'),
  P(660, 600, 'lsass.exe', SYS, '06:02:10', 'C:\\Windows\\system32\\lsass.exe'),
  P(700, 0, 'winlogon.exe', SYS, '06:02:11', 'winlogon.exe'),
  P(880, 640, 'svchost.exe', SYS, '06:02:14', `${SVC} DcomLaunch -p`),
  P(940, 640, 'svchost.exe', NS, '06:02:15', `${SVC} RPCSS -p`),
  P(1012, 640, 'svchost.exe', LS, '06:02:16', `${SVC} LocalServiceNetworkRestricted -p`),
  P(1100, 640, 'svchost.exe', NS, '06:02:17', `${SVC} NetworkService -p`),
  P(1288, 640, 'svchost.exe', SYS, '06:02:19', `${SVC} netsvcs -p -s Schedule`),
  P(1500, 640, 'svchost.exe', SYS, '06:02:22', `${SVC} netsvcs -p -s Appinfo`),
  P(1700, 640, 'spoolsv.exe', SYS, '06:02:30', 'C:\\Windows\\System32\\spoolsv.exe'),
  P(2210, 640, 'MsMpEng.exe', SYS, '06:02:41', '"C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18\\MsMpEng.exe"'),
  P(2480, 640, 'ccmexec.exe', SYS, '06:02:55', 'C:\\Windows\\CCM\\CcmExec.exe'),
  P(3320, 2480, 'powershell.exe', SYS, '09:00:02', 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File C:\\Windows\\CCM\\SystemTemp\\hw_inventory.ps1', { role: 'herring', sum: 'powershell.exe -ExecutionPolicy Bypass', why: 'The configuration-management agent (ccmexec.exe) runs this inventory script on schedule. It is signed, runs as SYSTEM from the CCM folder, and its parent is exactly who it should be.' }),
  P(3984, 0, 'explorer.exe', U, '07:55:12', 'C:\\Windows\\Explorer.EXE'),
  P(4021, 3984, 'OUTLOOK.EXE', U, '08:01:20', '"C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE"'),
  P(4088, 3984, 'rundll32.exe', U, '09:12:44', 'rundll32.exe shell32.dll,Control_RunDLL desk.cpl', { role: 'herring', sum: 'rundll32.exe shell32.dll,Control_RunDLL', why: 'This is how Windows opens a Control Panel applet from the Settings window. rundll32 is a favourite hiding place for malware, but here the DLL and the parent are both normal.' }),
  P(4120, 4021, 'WINWORD.EXE', U, '09:44:51', '"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" /n "C:\\Users\\acarter\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.Outlook\\Q1B2K9XM\\Invoice_8841.docm"', { role: 'key', step: 's_phish', touches: 'mail,ws', sum: 'WINWORD opens Invoice_8841.docm from Outlook cache' }),
  P(4410, 3984, 'Teams.exe', U, '08:03:02', '"C:\\Users\\acarter\\AppData\\Local\\Microsoft\\Teams\\current\\Teams.exe"'),
  P(4620, 3984, 'chrome.exe', U, '08:30:10', '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'),
  P(5236, 640, 'svchost.exe', U, '09:47:30', 'C:\\Windows\\System32\\svchost.exe', { role: 'key', step: 's_spoof', touches: 'ws', creator: 4120, sum: 'svchost.exe 5236: claims services.exe, runs as a user, no -k', detail: { Note: 'A real svchost has a -k group and runs as SYSTEM, LOCAL SERVICE or NETWORK SERVICE. Services.exe starts them at boot, not at 09:47.' } }),
  P(7340, 3984, 'ctfmon.exe', U, '09:48:12', 'ctfmon.exe', { role: 'key', step: 's_hidden', touches: 'ws', creator: 5236, hidden: true, sum: 'ctfmon.exe 7340 is unlinked from the process list', detail: { Note: 'Present in the pool-tag scan but missing from the active process list: it was unlinked.' } }),
];

const audit: TableRow[] = [
  T('a_logon', { time: `${D} 07:55:12`, ev: '4624', proc: 'explorer.exe', pid: '3984', creator: '1 (userinit.exe, exited)', sysmon: '—', note: 'Interactive logon FINCO\\acarter' }),
  T('a_word', { time: `${D} 09:44:51`, ev: '4688', proc: 'WINWORD.EXE', pid: '4120', creator: '4021 OUTLOOK.EXE', sysmon: '4021 OUTLOOK.EXE', note: 'Opened Invoice_8841.docm from the mail cache' }, { role: 'key', step: 's_phish', touches: 'mail,ws', sum: '4688: WINWORD launched by OUTLOOK for a .docm' }),
  T('a_spawn', { time: `${D} 09:47:30`, ev: '4688', proc: 'svchost.exe', pid: '5236', creator: '4120 WINWORD.EXE', sysmon: '640 services.exe', note: 'Creator Process ID and Sysmon ParentProcessId disagree' }, { role: 'key', step: 's_spoof', touches: 'ws', sum: '4688: svchost 5236 created by WINWORD (4120) but Sysmon says services.exe (640)' }),
  T('a_ccm', { time: `${D} 09:00:02`, ev: '4688', proc: 'powershell.exe', pid: '3320', creator: '2480 ccmexec.exe', sysmon: '2480 ccmexec.exe', note: '-ExecutionPolicy Bypass hw_inventory.ps1' }, { role: 'herring', sum: 'powershell by ccmexec at 09:00', why: 'Both sources agree on the parent. It is the endpoint management agent running its own script.' }),
];

const malfind: TableRow[] = [
  T('m_svc', { pid: '5236', proc: 'svchost.exe', start: '0x00000000001f0000', end: '0x000000000023ffff', prot: 'PAGE_EXECUTE_READWRITE', file: '(none, private memory)', tag: 'VadS', head: '4d 5a 90 00 03 00 00 00 …' }, { role: 'key', step: 's_inject', touches: 'ws', sum: 'svchost 5236: RWX region at 0x1f0000 starting with MZ' }),
  T('m_chrome', { pid: '4620', proc: 'chrome.exe', start: '0x000001a3c4000000', end: '0x000001a3c40fffff', prot: 'PAGE_EXECUTE_READWRITE', file: '(none, private memory)', tag: 'VadS', head: '48 89 5c 24 08 57 48 83 …' }, { role: 'herring', sum: 'chrome.exe RWX region', why: 'Browsers compile JavaScript to machine code at run time (JIT), so RWX memory is normal. The bytes are compiled code, not a program image with an MZ header.' }),
  T('m_defender', { pid: '2210', proc: 'MsMpEng.exe', start: '0x000002b811230000', end: '0x000002b81123ffff', prot: 'PAGE_EXECUTE_READWRITE', file: '(none, private memory)', tag: 'VadS', head: '00 00 00 00 00 00 00 00 …' }, { role: 'herring', sum: 'MsMpEng.exe RWX region', why: 'Defender’s emulator allocates executable scratch memory to run suspicious samples safely. It is empty and belongs to a signed Microsoft process.' }),
  T('m_teams', { pid: '4410', proc: 'Teams.exe', start: '0x00007ff6a1b00000', end: '0x00007ff6a1b0ffff', prot: 'PAGE_EXECUTE_READWRITE', file: '(none, private memory)', tag: 'VadS', head: '48 8b c4 48 89 58 08 48 …' }, { role: 'herring', sum: 'Teams.exe RWX region', why: 'Teams is an Electron (Chromium) app, so it has the same JIT behaviour as a browser.' }),
];

/* a 256-byte slice of the injected region: a PE image header, then strings */
const buf = new Uint8Array(256);
const put = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
buf[0] = 0x4d; buf[1] = 0x5a; buf[2] = 0x90; buf[4] = 0x03; buf[8] = 0x04; buf[0x3c] = 0x80;
put(0x4e, 'This program cannot be run in DOS mode.\r\r\n$');
put(0x80, 'PE'); buf[0x84] = 0x64; buf[0x85] = 0x86; buf[0x86] = 0x06;
put(0xb0, '.text'); put(0xc8, '.rdata');
put(0xe0, 'VirtualAlloc'); put(0xf0, 'CreateThread');
const cfg = 'c2=203.0.113.77:443;sleep=60000;jitter=5;ua=Mozilla/5.0;';
const hx: HexRow[] = hexRows(buf, 0x1f0000).map((r) => ({ id: `h${r.off.toString(16)}`, ...r }));
hx[0] = { ...hx[0]!, role: 'key', step: 's_inject', touches: 'ws', sum: 'Region 0x1f0000 begins with MZ (a PE image in private memory)' };
const cfgRows = hexRows(new TextEncoder().encode(cfg.padEnd(64, '\0')), 0x1f0100).map((r) => ({ id: `h${r.off.toString(16)}`, ...r, role: 'key' as const, step: 's_c2', touches: 'ws,c2', sum: 'Implant config in memory: c2=203.0.113.77:443' }));
const hexAll = [...hx, ...cfgRows];

const net: TableRow[] = [
  T('n_c2', { pid: '5236', proc: 'svchost.exe', local: '10.20.4.17:50412', foreign: '203.0.113.77:443', state: 'ESTABLISHED', created: `${D} 09:47:41` }, { role: 'key', step: 's_c2', touches: 'ws,c2', sum: 'svchost 5236 → 203.0.113.77:443 ESTABLISHED' }),
  T('n_def', { pid: '2210', proc: 'MsMpEng.exe', local: '10.20.4.17:50120', foreign: '20.190.151.8:443', state: 'ESTABLISHED', created: `${D} 08:00:05` }, { role: 'herring', sum: 'MsMpEng.exe → 20.190.151.8:443', why: 'Defender updating its signatures from Microsoft’s own address range.' }),
  T('n_ccm', { pid: '2480', proc: 'ccmexec.exe', local: '10.20.4.17:50133', foreign: '10.20.1.30:80', state: 'ESTABLISHED', created: `${D} 06:03:12` }, { role: 'herring', sum: 'ccmexec.exe → 10.20.1.30:80', why: 'The management agent talking to the internal management point.' }),
  T('n_teams', { pid: '4410', proc: 'Teams.exe', local: '10.20.4.17:50340', foreign: '52.113.194.132:443', state: 'ESTABLISHED', created: `${D} 08:03:10` }),
  T('n_chrome', { pid: '4620', proc: 'chrome.exe', local: '10.20.4.17:50402', foreign: '142.250.74.46:443', state: 'ESTABLISHED', created: `${D} 09:20:41` }),
  T('n_ls1', { pid: '1288', proc: 'svchost.exe', local: '0.0.0.0:135', foreign: '*:*', state: 'LISTENING', created: `${D} 06:02:20` }),
  T('n_ls2', { pid: '4', proc: 'System', local: '10.20.4.17:445', foreign: '*:*', state: 'LISTENING', created: `${D} 06:02:25` }),
];

export const case3: Case = {
  id: 'ghost-memory', no: 3, kind: 'Memory forensics', title: 'Ghost in the Memory', icon: 'proc', base: 140,
  tagline: 'The process list looks clean. The RAM disagrees.',
  briefing: [
    'An accountant opened an invoice at 09:44. By 09:48 the EDR had gone quiet on WS-ACC-017. IT took a memory dump before rebooting.',
    'In memory, a process’s own claims can be lies. Compare what it says about itself with what the kernel, the audit log and the memory map say.',
    'New tool: the process tree with a deep scan. It finds processes that were unlinked from the active list and shows who really created each one.',
  ],
  tools: ['logs', 'hex', 'proc', 'map', 'timeline'], newTools: ['proc'],
  artifacts: [
    { kind: 'proc', id: 'ev-proc', label: 'Process list', sub: 'WS-ACC-017 · RAM dump · pslist + psscan', rows: procs },
    { kind: 'table', id: 'ev-audit', label: 'Process audit', sub: 'Security 4688 + Sysmon 1', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'ev', label: 'Event', mono: true }, { k: 'proc', label: 'New process' }, { k: 'pid', label: 'PID', mono: true }, { k: 'creator', label: 'Creator (Security 4688)' }, { k: 'sysmon', label: 'Parent (Sysmon)' }, { k: 'note', label: 'Note', w: 280 }], rows: audit, sortKey: 'time' },
    { kind: 'table', id: 'ev-malfind', label: 'Memory map', sub: 'malfind · executable private memory', cols: [{ k: 'pid', label: 'PID', mono: true }, { k: 'proc', label: 'Process' }, { k: 'start', label: 'Start', mono: true }, { k: 'prot', label: 'Protection', mono: true }, { k: 'file', label: 'Backed by file' }, { k: 'head', label: 'First bytes', mono: true }], rows: malfind },
    { kind: 'hex', id: 'ev-hex', label: 'Memory dump', sub: 'svchost.exe (5236) · 0x1f0000 and 0x1f0100', rows: hexAll },
    { kind: 'table', id: 'ev-net', label: 'Sockets', sub: 'netscan', cols: [{ k: 'pid', label: 'PID', mono: true }, { k: 'proc', label: 'Process' }, { k: 'local', label: 'Local', mono: true }, { k: 'foreign', label: 'Foreign', mono: true }, { k: 'state', label: 'State' }, { k: 'created', label: 'Created', mono: true }], rows: net, sortKey: 'created' },
  ],
  hosts: [
    { id: 'mail', label: 'Phishing mail', ip: 'invoice@…', x: 14, y: 30, kind: 'net' },
    { id: 'ws', label: 'WS-ACC-017', ip: '10.20.4.17', x: 46, y: 58, kind: 'ws' },
    { id: 'c2', label: 'C2 server', ip: '203.0.113.77', x: 84, y: 40, kind: 'attacker' },
  ],
  edges: [['mail', 'ws'], ['ws', 'c2']],
  questions: [
    { id: 'q1', prompt: 'Which process is lying about its parent?', options: ['svchost.exe, PID 5236', 'powershell.exe, PID 3320', 'rundll32.exe, PID 4088', 'MsMpEng.exe, PID 2210'], answer: 0, proof: ['ev-proc:pid5236', 'ev-audit:a_spawn'], need: 1, points: 20, hint: 'Compare the parent it claims with the Creator ID in the audit log. Run the deep scan too.', explain: 'It claims services.exe (640), but the audit log and the scan both say WINWORD.EXE (4120) created it.' },
    { id: 'q2', prompt: 'Who really created it?', options: ['services.exe (PID 640)', 'WINWORD.EXE (PID 4120)', 'explorer.exe (PID 3984)', 'OUTLOOK.EXE (PID 4021)'], answer: 1, proof: ['ev-audit:a_spawn', 'ev-proc:pid5236'], need: 1, points: 20, hint: 'The Security log records the true creator, Sysmon records what the process asked to be called.', explain: 'This is parent PID spoofing: Word asked Windows to record services.exe as the parent so the tree would look normal.' },
    { id: 'q3', prompt: 'What is the evidence of code injection into that process?', options: ['An executable private region starting with MZ and no file behind it', 'It has a high handle count', 'It runs as a normal user', 'It has many threads'], answer: 0, proof: ['ev-malfind:m_svc', 'ev-hex:h1f0000'], need: 1, points: 20, hint: 'Several processes have executable private memory. Only one holds a whole program image.', explain: 'A PE image living in anonymous memory means something wrote an executable there. Chrome and Defender show JIT code, not an image.' },
    { id: 'q4', prompt: 'Which process was hidden from the active process list?', options: ['ctfmon.exe, PID 7340', 'explorer.exe, PID 3984', 'Teams.exe, PID 4410', 'No process is hidden'], answer: 0, proof: ['ev-proc:pid7340'], need: 1, points: 20, hint: 'Run the deep scan on the process list and watch for something flickering.', explain: 'ctfmon.exe was unlinked from the kernel’s active process list, but its memory structure was still there for the scan to find.' },
    { id: 'q5', prompt: 'Where does the implant call home?', options: ['203.0.113.77 on port 443', '20.190.151.8 on port 443', '10.20.1.30 on port 80', '52.113.194.132 on port 443'], answer: 0, proof: ['ev-net:n_c2', ...cfgRows.map((r) => `ev-hex:${r.id}`)], need: 1, points: 20, hint: 'Check which socket belongs to the process you caught. The implant’s config is in memory too.', explain: 'The injected svchost holds an open connection to 203.0.113.77:443, and its configuration is sitting in memory.' },
  ],
  steps: [
    { id: 's_phish', t: '09:44:51', from: 'mail', to: 'ws', title: 'An invoice opens in Word', text: 'Outlook hands Invoice_8841.docm to Word. The document asks to enable macros.', attack: { id: 'T1566.001', name: 'Phishing: Spearphishing Attachment', tactic: 'Initial Access' } },
    { id: 's_spoof', t: '09:47:30', from: 'ws', to: 'ws', title: 'A fake svchost is born', text: 'The macro starts svchost.exe and tells Windows its parent is services.exe. The real creator is Word.', attack: { id: 'T1134.004', name: 'Access Token Manipulation: Parent PID Spoofing', tactic: 'Defense Evasion' } },
    { id: 's_inject', t: '09:47:33', from: 'ws', to: 'ws', title: 'A program is written into memory', text: 'A full PE image is written into a private, executable region of that svchost and started.', attack: { id: 'T1055', name: 'Process Injection', tactic: 'Defense Evasion' } },
    { id: 's_c2', t: '09:47:41', from: 'ws', to: 'c2', title: 'The implant phones home', text: 'An outbound HTTPS connection to 203.0.113.77 appears under the svchost, configured to wait 60 s between polls.', attack: { id: 'T1071.001', name: 'Application Layer Protocol: Web Protocols', tactic: 'Command and Control' } },
    { id: 's_hidden', t: '09:48:12', from: 'ws', to: 'ws', title: 'A second stage hides itself', text: 'ctfmon.exe is started and then unlinked from the active process list, so tools that walk the list never see it.', attack: { id: 'T1014', name: 'Rootkit', tactic: 'Defense Evasion' } },
  ],
};
