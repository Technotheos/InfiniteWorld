import { useEffect, type CSSProperties } from "react";
import { CHARS, ORDER, type CharId } from "./characters";
import { useMascot } from "./Mascot";

// One round icon per slug, like the old Embo flame button: fire, electricity, nature.
const ICON: Record<CharId, string> = { embo: "🔥", jolt: "⚡", sprig: "🌿" };
const LABEL: Record<CharId, string> = { embo: "Fire", jolt: "Electricity", sprig: "Nature" };

/** The three slug icons, side by side. Tap one to let that slug out, tap again to send it back. */
export function SlugToggles({ className = "" }: { className?: string }) {
  const m = useMascot();
  return (
    <div className={`em-toggles ${className}`} role="group" aria-label="Slugs">
      {ORDER.map((id) => {
        const c = CHARS[id];
        const on = m.out.includes(id);
        return (
          <button key={id} type="button"
            className={`em-show${on ? " em-on" : ""}`}
            style={{ ["--ga"]: c.glowA, ["--bc"]: c.border } as CSSProperties}
            aria-pressed={on}
            aria-label={on ? `Call ${c.name} back (${LABEL[id]})` : `Let ${c.name} out (${LABEL[id]})`}
            title={`${c.name} · ${LABEL[id]}`}
            onClick={() => (on ? m.collect(id) : m.release(id))}>
            {ICON[id]}
          </button>
        );
      })}
    </div>
  );
}

/** Home's sidebar renders the icons itself (just above the profile); call this so the floating copy steps aside. */
export function useDockedToggles(docked: boolean) {
  const m = useMascot();
  const { setDocked } = m;
  useEffect(() => {
    setDocked(docked);
    return () => setDocked(false);
  }, [docked, setDocked]);
}
