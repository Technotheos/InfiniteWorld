// Fails the build if code appears that would reopen an XSS or token-theft hole.
// Run: node scripts/security-check.mjs   (CI runs it on every push)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML renders raw HTML; render text and let React escape it'],
  [/\.(innerHTML|outerHTML)\s*=/, 'assigning innerHTML/outerHTML injects raw HTML'],
  [/insertAdjacentHTML\s*\(/, 'insertAdjacentHTML injects raw HTML'],
  [/document\.write\s*\(/, 'document.write injects raw HTML'],
  [/\beval\s*\(/, 'eval runs strings as code'],
  [/new\s+Function\s*\(/, 'new Function runs strings as code'],
  [/set(Item)?\s*\(\s*['"`](jwt_token|token|access_token|refresh_token)['"`]/, 'tokens must stay in memory (see src/session.ts), never in web storage'],
  [/localStorage\.(get|set)Item\(\s*['"`](jwt_token|jwt_expires_at)['"`]/, 'the old localStorage token keys must not come back'],
  [/[?&]token=\$\{/, 'tokens must not be put in URLs: use the WebSocket subprotocol'],
  [/console\.(log|info|debug)\([^)]*\b(token|password)\b/i, 'do not log tokens or passwords'],
];

const bad = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/security-check:ignore/.test(line)) return;
      for (const [re, why] of RULES) if (re.test(line)) bad.push(`${p}:${i + 1}  ${why}\n      ${line.trim()}`);
    });
  }
})('src');

if (bad.length) {
  console.error(`\nsecurity-check failed (${bad.length}):\n\n` + bad.join('\n') + '\n');
  process.exit(1);
}
console.log('security-check: ok');
