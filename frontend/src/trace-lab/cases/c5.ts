import type { Case, TableRow } from '../types';
import { rng, stamp } from '../gen';
import { T, byKey } from './util';

const R = rng(5505);
const DAY = '2026-04-22';
const t = (s: string) => `${DAY} ${s}`;
const ATK = '198.51.100.23', OFFICE = '192.0.2.10', CI = '192.0.2.44';
const KEY = 'AKIAXQ7TRACELABK04', NEWKEY = 'AKIAXQ7NEWKEYSVCCI';
const BOTO = 'Boto3/1.34.69 md/Botocore#1.34.69 ua/2.0 os/linux#6.5.0';
const CHROME = 'Mozilla/5.0 Chrome/124';

/* ---- the public repo ---- */
const repo: TableRow[] = [
  T('c1', { when: '2026-04-20 16:02:10', who: 'dana.r', msg: 'refactor checkout form', files: 'src/checkout/Form.tsx' }),
  T('c_leak', { when: t('09:12:47'), who: 'dana.r', msg: 'add deploy config for staging', files: 'deploy/.env (+3)' }, { role: 'key', step: 's_leak', touches: 'repo', sum: 'Commit 09:12 adds deploy/.env containing an AWS key', detail: { Diff: '+AWS_ACCESS_KEY_ID=AKIAXQ7TRACELABK04\n+AWS_SECRET_ACCESS_KEY=•••••••• (40 chars)\n+AWS_REGION=eu-west-1', Visibility: 'Public repository acme-web' } }),
  T('c_fix', { when: t('09:58:20'), who: 'dana.r', msg: 'remove secrets', files: 'deploy/.env (-3)' }, { role: 'key', step: 's_leak', touches: 'repo', sum: 'Commit 09:58 “remove secrets” (history still has them)', detail: { Note: 'Deleting a file does not delete it from git history. Public repos are scraped within minutes.' } }),
  T('c2', { when: t('11:30:01'), who: 'ben.s', msg: 'bump dependencies', files: 'package.json' }),
];

