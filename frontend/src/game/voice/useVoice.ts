import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMsgType, RtcSignal, StateView } from "../types";

// Voice and camera for a room, peer to peer.
//
//  - Signalling (offers/answers) rides the room's existing WebSocket; the server only relays it between
//    people who are both in the voice chat (see "rtc" in game_room.go). Audio and video never touch the server.
//  - Full mesh: every player connects to every other. That is fine for the room sizes here (2-6).
//  - Every connection always has one audio and one video transceiver. Turning the mic or camera on and off
//    swaps the track on the sender (replaceTrack), so nothing is ever renegotiated mid-game.
//  - ICE is gathered fully before sending (no trickling): one message per offer/answer keeps signalling
//    far under the socket's rate limit.
//  - Remote audio goes through Web Audio so volume can follow distance in the 3D map (proximity voice).

const ICE_WAIT_MS = 2500;

function iceServers(): RTCIceServer[] {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const list: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  // Optional relay for strict NATs: set VITE_TURN_URL (+ VITE_TURN_USER / VITE_TURN_PASS) at build time.
  if (env.VITE_TURN_URL) {
    list.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  }
  return list;
}

interface Peer {
  pc: RTCPeerConnection;
  audio?: { src: MediaStreamAudioSourceNode; gain: GainNode; analyser: AnalyserNode; el: HTMLAudioElement };
  video?: HTMLVideoElement;
  stream: MediaStream;
}

export interface VoiceApi {
  /** getUserMedia + RTCPeerConnection exist and the page is a secure context. */
  supported: boolean;
  joined: boolean;
  mic: boolean;
  cam: boolean;
  busy: boolean;
  error: string | null;
  join: () => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  /** Your own camera, mirrored in the UI. */
  local: MediaStream | null;
  /** Remote video streams by player name (frames only arrive while their camera is on). */
  remote: Record<string, MediaStream>;
  /** Hidden <video> elements, for putting a feed on a 3D surface. */
  videos: Record<string, HTMLVideoElement>;
  /** Who is talking right now (including you). */
  speaking: Record<string, boolean>;
  /** 0..1 volume for one remote player. Used for proximity voice. */
  setVolume: (name: string, v: number) => void;
  /** Names of people we are connected to (or connecting with). */
  peers: string[];
}

interface Opts {
  state: StateView | null;
  send: (type: ClientMsgType, payload?: unknown) => void;
  onRtc?: (fn: (s: RtcSignal) => void) => () => void;
}

function waitIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      window.clearTimeout(t);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const t = window.setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Keep the SDP small: VP8 and H.264 only. The server caps a signalling message at 14 KB. */
function slimVideoCodecs(pc: RTCPeerConnection) {
  try {
    const caps = RTCRtpReceiver.getCapabilities("video");
    if (!caps) return;
    const keep = caps.codecs.filter((c) => !/VP9|AV1/i.test(c.mimeType));
    for (const t of pc.getTransceivers()) {
      if (t.receiver.track.kind === "video" && keep.length) t.setCodecPreferences(keep);
    }
  } catch { /* older browsers: the full list still works, just a bigger SDP */ }
}

