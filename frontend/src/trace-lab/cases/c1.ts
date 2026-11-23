import type { Case, DiskRow, TableRow } from '../types';
import { rng, stamp } from '../gen';
import { D, T, byKey, KB, MB, GB } from './util';

const R = rng(1101);
const DAY = '2026-03-04';
const t = (hms: string) => `${DAY} ${hms}`;

/* ---- disk: background files, then the ones that matter ---- */
const docs = ['Budget_FY26_draft.xlsx', 'Vendor_Contacts.xlsx', 'AP_Aging_Jan.xlsx', 'Board_Pack_Q4.pptx', 'Expense_Policy.pdf', 'Month_End_Checklist.docx', 'Audit_Notes_2025.docx', 'Rates_Table.csv', 'Treasury_Summary.xlsx', 'Intercompany_Recon.xlsx'];
const noiseDisk: DiskRow[] = docs.map((d, i) => {
  const c = stamp('2025-10-01', R.int(0, 120) * 86400 + R.int(28800, 64800));
  const m = stamp('2026-01-05', R.int(0, 40) * 86400 + R.int(28800, 64800));
  return D(`n${i}`, `C:\\Users\\mkessler\\Documents\\Finance\\${d}`, R.int(80, 3000) * KB, m, m, c, c);
});
noiseDisk.push(
  D('n10', 'C:\\Users\\mkessler\\AppData\\Local\\Temp\\~DF3A1.tmp', 4 * KB, '2026-03-04 09:12:00', '2026-03-04 09:12:00', '2026-03-04 09:12:00', '2026-03-04 09:12:00'),
  D('n11', 'C:\\Users\\mkessler\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\Finance.lnk', 1 * KB, '2026-03-04 08:55:10', '2026-03-04 08:55:10', '2025-10-14 10:02:00', '2025-10-14 10:02:00'),
  D('n12', 'C:\\Users\\mkessler\\Downloads\\Teams_windows_x64.msi', 118 * MB, '2026-01-22 11:30:00', '2026-01-22 11:31:12', '2026-01-22 11:30:00', '2026-01-22 11:30:00'),
  D('n13', 'C:\\Users\\mkessler\\Desktop\\Lunch_menu.pdf', 220 * KB, '2026-02-10 12:04:00', '2026-02-10 12:04:00', '2026-02-10 12:04:00', '2026-02-10 12:04:00'),
  D('n14', 'C:\\Users\\mkessler\\NTUSER.DAT', 18 * MB, '2026-03-04 22:59:40', '2026-03-04 22:59:40', '2025-10-01 08:00:00', '2025-10-01 08:00:00'),
);

