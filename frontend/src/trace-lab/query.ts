/** A tiny query language for the workbench: `word`, `"a phrase"`, `field:value`, `-word`, `-field:value`. All case-insensitive, all terms AND-ed. */
export interface Term { neg: boolean; field?: string; text: string }

export function parseQuery(q: string): Term[] {
  const out: Term[] = [];
  const re = /(-?)(?:([A-Za-z_]+):)?(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const text = (m[3] ?? m[4] ?? '').toLowerCase();
    if (text) out.push({ neg: m[1] === '-', field: m[2]?.toLowerCase(), text });
  }
  return out;
}

export function matches(terms: Term[], fields: Record<string, string>): boolean {
  if (!terms.length) return true;
  const all = Object.values(fields).join('\u0001').toLowerCase();
  return terms.every((t) => {
    let hit: boolean;
    if (t.field) {
      const key = Object.keys(fields).find((k) => k.toLowerCase() === t.field);
      hit = key ? (fields[key] ?? '').toLowerCase().includes(t.text) : false;
    } else hit = all.includes(t.text);
    return t.neg ? !hit : hit;
  });
}
