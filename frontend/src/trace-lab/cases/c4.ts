import type { Case, TableRow } from '../types';
import { rng, stamp } from '../gen';
import { T, byKey } from './util';

const R = rng(4404);
const DAY = '2026-04-09';
const t = (s: string) => `${DAY} ${s}`;
const WS = '10.20.5.7', FILE = '10.20.2.10', SQL = '10.20.2.20';

/* ---- DC01 security log ---- */
const users = ['lwong', 'tpatel', 'ckim', 'rdiaz', 'mhughes', 'sbaker', 'aolsen', 'jfox'];
const spns = ['HTTP/intranet.finco.local', 'cifs/SRV-FILE-01.finco.local', 'ldap/DC01.finco.local', 'host/SRV-SQL-01.finco.local'];
const dcNoise: TableRow[] = [];
for (let i = 0; i < 26; i++) {
  const u = R.pick(users), s = R.int(28000, 62000);
  if (R.next() < 0.4) dcNoise.push(T(`n${i}`, { time: stamp(DAY, s), id: '4768', acct: u, src: `10.20.${R.int(3, 7)}.${R.int(5, 90)}`, detail: 'TGT requested · etype 0x12 (AES256) · pre-auth OK · lifetime 10h' }));
  else dcNoise.push(T(`n${i}`, { time: stamp(DAY, s), id: '4769', acct: u, src: `10.20.${R.int(3, 7)}.${R.int(5, 90)}`, detail: `TGS ${R.pick(spns)} · etype 0x12 (AES256)` }));
}
const dc: TableRow[] = byKey([
  T('r1', { time: t('14:02:11'), id: '4769', acct: 'lwong', src: WS, detail: 'TGS MSSQLSvc/SRV-SQL-02.finco.local:1433 · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 lwong: RC4 ticket for MSSQLSvc/SRV-SQL-02' }),
  T('r2', { time: t('14:02:12'), id: '4769', acct: 'lwong', src: WS, detail: 'TGS MSSQLSvc/SRV-SQL-01.finco.local:1433 · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 lwong: RC4 ticket for MSSQLSvc/SRV-SQL-01' }),
  T('r3', { time: t('14:02:13'), id: '4769', acct: 'lwong', src: WS, detail: 'TGS HTTP/jira.finco.local · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 lwong: RC4 ticket for HTTP/jira' }),
  T('r4', { time: t('14:02:15'), id: '4769', acct: 'lwong', src: WS, detail: 'TGS CIFS/SRV-BKP01.finco.local · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 lwong: RC4 ticket for CIFS/SRV-BKP01' }),
  T('r5', { time: t('14:02:17'), id: '4769', acct: 'lwong', src: WS, detail: 'TGS HTTP/grafana.finco.local · etype 0x17 (RC4)' }, { role: 'key', step: 's_roast', touches: 'ws,dc', sum: '4769 lwong: RC4 ticket for HTTP/grafana' }),
  T('d_sync', { time: t('15:41:09'), id: '4662', acct: 'adm_it', src: SQL, detail: 'Operation on object: DC=finco,DC=local · Properties: DS-Replication-Get-Changes-All {1131f6ad-9c07-11d1-f79f-00c04fc2dcd2}' }, { role: 'key', step: 's_dcsync', touches: 'sql,dc', sum: '4662: DS-Replication-Get-Changes-All requested from SRV-SQL-02 (not a DC)', detail: { Note: 'Replication rights are only used by domain controllers talking to each other. 10.20.2.20 is a SQL server.' } }),
  T('d_sync2', { time: t('15:41:09'), id: '4624', acct: 'adm_it', src: SQL, detail: 'Logon type 3 · Kerberos · DRSUAPI session from non-DC' }, { role: 'key', step: 's_dcsync', touches: 'sql,dc', sum: '4624: network logon to DC01 from SRV-SQL-02' }),
  T('g_4769', { time: t('16:19:58'), id: '4769', acct: 'Administrator', src: WS, detail: 'TGS cifs/SRV-FILE-01.finco.local · etype 0x17 (RC4) · no matching 4768 for this account today' }, { role: 'key', step: 's_golden', touches: 'ws,dc', sum: '4769 Administrator with no TGT request first, RC4', detail: { Note: 'A TGS request needs a TGT, and a TGT request leaves a 4768. This account never asked for one.' } }),
  T('h_rdp', { time: t('11:05:02'), id: '4624', acct: 'adm_it', src: '10.20.1.50', detail: 'Logon type 10 (RemoteInteractive) · Kerberos · from jump host JMP-01 · CHG-20931 patch window' }, { role: 'herring', sum: 'adm_it RDP to DC01 from JMP-01', why: 'A planned patch window (change CHG-20931). The admin connects from the official jump host, interactively, with AES Kerberos. Not an attack.' }),
  T('h_bk1', { time: t('01:30:04'), id: '4769', acct: 'svc_backup', src: '10.20.9.5', detail: 'TGS cifs/SRV-FILE-01.finco.local · etype 0x12 (AES256)' }, { role: 'herring', sum: 'svc_backup requests many tickets at 01:30', why: 'The backup server requests tickets for the machines it backs up every night. They are AES, from SRV-BKP01, at the same time every day.' }),
  T('h_bk2', { time: t('01:30:05'), id: '4769', acct: 'svc_backup', src: '10.20.9.5', detail: 'TGS cifs/SRV-SQL-02.finco.local · etype 0x12 (AES256)' }, { role: 'herring', sum: 'svc_backup ticket for SRV-SQL-02', why: 'Part of the same nightly backup run: AES tickets from the backup server.' }),
  T('o1', { time: t('08:56:20'), id: '4768', acct: 'lwong', src: WS, detail: 'TGT requested · etype 0x12 (AES256) · pre-auth OK · lifetime 10h' }),
  T('o2', { time: t('11:04:51'), id: '4768', acct: 'adm_it', src: '10.20.1.50', detail: 'TGT requested · etype 0x12 (AES256) · pre-auth OK · lifetime 10h' }),
  ...dcNoise,
], 'time');