const disk: DiskRow[] = [
  D('d_forecast', 'C:\\Users\\mkessler\\Documents\\Finance\\Q4_Forecast_FY26.xlsx', 2450 * KB, '2026-02-27 16:20:11', t('22:43:12'), '2025-11-03 09:15:00', '2025-11-03 09:15:00', 'live', { role: 'key', step: 's_collect', touches: 'ws', sum: 'Q4_Forecast opened 22:43 (atime)' }),
  D('d_clients', 'C:\\Users\\mkessler\\Documents\\Finance\\ClientList_FY26.xlsx', 1180 * KB, '2026-02-18 10:02:44', t('22:43:40'), '2025-11-03 09:15:00', '2025-11-03 09:15:00', 'live', { role: 'key', step: 's_collect', touches: 'ws', sum: 'ClientList_FY26 read 22:43' }),
  D('d_payroll', 'C:\\Users\\mkessler\\Documents\\Finance\\Payroll_Export_Feb.csv', 640 * KB, '2026-03-01 07:00:03', t('22:44:05'), '2026-03-01 07:00:03', '2026-03-01 07:00:03', 'live', { role: 'key', step: 's_collect', touches: 'ws', sum: 'Payroll_Export_Feb read 22:44' }),
  D('d_zip', 'C:\\Users\\mkessler\\AppData\\Local\\Temp\\arch_0304.zip', 41 * MB, t('22:47:48'), t('22:47:48'), t('22:46:33'), t('22:46:33'), 'deleted', { role: 'key', step: 's_stage', touches: 'ws', sum: 'Deleted arch_0304.zip (41 MB) in Temp', detail: { Note: 'MFT record is flagged not-in-use; clusters not yet overwritten' } }),
  D('d_rb', 'C:\\$Recycle.Bin\\S-1-5-21-3841-1104\\$R7N3QZ.zip', 41 * MB, t('22:47:48'), t('22:57:03'), t('22:57:03'), t('22:57:03'), 'deleted', { role: 'key', step: 's_clean', touches: 'ws', sum: 'Recycle Bin $R7N3QZ.zip, deleted 22:57', detail: { '$I original path': 'C:\\Users\\mkessler\\AppData\\Local\\Temp\\arch_0304.zip', 'Deleted at': t('22:57:03') } }),
  D('d_usb_clients', 'E:\\ClientList_FY26.xlsx', 1180 * KB, '2026-02-18 10:02:44', t('22:51:02'), t('22:51:02'), t('22:51:02'), 'live', { role: 'key', step: 's_copy', touches: 'usb', sum: 'E:\\ClientList_FY26.xlsx created on USB 22:51', detail: { Volume: 'KINGSTON (E:) serial 0019E06B4C7DF2A1' } }),
  D('d_usb_payroll', 'E:\\Payroll_Export_Feb.csv', 640 * KB, '2026-03-01 07:00:03', t('22:51:29'), t('22:51:29'), t('22:51:29'), 'live', { role: 'key', step: 's_copy', touches: 'usb', sum: 'E:\\Payroll_Export_Feb.csv created on USB 22:51', detail: { Volume: 'KINGSTON (E:) serial 0019E06B4C7DF2A1' } }),
  D('d_notes', 'C:\\Users\\mkessler\\Desktop\\notes.txt', 311, '2019-06-12 09:00:00', '2019-06-12 09:00:00', '2019-06-12 09:00:00', t('22:56:41'), 'live', { role: 'key', step: 's_clean', touches: 'ws', sum: 'notes.txt: $SI created 2019, $FN created 22:56 today', detail: { Hint: '$STANDARD_INFORMATION can be edited by user-mode tools. $FILE_NAME is written by the kernel.' } }),
  D('h_resume', 'C:\\Users\\mkessler\\Documents\\Personal\\resume_2026.docx', 96 * KB, '2026-03-03 21:10:19', '2026-03-03 21:10:19', '2026-02-26 20:44:00', '2026-02-26 20:44:00', 'live', { role: 'herring', sum: 'resume_2026.docx edited Mar 3', why: 'A résumé written on his own time. It holds no company data and was never copied anywhere. Looking for a new job is not the same as stealing.' }),
  D('h_backup', 'C:\\ProgramData\\BackupAgent\\staging\\fin_share_20260304.bak', 8700 * MB, t('02:00:44'), t('02:00:44'), t('02:00:11'), t('02:00:11'), 'live', { role: 'herring', sum: 'Backup image, 8.7 GB, 02:00', why: 'The backup agent writes a file of about this size every night at 02:00. Same account, same size, same folder, every day of the month.' }),
  D('h_thumb', 'C:\\Users\\mkessler\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_idx.db', 24 * KB, '2026-03-04 17:40:02', '2026-03-04 17:40:02', '2025-10-01 08:03:00', '2025-10-01 08:03:00', 'hidden', { role: 'herring', sum: 'thumbcache_idx.db (hidden)', why: 'Windows marks its own thumbnail cache hidden. A hidden attribute alone proves nothing.' }),
  ...noiseDisk,
];

/* ---- USB history ---- */
const usbRows: TableRow[] = [
  T('u_king', { dev: 'Kingston DataTraveler 3.0', serial: '0019E06B4C7DF2A1', first: t('22:41:07'), last: t('22:58:19'), cls: 'Disk' }, { role: 'key', step: 's_usb', touches: 'usb', sum: 'Kingston DT 3.0 …F2A1: first seen 22:41', detail: { Key: 'HKLM\\SYSTEM\\CurrentControlSet\\Enum\\USBSTOR\\Disk&Ven_Kingston&Prod_DataTraveler_3.0', 'Drive letter': 'E:', 'Volume label': 'KINGSTON' } }),
  T('u_sandisk', { dev: 'SanDisk Cruzer Blade', serial: '4C530001220519112084', first: '2025-09-10 08:12:44', last: '2026-03-02 17:30:05', cls: 'Disk' }, { role: 'herring', sum: 'SanDisk Cruzer, used weekly', why: 'IT hands out this model for firmware tokens. It appears about once a week since September and was last used two days before the incident.' }),
  T('u_logi', { dev: 'Logitech USB Receiver', serial: 'N/A', first: '2025-10-01 08:21:10', last: '2026-03-04 17:55:00', cls: 'HID' }, { role: 'herring', sum: 'Logitech receiver (HID)', why: 'A keyboard and mouse receiver. It is a human interface device, not storage, and it is plugged in all day.' }),
  T('u_seagate', { dev: 'Seagate Backup Plus', serial: 'NA9XJ4R2', first: '2024-11-02 19:02:11', last: '2025-12-18 20:15:40', cls: 'Disk' }, {}),
  T('u_phone', { dev: 'Apple iPhone (MTP)', serial: '00008110-0012', first: '2025-11-20 12:30:00', last: '2026-01-09 08:10:22', cls: 'PTP' }, {}),
];