export function useVoice({ state, send, onRtc }: Opts): VoiceApi {
  const enabled = Boolean(state?.map.voice);
  const me = state?.you ?? "";
  const supported = enabled && typeof window !== "undefined" && window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== "undefined";

  const [joined, setJoined] = useState(false);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [peerNames, setPeerNames] = useState<string[]>([]);

  const peers = useRef(new Map<string, Peer>());
  const videos = useRef<Record<string, HTMLVideoElement>>({});
  const micTrack = useRef<MediaStreamTrack | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const joinedRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const meRef = useRef(me);
  meRef.current = me;
  const speakRef = useRef<Record<string, boolean>>({});
  const localAnalyser = useRef<AnalyserNode | null>(null);

  const publishPeers = () => setPeerNames([...peers.current.keys()]);

  // ---- attach our tracks to a connection ------------------------------------
  const attachLocal = useCallback((pc: RTCPeerConnection) => {
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      t.direction = "sendrecv";
      void t.sender.replaceTrack(kind === "audio" ? micTrack.current : camTrack.current).catch(() => undefined);
    }
  }, []);

  const closePeer = useCallback((name: string) => {
    const p = peers.current.get(name);
    if (!p) return;
    peers.current.delete(name);
    try { p.audio?.src.disconnect(); p.audio?.gain.disconnect(); p.audio?.analyser.disconnect(); } catch { /* already gone */ }
    if (p.audio) { p.audio.el.srcObject = null; }
    if (p.video) p.video.srcObject = null;
    delete videos.current[name];
    p.pc.close();
    setRemote((r) => { const n = { ...r }; delete n[name]; return n; });
    delete speakRef.current[name];
    publishPeers();
  }, []);

  const makePeer = useCallback((name: string): Peer => {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const stream = new MediaStream();
    const peer: Peer = { pc, stream };
    peers.current.set(name, peer);

    pc.ontrack = (e) => {
      const track = e.track;
      if (track.kind === "audio") {
        const c = ctx.current;
        if (!c) return;
        const only = new MediaStream([track]);
        // Chrome only feeds Web Audio from a remote stream that is also held by a media element.
        const el = new Audio();
        el.srcObject = only;
        el.muted = true;
        void el.play().catch(() => undefined);
        const src = c.createMediaStreamSource(only);
        const gain = c.createGain();
        const analyser = c.createAnalyser();
        analyser.fftSize = 256;
        src.connect(gain);
        gain.connect(c.destination);
        src.connect(analyser);
        peer.audio = { src, gain, analyser, el };
      } else {
        const vs = new MediaStream([track]);
        peer.video = document.createElement("video");
        peer.video.muted = true;
        peer.video.playsInline = true;
        peer.video.autoplay = true;
        peer.video.srcObject = vs;
        void peer.video.play().catch(() => undefined);
        videos.current[name] = peer.video;
        setRemote((r) => ({ ...r, [name]: vs }));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (peers.current.get(name)?.pc === pc) closePeer(name);
      }
    };
    publishPeers();
    return peer;
  }, [closePeer]);

  // ---- signalling -----------------------------------------------------------
  const sendSignal = (to: string, kind: "offer" | "answer", pc: RTCPeerConnection) => {
    const sdp = pc.localDescription?.sdp;
    if (sdp) sendRef.current("rtc", { to, kind, sdp });
  };

  const callPeer = useCallback(async (name: string) => {
    const peer = makePeer(name);
    const { pc } = peer;
    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    slimVideoCodecs(pc);
    attachLocal(pc);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      if (peers.current.get(name)?.pc === pc) sendSignal(name, "offer", pc);
    } catch {
      closePeer(name);
    }
  }, [attachLocal, closePeer, makePeer]);

  const handleSignal = useCallback(async (s: RtcSignal) => {
    if (!joinedRef.current) return;
    try {
      if (s.kind === "offer") {
        if (peers.current.has(s.from)) closePeer(s.from); // they restarted: start clean
        const { pc } = makePeer(s.from);
        await pc.setRemoteDescription({ type: "offer", sdp: s.sdp });
        slimVideoCodecs(pc);
        attachLocal(pc);
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        if (peers.current.get(s.from)?.pc === pc) sendSignal(s.from, "answer", pc);
      } else {
        const p = peers.current.get(s.from);
        if (p && p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
      }
    } catch {
      closePeer(s.from);
    }
  }, [attachLocal, closePeer, makePeer]);

  useEffect(() => (onRtc ? onRtc((s) => { void handleSignal(s); }) : undefined), [onRtc, handleSignal]);

  // ---- who should we be connected to? ---------------------------------------
  // Everyone in voice chat. The player whose name sorts first makes the offer, so two people
  // never offer to each other at the same moment.
  const inVoice = useMemo(
    () => (state?.players ?? []).filter((p) => p.voice?.on && p.connected && p.name !== me).map((p) => p.name).join("|"),
    [state?.players, me],
  );
  useEffect(() => {
    if (!joined) return;
    const want = new Set(inVoice ? inVoice.split("|") : []);
    for (const name of [...peers.current.keys()]) if (!want.has(name)) closePeer(name);
    for (const name of want) {
      if (!peers.current.has(name) && meRef.current < name) void callPeer(name);
    }
  }, [joined, inVoice, callPeer, closePeer]);

  // A dead connection is rebuilt on the next state snapshot (the effect above runs again as peers.size changes).
  useEffect(() => {
    if (!joined) return;
    const id = window.setInterval(() => {
      const want = inVoice ? inVoice.split("|") : [];
      for (const name of want) {
        if (!peers.current.has(name) && meRef.current < name) void callPeer(name);
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [joined, inVoice, callPeer]);

  // ---- tell the room (and the UI) what is live -------------------------------
  useEffect(() => {
    if (!enabled || !state) return;
    send("voice", { on: joined, mic: joined && mic, cam: joined && cam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, mic, cam, enabled]);

  // ---- speaking detection ----------------------------------------------------
  useEffect(() => {
    if (!joined) return;
    const buf = new Uint8Array(128);
    const level = (a: AnalyserNode) => {
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i]! - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / buf.length);
    };
    const id = window.setInterval(() => {
      const next: Record<string, boolean> = {};
      if (localAnalyser.current && micTrack.current?.enabled) next[meRef.current] = level(localAnalyser.current) > 0.035;
      for (const [name, p] of peers.current) if (p.audio) next[name] = level(p.audio.analyser) > 0.02;
      const prev = speakRef.current;
      const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => next[k] === prev[k]);
      if (!same) { speakRef.current = next; setSpeaking(next); }
    }, 140);
    return () => window.clearInterval(id);
  }, [joined]);

  // ---- actions --------------------------------------------------------------
  const join = useCallback(async () => {
    if (!supported || joinedRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = new AC();
      void ctx.current.resume();
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micTrack.current = s.getAudioTracks()[0] ?? null;
        if (micTrack.current) {
          const an = ctx.current.createAnalyser();
          an.fftSize = 256;
          ctx.current.createMediaStreamSource(new MediaStream([micTrack.current])).connect(an); // not connected to speakers
          localAnalyser.current = an;
          setMic(true);
        }
      } catch {
        // No mic or permission denied: still join so you can hear and see everyone else.
        setError("Microphone unavailable. You can still listen and watch.");
        setMic(false);
      }
      joinedRef.current = true;
      setJoined(true);
    } finally {
      setBusy(false);
    }
  }, [busy, supported]);

  const leave = useCallback(() => {
    joinedRef.current = false;
    for (const name of [...peers.current.keys()]) closePeer(name);
    micTrack.current?.stop();
    camTrack.current?.stop();
    micTrack.current = camTrack.current = null;
    localAnalyser.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLocal(null);
    setMic(false);
    setCam(false);
    setSpeaking({});
    speakRef.current = {};
    setJoined(false);
  }, [closePeer]);

  const toggleMic = useCallback(() => {
    const t = micTrack.current;
    if (!t) { setError("No microphone. Check your browser permissions."); return; }
    t.enabled = !t.enabled;
    setMic(t.enabled);
  }, []);

  const toggleCam = useCallback(async () => {
    if (!joinedRef.current) return;
    if (camTrack.current) {
      camTrack.current.stop();
      camTrack.current = null;
      setLocal(null);
      setCam(false);
    } else {
      try {
        // Small and slow on purpose: in a full mesh every camera is uploaded once per player.
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } } });
        camTrack.current = s.getVideoTracks()[0] ?? null;
        if (camTrack.current) { setLocal(new MediaStream([camTrack.current])); setCam(true); }
        setError(null);
      } catch {
        setError("Camera unavailable. Check your browser permissions.");
        return;
      }
    }
    for (const { pc } of peers.current.values()) {
      for (const t of pc.getTransceivers()) if (t.receiver.track.kind === "video") void t.sender.replaceTrack(camTrack.current).catch(() => undefined);
    }
  }, []);

  const setVolume = useCallback((name: string, v: number) => {
    const g = peers.current.get(name)?.audio?.gain;
    const c = ctx.current;
    if (g && c) g.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), c.currentTime, 0.15);
  }, []);

  // Leave cleanly when the room view goes away.
  useEffect(() => () => {
    joinedRef.current = false;
    for (const name of [...peers.current.keys()]) {
      const p = peers.current.get(name);
      p?.pc.close();
    }
    peers.current.clear();
    micTrack.current?.stop();
    camTrack.current?.stop();
    void ctx.current?.close().catch(() => undefined);
  }, []);

  return {
    supported, joined, mic, cam, busy, error, join, leave, toggleMic, toggleCam,
    local, remote, videos: videos.current, speaking, setVolume, peers: peerNames,
  };
}
