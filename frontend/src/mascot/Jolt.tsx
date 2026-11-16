import type { Pose } from "./pose";

// Jolt: a cocky little storm slug. Tall teardrop body, lightning crest, electric-blue eyes.
const BODY = "M60 26C84 26 97 50 99 80C101 108 90 131 60 132C30 131 19 108 21 80C23 50 36 26 60 26Z";
const CREST = "M43 40L33 16L47 25L44 4L58 28L65 2L70 29L86 12L78 44Z";
const CREST_IN = "M50 38L46 24L54 30L56 17L62 32L68 20L71 36Z";

export function Jolt({ pose = "idle", dir = 1 }: { pose?: Pose; dir?: 1 | -1 }) {
  const cls = pose === "juggle" ? "em-juggle-on" : `em-${pose}`;
  const ink = "#0b1a4a";
  return (
    <svg viewBox="0 0 120 140" width={96} height={112} overflow="visible" className={`em em-jolt em-flip ${cls}`}
      style={{ transform: `scaleX(${dir})`, ["--fx" as string]: dir }} aria-hidden="true">
      <defs>
        <linearGradient id="jl-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#62b4ff" /><stop offset=".55" stopColor="#2f6bff" /><stop offset="1" stopColor="#1a38c4" />
        </linearGradient>
        <radialGradient id="jl-y" cx=".5" cy=".3" r=".8">
          <stop offset="0" stopColor="#f0fdff" /><stop offset=".65" stopColor="#a6e8ff" /><stop offset="1" stopColor="#62c6f4" />
        </radialGradient>
        <linearGradient id="jl-c" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FFB800" /><stop offset=".5" stopColor="#FFE04A" /><stop offset="1" stopColor="#FFFBD0" />
        </linearGradient>
      </defs>

      <ellipse cx="60" cy="137" rx="36" ry="4" fill="#000" opacity=".3" />
      <g>
        <circle className="em-spark" cx="26" cy="30" r="2.5" fill="#FFE84A" />
        <circle className="em-spark" cx="96" cy="26" r="2" fill="#bff3ff" style={{ animationDelay: "-.5s" }} />
        <circle className="em-spark" cx="60" cy="6" r="2" fill="#FFF6B0" />
      </g>

      <g className="em-all">
        {/* zigzag lightning tail */}
        <path d="M28 114L7 119L17 125L2 136L27 128L21 122L32 121Z" fill="url(#jl-c)" stroke="#d99000" strokeWidth="1" strokeLinejoin="round" />

        <g className="em-arm em-arm-l" style={{ transformOrigin: "28px 98px" }}><circle cx="20" cy="102" r="7.5" fill="#2f6bff" /></g>
        <g className="em-arm" style={{ transformOrigin: "92px 98px" }}><circle cx="100" cy="102" r="7.5" fill="#2f6bff" /></g>

        {/* lightning crest on the head */}
        <g className="em-flick"><path d={CREST} fill="url(#jl-c)" stroke="#d99000" strokeWidth="1" strokeLinejoin="round" /><path d={CREST_IN} fill="#FFFDE8" /></g>

        {/* teal side fins */}
        <path d="M24 72C8 68 3 54 9 45C17 53 24 58 31 60Z" fill="#2fd0d8" />
        <path d="M96 72C112 68 117 54 111 45C103 53 96 58 89 60Z" fill="#2fd0d8" />

        {/* body, pale belly, shine */}
        <path d={BODY} fill="url(#jl-b)" />
        <ellipse cx="60" cy="110" rx="24" ry="19" fill="url(#jl-y)" />
        <ellipse cx="40" cy="52" rx="9" ry="5" fill="#fff" opacity=".45" transform="rotate(-30 40 52)" />

        {/* electric markings */}
        <g className="em-bolt" fill="none" stroke="#FFD21F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M27 88L36 82L32 96L41 90" /><path d="M93 88L84 82L88 96L79 90" /><path d="M60 36L54 48L62 48L56 62" />
        </g>

        {/* big electric eyes */}
        <g className="em-eyes">
          <ellipse cx="41" cy="76" rx="12" ry="13.5" fill="#fff" stroke={ink} strokeWidth="2" />
          <ellipse cx="79" cy="76" rx="12" ry="13.5" fill="#fff" stroke={ink} strokeWidth="2" />
          {[41, 79].map((cx) => (
            <g className="em-pupil" key={cx}>
              <circle cx={cx} cy="78" r="8.5" fill="#35c4ff" />
              <circle cx={cx} cy="78" r="5" fill={ink} />
              <circle cx={cx - 3} cy="74.5" r="3" fill="#fff" />
              <circle cx={cx + 3} cy="82" r="1.5" fill="#fff" />
            </g>
          ))}
        </g>
        <g className="em-lids" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M30 78Q41 87 52 78" /><path d="M68 78Q79 87 90 78" />
        </g>
        <g stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
          {pose === "sad" ? (<><path d="M31 63L50 58" /><path d="M89 63L70 58" /></>)
            : pose === "surprised" ? (<><path d="M31 57Q41 51 51 57" /><path d="M69 57Q79 51 89 57" /></>)
            : pose === "sleep" ? null
            : (<><path d="M30 58Q41 52 52 58" /><path d="M68 54Q79 47 90 54" /></>)}
        </g>
        <circle cx="27" cy="95" r="6" fill="#8ff0ff" opacity=".5" />
        <circle cx="93" cy="95" r="6" fill="#8ff0ff" opacity=".5" />
        <Mouth pose={pose} ink={ink} />

        <g className="em-juggle" fill="#FFE84A" stroke="#35c4ff" strokeWidth="1.5">
          <circle cx="8" cy="76" r="5" /><circle cx="60" cy="56" r="5" /><circle cx="112" cy="76" r="5" />
        </g>
        <g className="em-z" fill="#bff3ff" fontFamily="Manrope,sans-serif" fontWeight="700">
          <text x="98" y="40" fontSize="16">z</text><text x="108" y="26" fontSize="12">z</text>
        </g>
      </g>
    </svg>
  );
}

function Mouth({ pose, ink }: { pose: Pose; ink: string }) {
  const line = { stroke: ink, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  if (pose === "sleep") return <path d="M54 102Q60 106 66 102" {...line} />;
  if (pose === "sad") return <path d="M51 108Q60 99 69 108" {...line} />;
  if (pose === "dizzy") return <path d="M47 101q3-4 6 0t6 0t6 0t6 0" {...line} />;
  if (pose === "surprised") return <ellipse cx="60" cy="102" rx="5" ry="7" fill="#0a1650" stroke={ink} strokeWidth="2" />;
  if (pose === "cheer")
    return (<g><path d="M46 94Q60 122 74 94Z" fill="#0a1650" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" /><ellipse cx="60" cy="107" rx="7" ry="4" fill="#FF7AA8" /></g>);
  return (
    <g>
      <path d="M48 98Q58 107 73 94" {...line} />
      <path d="M65 100L68.5 107.5L72 96Z" fill="#fff" stroke={ink} strokeWidth="1" strokeLinejoin="round" />
    </g>
  );
}
