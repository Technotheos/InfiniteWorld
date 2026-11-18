import { useEffect, useRef, useState } from "react";
import { REACTIONS, type ChatMsg, type SendFn } from "./types";
import { Avatar } from "./ui";
import { UserName } from "../social/UserName";
import "../social/social.css";

function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

export function Chat({
  messages,
  you,
  send,
  typing = [],
}: {
  messages: ChatMsg[];
  you: string;
  send: SendFn;
  typing?: string[];
}) {
  const [text, setText] = useState("");
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send("chat", { text: t });
    setText("");
    lastTyping.current = 0;
  };

  const onType = (v: string) => {
    setText(v);
    // Tell the room at most every 1.5 s while there is something in the box.
    const now = Date.now();
    if (v.trim() && now - lastTyping.current > 1500) {
      lastTyping.current = now;
      send("typing");
    }
  };

  const react = (id: number, emoji: string) => {
    send("react", { id, emoji });
    setPickerFor(null);
  };

  return (
    <section className="rg-card rg-chat" aria-label="Chat">
      <h3 className="rg-h3">Chat</h3>
      <div className="rg-chat-log" aria-live="polite">
        {messages.length === 0 && <p className="rg-dim rg-small">Say hi. Be kind.</p>}
        {messages.map((m, i) => {
          const reacts = Object.entries(m.reacts ?? {}).filter(([, who]) => who.length > 0);
          return (
            <div key={m.id ?? `${m.at}-${i}`}>
              <p className={`rg-msg${m.from === you ? " mine" : ""}`}>
                <Avatar name={m.from} size={24} />
                <span>
                  <b><UserName name={m.from} /></b>{" "}
                  {m.id !== undefined ? (
                    <button
                      type="button"
                      className="iw-msg-tap"
                      aria-label="React to this message"
                      aria-expanded={pickerFor === m.id}
                      onClick={() => setPickerFor(pickerFor === m.id ? null : m.id!)}
                    >
                      {m.text}
                    </button>
                  ) : (
                    m.text
                  )}
                </span>
              </p>
              {reacts.length > 0 && (
                <div className="iw-reacts">
                  {reacts.map(([emoji, who]) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`iw-react${who.includes(you) ? " mine" : ""}`}
                      title={who.join(", ")}
                      aria-label={`${emoji} ${who.length}, ${who.includes(you) ? "remove your reaction" : "add your reaction"}`}
                      onClick={() => m.id !== undefined && react(m.id, emoji)}
                    >
                      {emoji} {who.length}
                    </button>
                  ))}
                </div>
              )}
              {m.id !== undefined && pickerFor === m.id && (
                <div className="iw-picker" role="group" aria-label="Pick a reaction">
                  {REACTIONS.map((e) => (
                    <button key={e} type="button" aria-label={`React ${e}`} onClick={() => react(m.id!, e)}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="iw-typing" aria-live="polite">
        {typing.length > 0 && <span>{typingText(typing)}</span>}
      </div>
      <form onSubmit={submit} className="rg-chat-form">
        <input className="rg-input" value={text} maxLength={200} autoComplete="off" enterKeyHint="send" onChange={(e) => onType(e.target.value)} placeholder="Message" aria-label="Message" />
        <button type="submit" className="rg-btn small">Send</button>
      </form>
    </section>
  );
}
