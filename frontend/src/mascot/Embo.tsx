import type { Pose } from "./Mascot";

// Embo v2: a chubby little fire slug. Round body, flame tuft, big shiny eyes.
const BODY = "M60 34C88 34 102 56 102 84C102 114 86 132 60 132C34 132 18 114 18 84C18 56 32 34 60 34Z";
const TUFT = "M60 4C66 14 74 18 72 28C70 35 64 38 60 38C56 38 50 35 48 28C46 20 54 16 60 4Z";
const TUFT_IN = "M60 18C63 24 66 26 65 31C64 35 62 36 60 36C58 36 56 35 55 31C54 26 58 24 60 18Z";

export function Embo({ pose = "idle", dir = 1 }: { pose?: Pose; dir?: 1 | -1 }) {
  const cls = pose === "juggle" ? "em-juggle-on" : `em-${pose}`;
  const ink = "#5a1a00";
  return (
    <svg viewBox="0 0 120 140" width={96} height={112} overflow="visible" className={`em em-flip ${cls}`}
      style={{ transform: `scaleX(${dir})`, ["--fx" as string]: dir }} aria-hidden="true">
      <defs>
        <linearGradient id="em-o" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF5A00" /><stop offset=".6" stopColor="#FF8A00" /><stop offset="1" stopColor="#FFA826" />
        </linearGradient>
        <radialGradient id="em-y" cx=".5" cy=".35" r=".75">
          <stop offset="0" stopColor="#FFF8D6" /><stop offset=".7" stopColor="#FFDF4A" /><stop offset="1" stopColor="#FFC21F" />
        </radialGradient>
        <linearGradient id="em-t" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FF8A00" /><stop offset=".5" stopColor="#FFC21F" /><stop offset="1" stopColor="#FFF1A0" />
        </linearGradient>
      </defs>

      <ellipse cx="60" cy="137" rx="38" ry="4" fill="#000" opacity=".3" />
      <g>
        <circle className="em-spark" cx="44" cy="16" r="2.5" fill="#FFD21F" />
        <circle className="em-spark" cx="78" cy="20" r="2" fill="#FFF6C2" />
        <circle className="em-spark" cx="60" cy="4" r="2" fill="#FF8A00" />
      </g>

      <g className="em-all">
        {/* slug foot + curly tail with a glowing tip */}
        <ellipse cx="60" cy="131" rx="41" ry="8" fill="#E8480A" />
        <path d="M26 108C8 108 2 128 14 134C22 137 27 130 23 126C21 124 25 122 29 120Z" fill="#FF7A00" />
        <circle cx="13" cy="131" r="4.5" fill="#FFE066" />

        {/* tiny nub arms */}
        <g className="em-arm em-arm-l"><circle cx="18" cy="100" r="7.5" fill="#FF7A00" /></g>
        <g className="em-arm"><circle cx="102" cy="100" r="7.5" fill="#FF7A00" /></g>

        {/* body, cream belly, shine */}
        <path d={BODY} fill="url(#em-o)" />
        <ellipse cx="60" cy="108" rx="28" ry="22" fill="url(#em-y)" />
        <ellipse cx="38" cy="52" rx="9" ry="5" fill="#fff" opacity=".4" transform="rotate(-30 38 52)" />

        {/* flame tuft on its head */}
        <g className="em-flick"><path d={TUFT} fill="url(#em-t)" /><path d={TUFT_IN} fill="#FFFBE8" /></g>

        {/* cute big eyes */}
        <g className="em-eyes">
          <ellipse cx="41" cy="76" rx="12" ry="13.5" fill="#fff" stroke={ink} strokeWidth="2" />
          <ellipse cx="79" cy="76" rx="12" ry="13.5" fill="#fff" stroke={ink} strokeWidth="2" />
          {[41, 79].map((cx) => (
            <g className="em-pupil" key={cx}>
              <circle cx={cx} cy="78" r="8" fill="#3b1200" />
              <circle cx={cx - 3} cy="74.5" r="3" fill="#fff" />
              <circle cx={cx + 3} cy="82" r="1.5" fill="#fff" />
            </g>
          ))}
        </g>
        <g className="em-lids" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M30 78Q41 87 52 78" /><path d="M68 78Q79 87 90 78" />
        </g>
        {(pose === "sad" || pose === "surprised") && (
          <g stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
            {pose === "sad" ? (<><path d="M31 61L50 56" /><path d="M89 61L70 56" /></>)
              : (<><path d="M31 55Q41 49 51 55" /><path d="M69 55Q79 49 89 55" /></>)}
          </g>
        )}
        <circle cx="27" cy="93" r="6" fill="#FF4A2E" opacity=".4" />
        <circle cx="93" cy="93" r="6" fill="#FF4A2E" opacity=".4" />
        <Mouth pose={pose} ink={ink} />

        <g className="em-juggle" fill="#FFD21F" stroke="#FF8A00" strokeWidth="1.5">
          <circle cx="8" cy="76" r="5" /><circle cx="60" cy="56" r="5" /><circle cx="112" cy="76" r="5" />
        </g>
        <g className="em-z" fill="#FFF6C2" fontFamily="Manrope,sans-serif" fontWeight="700">
          <text x="96" y="40" fontSize="16">z</text><text x="106" y="26" fontSize="12">z</text>
        </g>
      </g>
    </svg>
  );
}

function Mouth({ pose, ink }: { pose: Pose; ink: string }) {
  const line = { stroke: ink, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  if (pose === "sleep") return <path d="M54 98Q60 102 66 98" {...line} />;
  if (pose === "sad") return <path d="M51 104Q60 95 69 104" {...line} />;
  if (pose === "dizzy") return <path d="M47 99q3-4 6 0t6 0t6 0t6 0" {...line} />;
  if (pose === "surprised") return <ellipse cx="60" cy="100" rx="5" ry="7" fill="#6b1700" stroke={ink} strokeWidth="2" />;
  if (pose === "cheer")
    return (<g><path d="M46 91Q60 118 74 91Z" fill="#6b1700" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" /><ellipse cx="60" cy="105" rx="7" ry="4" fill="#FF6B6B" /></g>);
  return (
    <g>
      <path d="M50 92Q60 96 70 92Q69 108 60 108Q51 108 50 92Z" fill="#6b1700" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="60" cy="102" rx="5.5" ry="3" fill="#FF6B6B" />
    </g>
  );
}