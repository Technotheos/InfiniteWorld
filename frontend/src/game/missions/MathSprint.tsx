import { useEffect, useRef, useState } from "react";
import type { MathPlay, MathPrivate, MissionProps } from "../types";

export function MathSprint({ priv, send }: MissionProps<MathPlay, MathPrivate>) {
  const [value, setValue] = useState("");
  const [fx, setFx] = useState<"ok" | "bad" | null>(null);
  const prev = useRef({ correct: 0, wrong: 0 });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!priv) return;
    if (priv.correct > prev.current.correct) setFx("ok");
    else if (priv.wrong > prev.current.wrong) setFx("bad");
    prev.current = { correct: priv.correct, wrong: priv.wrong };
    const id = window.setTimeout(() => setFx(null), 350);
    input.current?.focus();
    return () => window.clearTimeout(id);
  }, [priv?.correct, priv?.wrong]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || !priv?.q) return;
    send("act", { op: "answer", value: v });
    setValue("");
  };

  const q = (priv?.q ?? "").replace(/\*/g, "×").replace(/-/g, "−");
  return (
    <div className={`rg-math ${fx ?? ""}`}>
      <div className="rg-stats">
        <span><b>{priv?.correct ?? 0}</b> correct</span>
        <span><b>{priv?.wrong ?? 0}</b> wrong</span>
      </div>
      <div className="rg-question" aria-live="polite">{q || "…"}</div>
      <form onSubmit={submit}>
        <input ref={input} className="rg-input big" value={value} inputMode="numeric" autoFocus autoComplete="off"
          onChange={(e) => setValue(e.target.value.replace(/[^0-9-]/g, "").slice(0, 8))} aria-label="Your answer"
          placeholder="Answer, then Enter" />
      </form>
      <p className="rg-dim rg-small">Right +100, wrong −50. Same questions for everyone.</p>
    </div>
  );
}