/* ---- event log ---- */
const evNoise: TableRow[] = [];
const msgs: [string, string, string, string][] = [
  ['4624', 'Security', 'mkessler', 'An account was successfully logged on (Type 2, interactive)'],
  ['1000', 'Application', 'SYSTEM', 'Windows Defender scheduled quick scan completed, no threats'],
  ['19', 'WindowsUpdateClient', 'SYSTEM', 'Installation successful: 2026-02 Cumulative Update'],
  ['4688', 'Security', 'mkessler', 'New process: C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE'],
  ['4688', 'Security', 'mkessler', 'New process: C:\\Windows\\explorer.exe'],
  ['7036', 'Service Control Manager', 'SYSTEM', 'The Print Spooler service entered the running state'],
];
for (let i = 0; i < 16; i++) {
  const m = R.pick(msgs);
  const day = i < 9 ? '2026-03-04' : '2026-03-03';
  const s = i < 9 ? R.int(28000, 61000) : R.int(30000, 62000);
  evNoise.push(T(`n${i}`, { time: stamp(day, s), id: m[0], src: m[1], acct: m[2], msg: m[3] }));
}
const events: TableRow[] = byKey([
  T('e_pnp', { time: t('22:41:07'), id: '2003', src: 'Kernel-PnP', acct: 'SYSTEM', msg: 'Device USB\\VID_0951&PID_1666\\0019E06B4C7DF2A1 was configured (Kingston DataTraveler 3.0)' }, { role: 'key', step: 's_usb', touches: 'usb', sum: 'Kernel-PnP: Kingston USB configured 22:41' }),
  T('e_7z', { time: t('22:46:31'), id: '4688', src: 'Security', acct: 'mkessler', msg: '7z.exe a -tzip -p**** C:\\Users\\mkessler\\AppData\\Local\\Temp\\arch_0304.zip C:\\Users\\mkessler\\Documents\\Finance\\*' }, { role: 'key', step: 's_stage', touches: 'ws', sum: '7z archives the Finance folder, 22:46' }),
  T('e_copy', { time: t('22:51:02'), id: '4688', src: 'Security', acct: 'mkessler', msg: 'robocopy.exe C:\\Users\\mkessler\\Documents\\Finance E:\\ ClientList_FY26.xlsx Payroll_Export_Feb.csv /NJH' }, { role: 'key', step: 's_copy', touches: 'usb', sum: 'robocopy of 2 files to E: at 22:51' }),
  T('e_del', { time: t('22:57:03'), id: '4660', src: 'Security', acct: 'mkessler', msg: 'An object was deleted: C:\\Users\\mkessler\\AppData\\Local\\Temp\\arch_0304.zip' }, { role: 'key', step: 's_clean', touches: 'ws', sum: 'arch_0304.zip deleted 22:57' }),
  T('e_stomp', { time: t('22:56:41'), id: '2', src: 'Sysmon', acct: 'mkessler', msg: 'File creation time changed: powershell.exe  C:\\Users\\mkessler\\Desktop\\notes.txt  Previous 2026-03-04 22:56:39 → New 2019-06-12 09:00:00' }, { role: 'key', step: 's_clean', touches: 'ws', sum: 'Sysmon 2: creation time of notes.txt rewritten' }),
  T('h_bk', { time: t('02:00:03'), id: '4688', src: 'Security', acct: 'svc_backup', msg: 'robocopy.exe D:\\FinShare C:\\ProgramData\\BackupAgent\\staging /MIR /R:1' }, { role: 'herring', sum: 'svc_backup robocopy at 02:00', why: 'The nightly backup job. It runs as the service account, at 02:00, and copies the same share every night. It has nothing to do with a USB stick.' }),
  T('h_ps', { time: t('10:14:20'), id: '4104', src: 'PowerShell', acct: 'adm_it', msg: 'Get-ChildItem -Recurse C:\\Users | Measure-Object Length -Sum  # inventory.ps1' }, { role: 'herring', sum: 'adm_it inventory script 10:14', why: 'The IT inventory script that runs on every laptop each week. It sizes folders; it does not copy anything.' }),
  ...evNoise,
], 'time');