/* ---- CloudTrail ---- */
const evs: [string, string, string, string][] = [
  ['DescribeInstances', 'terraform-ci', CI, 'ec2'], ['GetObject', 'svc-ci', CI, 'acme-build-cache'], ['ConsoleLogin', 'ben.s', OFFICE, 'console'],
  ['PutObject', 'svc-ci', CI, 'acme-build-cache'], ['DescribeSecurityGroups', 'terraform-ci', CI, 'ec2'], ['GetParameter', 'svc-ci', CI, 'ssm'],
];
const trailNoise: TableRow[] = [];
for (let i = 0; i < 24; i++) {
  const e = R.pick(evs);
  trailNoise.push(T(`n${i}`, { time: stamp(DAY, R.int(0, 14 * 3600)), event: e[0], who: e[1], key: e[1] === 'ben.s' ? '—' : 'AKIAXQ7CIJOBKEY001', ip: e[2], agent: e[1] === 'ben.s' ? CHROME : 'Terraform/1.7.4', res: e[3], res_: 'Success' }));
}
const trail: TableRow[] = byKey([
  T('t_who', { time: t('14:03:11'), event: 'GetCallerIdentity', who: 'dana.r', key: KEY, ip: ATK, agent: BOTO, res: 'sts', res_: 'Success' }, { role: 'key', step: 's_recon', touches: 'atk,iam', sum: 'GetCallerIdentity with Dana’s key from 198.51.100.23' }),
  T('t_list', { time: t('14:03:40'), event: 'ListBuckets', who: 'dana.r', key: KEY, ip: ATK, agent: BOTO, res: 's3', res_: 'Success' }, { role: 'key', step: 's_recon', touches: 'atk,iam', sum: 'ListBuckets from 198.51.100.23' }),
  T('t_pol', { time: t('14:04:02'), event: 'GetBucketPolicy', who: 'dana.r', key: KEY, ip: ATK, agent: BOTO, res: 'acme-customer-exports', res_: 'Success' }, { role: 'key', step: 's_recon', touches: 'atk,iam,s3', sum: 'GetBucketPolicy on acme-customer-exports' }),
  T('t_ck', { time: t('14:06:30'), event: 'CreateAccessKey', who: 'dana.r', key: KEY, ip: ATK, agent: BOTO, res: 'user svc-ci', res_: 'Success' }, { role: 'key', step: 's_persist', touches: 'atk,iam', sum: 'CreateAccessKey for svc-ci using Dana’s key', detail: { Note: 'A new long-lived key on a different user means revoking Dana’s key will not end the intrusion.' } }),
  T('t_stop', { time: t('14:11:48'), event: 'StopLogging', who: 'dana.r', key: KEY, ip: ATK, agent: BOTO, res: 'trail org-trail', res_: 'Success' }, { role: 'key', step: 's_evade', touches: 'atk,ct', sum: 'StopLogging on org-trail, 14:11:48', detail: { Note: 'There are no CloudTrail events from this IP after this moment. The silence is the clue.' } }),
  T('t_start', { time: t('15:40:02'), event: 'StartLogging', who: 'ir-responder', key: 'AKIAXQ7IRRESPONDER', ip: OFFICE, agent: 'aws-cli/2.15 Linux', res: 'trail org-trail', res_: 'Success' }),
  T('h_bk', { time: t('03:00:05'), event: 'GetObject', who: 'backup-role (AWS Backup)', key: 'ASIA…assumed-role', ip: 'backup.amazonaws.com', agent: 'AWS Internal', res: 'acme-customer-exports', res_: 'Success ×18,240' }, { role: 'herring', sum: 'AWS Backup reads the whole bucket at 03:00', why: 'The managed backup service reads every object in the bucket each night. The caller is an AWS service principal, not an IP on the internet.' }),
  T('h_ci', { time: t('00:00:11'), event: 'DeleteObject', who: 'terraform-ci', key: 'AKIAXQ7CIJOBKEY001', ip: CI, agent: 'Terraform/1.7.4', res: 'acme-tmp-artifacts', res_: 'Success ×512' }, { role: 'herring', sum: 'terraform-ci deletes 512 objects at midnight', why: 'The CI pipeline cleans temporary build artifacts every midnight, from the CI runner’s fixed IP, in a bucket made for throwaway files.' }),
  T('h_login', { time: t('08:41:09'), event: 'ConsoleLogin', who: 'dana.r', key: '—', ip: OFFICE, agent: CHROME, res: 'console', res_: 'Success (MFA)' }, { role: 'herring', sum: 'Dana signs in to the console at 08:41', why: 'Dana’s normal morning login from the office IP with MFA. The attacker never used the console; they used only the leaked key.' }),
  ...trailNoise,
], 'time');

/* ---- IAM credential report ---- */
const iam: TableRow[] = [
  T('i_dana', { user: 'dana.r', key: KEY, created: '2025-11-03 10:20', last: t('14:11:12'), from: ATK, svc: 'sts, s3, iam, cloudtrail', status: 'Active' }, { role: 'key', step: 's_recon', touches: 'iam', sum: 'Dana’s key last used from 198.51.100.23' }),
  T('i_new', { user: 'svc-ci', key: NEWKEY, created: t('14:06:30'), last: t('14:13:50'), from: ATK, svc: 's3', status: 'Active' }, { role: 'key', step: 's_persist', touches: 'iam', sum: 'svc-ci key created 14:06 and used from 198.51.100.23' }),
  T('i_ci', { user: 'svc-ci', key: 'AKIAXQ7CIJOBKEY001', created: '2025-08-14 09:00', last: t('13:58:02'), from: CI, svc: 's3, ssm', status: 'Active' }),
  T('i_tf', { user: 'terraform-ci', key: 'AKIAXQ7TFKEY0000002', created: '2025-06-02 14:12', last: t('13:30:00'), from: CI, svc: 'ec2, s3', status: 'Active' }),
  T('i_ben', { user: 'ben.s', key: '—', created: '—', last: '— (console only)', from: OFFICE, svc: 'console', status: 'MFA on' }),
];

