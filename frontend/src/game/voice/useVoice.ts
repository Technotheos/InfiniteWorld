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
//  - The server's view of "who is in voice, mic on, cam on" is what everybody sees, so this hook keeps
//    re-asserting its own state until the server agrees (a phone that drops and reconnects would otherwise
//    be shown as having left voice while still listening).
//  - Remote audio goes through Web Audio so volume can follow distance in the 3D map (proximity voice).
//    Safari and iOS cannot be trusted with that, so there it plays straight from an <audio> element.

const ICE_WAIT_MS = 2500;
const RECHECK_MS = 3000;

function iceServers(): RTCIceServer[] {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const list: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  // Optional relay for strict NATs: set VITE_TURN_URL (+ VITE_TURN_USER / VITE_TURN_PASS) at build time.
  if (env.VITE_TURN_URL) {
    list.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  }
  return list;
}

const UA = typeof navigator === "undefined" ? "" : navigator.userAgent;
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(UA);
/** Safari and iOS: remote WebRTC audio into Web Audio is unreliable, so play it from a media element. */
const DIRECT_AUDIO = IS_IOS || IS_SAFARI;

export type CamQuality = "low" | "med" | "high";
const QUALITY: Record<CamQuality, { w: number; h: number; fps: number }> = {
  low: { w: 160, h: 120, fps: 12 },
  med: { w: 320, h: 240, fps: 15 },
  high: { w: 640, h: 480, fps: 24 },
};

interface PeerAudio {
  el: HTMLAudioElement;
  gain?: GainNode;
  src?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
}
interface Peer {
  pc: RTCPeerConnection;
  since: number;
  audio?: PeerAudio;
  video?: HTMLVideoElement;
}