/* ---- web proxy ---- */
const proxy: TableRow[] = byKey([
  T('p_block', { time: t('22:49:14'), user: 'mkessler', action: 'DENIED', method: 'POST', url: 'https://drop.megastore-share.example/upload', bytes: '41,214,973', cat: 'Personal storage' }, { role: 'key', step: 's_cloud', touches: 'cloud', sum: 'Proxy blocked a 41 MB POST to personal storage' }),
  T('p1', { time: t('09:03:10'), user: 'mkessler', action: 'ALLOWED', method: 'GET', url: 'https://outlook.office.com/mail/', bytes: '412,880', cat: 'Business' }),
  T('p2', { time: t('12:31:55'), user: 'mkessler', action: 'ALLOWED', method: 'GET', url: 'https://www.linkedin.com/jobs/', bytes: '902,114', cat: 'Social / jobs' }, { role: 'herring', sum: 'Browsing job listings at lunch', why: 'He was looking at job postings in his lunch break. Allowed by policy, small download, nothing leaves the network.' }),
  T('p3', { time: t('15:20:02'), user: 'mkessler', action: 'ALLOWED', method: 'GET', url: 'https://sso.finco.example/login', bytes: '58,901', cat: 'Business' }),
  T('p4', { time: t('17:45:30'), user: 'mkessler', action: 'ALLOWED', method: 'GET', url: 'https://windowsupdate.microsoft.com/', bytes: '2,411,000', cat: 'Updates' }),
], 'time');

