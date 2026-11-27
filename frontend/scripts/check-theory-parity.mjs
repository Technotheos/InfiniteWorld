// The server (backend-go/studio_notes.go) and the client (src/studio/theory.ts) each carry the allowlists for
// scales, instruments and delay divisions. If they drift apart, the client offers choices the server refuses.
// This compares them.   Run:  node --experimental-strip-types scripts/check-theory-parity.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../src/studio/theory.ts';

const go = readFileSync(new URL('../../backend-go/studio_notes.go', import.meta.url), 'utf8');
const block = (name) => {
  const m = go.match(new RegExp(`var ${name} = [^{]*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `could not find ${name} in studio_notes.go`);
  return m[1];
};

// scales: "name": {0, 2, ...},
const scales = {};
for (const m of block('studioScales').matchAll(/"(\w+)":\s*\{([\d,\s]+)\}/g)) scales[m[1]] = m[2].split(',').map((x) => Number(x.trim()));
assert.deepEqual(Object.keys(scales).sort(), T.SCALE_IDS.slice().sort(), 'scale ids differ between Go and TS');
for (const id of T.SCALE_IDS) assert.deepEqual(scales[id], T.SCALES[id].steps, `scale ${id} differs`);

// instruments
const instr = [...block('studioInstruments').matchAll(/"(\w+)":\s*true/g)].map((m) => m[1]).sort();
assert.deepEqual(instr, T.INSTRUMENTS.map((i) => i.id).sort(), 'instrument ids differ between Go and TS');

// delay divisions
const divs = [...go.matchAll(/studioDelayDivs = map\[string\]bool\{([^}]*)\}/g)][0][1];
const goDivs = [...divs.matchAll(/"([^"]+)":\s*true/g)].map((m) => m[1]).sort();
assert.deepEqual(goDivs, T.DELAY_DIVS.map((d) => d.id).sort(), 'delay divisions differ between Go and TS');

// limits
const num = (name) => Number(go.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))[1]);
assert.equal(num('studioMinPitch'), T.PITCH_MIN);
assert.equal(num('studioMaxPitch'), T.PITCH_MAX);
assert.equal(num('studioMaxBars'), T.MAX_BARS);
assert.equal(num('studioMaxNotes'), T.MAX_NOTES);
assert.equal(num('studioMaxNoteBatch'), T.MAX_BATCH);

console.log(`parity ok: ${T.SCALE_IDS.length} scales, ${instr.length} instruments, ${goDivs.length} delay divisions, limits`);