/* ---- member servers ---- */
const srv: TableRow[] = byKey([
  T('l1', { time: t('14:36:40'), host: 'SRV-FILE-01', id: '4624', acct: 'svc_backup', src: WS, detail: 'Logon type 3 · NTLM · workstation WS-MKT-007' }, { role: 'key', step: 's_lat1', touches: 'ws,file', sum: '4624 svc_backup on SRV-FILE-01 from the marketing PC', detail: { Note: 'svc_backup normally logs on from 10.20.9.5 (the backup server) using Kerberos.' } }),
  T('l1b', { time: t('14:36:41'), host: 'SRV-FILE-01', id: '4672', acct: 'svc_backup', src: WS, detail: 'Special privileges assigned: SeBackupPrivilege, SeRestorePrivilege' }, { role: 'key', step: 's_lat1', touches: 'ws,file', sum: '4672 backup privileges for svc_backup' }),
  T('x1', { time: t('15:04:22'), host: 'SRV-FILE-01', id: 'Sysmon 10', acct: 'svc_backup', src: '—', detail: 'ProcessAccess: C:\\Users\\Public\\svcupd.exe → lsass.exe · GrantedAccess 0x1fffff' }, { role: 'key', step: 's_dump', touches: 'file', sum: 'Sysmon 10: svcupd.exe opens lsass.exe with full access' }),
  T('p1', { time: t('15:17:33'), host: 'SRV-SQL-02', id: '4624', acct: 'adm_it', src: FILE, detail: 'Logon type 3 · NTLM · Key Length 0 · workstation SRV-FILE-01' }, { role: 'key', step: 's_pth', touches: 'file,sql', sum: '4624 adm_it on SRV-SQL-02 from SRV-FILE-01, NTLM, key length 0', detail: { Note: 'NTLM with Key Length 0 from a server the admin never uses is the classic look of pass-the-hash.' } }),
  T('g1', { time: t('16:22:10'), host: 'SRV-FILE-01', id: '4624', acct: 'Administrator', src: WS, detail: 'Logon type 3 · Kerberos · ticket etype 0x17 (RC4)' }, { role: 'key', step: 's_golden', touches: 'ws,file', sum: '4624 Administrator on SRV-FILE-01 using the forged ticket' }),
  T('h_s1', { time: t('02:00:12'), host: 'SRV-FILE-01', id: '4624', acct: 'svc_scan', src: '10.20.8.8', detail: 'Logon type 3 · NTLM · workstation VULNSCAN' }, { role: 'herring', sum: 'svc_scan logs onto servers at 02:00', why: 'The nightly vulnerability scanner authenticates to every server with NTLM. Same account, same source, same time, every night.' }),
  T('h_s2', { time: t('02:00:19'), host: 'SRV-SQL-02', id: '4624', acct: 'svc_scan', src: '10.20.8.8', detail: 'Logon type 3 · NTLM · workstation VULNSCAN' }, { role: 'herring', sum: 'svc_scan logon on SRV-SQL-02', why: 'The same scanner run, hitting the next server.' }),
  T('b1', { time: t('01:30:30'), host: 'SRV-FILE-01', id: '4624', acct: 'svc_backup', src: '10.20.9.5', detail: 'Logon type 3 · Kerberos · workstation SRV-BKP01' }),
  T('o1', { time: t('09:12:00'), host: 'SRV-FILE-01', id: '4624', acct: 'tpatel', src: '10.20.3.44', detail: 'Logon type 3 · Kerberos · workstation WS-FIN-044' }),
  T('o2', { time: t('10:45:10'), host: 'SRV-SQL-02', id: '4624', acct: 'svc_sql', src: '10.20.7.14', detail: 'Logon type 5 · service · MSSQLSERVER' }),
], 'time');