/* ---- S3 server access log ---- */
const s3: TableRow[] = byKey([
  T('s_g1', { time: t('14:07:52'), bucket: 'acme-customer-exports', who: 'dana.r', op: 'REST.GET.OBJECT', obj: 'customers_2025_q1.parquet', bytes: '6.4 GB', ip: ATK }, { role: 'key', step: 's_exfil', touches: 'atk,s3', sum: 'GET customers_2025_q1.parquet (6.4 GB) from 198.51.100.23' }),
  T('s_g2', { time: t('14:08:40'), bucket: 'acme-customer-exports', who: 'dana.r', op: 'REST.GET.OBJECT', obj: 'customers_2025_q2.parquet', bytes: '6.1 GB', ip: ATK }, { role: 'key', step: 's_exfil', touches: 'atk,s3', sum: 'GET customers_2025_q2.parquet (6.1 GB)' }),
  T('s_g3', { time: t('14:09:35'), bucket: 'acme-customer-exports', who: 'dana.r', op: 'REST.GET.OBJECT', obj: 'customers_2025_q3.parquet', bytes: '6.8 GB', ip: ATK }, { role: 'key', step: 's_exfil', touches: 'atk,s3', sum: 'GET customers_2025_q3.parquet (6.8 GB)' }),
  T('s_g4', { time: t('14:10:31'), bucket: 'acme-customer-exports', who: 'dana.r', op: 'REST.GET.OBJECT', obj: 'payment_tokens.csv', bytes: '2.2 GB', ip: ATK }, { role: 'key', step: 's_exfil', touches: 'atk,s3', sum: 'GET payment_tokens.csv (2.2 GB)' }),
  T('s_d1', { time: t('14:12:03'), bucket: 'acme-customer-exports', who: 'svc-ci', op: 'REST.POST.MULTI_OBJECT_DELETE', obj: '×1,000 objects', bytes: '—', ip: ATK }, { role: 'key', step: 's_impact', touches: 'atk,s3', sum: 'Bulk delete of 1,000 objects by svc-ci from 198.51.100.23' }),
  T('s_d2', { time: t('14:12:41'), bucket: 'acme-customer-exports', who: 'svc-ci', op: 'REST.POST.MULTI_OBJECT_DELETE', obj: '×1,000 objects', bytes: '—', ip: ATK }, { role: 'key', step: 's_impact', touches: 'atk,s3', sum: 'Bulk delete of 1,000 objects (2nd batch)' }),
  T('s_d3', { time: t('14:13:50'), bucket: 'acme-customer-exports', who: 'svc-ci', op: 'REST.POST.MULTI_OBJECT_DELETE', obj: '×240 objects', bytes: '—', ip: ATK }, { role: 'key', step: 's_impact', touches: 'atk,s3', sum: 'Bulk delete of the last 240 objects, bucket now empty' }),
  T('h_lc', { time: t('00:00:00'), bucket: 'acme-tmp-artifacts', who: 'S3 lifecycle', op: 'S3.EXPIRE.OBJECT', obj: 'build-*.tar.gz ×512', bytes: '—', ip: '—' }, { role: 'herring', sum: 'Lifecycle rule expires 512 temp objects', why: 'A lifecycle rule on the temp-artifacts bucket expires objects after 7 days. It is configuration, not a person, and the bucket is meant to be disposable.' }),
  T('o1', { time: t('13:58:02'), bucket: 'acme-build-cache', who: 'svc-ci', op: 'REST.PUT.OBJECT', obj: 'cache/node_modules.tgz', bytes: '188 MB', ip: CI }),
  T('o2', { time: t('12:10:40'), bucket: 'acme-build-cache', who: 'svc-ci', op: 'REST.GET.OBJECT', obj: 'cache/node_modules.tgz', bytes: '188 MB', ip: CI }),
], 'time');

const refs = (rows: TableRow[], a: string, step: string) => rows.filter((r) => r.step === step).map((r) => `${a}:${r.id}`);

