import { useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { ArrowUpRight, PackageOpen } from "lucide-react";
import "./basket.css";
import { CHARS, ORDER, type CharId } from "./characters";
import { useMascot } from "./Mascot";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#e9b872] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06050b]";

// Where each slug stands inside the glass (centre x as % of the basket's width).
const SPOT: Record<CharId, number> = { embo: 28, jolt: 50, sprig: 72 };
const GLASS = "M56 64C50 170 70 250 120 272L360 272C410 250 430 170 424 64Z";

/** Back half of the glass: handle, tinted inside, glowing gems, far rim. */
function GlassBack() {
  return (
    <svg className="sb-layer sb-back" viewBox="0 0 480 300" aria-hidden="true">
      <defs>
        <linearGradient id="sb-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef2f8" /><stop offset=".45" stopColor="#9aa6bb" /><stop offset="1" stopColor="#566177" />
        </linearGradient>
        <linearGradient id="sb-in" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fdcff" stopOpacity=".06" /><stop offset="1" stopColor="#7a5cff" stopOpacity=".28" />
        </linearGradient>
        <radialGradient id="sb-floor">
          <stop offset="0" stopColor="#8ff6ff" stopOpacity=".6" /><stop offset="1" stopColor="#8ff6ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="290" rx="196" ry="10" fill="#000" opacity=".45" />
      <path d="M74 60C70-30 410-30 406 60" fill="none" stroke="#2f3747" strokeWidth="12" strokeLinecap="round" />
      <path d="M74 60C70-30 410-30 406 60" fill="none" stroke="url(#sb-metal)" strokeWidth="7" strokeLinecap="round" />
      <path d="M86 52C90-14 390-14 394 52" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
      <path d={GLASS} fill="url(#sb-in)" />
      <ellipse cx="240" cy="268" rx="130" ry="16" fill="url(#sb-floor)" />
      <g opacity=".9">
        <path d="M150 272l9-20 11 20z" fill="#58e1ff" /><path d="M159 252l11 20h-11z" fill="#2bb4de" />
        <path d="M312 272l8-24 12 24z" fill="#b48cff" /><path d="M320 248l12 24h-12z" fill="#8a5cf0" />
        <path d="M232 272l7-14 8 14z" fill="#ffd46a" /><path d="M200 272l6-12 7 12z" fill="#7dffb0" />
      </g>
      <path d="M56 64A184 22 0 0 1 424 64" fill="none" stroke="#6b768c" strokeWidth="6" />
    </svg>
  );
}

/** Front half of the glass: sheen, near rim, metal base, reflections. */
function GlassFront() {
  return (
    <svg className="sb-layer sb-front" viewBox="0 0 480 300" aria-hidden="true">
      <defs>
        <linearGradient id="sb-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" /><stop offset=".35" stopColor="#fff" stopOpacity=".02" />
          <stop offset=".7" stopColor="#9fe3ff" stopOpacity=".05" /><stop offset="1" stopColor="#fff" stopOpacity=".14" />
        </linearGradient>
      </defs>
      <path d={GLASS} fill="url(#sb-sheen)" stroke="#bfeaff" strokeOpacity=".55" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M56 64A184 22 0 0 0 424 64" fill="none" stroke="#2f3747" strokeWidth="11" strokeLinecap="round" />
      <path d="M56 64A184 22 0 0 0 424 64" fill="none" stroke="url(#sb-metal)" strokeWidth="7" strokeLinecap="round" />
      <path d="M68 66A172 18 0 0 0 412 66" fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="104" y="268" width="272" height="22" rx="9" fill="#2f3747" />
      <rect x="106" y="269" width="268" height="19" rx="8" fill="url(#sb-metal)" />
      <path d="M118 274H362" stroke="#fff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
      <path d="M82 98C75 172 91 232 124 258" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="8" strokeLinecap="round" />
      <path d="M99 96C95 118 96 136 100 152" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M403 104C407 162 395 214 371 246" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="4.5" strokeLinecap="round" />
      <path className="sb-glint" d="M112 120l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#fff" />
    </svg>
  );
}

export function SlugBasket() {
  const m = useMascot();
  const [hover, setHover] = useState<CharId | null>(null);
  const [look, setLook] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const inCount = ORDER.length - m.out.length;

  // Pupils follow the pointer while it is over the basket.
  const track = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.6);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
    setLook({ x: (dx / d) * k, y: (dy / d) * k });
  };

  const toggle = (id: CharId, el: HTMLElement) => {
    if (m.out.includes(id)) { m.collect(id); return; }
    const r = el.getBoundingClientRect();
    m.release(id, r.left + r.width / 2 - 48);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0b16]/75 backdrop-blur-md p-6 sm:p-8">
      <div aria-hidden="true" className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-cyan-400/10 blur-[90px] pointer-events-none" />
      <div aria-hidden="true" className="absolute -right-16 -bottom-20 h-64 w-64 rounded-full bg-violet-500/15 blur-[90px] pointer-events-none" />
      <div className="relative grid lg:grid-cols-2 gap-8 items-center">
        <div>
          <div className="flex flex-wrap gap-2 text-[11px] text-[#c9c4d2]">
            <span className="px-2.5 py-1 rounded-full border border-cyan-300/40 text-cyan-200">Companions</span>
            <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">{inCount} of {ORDER.length} in the basket</span>
          </div>
          <h3 className="iw-display text-4xl sm:text-5xl font-light mt-3">Slug Squad</h3>
          <p className="text-sm text-[#c9c4d2] leading-relaxed mt-3 max-w-md">
            Tap a slug to let it out. It will roam your screen, chat and cheer you on. Tap it again, or its ×, to call it back to the glass basket.
          </p>

          <ul className="mt-5 space-y-2.5">
            {ORDER.map((id) => {
              const c = CHARS[id];
              const isOut = m.out.includes(id);
              return (
                <li key={id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5"
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.accent, boxShadow: `0 0 10px ${c.accent}` }} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#eee9dc] truncate">
                        {c.name} <span className="font-normal text-[#a49fb0]">· {c.role}</span>
                      </div>
                      <div className="text-xs text-[#a49fb0] truncate">{c.blurb}</div>
                    </div>
                  </div>
                  <button type="button" onClick={(e) => toggle(id, e.currentTarget)}
                    className={`shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold transition hover:brightness-110 ${FOCUS}`}
                    style={isOut ? { border: `1px solid ${c.accent}66`, color: c.accent } : { background: c.accent, color: "#0b0a10" }}>
                    {isOut ? "Call back" : "Let out"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={m.releaseAll} disabled={m.out.length === ORDER.length}
              className={`px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-300 to-violet-400 text-[#04050d] font-bold text-sm hover:brightness-110 disabled:opacity-40 transition flex items-center gap-2 ${FOCUS}`}>
              Let them all out <ArrowUpRight size={15} />
            </button>
            <button type="button" onClick={m.collectAll} disabled={m.out.length === 0}
              className={`px-5 py-2.5 rounded-xl border border-white/10 text-sm text-[#c9c4d2] hover:text-[#eee9dc] hover:bg-white/5 disabled:opacity-40 transition flex items-center gap-2 ${FOCUS}`}>
              <PackageOpen size={15} /> Collect all
            </button>
          </div>
        </div>

        <div className="sb-stage" onPointerMove={track} onPointerLeave={() => setLook({ x: 0, y: 0 })}
          style={{ ["--lx"]: look.x, ["--ly"]: look.y } as CSSProperties}>
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
                {isOut && <span className="sb-out">Out exploring</span>}
              </button>
            );
          })}
          <GlassFront />
        </div>
      </div>
    </div>
  );
}
