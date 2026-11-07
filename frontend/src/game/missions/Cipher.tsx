import { useEffect, useState } from "react";
import { Avatar } from "../ui";
import type { CipherPlay, CipherPrivate, MissionProps } from "../types";

const LABEL: Record<CipherPlay["variant"], string> = {
  caesar: "Caesar shift", base64: "Base64", hex: "Hex bytes", binary: "Binary",
};

export function Cipher({ play, priv, send }: MissionProps<CipherPlay, CipherPrivate>) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [play.challenge]);

  const solved = priv?.solved ?? false;
  const between = play.status === "between";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || solved || between) return;
    send("act", { op: "answer", value: v });
    setValue("");
  };

  return (
    <div className="rg-cipher">
      <div className="rg-chips">
        <span className="rg-chip">{LABEL[play.variant]}</span>
        <span className="rg-chip dim">Puzzle {play.round} / {play.rounds}</span>
        <span className="rg-chip dim">{priv?.attempts ?? 0} / 8 tries</span>
      </div>
      <div className="rg-terminal" aria-label="Encoded message">
        <span className="rg-prompt">$ decode</span>
        <code>{play.challenge}</code>
        <span className="rg-caret" aria-hidden="true" />
      </div>
      {play.hint && !between && <p className="rg-hint">Hint: {play.hint}</p>}
      {between ? (
        <p className="rg-answer">Answer: <b>{play.answer}</b></p>
      ) : solved ? (
        <p className="rg-ok">Solved! Waiting for the others…</p>
      ) : (
        <form onSubmit={submit} className="rg-inline">
          <input className="rg-input big" value={value} onChange={(e) => setValue(e.target.value)} maxLength={64}
            autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="The hidden word" aria-label="Your answer" />
          <button type="submit" className="rg-btn">Submit</button>
        </form>
      )}
      <div className="rg-solvers">
        {play.solved.map((n) => (
          <span key={n} className="rg-solver"><Avatar name={n} size={20} /> {n}</span>
        ))}
      </div>
    </div>
  );
}