export interface VoiceApi {
  /** RTCPeerConnection exists, so at least listening and watching works. */
  supported: boolean;
  /** getUserMedia is allowed here (HTTPS or localhost). Without it you can only listen and watch. */
  canSend: boolean;
  joined: boolean;
  mic: boolean;
  cam: boolean;
  busy: boolean;
  error: string | null;
  /** The browser refused to start someone's audio; one tap anywhere (or enableAudio) fixes it. */
  audioBlocked: boolean;
  join: () => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  /** Swap between front and back camera (phones). */
  flipCamera: () => Promise<void>;
  camQuality: CamQuality;
  setCamQuality: (q: CamQuality) => void;
  enableAudio: () => void;
  /** Your own camera, mirrored in the UI. */
  local: MediaStream | null;
  /** A hidden, playing <video> of your own camera (for the 3D hologram). */
  localVideo: HTMLVideoElement | null;
  /** Remote video streams by player name (frames only arrive while their camera is on). */
  remote: Record<string, MediaStream>;
  /** Hidden <video> elements, for putting a feed on a 3D surface. */
  videos: Record<string, HTMLVideoElement>;
  /** Who is talking right now (including you). */
  speaking: Record<string, boolean>;
  /** 0..1 volume from distance in the 3D map (proximity voice). */
  setVolume: (name: string, v: number) => void;
  /** 0..1 volume the listener chose for one person. 0 mutes them for you only. */
  setUserVolume: (name: string, v: number) => void;
  userVolumes: Record<string, number>;
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

/** Media elements must be in the page to play reliably on iOS, so they live in one invisible holder. */
function holder(): HTMLElement {
  let h = document.getElementById("iw-voice-holder");
  if (!h) {
    h = document.createElement("div");
    h.id = "iw-voice-holder";
    h.setAttribute("aria-hidden", "true");
    h.style.cssText = "position:fixed;left:-20px;top:0;width:2px;height:2px;overflow:hidden;opacity:.01;pointer-events:none;";
    document.body.appendChild(h);
  }
  return h;
}

export function useVoice({ state, send, onRtc }: Opts): VoiceApi {
  const enabled = Boolean(state?.map.voice);
  const me = state?.you ?? "";
  const supported = enabled && typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined";
  const canSend = supported && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  const [joined, setJoined] = useState(false);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [localVideo, setLocalVideo] = useState<HTMLVideoElement | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [peerNames, setPeerNames] = useState<string[]>([]);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [camQuality, setCamQualityState] = useState<CamQuality>("med");
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});

  const peers = useRef(new Map<string, Peer>());
  const videos = useRef<Record<string, HTMLVideoElement>>({});
  const micTrack = useRef<MediaStreamTrack | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const facing = useRef<"user" | "environment">("user");
  const quality = useRef<CamQuality>("med");
  const ctx = useRef<AudioContext | null>(null);
  const joinedRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const meRef = useRef(me);
  meRef.current = me;
  const stateRef = useRef(state);
  stateRef.current = state;
  const flagsRef = useRef({ mic: false, cam: false });
  flagsRef.current = { mic, cam };
  const speakRef = useRef<Record<string, boolean>>({});
  const localAnalyser = useRef<AnalyserNode | null>(null);
  const prox = useRef<Record<string, number>>({});
  const user = useRef<Record<string, number>>({});
  const blocked = useRef(new Set<HTMLMediaElement>());

  const publishPeers = () => setPeerNames([...peers.current.keys()]);

  // ---- volume = distance in the map x what this listener chose --------------------
  const applyGain = useCallback((name: string) => {
    const a = peers.current.get(name)?.audio;
    if (!a) return;
    const v = Math.max(0, Math.min(1, (prox.current[name] ?? 1) * (user.current[name] ?? 1)));
    if (a.gain && ctx.current) a.gain.gain.setTargetAtTime(v, ctx.current.currentTime, 0.15);
    else a.el.volume = v; // iOS ignores this (volume is read-only there); everywhere else it works
  }, []);
  const setVolume = useCallback((name: string, v: number) => { prox.current[name] = v; applyGain(name); }, [applyGain]);
  const setUserVolume = useCallback((name: string, v: number) => {
    user.current[name] = v;
    setUserVolumes((m) => ({ ...m, [name]: v }));
    applyGain(name);
  }, [applyGain]);

  const tryPlay = useCallback((el: HTMLMediaElement) => {
    el.play().then(() => { blocked.current.delete(el); setAudioBlocked(blocked.current.size > 0); }).catch(() => {
      blocked.current.add(el);
      setAudioBlocked(true);
    });
  }, []);
  const enableAudio = useCallback(() => {
    void ctx.current?.resume();
    for (const el of [...blocked.current]) tryPlay(el);
  }, [tryPlay]);
  useEffect(() => {
    if (!audioBlocked) return;
    const go = () => enableAudio();
    window.addEventListener("pointerdown", go, { passive: true });
    window.addEventListener("keydown", go, { passive: true });
    return () => { window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); };
  }, [audioBlocked, enableAudio]);

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
    try { p.audio?.src?.disconnect(); p.audio?.gain?.disconnect(); p.audio?.analyser?.disconnect(); } catch { /* already gone */ }
    if (p.audio) { blocked.current.delete(p.audio.el); p.audio.el.srcObject = null; p.audio.el.remove(); }
    if (p.video) { p.video.srcObject = null; p.video.remove(); }
    delete videos.current[name];
    p.pc.close();
    setRemote((r) => { const n = { ...r }; delete n[name]; return n; });
    delete speakRef.current[name];
    setAudioBlocked(blocked.current.size > 0);
    publishPeers();
  }, []);

  const makePeer = useCallback((name: string): Peer => {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer: Peer = { pc, since: Date.now() };
    peers.current.set(name, peer);

    pc.ontrack = (e) => {
      const track = e.track;
      if (track.kind === "audio") {
        const only = new MediaStream([track]);
        const el = new Audio();
        el.srcObject = only;
        el.setAttribute("playsinline", "");
        el.autoplay = true;
        holder().appendChild(el);
        const audio: PeerAudio = { el };
        const c = ctx.current;
        try {
          if (c && !DIRECT_AUDIO) {
            // Chrome only feeds Web Audio from a remote stream that is also held by a media element.
            el.muted = true;
            audio.src = c.createMediaStreamSource(only);
            audio.gain = c.createGain();
            audio.analyser = c.createAnalyser();
            audio.analyser.fftSize = 256;
            audio.src.connect(audio.gain);
            audio.gain.connect(c.destination);
            audio.src.connect(audio.analyser);
          } else if (c) {
            // Direct playback: Web Audio is only used to read the level for the "talking" ring.
            audio.src = c.createMediaStreamSource(only);
            audio.analyser = c.createAnalyser();
            audio.analyser.fftSize = 256;
            audio.src.connect(audio.analyser);
          }
        } catch { /* no Web Audio: the element still plays the sound */ }
        peer.audio = audio;
        tryPlay(el);
        applyGain(name);
      } else {
        const vs = new MediaStream([track]);
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.srcObject = vs;
        holder().appendChild(v);
        void v.play().catch(() => undefined);
        peer.video = v;
        videos.current[name] = v;
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
  }, [applyGain, closePeer, tryPlay]);

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
  const inVoiceRef = useRef(inVoice);
  inVoiceRef.current = inVoice;

  const reconcile = useCallback(() => {
    if (!joinedRef.current) return;
    const want = new Set(inVoiceRef.current ? inVoiceRef.current.split("|") : []);
    const now = Date.now();
    for (const [name, p] of [...peers.current]) {
      const st = p.pc.connectionState;
      const dead = st === "failed" || st === "closed" ||
        (st === "disconnected" && now - p.since > 6000) ||
        ((st === "new" || st === "connecting") && now - p.since > 20000);
      if (!want.has(name) || dead) closePeer(name);
    }
    for (const name of want) {
      if (!peers.current.has(name) && meRef.current < name) void callPeer(name);
    }
  }, [callPeer, closePeer]);

  useEffect(() => { reconcile(); }, [joined, inVoice, reconcile]);
  useEffect(() => {
    if (!joined) return;
    const id = window.setInterval(reconcile, RECHECK_MS);
    return () => window.clearInterval(id);
  }, [joined, reconcile]);

  // ---- tell the room (and the UI) what is live, and keep telling it until it agrees ----
  useEffect(() => {
    if (!enabled || !state) return;
    send("voice", { on: joined, mic: joined && mic, cam: joined && cam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, mic, cam, enabled]);

  useEffect(() => {
    if (!enabled || !joined) return;
    const id = window.setInterval(() => {
      const mine = stateRef.current?.players.find((p) => p.name === meRef.current);
      const v = mine?.voice;
      const f = flagsRef.current;
      if (!v?.on) {
        // The server has forgotten us (we dropped and reconnected). Everyone else closed their side when we
        // vanished, so our old connections are dead: rebuild them now instead of waiting for them to time out.
        const seenOnce = mine !== undefined;
        if (seenOnce && peers.current.size) for (const name of [...peers.current.keys()]) closePeer(name);
        sendRef.current("voice", { on: true, mic: f.mic, cam: f.cam });
        window.setTimeout(reconcile, 400);
      } else if (v.mic !== f.mic || v.cam !== f.cam) {
        sendRef.current("voice", { on: true, mic: f.mic, cam: f.cam });
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [enabled, joined, closePeer, reconcile]);

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
      for (const [name, p] of peers.current) if (p.audio?.analyser) next[name] = level(p.audio.analyser) > 0.02;
      const prev = speakRef.current;
      const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => next[k] === prev[k]);
      if (!same) { speakRef.current = next; setSpeaking(next); }
    }, 140);
    return () => window.clearInterval(id);
  }, [joined]);

  // ---- local camera preview (also a hidden <video> for the 3D hologram) -------
  useEffect(() => {
    if (!local) { setLocalVideo(null); return; }
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true; v.srcObject = local;
    holder().appendChild(v);
    void v.play().catch(() => undefined);
    setLocalVideo(v);
    return () => { v.srcObject = null; v.remove(); };
  }, [local]);

  // ---- actions --------------------------------------------------------------
  const join = useCallback(async () => {
    if (!supported || joinedRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try { ctx.current = new AC(); void ctx.current.resume(); } catch { ctx.current = null; }
      if (!canSend) {
        setError("This page is not on HTTPS, so the browser blocks your mic and camera. You can still listen and watch.");
        setMic(false);
      } else {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          micTrack.current = s.getAudioTracks()[0] ?? null;
          if (micTrack.current && ctx.current) {
            const an = ctx.current.createAnalyser();
            an.fftSize = 256;
            ctx.current.createMediaStreamSource(new MediaStream([micTrack.current])).connect(an); // not connected to speakers
            localAnalyser.current = an;
          }
          setMic(Boolean(micTrack.current));
        } catch {
          // No mic or permission denied: still join so you can hear and see everyone else.
          setError("Microphone unavailable. You can still listen and watch.");
          setMic(false);
        }
      }
      joinedRef.current = true;
      setJoined(true);
    } finally {
      setBusy(false);
    }
  }, [busy, canSend, supported]);

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
    if (!t) { setError(canSend ? "No microphone. Check your browser permissions." : "Mic needs HTTPS. This page is not secure."); return; }
    t.enabled = !t.enabled;
    setMic(t.enabled);
  }, [canSend]);

  const openCamera = useCallback(async () => {
    const q = QUALITY[quality.current];
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps + 6 }, facingMode: { ideal: facing.current } },
    });
    return s.getVideoTracks()[0] ?? null;
  }, []);

  const pushCamTrack = useCallback(() => {
    for (const { pc } of peers.current.values()) {
      for (const t of pc.getTransceivers()) if (t.receiver.track.kind === "video") void t.sender.replaceTrack(camTrack.current).catch(() => undefined);
    }
  }, []);

  const toggleCam = useCallback(async () => {
    if (!joinedRef.current) return;
    if (camTrack.current) {
      camTrack.current.stop();
      camTrack.current = null;
      setLocal(null);
      setCam(false);
    } else {
      if (!canSend) { setError("Camera needs HTTPS. This page is not secure."); return; }
      try {
        // Small and slow by default: in a full mesh every camera is uploaded once per player.
        camTrack.current = await openCamera();
        if (camTrack.current) { setLocal(new MediaStream([camTrack.current])); setCam(true); }
        setError(null);
      } catch {
        setError("Camera unavailable. Check your browser permissions.");
        return;
      }
    }
    pushCamTrack();
  }, [canSend, openCamera, pushCamTrack]);

  const flipCamera = useCallback(async () => {
    facing.current = facing.current === "user" ? "environment" : "user";
    if (!camTrack.current) return;
    camTrack.current.stop();
    try {
      camTrack.current = await openCamera();
      setLocal(camTrack.current ? new MediaStream([camTrack.current]) : null);
      pushCamTrack();
    } catch {
      facing.current = facing.current === "user" ? "environment" : "user";
      setError("Could not switch cameras.");
      setCam(false);
      setLocal(null);
      camTrack.current = null;
      pushCamTrack();
    }
  }, [openCamera, pushCamTrack]);

  const setCamQuality = useCallback((q: CamQuality) => {
    quality.current = q;
    setCamQualityState(q);
    const t = camTrack.current;
    if (t) {
      const c = QUALITY[q];
      void t.applyConstraints({ width: { ideal: c.w }, height: { ideal: c.h }, frameRate: { ideal: c.fps, max: c.fps + 6 } }).catch(() => undefined);
    }
  }, []);

  // Leave cleanly when the room view goes away.
  useEffect(() => () => {
    joinedRef.current = false;
    for (const name of [...peers.current.keys()]) {
      const p = peers.current.get(name);
      p?.pc.close();
      p?.audio?.el.remove();
      p?.video?.remove();
    }
    peers.current.clear();
    micTrack.current?.stop();
    camTrack.current?.stop();
    void ctx.current?.close().catch(() => undefined);
  }, []);

  return {
    supported, canSend, joined, mic, cam, busy, error, audioBlocked, join, leave, toggleMic, toggleCam, flipCamera,
    camQuality, setCamQuality, enableAudio, local, localVideo, remote, videos: videos.current, speaking,
    setVolume, setUserVolume, userVolumes, peers: peerNames,
  };
}
