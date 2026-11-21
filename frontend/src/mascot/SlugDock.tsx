import { type CSSProperties } from "react";
import { PackageOpen, ArrowUpRight } from "lucide-react";
import "./basket.css";
import { CHARS, ORDER, type CharId } from "./characters";
import { useMascot } from "./Mascot";
import { SPOT } from "./SlugBasket";
import { useState } from "react";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]";

// Same shape as the full glass basket, so the slugs stand in the same spots.
const GLASS = "M56 64C50 170 70 250 120 272L360 272C410 250 430 170 424 64Z";

/** A quiet version of the old glass basket: a thin outline, a soft floor glow, no handle and no gems. */
function JarBack() {
  return (
    <svg className="sb-layer sb-back" viewBox="0 0 480 300" aria-hidden="true">
      <defs>
        <linearGradient id="sj-in" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fdcff" stopOpacity=".03" /><stop offset="1" stopColor="#7a5cff" stopOpacity=".16" />
        </linearGradient>
        <radialGradient id="sj-floor"><stop offset="0" stopColor="#8ff6ff" stopOpacity=".32" /><stop offset="1" stopColor="#8ff6ff" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="240" cy="286" rx="180" ry="8" fill="#000" opacity=".35" />
      <path d={GLASS} fill="url(#sj-in)" />
      <ellipse cx="240" cy="266" rx="120" ry="14" fill="url(#sj-floor)" />
      <path d="M56 64A184 22 0 0 1 424 64" fill="none" stroke="#bfeaff" strokeOpacity=".22" strokeWidth="2" />
    </svg>
  );
}
function JarFront() {
  return (
    <svg className="sb-layer sb-front" viewBox="0 0 480 300" aria-hidden="true">
      <path d={GLASS} fill="none" stroke="#bfeaff" strokeOpacity=".4" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M56 64A184 22 0 0 0 424 64" fill="none" stroke="#bfeaff" strokeOpacity=".45" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M104 279H376" stroke="#bfeaff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
      <path d="M96 110C92 160 100 205 122 238" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The slug basket, kept minimal.
 *  - "rail":   lives in the left sidebar on laptops, no card around it.
 *  - "inline": a slim row in the page on phones.
 * Only ever render ONE of them at a time: the glass art uses fixed SVG ids.
 */
export function SlugDock({ layout }: { layout: "rail" | "inline" }) {
  const m = useMascot();
  const [hover, setHover] = useState<CharId | null>(null);
  const inCount = ORDER.length - m.out.length;

  const toggle = (id: CharId, el: HTMLElement) => {
    if (m.out.includes(id)) { m.collect(id); return; }
    const r = el.getBoundingClientRect();
    m.release(id, r.left + r.width / 2 - 48);
  };

  const stage = (
    <div className="sb-stage" style={{ maxWidth: layout === "rail" ? 168 : 96 }}>
      <JarBack />
      {ORDER.map((id) => {
        const c = CHARS[id];
        const isOut = m.out.includes(id);
        const Art = c.Art;
        return (
          <button key={id} type="button" className="sb-slug"
            style={{ left: `${SPOT[id] - 12.5}%`, ["--ga"]: c.glowA } as CSSProperties}
            onClick={(e) => toggle(id, e.currentTarget)}
            onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}
            aria-label={isOut ? `Call ${c.name} back into the basket` : `Let ${c.name} out of the basket`}>
            <div key={isOut ? "out" : "in"} className={`sb-in ${isOut ? "sb-ghost" : "sb-drop"}`}>
              <Art pose={!isOut && hover === id ? "wave" : "idle"} />
            </div>
          </button>
        );
      })}
      <JarFront />
    </div>
  );

  const link = `inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[#a49fb0] transition hover:text-[#eee9dc] hover:bg-white/5 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#a49fb0] ${FOCUS}`;
  const actions = (
    <div className="flex items-center gap-1">
      <button type="button" onClick={m.releaseAll} disabled={m.out.length === ORDER.length} className={link}>
        All out <ArrowUpRight size={11} />
      </button>
      <button type="button" onClick={m.collectAll} disabled={m.out.length === 0} className={link}>
        <PackageOpen size={11} /> Collect
      </button>
    </div>
  );

  if (layout === "inline") {
    return (
      <div className="flex items-center gap-3 border-t border-b border-white/10 py-2">
        <div className="w-[84px] shrink-0">{stage}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#a49fb0]">Slugs</div>
          <div className="text-xs text-[#c9c4d2]">{inCount} of {ORDER.length} in the basket</div>
          <div className="-ml-1.5 mt-0.5">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-1" aria-label="Slug basket">
      <div className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-[0.14em] text-[#a49fb0]">
        <span>Slugs</span>
        <span className="normal-case tracking-normal text-[#7d788a]">{inCount}/{ORDER.length} home</span>
      </div>
      {stage}
      <div className="mt-0.5 flex justify-center">{actions}</div>
    </div>
  );
}