/* ---- ticket cache dump ---- */
const tickets: TableRow[] = [
  T('t_lwong', { client: 'lwong@FINCO.LOCAL', server: 'krbtgt/FINCO.LOCAL', etype: 'AES-256 (0x12)', start: t('08:56:20'), end: t('18:56:20'), life: '10 h', flags: 'forwardable renewable initial pre_authent' }),
  T('t_adm', { client: 'adm_it@FINCO.LOCAL', server: 'krbtgt/FINCO.LOCAL', etype: 'AES-256 (0x12)', start: t('11:04:51'), end: t('21:04:51'), life: '10 h', flags: 'forwardable renewable initial pre_authent' }),
  T('t_gold', { client: 'Administrator@FINCO.LOCAL', server: 'krbtgt/FINCO.LOCAL', etype: 'RC4 (0x17)', start: t('16:19:55'), end: '2036-04-06 16:19:55', life: '87 600 h (10 years)', flags: 'forwardable renewable initial pre_authent' }, { role: 'key', step: 's_golden', touches: 'ws,dc', sum: 'Administrator TGT: RC4, 10-year lifetime', detail: { Note: 'The domain policy allows 10 hours. Only someone holding the krbtgt key can sign a ticket with a different lifetime.' } }),
  T('t_bk', { client: 'svc_backup@FINCO.LOCAL', server: 'cifs/SRV-FILE-01.finco.local', etype: 'AES-256 (0x12)', start: t('01:30:04'), end: t('11:30:04'), life: '10 h', flags: 'forwardable renewable ok_as_delegate' }),
  T('t_ldap', { client: 'adm_it@FINCO.LOCAL', server: 'ldap/DC01.finco.local', etype: 'AES-256 (0x12)', start: t('11:05:10'), end: t('21:05:10'), life: '10 h', flags: 'forwardable renewable ok_as_delegate' }),
];

const refs = (rows: TableRow[], a: string, step: string) => rows.filter((r) => r.step === step).map((r) => `${a}:${r.id}`);

