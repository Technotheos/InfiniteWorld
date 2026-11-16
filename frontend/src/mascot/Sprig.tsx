import type { Pose } from "./pose";

// Sprig: a shy, sincere glow slug. Soft pear-shaped body, leaf fins, a little lantern antenna.
const BODY = "M60 28C78 28 88 46 90 70C93 98 92 130 60 132C28 130 27 98 30 70C32 46 42 28 60 28Z";

export function Sprig({ pose = "idle", dir = 1 }: { pose?: Pose; dir?: 1 | -1 }) {
  const cls = pose === "juggle" ? "em-juggle-on" : `em-${pose}`;
  const ink = "#0f3a24";
  return (
    <svg viewBox="0 0 120 140" width={96} height={112} overflow="visible" className={`em em-sprig em-flip ${cls}`}
      style={{ transform: `scaleX(${dir})`, ["--fx" as string]: dir }} aria-hidden="true">
      <defs>
        <linearGradient id="sp-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9af0a6" /><stop offset=".55" stopColor="#3ecf7a" /><stop offset="1" stopColor="#1d9558" />
        </linearGradient>
        <radialGradient id="sp-y" cx=".5" cy=".3" r=".8">
          <stop offset="0" stopColor="#fbffe8" /><stop offset=".65" stopColor="#d4f7a8" /><stop offset="1" stopColor="#a9e87e" />
        </radialGradient>
        <radialGradient id="sp-l" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".45" stopColor="#FFF59A" /><stop offset="1" stopColor="#D5F062" />
        </radialGradient>
      </defs>

      <ellipse cx="60" cy="137" rx="36" ry="4" fill="#000" opacity=".3" />
      <g>
        <circle className="em-spark" cx="84" cy="22" r="2.2" fill="#FFF59A" />
        <circle className="em-spark" cx="68" cy="4" r="1.8" fill="#fff" style={{ animationDelay: "-.6s" }} />
        <circle className="em-spark" cx="92" cy="8" r="2" fill="#D5F062" />
      </g>

      <g className="em-all">
        {/* curly tail with a glowing tip */}
        <path d="M31 118C12 118 5 134 17 138C26 140 30 132 25 127Z" fill="#35c46f" />
        <circle cx="15" cy="133" r="4.5" fill="#FFF59A" />

        <g className="em-arm em-arm-l" style={{ transformOrigin: "30px 98px" }}><circle cx="25" cy="102" r="7" fill="#35c46f" /></g>
        <g className="em-arm" style={{ transformOrigin: "90px 98px" }}><circle cx="95" cy="102" r="7" fill="#35c46f" /></g>

        {/* leaf fins */}
        <path d="M31 76C12 74 5 62 9 51C20 57 28 63 35 68Z" fill="#6fe39a" />
        <path d="M89 76C108 74 115 62 111 51C100 57 92 63 85 68Z" fill="#6fe39a" />
        <path d="M30 70L14 58M90 70L106 58" stroke="#3ecf7a" strokeWidth="1.5" strokeLinecap="round" />

        {/* body, mint belly, soft spots, shine */}
        <path d={BODY} fill="url(#sp-b)" />
        <ellipse cx="60" cy="110" rx="24" ry="20" fill="url(#sp-y)" />
        <g fill="#c9f7b0" opacity=".55"><circle cx="40" cy="48" r="2.6" /><circle cx="76" cy="44" r="2" /><circle cx="68" cy="56" r="1.6" /></g>
        <ellipse cx="44" cy="46" rx="8" ry="4.5" fill="#fff" opacity=".45" transform="rotate(-30 44 46)" />

        {/* lantern antenna */}
        <g className="em-flick">
          <path d="M60 32C60 20 66 12 74 8" fill="none" stroke="#2fa564" strokeWidth="3.5" strokeLinecap="round" />
          <circle className="em-halo" cx="75" cy="7" r="14" fill="#FFF7A0" opacity=".35" />
          <circle cx="75" cy="7" r="6.5" fill="url(#sp-l)" />
        </g>

        {/* big sincere eyes */}
        <g className="em-eyes">
          <ellipse cx="44" cy="76" rx="11.5" ry="14" fill="#fff" stroke={ink} strokeWidth="2" />
          <ellipse cx="76" cy="76" rx="11.5" ry="14" fill="#fff" stroke={ink} strokeWidth="2" />
          {[44, 76].map((cx) => (
            <g className="em-pupil" key={cx}>
              <circle cx={cx} cy="78" r="8.5" fill="#10351f" />
              <circle cx={cx - 3} cy="74" r="3.6" fill="#fff" />
              <circle cx={cx + 3} cy="82" r="1.7" fill="#fff" />
            </g>
          ))}
        </g>
        <g className="em-lids" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M33 78Q44 87 55 78" /><path d="M65 78Q76 87 87 78" />
        </g>
        <g stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none">
          {pose === "sad" ? (<><path d="M33 62L53 56" /><path d="M87 62L67 56" /></>)
            : pose === "surprised" ? (<><path d="M34 55Q44 49 54 55" /><path d="M66 55Q76 49 86 55" /></>)
            : pose === "sleep" ? null
            : (<><path d="M33 60Q43 55 53 54" opacity=".7" /><path d="M87 60Q77 55 67 54" opacity=".7" /></>)}
        </g>
        <circle cx="30" cy="94" r="6" fill="#FF8FB0" opacity=".5" />
        <circle cx="90" cy="94" r="6" fill="#FF8FB0" opacity=".5" />
        <Mouth pose={pose} ink={ink} />

        <g className="em-juggle" fill="#FFF59A" stroke="#3ecf7a" strokeWidth="1.5">
          <circle cx="8" cy="76" r="5" /><circle cx="60" cy="56" r="5" /><circle cx="112" cy="76" r="5" />
        </g>
        <g className="em-z" fill="#d9ffe6" fontFamily="Manrope,sans-serif" fontWeight="700">
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
  if (pose === "surprised") return <ellipse cx="60" cy="102" rx="5" ry="7" fill="#0c2a18" stroke={ink} strokeWidth="2" />;
  if (pose === "cheer")
    return (<g><path d="M47 95Q60 120 73 95Z" fill="#0c2a18" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" /><ellipse cx="60" cy="107" rx="6.5" ry="4" fill="#FF8FB0" /></g>);
  return <path d="M50 97Q60 106 70 97" {...line} />;
}
