import { useState, type CSSProperties } from "react";
import { ChevronDown, PackageOpen, ArrowUpRight } from "lucide-react";
import "./basket.css";
import { CHARS, ORDER, type CharId } from "./characters";
import { useMascot } from "./Mascot";
import { GlassBack, GlassFront, SPOT } from "./SlugBasket";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]";

/**
 * A small frosted-glass version of the slug basket.
 *  - "dock":   floats at the bottom-left on laptops, can be folded away.
 *  - "inline": sits in the page flow (top of the page on phones).
 * Only ever render ONE of them at a time: the glass art uses fixed SVG ids.
 */
export function SlugDock({ layout }: { layout: "dock" | "inline" }) {
  const m = useMascot();
  const [open, setOpen] = useState(true);
  const [hover, setHover] = useState<CharId | null>(null);
  const inCount = ORDER.length - m.out.length;

  const toggle = (id: CharId, el: HTMLElement) => {
    if (m.out.includes(id)) { m.collect(id); return; }
    const r = el.getBoundingClientRect();
    m.release(id, r.left + r.width / 2 - 48);
  };

  const glass =
    "relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-white/[0.12] to-white/[0.03] backdrop-blur-xl " +
    "shadow-[0_10px_36px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.25)]";

  const stage = (
    <div className="sb-stage" style={{ maxWidth: layout === "dock" ? 176 : 132 }}>
      <GlassBack />
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
      <GlassFront />
    </div>
  );

  const buttons = (
    <div className="flex gap-1.5">
      <button type="button" onClick={m.releaseAll} disabled={m.out.length === ORDER.length}
        className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-cyan-300 to-violet-400 px-2 py-1 text-[11px] font-bold text-[#04050d] transition hover:brightness-110 disabled:opacity-40 ${FOCUS}`}>
        All out <ArrowUpRight size={12} />
      </button>
      <button type="button" onClick={m.collectAll} disabled={m.out.length === 0}
        className={`flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-[#c9c4d2] transition hover:bg-white/10 disabled:opacity-40 ${FOCUS}`}>
        <PackageOpen size={12} /> Collect
      </button>
    </div>
  );

  if (layout === "inline") {
    // Phones: a slim glass strip, basket on the left, a few words and buttons on the right.
    return (
      <div className={`${glass} flex items-center gap-3 p-3`}>
        <div className="w-[118px] shrink-0">{stage}</div>
        <div className="min-w-0 flex-1">
          <div className="iw-display text-xl font-light leading-none text-[#eee9dc]">Slug Squad</div>
          <div className="mt-1 text-[11px] text-[#a49fb0]">{inCount} of {ORDER.length} in the basket. Tap a slug.</div>
          <div className="mt-2">{buttons}</div>
        </div>
      </div>
    );
  }

  // Laptop: folds into a small glass pill so it never covers the page.
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Show the slug basket"
        className={`${glass} flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#eee9dc] hover:brightness-125 ${FOCUS}`}>
        <span aria-hidden="true" className="flex -space-x-1">
          {ORDER.map((id) => (
            <span key={id} className="h-3 w-3 rounded-full border border-black/40"
              style={{ background: CHARS[id].accent, opacity: m.out.includes(id) ? 0.3 : 1 }} />
          ))}
        </span>
        Slugs
      </button>
    );
  }

  return (
    <div className={`${glass} w-52 p-3`}>
      <div aria-hidden="true" className="pointer-events-none absolute -left-8 -top-8 h-24 w-24 rounded-full bg-cyan-400/15 blur-[40px]" />
      <div className="relative">
        <div className="mb-1 flex items-center justify-between">
          <span className="iw-display text-lg font-light text-[#eee9dc]">Slug Squad</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fold the slug basket away"
            className={`rounded-md p-1 text-[#a49fb0] hover:bg-white/10 hover:text-white ${FOCUS}`}>
            <ChevronDown size={14} />
          </button>
        </div>
        {stage}
        <div className="mb-2 mt-1 text-center text-[11px] text-[#a49fb0]">{inCount} of {ORDER.length} in the basket</div>
        {buttons}
      </div>
    </div>
  );
}