export const case4: Case = {
  id: 'golden-ticket', no: 4, kind: 'Windows & Active Directory', title: 'Golden Ticket', icon: 'log', base: 160,
  tagline: 'Someone is logged in as Administrator who never asked to be.',
  briefing: [
    'At 16:22 an alert fired: the domain Administrator account opened a file share from a marketing PC. The real administrator was in a meeting.',
    'You have the domain controller’s Security log, logs from the member servers and a dump of Kerberos tickets. Rebuild the path from the first foothold to the forged ticket.',
    'Kerberos hint: a service ticket (4769) needs a TGT, and a TGT request (4768) leaves its own event. The attacker’s tickets break these rules.',
  ],
  tools: ['logs', 'map', 'timeline'], newTools: [],
  artifacts: [
    { kind: 'table', id: 'ev-dc', label: 'DC01 security log', sub: 'Domain controller · Kerberos and directory events', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'id', label: 'ID', mono: true }, { k: 'acct', label: 'Account' }, { k: 'src', label: 'Source IP', mono: true }, { k: 'detail', label: 'Detail', w: 440 }], rows: dc, sortKey: 'time' },
    { kind: 'table', id: 'ev-srv', label: 'Member servers', sub: 'SRV-FILE-01 and SRV-SQL-02 · Security and Sysmon', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'host', label: 'Host' }, { k: 'id', label: 'ID', mono: true }, { k: 'acct', label: 'Account' }, { k: 'src', label: 'Source', mono: true }, { k: 'detail', label: 'Detail', w: 420 }], rows: srv, sortKey: 'time' },
    { kind: 'table', id: 'ev-tickets', label: 'Kerberos tickets', sub: 'klist dump · SRV-FILE-01 memory', cols: [{ k: 'client', label: 'Client' }, { k: 'server', label: 'Service' }, { k: 'etype', label: 'Encryption' }, { k: 'start', label: 'Start', mono: true }, { k: 'end', label: 'End', mono: true }, { k: 'life', label: 'Lifetime' }, { k: 'flags', label: 'Flags', w: 240 }], rows: tickets },
  ],
  hosts: [
    { id: 'ws', label: 'WS-MKT-007', ip: WS, x: 12, y: 50, kind: 'ws' },
    { id: 'file', label: 'SRV-FILE-01', ip: FILE, x: 40, y: 22, kind: 'server' },
    { id: 'sql', label: 'SRV-SQL-02', ip: SQL, x: 40, y: 78, kind: 'server' },
    { id: 'dc', label: 'DC01', ip: '10.20.0.10', x: 82, y: 50, kind: 'dc' },
  ],
  edges: [['ws', 'file'], ['file', 'sql'], ['sql', 'dc'], ['ws', 'dc']],
  questions: [
    { id: 'q1', prompt: 'Which machine was the attacker’s foothold?', options: ['WS-MKT-007 (10.20.5.7)', 'SRV-FILE-01 (10.20.2.10)', 'SRV-SQL-02 (10.20.2.20)', 'DC01 (10.20.0.10)'], answer: 0, proof: [...refs(dc, 'ev-dc', 's_roast'), 'ev-srv:l1'], need: 1, points: 20, hint: 'Which source IP appears first in the strange events?', explain: 'The first abnormal requests and the first abnormal logons all come from 10.20.5.7.' },
    { id: 'q2', prompt: 'How did the attacker get a service account password?', options: ['Kerberoasting: RC4 tickets requested then cracked offline', 'Password spraying against Outlook', 'A golden ticket', 'DCSync'], answer: 0, proof: refs(dc, 'ev-dc', 's_roast'), need: 3, points: 20, hint: 'One user asked for several service tickets in seconds, all using the weak cipher.', explain: 'Any user can request a ticket for any SPN. RC4 tickets are encrypted with the account’s password hash, so they can be cracked offline.' },
    { id: 'q3', prompt: 'Which technique pulled the krbtgt hash from the domain controller?', options: ['DCSync', 'Copying NTDS.dit from a shadow copy', 'Dumping LSASS on the DC', 'Kerberoasting'], answer: 0, proof: ['ev-dc:d_sync', 'ev-dc:d_sync2'], need: 1, points: 20, hint: 'Look at 4662 and ask whether the requester is a domain controller.', explain: 'Directory replication rights were used by a SQL server. That is DCSync, a request to the DC to “replicate” the password hashes.' },
    { id: 'q4', prompt: 'Which ticket is the forged golden ticket?', options: ['Administrator → krbtgt, RC4, 10 years', 'lwong → krbtgt, AES, 10 hours', 'svc_backup → cifs/SRV-FILE-01', 'adm_it → ldap/DC01'], answer: 0, proof: ['ev-tickets:t_gold', 'ev-dc:g_4769'], need: 1, points: 20, hint: 'Compare lifetime and encryption type with the others.', explain: 'Only someone holding the krbtgt key can sign a TGT valid for ten years with a cipher the domain no longer uses.' },
    { id: 'q5', prompt: 'What was the attacker’s path through the network?', options: ['WS-MKT-007 → SRV-FILE-01 → SRV-SQL-02 → DC01', 'WS-MKT-007 → DC01 → SRV-SQL-02 → SRV-FILE-01', 'SRV-SQL-02 → WS-MKT-007 → DC01 → SRV-FILE-01', 'WS-MKT-007 → SRV-SQL-02 → SRV-FILE-01 → DC01'], answer: 0, proof: ['ev-srv:l1', 'ev-srv:p1', 'ev-dc:d_sync2'], need: 3, points: 20, hint: 'Pin one event for each hop, in order. The network map will draw the path as you prove it.', explain: 'Cracked service account → file server → pass-the-hash to SQL → DCSync against the DC.' },
  ],
  steps: [
    { id: 's_roast', t: '14:02:11', from: 'ws', to: 'dc', title: 'Service tickets are harvested', text: 'lwong’s PC requests five service tickets in six seconds, all with weak RC4 encryption. They are cracked offline in minutes.', attack: { id: 'T1558.003', name: 'Steal or Forge Kerberos Tickets: Kerberoasting', tactic: 'Credential Access' } },
    { id: 's_lat1', t: '14:36:40', from: 'ws', to: 'file', title: 'First hop: the file server', text: 'svc_backup logs onto SRV-FILE-01 from a marketing PC with NTLM. It normally comes from the backup server.', attack: { id: 'T1021.002', name: 'Remote Services: SMB/Windows Admin Shares', tactic: 'Lateral Movement' } },
    { id: 's_dump', t: '15:04:22', from: 'file', to: 'file', title: 'Credentials are dumped', text: 'A tool in C:\\Users\\Public opens lsass.exe with full access. An IT admin’s hash is sitting in memory.', attack: { id: 'T1003.001', name: 'OS Credential Dumping: LSASS Memory', tactic: 'Credential Access' } },
    { id: 's_pth', t: '15:17:33', from: 'file', to: 'sql', title: 'Pass the hash', text: 'adm_it appears on SRV-SQL-02 from the file server. NTLM with key length 0 means no password was ever typed.', attack: { id: 'T1550.002', name: 'Use Alternate Authentication Material: Pass the Hash', tactic: 'Lateral Movement' } },
    { id: 's_dcsync', t: '15:41:09', from: 'sql', to: 'dc', title: 'DCSync', text: 'From the SQL server the attacker asks the domain controller to replicate password data, including the krbtgt hash.', attack: { id: 'T1003.006', name: 'OS Credential Dumping: DCSync', tactic: 'Credential Access' } },
    { id: 's_golden', t: '16:19:55', from: 'ws', to: 'dc', title: 'The golden ticket', text: 'A TGT for Administrator is forged offline, valid for ten years. Tickets appear without any request that created them.', attack: { id: 'T1558.001', name: 'Steal or Forge Kerberos Tickets: Golden Ticket', tactic: 'Credential Access' } },
  ],
};