export const case1: Case = {
  id: 'quiet-employee', no: 1, kind: 'Disk forensics', title: 'The Quiet Employee', icon: 'disk', base: 100,
  tagline: 'He resigned on Friday. The files left on Wednesday night.',
  briefing: [
    'Marcus Kessler, a finance analyst, handed in his notice on 6 March. HR noticed that the client list and a payroll export were opened very late on 4 March.',
    'You have his laptop image (file timestamps), the USB history from the registry, the event log and the web proxy log. Find what left the building, how, and what he tried to hide.',
    'Tip: deleted files and hidden entries stay invisible until you sweep the drive with the UV scanner.',
  ],
  tools: ['logs', 'disk', 'map', 'timeline'], newTools: ['logs', 'disk', 'map', 'timeline'],
  artifacts: [
    { kind: 'disk', id: 'ev-disk', label: 'Laptop image', sub: 'NTFS file listing · C:\\Users\\mkessler and E:\\', rows: disk },
    { kind: 'table', id: 'ev-usb', label: 'USB history', sub: 'SYSTEM hive · USBSTOR', cols: [{ k: 'dev', label: 'Device' }, { k: 'serial', label: 'Serial', mono: true }, { k: 'first', label: 'First connected', mono: true }, { k: 'last', label: 'Last connected', mono: true }, { k: 'cls', label: 'Class' }], rows: usbRows, sortKey: 'first' },
    { kind: 'table', id: 'ev-events', label: 'Event log', sub: 'WS-FIN-022 · Security, Sysmon, System', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'id', label: 'ID', mono: true }, { k: 'src', label: 'Source' }, { k: 'acct', label: 'Account' }, { k: 'msg', label: 'Message', w: 460 }], rows: events, sortKey: 'time' },
    { kind: 'table', id: 'ev-proxy', label: 'Web proxy', sub: 'Gateway log · user mkessler', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'user', label: 'User' }, { k: 'action', label: 'Action' }, { k: 'method', label: 'Method' }, { k: 'url', label: 'URL', w: 300 }, { k: 'bytes', label: 'Bytes', mono: true }, { k: 'cat', label: 'Category' }], rows: proxy, sortKey: 'time' },
  ],
  hosts: [
    { id: 'ws', label: 'WS-FIN-022', ip: '10.20.3.22', x: 26, y: 55, kind: 'ws' },
    { id: 'usb', label: 'Kingston USB', ip: 'E:', x: 74, y: 28, kind: 'usb' },
    { id: 'cloud', label: 'Personal cloud', ip: 'megastore-share', x: 74, y: 82, kind: 'cloud' },
  ],
  edges: [['ws', 'usb'], ['ws', 'cloud']],
  questions: [
    { id: 'q1', prompt: 'Which removable device carried the data out?', options: ['Kingston DataTraveler 3.0', 'SanDisk Cruzer Blade', 'Logitech USB Receiver', 'Seagate Backup Plus'], answer: 0, proof: ['ev-usb:u_king', 'ev-events:e_pnp', 'ev-disk:d_usb_clients', 'ev-disk:d_usb_payroll'], need: 1, points: 20, hint: 'Look for a device whose first connection time matches the late-night activity.', explain: 'The Kingston stick was plugged in for the first time at 22:41 and the files appear on a volume with its serial number.' },
    { id: 'q2', prompt: 'When did the copying happen?', options: ['02:00 every night', '4 March, between 22:41 and 22:58', '6 March at 09:10, his last day', '2 March, mid-afternoon'], answer: 1, proof: ['ev-usb:u_king', 'ev-events:e_pnp', 'ev-events:e_copy', 'ev-disk:d_usb_clients'], need: 2, points: 20, hint: 'You need two timestamps that agree with each other, from different sources.', explain: 'The registry, the Plug and Play log and the robocopy event all point to the same 17-minute window.' },
    { id: 'q3', prompt: 'Which staging file was created and then deleted to cover his tracks?', options: ['fin_share_20260304.bak in BackupAgent', 'arch_0304.zip in his Temp folder', 'resume_2026.docx in Personal', 'thumbcache_idx.db'], answer: 1, proof: ['ev-disk:d_zip', 'ev-disk:d_rb', 'ev-events:e_7z', 'ev-events:e_del'], need: 1, points: 20, hint: 'Deleted entries only show on the disk after the UV sweep. The Recycle Bin remembers the original path.', explain: 'He zipped the Finance folder to Temp at 22:46 and deleted the archive at 22:57. The MFT still remembers it.' },
    { id: 'q4', prompt: 'What data was stolen?', options: ['The client list and the February payroll export', 'Only the Q4 forecast', 'The nightly backup image', 'His personal résumé'], answer: 0, proof: ['ev-disk:d_usb_clients', 'ev-disk:d_usb_payroll', 'ev-events:e_copy'], need: 2, points: 20, hint: 'What exists on E: that did not exist an hour earlier?', explain: 'Those two files were created on the USB volume at 22:51, and robocopy names them explicitly.' },
    { id: 'q5', prompt: 'Which file had its creation time forged (timestomped)?', options: ['notes.txt on the Desktop', 'resume_2026.docx', 'Q4_Forecast_FY26.xlsx', 'arch_0304.zip'], answer: 0, proof: ['ev-disk:d_notes', 'ev-events:e_stomp'], need: 1, points: 20, hint: 'Compare the two creation times: one can be edited by a script, the other cannot.', explain: '$STANDARD_INFORMATION says 2019, but $FILE_NAME says today. The kernel wrote the real value.' },
  ],
  steps: [
    { id: 's_usb', t: '22:41:07', from: 'ws', to: 'usb', title: 'A USB stick is plugged in', text: 'A Kingston DataTraveler appears for the very first time. It is the carrier for everything that follows.', attack: { id: 'T1052.001', name: 'Exfiltration Over Physical Medium: USB', tactic: 'Exfiltration' } },
    { id: 's_collect', t: '22:43:12', from: 'ws', to: 'ws', title: 'Finance files are opened', text: 'The forecast, the client list and the payroll export are read within three minutes of each other.', attack: { id: 'T1005', name: 'Data from Local System', tactic: 'Collection' } },
    { id: 's_stage', t: '22:46:31', from: 'ws', to: 'ws', title: 'Everything is zipped', text: '7-Zip packs the Finance folder into arch_0304.zip in Temp, 41 MB with a password.', attack: { id: 'T1560.001', name: 'Archive Collected Data: Archive via Utility', tactic: 'Collection' } },
    { id: 's_cloud', t: '22:49:14', from: 'ws', to: 'cloud', title: 'Upload to personal cloud is blocked', text: 'He tries the easy way first. The proxy denies the 41 MB POST to a personal storage site.', attack: { id: 'T1567.002', name: 'Exfiltration to Cloud Storage', tactic: 'Exfiltration' } },
    { id: 's_copy', t: '22:51:02', from: 'ws', to: 'usb', title: 'Plan B: copy to the stick', text: 'robocopy puts the client list and payroll export on E:. This is the actual theft.', attack: { id: 'T1052.001', name: 'Exfiltration Over Physical Medium: USB', tactic: 'Exfiltration' } },
    { id: 's_clean', t: '22:56:41', from: 'ws', to: 'ws', title: 'Tracks are covered', text: 'He forges the creation time of a notes file, then deletes the archive. Both leave traces the kernel keeps.', attack: { id: 'T1070.006', name: 'Indicator Removal: Timestomp', tactic: 'Defense Evasion' } },
  ],
};
