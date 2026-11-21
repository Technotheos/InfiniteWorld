// @ts-nocheck
// Shared three.js helpers for the 3D rooms (Brain Bazaar, Midnight Mystery).
// Everything here is client-side decoration: the server owns the game, the scene only
// draws the state it is given. Scenes degrade gracefully: no WebGL means no canvas,
// and the normal UI keeps working. This file is checked at runtime, not by tsc
// (three ships without types in this project), hence the @ts-nocheck above.
import * as THREE from "three";

export interface SceneHandle<S> {
  update: (state: S) => void;
  dispose: () => void;
}

export interface Stage {
  /** Absent on the headless test stage. Scenes that want shadows switch them on here. */
  renderer?: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  reduced: boolean;
  /** Register a per-frame callback (t = seconds since start, dt = seconds since last frame). */
  frame: (fn: (t: number, dt: number) => void) => void;
  dispose: () => void;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function disposeScene(scene: THREE.Scene) {
  scene.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}

/** Creates a renderer inside `host` and runs the loop. Returns null when WebGL is unavailable. */
export function createStage(host: HTMLElement, opts: { fov?: number; lowPower?: boolean } = {}): Stage | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !opts.lowPower, alpha: false, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 42, 2, 0.1, 120);
  const fit = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
  ro?.observe(host);
  fit();

  const frames: Array<(t: number, dt: number) => void> = [];
  const clock = new THREE.Clock();
  let raf = 0;
  let lost = false;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (document.hidden || lost) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    for (const f of frames) f(t, dt);
    renderer.render(scene, camera);
  };
  renderer.domElement.addEventListener("webglcontextlost", (e: Event) => { e.preventDefault(); lost = true; });
  renderer.domElement.addEventListener("webglcontextrestored", () => { lost = false; });
  raf = requestAnimationFrame(loop);

  return {
    renderer, scene, camera, reduced: prefersReducedMotion(),
    frame: (fn) => { frames.push(fn); },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** A stage with no renderer, for tests: call tick(t, dt) yourself. */
export function createHeadlessStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 120);
  const frames: Array<(t: number, dt: number) => void> = [];
  return {
    scene, camera, reduced: false,
    frame: (fn: (t: number, dt: number) => void) => { frames.push(fn); },
    tick: (t: number, dt: number) => { for (const f of frames) f(t, dt); },
    dispose: () => disposeScene(scene),
  };
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A text sprite that always faces the camera. `set` redraws it. */
export function makeLabel(text: string, color = "#ffffff", scale = 1) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 72;
  const g = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(2.2 * scale, 0.62 * scale, 1);
  sprite.renderOrder = 10;
  let last = "";
  let lastColor = "";
  const set = (t: string, col = color) => {
    if (t === last && col === lastColor) return;
    last = t;
    lastColor = col;
    g.clearRect(0, 0, 256, 72);
    g.font = "700 34px system-ui, -apple-system, Segoe UI, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0,0,0,0.8)";
    g.strokeText(t, 128, 38);
    g.fillStyle = col;
    g.fillText(t, 128, 38);
    tex.needsUpdate = true;
  };
  set(text);
  return { sprite, set };
}

/** One draw call of additive sparks: confetti, coin glitter, dust puffs. */
export function createParticles(scene: THREE.Scene, max = 320, size = 0.13, gravity = 6) {
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  for (let i = 0; i < max; i++) pos[i * 3 + 1] = -100;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  let cursor = 0;
  const c = new THREE.Color();
  return {
    burst(x: number, y: number, z: number, n: number, speed: number, hex: number | number[], life0 = 1.6) {
      for (let k = 0; k < n; k++) {
        const i = cursor++ % max;
        const th = Math.random() * Math.PI * 2;
        const up = 0.35 + Math.random() * 0.65;
        const s = speed * (0.4 + Math.random() * 0.6);
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = Math.cos(th) * s * (1 - up * 0.5);
        vel[i * 3 + 1] = s * up * 1.4;
        vel[i * 3 + 2] = Math.sin(th) * s * (1 - up * 0.5);
        life[i] = life0 * (0.6 + Math.random() * 0.4);
        c.set(Array.isArray(hex) ? hex[Math.floor(Math.random() * hex.length)] : hex);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    },
    update(dt: number) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -100; continue; }
        vel[i * 3 + 1] -= gravity * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Frame-rate independent smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
