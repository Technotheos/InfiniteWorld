// Dev-only harness: two voice clients in one page, with an in-memory stand-in for the server's "voice" and "rtc" relay.
import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { useVoice } from "./game/voice/useVoice";
import type { PlayerView, RtcSignal, StateView } from "./game/types";
import { RELIC_MAP } from "./game/dev/fixtures";

type Flags = { on: boolean; mic: boolean; cam: boolean };
const NAMES = ["ann", "bob", "cy"];

function Harness() {
  const [flags, setFlags] = useState<Record<string, Flags>>({});
  const subs = useRef<Record<string, Set<(s: RtcSignal) => void>>>({});
  const sdpSizes = useRef<number[]>([]);
  (window as unknown as { __sdp: number[] }).__sdp = sdpSizes.current;

  const players: PlayerView[] = NAMES.map((n) => ({ name: n, ready: false, connected: true, spectator: false, host: false, score: 0, gain: 0, progress: 0, voice: flags[n]?.on ? flags[n] : undefined }));
  const stateFor = (you: string): StateView => ({ code: "T", map: RELIC_MAP, phase: "lobby", you, spectating: false, players, mission: -1, deadline: 0, now: Date.now() });

  const sendFor = useCallback((from: string) => (type: string, payload?: unknown) => {
    if (type === "voice") setFlags((f) => ({ ...f, [from]: payload as Flags }));
    if (type === "rtc") {
      const m = payload as { to: string; kind: "offer" | "answer"; sdp: string };
      sdpSizes.current.push(m.sdp.length);
      queueMicrotask(() => subs.current[m.to]?.forEach((fn) => fn({ from, kind: m.kind, sdp: m.sdp })));
    }
  }, []);
  const onRtcFor = useCallback((name: string) => (fn: (s: RtcSignal) => void) => {
    (subs.current[name] ??= new Set()).add(fn);
    return () => { subs.current[name]?.delete(fn); };
  }, []);

  return <div>{NAMES.map((n) => <Client key={n} name={n} state={stateFor(n)} send={sendFor(n)} onRtc={onRtcFor(n)} />)}</div>;
}

function Client({ name, state, send, onRtc }: { name: string; state: StateView; send: (t: never, p?: unknown) => void; onRtc: (fn: (s: RtcSignal) => void) => () => void }) {
  const voice = useVoice({ state, send: send as never, onRtc });
  const [info, setInfo] = useState("");
  useEffect(() => {
    const id = setInterval(() => {
      const vids = Object.entries(voice.videos).map(([k, v]) => `${k}:${v.videoWidth}x${v.videoHeight}`).join(",");
      setInfo(`peers=[${voice.peers}] remoteVideo=[${vids}] speaking=${JSON.stringify(voice.speaking)}`);
    }, 300);
    return () => clearInterval(id);
  }, [voice]);
  (window as unknown as Record<string, unknown>)["__" + name] = voice;
  (window as unknown as Record<string, unknown>)["__info_" + name] = info;
  return (
    <div style={{ margin: 8 }}>
      <b>{name}</b> supported={String(voice.supported)} joined={String(voice.joined)} mic={String(voice.mic)} cam={String(voice.cam)} err={voice.error ?? ""} <br /> {info}
      <div>
        <button id={`join-${name}`} onClick={() => void voice.join()}>join</button>
        <button id={`cam-${name}`} onClick={() => void voice.toggleCam()}>cam</button>
        <button id={`leave-${name}`} onClick={voice.leave}>leave</button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />);
