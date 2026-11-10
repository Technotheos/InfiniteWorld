import { useState, type ComponentType } from "react";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { NeuralBackdrop } from "./NeuralBackdrop";
import { Backprop } from "./Backprop";
import "./ai-lab.css";

interface Lesson { id: string; title: string; icon: string; Component?: ComponentType }
// Add a lesson: build a component, then register it here. Lessons without a Component show as "soon".
const LESSONS: Lesson[] = [
  { id: "backprop", title: "Backpropagation", icon: "🧠", Component: Backprop },
  { id: "attention", title: "Attention & Transformers", icon: "👁️" },
  { id: "bpe", title: "Tokenization (BPE)", icon: "🔤" },
  { id: "diffusion", title: "Diffusion models", icon: "🌫️" },
  { id: "ppo", title: "Policy gradients & PPO", icon: "🎯" },
];

export function AILab({ username, onLeave, onDiscuss }: { username: string; onLeave: () => void; onDiscuss: () => void }) {
  const [id, setId] = useState("backprop");
  const Active = LESSONS.find((l) => l.id === id)?.Component;
  return (
    <div className="ail">
      <NeuralBackdrop />
      <div className="ail-wrap">
        <div className="ail-top">
          <button className="ail-btn" onClick={onLeave}><ArrowLeft size={14} style={{ display: "inline", marginRight: 6 }} />Back</button>
          <button className="ail-btn" onClick={onDiscuss}><MessageCircle size={14} style={{ display: "inline", marginRight: 6 }} />Discuss</button>
          <span style={{ marginLeft: "auto", color: "var(--mu)", fontSize: 13 }}>researcher: {username}</span>
        </div>
        <header className="ail-hero">
          <div className="ail-kick">Deep AI · open the black box</div>
          <h1 className="ail-title">Intelligence, taken apart.</h1>
          <p className="ail-sub">Skip the hype. Each lesson opens one famous algorithm: the problem that stalled researchers, the idea that broke it, the math, the code, and a live model you can break.</p>
        </header>
        <nav className="ail-tabs" aria-label="Lessons">
          {LESSONS.map((l) => <button key={l.id} className={`ail-tab ${id === l.id ? "on" : ""} ${l.Component ? "" : "soon"}`} disabled={!l.Component} onClick={() => setId(l.id)}>{l.icon} {l.title}{l.Component ? "" : " · soon"}</button>)}
        </nav>
        {Active && <Active />}
      </div>
    </div>
  );
}
