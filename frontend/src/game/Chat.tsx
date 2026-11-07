import { useEffect, useRef, useState } from "react";
import type { ChatMsg, SendFn } from "./types";

export function Chat({ messages, you, send }: { messages: ChatMsg[]; you: string; send: SendFn }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send("chat", { text: t });
    setText("");
  };

  return (
    <section className="rg-card rg-chat" aria-label="Chat">
      <h3 className="rg-h3">Chat</h3>
      <div className="rg-chat-log" aria-live="polite">
        {messages.length === 0 && <p className="rg-dim rg-small">Say hi. Be kind.</p>}
        {messages.map((m, i) => (
          <p key={`${m.at}-${i}`} className={m.from === you ? "mine" : ""}>
            <b>{m.from}</b> {m.text}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="rg-chat-form">
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" />
        <button type="submit" className="rg-btn small">Send</button>
      </form>
    </section>
  );
}
