import { useEffect, useRef, useState } from "react";
import { backward, forward, makeData, makeNet, predict, trainStep, type DataKind, type Net, type Opt, type Pt } from "./nn";
import { useMascot } from "../mascot";

const SIZES = [2, 6, 6, 1], NX = [55, 155, 255, 355];
const ny = (l: number, i: number) => 130 + (i - (SIZES[l] - 1) / 2) * 34;
type Tab = "story" | "math" | "code";

const CODE = `// the whole of backprop, from scratch (see nn.ts)
d[L] = a[L] - y;                       // output error
for (let l = L - 1; l >= 1; l--)       // walk backwards
  d[l] = (Wᵀ[l+1] · d[l+1]) ⊙ (1 - a[l]²);

gradW[l] += d[l] ⊗ a[l-1];             // dL/dW
gradb[l] += d[l];                      // dL/db

// Adam update, per weight
m = 0.9·m + 0.1·g;   v = 0.999·v + 0.001·g²;
w -= lr · m̂ / (√v̂ + 1e-8);`;

export function Backprop() {
  const mascot = useMascot(), mref = useRef(mascot); mref.current = mascot;
  const [tab, setTab] = useState<Tab>("story");
  const [kind, setKind] = useState<DataKind>("circles");
  const [opt, setOpt] = useState<Opt>("adam");
  const [lr, setLr] = useState(0.05);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState<"fwd" | "bwd">("fwd");
  const [sample, setSample] = useState(0);
  const [, setTick] = useState(0);
  const net = useRef<Net>(makeNet(SIZES)), data = useRef<Pt[]>(makeData("circles")), hist = useRef<number[]>([]), cheered = useRef(false);
  const cv = useRef<HTMLCanvasElement>(null);

  const reset = (k: DataKind = kind) => { net.current = makeNet(SIZES); data.current = makeData(k); hist.current = []; cheered.current = false; setKind(k); setRunning(true); };

  useEffect(() => { mref.current.react("wave", "Welcome to the lab! Watch the loss fall."); }, []);
  useEffect(() => {
    if (!running) return;
    let id = 0;
    const loop = () => {
      for (let k = 0; k < 3; k++) hist.current.push(trainStep(net.current, data.current, opt, lr));
      if (hist.current.length > 500) hist.current.splice(0, hist.current.length - 500);
      setTick((t) => t + 1); id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id);
  }, [running, opt, lr]);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => { if (p === "bwd") setSample(Math.floor(Math.random() * data.current.length)); return p === "fwd" ? "bwd" : "fwd"; }), 2200);
    return () => clearInterval(id);
  }, []);

  const loss = hist.current[hist.current.length - 1] ?? NaN;
  useEffect(() => {
    if (!cheered.current && hist.current.length > 30 && loss < 0.12) { cheered.current = true; mref.current.react("cheer", "Loss under 0.12! The network just figured it out!"); }
  });

  useEffect(() => { // decision boundary
    const c = cv.current; if (!c) return; const g = c.getContext("2d")!, S = 44, cell = c.width / S;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const p = predict(net.current, (i / S) * 2 - 1 + 1 / S, (j / S) * 2 - 1 + 1 / S);
      g.fillStyle = `rgba(${Math.round(244 - p * 210)},${Math.round(114 + p * 97)},${Math.round(182 + p * 56)},${0.22 + Math.abs(p - 0.5) * 0.5})`;
      g.fillRect(i * cell, j * cell, cell + 1, cell + 1);
    }
    for (const p of data.current) { g.fillStyle = p.c ? "#22d3ee" : "#f472b6"; g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.beginPath(); g.arc(((p.x + 1) / 2) * c.width, ((p.y + 1) / 2) * c.height, 4, 0, 6.3); g.fill(); g.stroke(); }
  });

  // inspect one sample: forward activations, then backward error signals
  const pt = data.current[sample % data.current.length], a = forward(net.current, [pt.x, pt.y]), d = backward(net.current, a, pt.c);
  const dmax = Math.max(1e-9, ...d.slice(1).flatMap((v) => Array.from(v).map(Math.abs)));
  const bwd = phase === "bwd", n = net.current;
  const pts = hist.current.map((v, i) => `${(i / 500) * 300},${70 - Math.min(1, v / 0.8) * 66}`).join(" ");

  return (
    <div className="ail-grid">
      <div className="ail-card">
        <div className="ail-tabs">{(["story", "math", "code"] as Tab[]).map((t) => <button key={t} className={`ail-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t === "story" ? "📜 The story" : t === "math" ? "∑ The math" : "</> The code"}</button>)}</div>
        {tab === "story" && (<>
          <h3>A 1969 book nearly killed neural networks</h3>
          <p className="ail-p">Minsky & Papert proved a single-layer perceptron cannot learn XOR. The fix was obvious, add hidden layers, but nobody knew how to train them: how much blame does a weight in layer 1 deserve for an error at the output?</p>
          <p className="ail-p">The answer is the chain rule, applied backwards. Linnainmaa described reverse-mode automatic differentiation in 1970 and Werbos applied it to networks in 1974. Rumelhart, Hinton & Williams popularised it in 1986, and every modern model, from CNNs to GPT, still trains this way.</p>
          <p className="ail-p">Watch the right panel: <b style={{ color: "#22d3ee" }}>cyan pulses</b> are the forward pass, <b style={{ color: "#f472b6" }}>pink pulses</b> carry error signals backwards. Notice how the nodes near the input glow dimmer in the backward phase. That is the vanishing gradient problem, live.</p>
        </>)}
        {tab === "math" && (<>
          <h3>Four equations that train everything</h3>
          <code className="ail-eq">a⁽ˡ⁾ = f( W⁽ˡ⁾ a⁽ˡ⁻¹⁾ + b⁽ˡ⁾ )<small>forward: tanh in hidden layers, sigmoid at the output</small></code>
          <code className="ail-eq">L = −[ y·ln ŷ + (1−y)·ln(1−ŷ) ]<small>binary cross-entropy: punishes confident mistakes</small></code>
          <code className="ail-eq">δ⁽ᴸ⁾ = ŷ − y<small>sigmoid's derivative cancels with the loss's: a beautiful simplification</small></code>
          <code className="ail-eq">δ⁽ˡ⁾ = ( W⁽ˡ⁺¹⁾ᵀ δ⁽ˡ⁺¹⁾ ) ⊙ ( 1 − a⁽ˡ⁾² )<small>the chain rule: send error back through the weights, scale by tanh'</small></code>
          <code className="ail-eq">∂L/∂W⁽ˡ⁾ = δ⁽ˡ⁾ a⁽ˡ⁻¹⁾ᵀ<small>each weight's blame = error at its output × signal at its input</small></code>
          <p className="ail-p">Because (1 − a²) is at most 1, every layer the error crosses can only shrink it. Adam rescales each weight's step by its own gradient history, which is why it escapes where plain SGD crawls.</p>
        </>)}
        {tab === "code" && (<><h3>No framework. This is the real thing.</h3><div className="ail-code">{CODE}</div><p className="ail-p">The same code runs the demo on the right. Open <code>ai-lab/nn.ts</code> and change the activation to ReLU to see what breaks.</p></>)}
      </div>

      <div className="ail-card">
        <h3>Live network · {phase === "fwd" ? "forward pass →" : "← backward pass"}</h3>
        <svg viewBox="0 0 410 260" width="100%" role="img" aria-label="Network diagram">
          {SIZES.slice(0, -1).map((_, l) => Array.from({ length: SIZES[l] }).map((_, i) => Array.from({ length: SIZES[l + 1] }).map((_, j) => {
            const w = n.W[l][j * SIZES[l] + i];
            return (<g key={`${l}-${i}-${j}`}>
              <line x1={NX[l]} y1={ny(l, i)} x2={NX[l + 1]} y2={ny(l + 1, j)} stroke={w > 0 ? "#22d3ee" : "#f472b6"} strokeOpacity={0.08 + Math.min(0.35, Math.abs(w) * 0.2)} strokeWidth={0.4 + Math.min(2, Math.abs(w))} />
              <line className={`ail-flow ${bwd ? "bwd" : ""}`} x1={NX[l]} y1={ny(l, i)} x2={NX[l + 1]} y2={ny(l + 1, j)} stroke={bwd ? "#f472b6" : "#22d3ee"} strokeOpacity={0.25} strokeWidth={1} />
            </g>);
          })))}
          {SIZES.map((s, l) => Array.from({ length: s }).map((_, i) => {
            const k = bwd ? (l === 0 ? 0 : Math.abs(d[l][i]) / dmax) : Math.min(1, Math.abs(a[l][i]));
            return <circle key={`${l}-${i}`} className="ail-node" cx={NX[l]} cy={ny(l, i)} r={6 + k * 5} fill={bwd ? "#f472b6" : "#22d3ee"} fillOpacity={0.15 + k * 0.85} stroke="#e8edff" strokeOpacity={0.5} />;
          }))}
          {["input", "hidden 1", "hidden 2", "output"].map((t, l) => <text key={t} x={NX[l]} y={252} textAnchor="middle" fontSize="10" fill="#8e97c4">{t}</text>)}
        </svg>
        <div className="ail-viz">
          <canvas ref={cv} width={264} height={264} className="ail-canvas" aria-label="Decision boundary" />
          <div>
            <div className="ail-stat">loss {Number.isFinite(loss) ? loss.toFixed(4) : "…"} · step {n.t}</div>
            <svg viewBox="0 0 300 74" width="100%" style={{ background: "#02040e", borderRadius: 12, border: "1px solid var(--line)", marginTop: 6 }}><polyline points={pts} fill="none" stroke="#a3e635" strokeWidth="1.8" /></svg>
            <div className="ail-row">{(["circles", "xor", "spiral"] as DataKind[]).map((k) => <button key={k} className={`ail-btn ${kind === k ? "on" : ""}`} onClick={() => reset(k)}>{k}</button>)}</div>
            <div className="ail-row">{(["sgd", "adam"] as Opt[]).map((o) => <button key={o} className={`ail-btn ${opt === o ? "on" : ""}`} onClick={() => { setOpt(o); reset(); mref.current.say(o === "adam" ? "Adam: momentum plus per-weight step sizes." : "Plain SGD. Simple, honest, slow."); }}>{o.toUpperCase()}</button>)}
              <button className="ail-btn" onClick={() => setRunning((r) => !r)}>{running ? "⏸ pause" : "▶ train"}</button><button className="ail-btn" onClick={() => reset()}>↺ reset</button></div>
            <div className="ail-row"><label>learning rate {lr.toFixed(3)}<input type="range" min={0.005} max={0.3} step={0.005} value={lr} onChange={(e) => setLr(+e.target.value)} /></label></div>
          </div>
        </div>
      </div>
    </div>
  );
}
