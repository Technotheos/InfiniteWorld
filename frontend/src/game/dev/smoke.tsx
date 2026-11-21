// Server-render every preview scenario and check its key content. Run:  npx vite-node src/game/dev/smoke.tsx
import { renderToString } from "react-dom/server";
import { GameView } from "../GameView";
import { SAMPLE_CHAT, SCENARIOS } from "./fixtures";

const expect: Record<string, RegExp> = {
  "lobby (arena)": /Ready \(tap to undo\)[\s\S]*Start now/,
  "countdown": /Get ready/,
  "briefing": /Mission 1 of 3/,
  "reaction: wait": /Wait for green/,
  "reaction: GO": /CLICK!/,
  "reaction: between": /false start/,
  "math sprint": /7 × 8 \+ 12/,
  "typing race": /Passage to type/,
  "reveal": /What you just learned/,
  "cipher lab": /MPYLDHSS[\s\S]*Hint:/,
  "cipher: between": /Answer: <b>payload/,
  "social spark (coop)": /small thing that always improves/,
  "final (versus)": /neo wins!/,
  "final (coop)": /Mission complete/,
  "bazaar: fib (ask)": /Spot the fib[\s\S]*Lock in my bet/,
  "bazaar: estimate (between)": /Mount Everest[\s\S]*Wacky Penalty for morpheus/,
  "bazaar: chain": /missing[\s\S]*Hash the salted password/,
  "mystery: intro": /Door opened during[\s\S]*SECRET ROLE/,
  "mystery: alibi": /Testimony board[\s\S]*private errand/,
  "mystery: investigate": /Security cameras[\s\S]*Anonymous tip/,
  "mystery: vote": /Who did it\?/,
  "mystery: unmask": /morpheus is caught![\s\S]*Where everyone really was/,
  "relic: show": /Behold[\s\S]*The Weeping Idol[\s\S]*Voice &amp; camera/,
  "relic: bury": /The burial[\s\S]*Drowned Chapel/,
  "relic: hunt (cold)": /Buried near[\s\S]*Drowned Chapel[\s\S]*Cold/,
  "relic: hunt (burning)": /Burning[\s\S]*Dig \(Space\)/,
  "relic: wail": /THE CURSE IS LYING[\s\S]*Readings scrambled/,
  "relic: found": /trinity<\/b> unearthed The Weeping Idol/,
};

let failed = 0;
for (const [name, make] of Object.entries(SCENARIOS)) {
  try {
    const html = renderToString(
      <GameView state={make()} chat={SAMPLE_CHAT} status="open" skew={0} send={() => undefined} onLeave={() => undefined} />,
    );
    const text = html.replace(/<!-- -->/g, ""); // React splits adjacent text nodes with comments
    const ok = expect[name]?.test(text) ?? false;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(22)} ${html.length} bytes`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`ERROR ${name}: ${(e as Error).message}`);
    failed++;
  }
}
if (failed) throw new Error(`${failed} scenario(s) failed`);