export const case5: Case = {
  id: 'cloud-leak', no: 5, kind: 'Cloud forensics', title: 'Cloud Leak', icon: 'cloud', base: 180,
  tagline: 'The bucket is empty. The log stops in the middle of the story.',
  briefing: [
    'At 14:20 the customer-exports bucket held zero objects. Thirty-eight gigabytes of customer data are gone and the on-call engineer cannot find who did it in the audit log.',
    'You have the commit history of a public repository, the CloudTrail log, the IAM credential report and the S3 server access log. These are different sources and each one sees only part of the story.',
    'Think about what a log cannot tell you when the attacker can turn it off.',
  ],
  tools: ['logs', 'map', 'timeline'], newTools: [],
  artifacts: [
    { kind: 'table', id: 'ev-repo', label: 'Public repo', sub: 'github.com/acme/acme-web · commit history', cols: [{ k: 'when', label: 'When', mono: true }, { k: 'who', label: 'Author' }, { k: 'msg', label: 'Message', w: 260 }, { k: 'files', label: 'Files', mono: true }], rows: repo, sortKey: 'when' },
    { kind: 'table', id: 'ev-trail', label: 'CloudTrail', sub: 'org-trail · management events · eu-west-1', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'event', label: 'Event', mono: true }, { k: 'who', label: 'Principal' }, { k: 'key', label: 'Access key', mono: true }, { k: 'ip', label: 'Source IP', mono: true }, { k: 'agent', label: 'User agent', w: 260 }, { k: 'res', label: 'Resource' }, { k: 'res_', label: 'Result' }], rows: trail, sortKey: 'time' },
    { kind: 'table', id: 'ev-iam', label: 'IAM report', sub: 'Credential report · taken 15:30', cols: [{ k: 'user', label: 'User' }, { k: 'key', label: 'Access key', mono: true }, { k: 'created', label: 'Created', mono: true }, { k: 'last', label: 'Last used', mono: true }, { k: 'from', label: 'Last used from', mono: true }, { k: 'svc', label: 'Services' }, { k: 'status', label: 'Status' }], rows: iam },
    { kind: 'table', id: 'ev-s3', label: 'S3 access log', sub: 'Server access logging · all buckets', cols: [{ k: 'time', label: 'Time', mono: true }, { k: 'bucket', label: 'Bucket' }, { k: 'who', label: 'Requester' }, { k: 'op', label: 'Operation', mono: true }, { k: 'obj', label: 'Object' }, { k: 'bytes', label: 'Bytes' }, { k: 'ip', label: 'IP', mono: true }], rows: s3, sortKey: 'time' },
  ],
  hosts: [
    { id: 'repo', label: 'Public repo', ip: 'acme-web', x: 12, y: 24, kind: 'cloud' },
    { id: 'atk', label: 'Attacker', ip: ATK, x: 12, y: 76, kind: 'attacker' },
    { id: 'iam', label: 'IAM · dana.r', ip: 'AKIA…TK04', x: 48, y: 50, kind: 'cloud' },
    { id: 's3', label: 'S3 customer-exports', ip: 'eu-west-1', x: 86, y: 26, kind: 'cloud' },
    { id: 'ct', label: 'CloudTrail', ip: 'org-trail', x: 86, y: 76, kind: 'cloud' },
  ],
  edges: [['repo', 'atk'], ['atk', 'iam'], ['iam', 's3'], ['iam', 'ct']],
  questions: [
    { id: 'q1', prompt: 'Which credential was compromised?', options: ['Dana’s access key AKIAXQ7TRACELABK04', 'The CI key AKIAXQ7CIJOBKEY001', 'The AWS Backup role', 'Ben’s console password'], answer: 0, proof: ['ev-repo:c_leak', 'ev-iam:i_dana', 'ev-trail:t_who'], need: 1, points: 20, hint: 'Which key is being used from an address that is not the office or the CI runner?', explain: 'The key appeared in a public commit and minutes later it was used from 198.51.100.23.' },
    { id: 'q2', prompt: 'How did the attacker learn what was in the account?', options: ['API reconnaissance: GetCallerIdentity, ListBuckets, GetBucketPolicy', 'Brute-forcing the console', 'Phishing Dana', 'Exploiting a Lambda function'], answer: 0, proof: refs(trail, 'ev-trail', 's_recon'), need: 2, points: 20, hint: 'Look for the first few calls from the new IP: who am I, what exists, who can read it?', explain: 'Those three calls in 51 seconds are the standard “what can this key do?” routine.' },
    { id: 'q3', prompt: 'Which action let the attacker delete data without a trace in CloudTrail?', options: ['StopLogging on org-trail', 'Deleting the log bucket', 'Using another AWS region', 'Nothing: the deletes are in CloudTrail'], answer: 0, proof: ['ev-trail:t_stop'], need: 1, points: 20, hint: 'Find the last event from the attacker’s IP in the trail. What is it?', explain: 'After 14:11:48 the trail was off. The deletions only show up in the S3 access log.' },
    { id: 'q4', prompt: 'Which bucket was emptied, and with which credential?', options: ['acme-customer-exports with the new svc-ci key', 'acme-tmp-artifacts by the lifecycle rule', 'acme-customer-exports by AWS Backup', 'acme-build-cache by dana.r'], answer: 0, proof: [...refs(s3, 'ev-s3', 's_impact'), 'ev-iam:i_new'], need: 2, points: 20, hint: 'Match the requester and IP in the S3 log with the IAM report.', explain: 'Three bulk deletes came from 198.51.100.23 using the key that was created at 14:06.' },
    { id: 'q5', prompt: 'What did the attacker do to keep access if Dana’s key was revoked?', options: ['Created a second access key for svc-ci', 'Added an SSH key to an EC2 instance', 'Attached AdministratorAccess to dana.r', 'Changed the bucket policy'], answer: 0, proof: ['ev-trail:t_ck', 'ev-iam:i_new'], need: 1, points: 20, hint: 'Look for a write call early in the attacker’s session that does not touch S3.', explain: 'CreateAccessKey gave them a second credential on a different user. Rotating Dana’s key alone would not have stopped them.' },
  ],
  steps: [
    { id: 's_leak', t: '09:12:47', from: 'repo', to: 'atk', title: 'The key is committed to a public repo', text: 'A deploy .env is pushed. The “remove secrets” commit comes 46 minutes later, but git history keeps everything and scrapers watch public pushes.', attack: { id: 'T1552.001', name: 'Unsecured Credentials: Credentials In Files', tactic: 'Credential Access' } },
    { id: 's_recon', t: '14:03:11', from: 'atk', to: 'iam', title: 'Who am I? What exists?', text: 'GetCallerIdentity, ListBuckets, GetBucketPolicy: three calls with a boto3 user agent from a VPS address.', attack: { id: 'T1580', name: 'Cloud Infrastructure Discovery', tactic: 'Discovery' } },
    { id: 's_persist', t: '14:06:30', from: 'atk', to: 'iam', title: 'A spare key', text: 'A new access key is created on svc-ci, so the attacker survives if Dana’s key is revoked.', attack: { id: 'T1098.001', name: 'Account Manipulation: Additional Cloud Credentials', tactic: 'Persistence' } },
    { id: 's_exfil', t: '14:07:52', from: 's3', to: 'atk', title: 'The data is downloaded', text: 'Four large GETs pull about 21 GB of customer files and a token export.', attack: { id: 'T1530', name: 'Data from Cloud Storage', tactic: 'Collection' } },
    { id: 's_evade', t: '14:11:48', from: 'iam', to: 'ct', title: 'The lights go out', text: 'StopLogging on the organisation trail. Anything after this moment is invisible to CloudTrail.', attack: { id: 'T1562.008', name: 'Impair Defenses: Disable or Modify Cloud Logs', tactic: 'Defense Evasion' } },
    { id: 's_impact', t: '14:12:03', from: 'atk', to: 's3', title: 'The bucket is emptied', text: 'Three bulk-delete requests remove every object. Only the S3 access log recorded it.', attack: { id: 'T1485', name: 'Data Destruction', tactic: 'Impact' } },
  ],
};
