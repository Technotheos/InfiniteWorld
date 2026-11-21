// @ts-nocheck
// The Cursed Relic: a haunted graveyard at night. Four landmarks, a stone altar in the middle, and you,
// walking with a lantern that gets hotter and faster the closer the buried relic is.
//
// Everything here is decoration driven by the server's state. The server owns positions, digs and the secret:
// the scene only draws what it is told, plus local movement prediction for the player's own avatar.
//
//  show  : the relic turns on the altar while the lore is read out
//  bury  : a gravekeeper carries it to the zone; the zone is swallowed by mist and the grave is dug INSIDE it,
//          so the show reveals where (public) but never exactly where (secret)
//  hunt  : third-person walk, dig, follow the lantern; wails scramble the readings
//  found : the relic rises out of the ground in a beam of light
import * as THREE from "three";
import { canvasTexture, createParticles, createStage, damp, lerp, makeLabel, type SceneHandle, type Stage } from "./common";
import type { RelicPlay, RelicPrivate } from "../types";

export interface RelicSceneState {
  play: RelicPlay;
  priv?: RelicPrivate;
  you: string;
  skew: number;
  spectating: boolean;
  /** Mutable joystick vector, -1..1 (touch). Keyboard is read by the scene itself. */
  joy: { x: number; y: number };
  /** Bumped by the UI each time the local player digs. */
  digCount: number;
  cams: Record<string, boolean>;
  speaking: Record<string, boolean>;
  videos: Record<string, HTMLVideoElement | undefined>;
  localVideo?: HTMLVideoElement | null;
  onMove: (x: number, z: number, ry: number) => void;
  onLocal?: (x: number, z: number) => void;
}

const HEAT_COL = [0x4f6bff, 0x38bdf8, 0xf5c14a, 0xff8a2a, 0xff2a3a];
const HEAT_GAP = [0, 2.4, 1.6, 1.0, 0.55]; // seconds between lantern ripples
const SPEED = 7;
const ZONE_RADIUS = 8;

export const hashHue = (n: string) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; };
export const heightAt = (x: number, z: number) => {
  const flat = Math.min(1, Math.max(0, (Math.hypot(x, z) - 5) / 6)); // the altar plain stays level
  return ((Math.sin(x * 0.13) + Math.cos(z * 0.11)) * 0.35 + Math.sin((x + z) * 0.2) * 0.15) * flat;
};

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mat = (color: number, o: any = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });
const glow = (color: number, k = 1.4) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- props ---------------------------------------------------------------------------------------------

export function makeRelic(key: string) {
  const g = new THREE.Group();
  if (key === "lantern") {
    const frame = mat(0x2a2320, { metalness: 0.6, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 8), frame);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.34, 8), frame); top.position.y = 0.98;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), glow(0x9dffe0, 2.2)); orb.position.y = 0.5;
    g.add(base, top, orb);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.84, 6), frame);
      const a = (i / 4) * Math.PI * 2 + 0.4; bar.position.set(Math.cos(a) * 0.33, 0.5, Math.sin(a) * 0.33); g.add(bar);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 16), frame); ring.position.y = 1.22; g.add(ring);
    g.userData.color = 0x9dffe0;
  } else if (key === "mask") {
    const bone = mat(0xe8e0c8, { roughness: 0.55 });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), bone); face.scale.set(0.82, 1.08, 0.5); face.position.y = 0.7;
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.18), bone); jaw.position.set(0, 0.28, 0.1);
    g.add(face, jaw);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), glow(0xff3050, 2.6)); eye.position.set(s * 0.17, 0.78, 0.2); g.add(eye);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.44, 8), bone); horn.position.set(s * 0.32, 1.12, 0); horn.rotation.z = -s * 0.4; g.add(horn);
    }
    g.userData.color = 0xff3050;
  } else {
    const jade = new THREE.MeshStandardMaterial({ color: 0x3fc98a, emissive: 0x0f6b42, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.8, 14), jade); body.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), jade); head.position.y = 1.07;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 6), jade); crown.position.y = 1.4;
    g.add(body, head, crown);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), mat(0x021a0f)); eye.position.set(s * 0.1, 1.1, 0.23); g.add(eye);
      const tear = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), mat(0x06060a, { roughness: 0.1 })); tear.position.set(s * 0.1, 0.96, 0.25); tear.name = "tear"; g.add(tear);
    }
    g.userData.color = 0x3fc98a;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function mistTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(190,215,235,.55)"); gr.addColorStop(1, "rgba(190,215,235,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function deadTree(r: () => number, scale = 1) {
  const g = new THREE.Group();
  const bark = mat(0x1d1612);
  const h = (2.4 + r() * 1.6) * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.22 * scale, h, 7), bark); trunk.position.y = h / 2; trunk.castShadow = true; g.add(trunk);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07 * scale, 1.3 * scale, 5), bark);
    const a = r() * Math.PI * 2; b.position.set(Math.cos(a) * 0.4 * scale, h * (0.55 + r() * 0.4), Math.sin(a) * 0.4 * scale);
    b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); b.castShadow = true; g.add(b);
  }
  return g;
}

function buildLandmark(i: number, zone: { x: number; z: number }, r: () => number) {
  const g = new THREE.Group();
  g.position.set(zone.x, heightAt(zone.x, zone.z), zone.z);
  const stone = mat(0x4a4d5a, { roughness: 1 });
  const tint = [0x3dff9a, 0x6fb7ff, 0xe8e0c8, 0xffb84d][i % 4];
  const lamp = new THREE.PointLight(tint, 9, 14, 2); lamp.position.y = 2.2; g.add(lamp);
  const rune = new THREE.Mesh(new THREE.RingGeometry(ZONE_RADIUS - 0.25, ZONE_RADIUS, 64), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.06; g.add(rune);

  if (i === 0) { // Weeping Grove: a huge willow with hanging strands
    const bark = mat(0x241a12);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.85, 5, 9), bark); trunk.position.y = 2.5; trunk.castShadow = true; g.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3.1, 14, 10), mat(0x1c3a2a)); crown.position.y = 5.6; crown.scale.y = 0.55; crown.castShadow = true; g.add(crown);
    for (let k = 0; k < 46; k++) {
      const a = r() * Math.PI * 2, d = 1.2 + r() * 2.2, len = 2.2 + r() * 2.4;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, len, 4), mat(0x2f6a4a, { transparent: true, opacity: 0.8 }));
      s.position.set(Math.cos(a) * d, 5.2 - len / 2, Math.sin(a) * d); s.userData.sway = r() * 6; s.name = "strand"; g.add(s);
    }
    for (let k = 0; k < 5; k++) { const t = deadTree(r, 0.9); const a = (k / 5) * 6.28 + 0.5; t.position.set(Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5); g.add(t); }
  } else if (i === 1) { // Drowned Chapel: broken walls, a flooded floor, a leaning cross
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32), new THREE.MeshStandardMaterial({ color: 0x0b2a4a, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.85 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.1; g.add(water);
    const wall = (x: number, z: number, w: number, h: number, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), stone); m.position.set(x, h / 2, z); m.rotation.y = ry; m.castShadow = true; g.add(m); };
    wall(-3.6, -2, 4.4, 3.8); wall(3.8, -2, 3, 2.4); wall(0, -4, 2.2, 5.2);
    wall(-4.6, 1.6, 3, 2.9, Math.PI / 2); wall(4.7, 1.2, 2.2, 1.6, Math.PI / 2);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.28, 8, 18, Math.PI), stone); arch.position.set(0, 3.2, -3.7); arch.castShadow = true; g.add(arch);
    const cross = new THREE.Group(); const cv = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), stone); cv.position.y = 1.1; const ch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.22), stone); ch.position.y = 1.7; cross.add(cv, ch); cross.position.set(2, 0, 2.4); cross.rotation.z = 0.28; g.add(cross);
  } else if (i === 2) { // Bone Orchard: rib arches, skull stakes, dead trees
    const bone = mat(0xdcd3b8, { roughness: 0.6 });
    for (let k = 0; k < 5; k++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.1, 6, 14, Math.PI), bone); rib.position.set(-4 + k * 2, 0, -1); rib.rotation.y = 0.2 * (k - 2); rib.castShadow = true; g.add(rib);
    }
    for (let k = 0; k < 9; k++) {
      const a = r() * 6.28, d = 2 + r() * 5;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.5, 5), mat(0x2a1d14)); stake.position.set(Math.cos(a) * d, 0.75, Math.sin(a) * d);
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), bone); skull.position.set(stake.position.x, 1.6, stake.position.z); skull.scale.set(0.9, 1, 1.05);
      g.add(stake, skull);
    }
    for (let k = 0; k < 4; k++) { const t = deadTree(r, 1.1); const a = r() * 6.28; t.position.set(Math.cos(a) * 7, 0, Math.sin(a) * 7); g.add(t); }
  } else { // Old Well
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.1, 18, 1, true), stone); ring.position.y = 0.55; ring.castShadow = true;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.1, 18, 1, true), mat(0x15161d, { side: THREE.BackSide })); inner.position.y = 0.55;
    const top = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 8, 22), stone); top.rotation.x = Math.PI / 2; top.position.y = 1.1;
    const abyss = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), glow(0x3a7bff, 0.6)); abyss.rotation.x = -Math.PI / 2; abyss.position.y = 0.2;
    g.add(ring, inner, top, abyss);
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), mat(0x2a1d14)); post.position.set(s * 1.7, 1.6, 0); post.castShadow = true; g.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.2, 0.2), mat(0x2a1d14)); beam.position.y = 3.2; g.add(beam);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.1, 4), mat(0x35261b)); roof.position.y = 3.9; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  }
  return g;
}

function makeAvatar(name: string, mine: boolean) {
  const g = new THREE.Group();
  const col = new THREE.Color().setHSL(hashHue(name) / 360, 0.62, 0.5);
  const body = new THREE.Group(); g.add(body);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 18), mat(col.getHex(), { roughness: 0.75 })); robe.position.y = 0.75; robe.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), mat(0xe8c6a0, { roughness: 0.6 })); head.position.y = 1.68; head.castShadow = true;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 12), mat(col.clone().multiplyScalar(0.6).getHex())); hat.position.y = 2.02;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), mat(col.clone().multiplyScalar(0.55).getHex())); brim.position.y = 1.86;
  body.add(robe, head, hat, brim);
  const lant = new THREE.Group(); lant.position.set(0.5, 1.0, 0.15);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), mat(0x2a1d14)); pole.position.y = 0.2;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), glow(0xffd27a, 2.2)); bulb.position.y = 0.78;
  lant.add(pole, bulb); g.add(lant);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.86, 28), new THREE.MeshBasicMaterial({ color: 0x7affc8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const label = makeLabel(name, mine ? "#ffe9a8" : "#ffffff", 0.9); label.sprite.position.y = 2.55; g.add(label.sprite);

  // floating video panel (hologram), shown only while the player's camera is on
  const panel = new THREE.Group(); panel.position.y = 3.5; panel.visible = false;
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 1.38), new THREE.MeshBasicMaterial({ color: 0x7affc8, transparent: true, opacity: 0.55 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 1.26), new THREE.MeshBasicMaterial({ color: 0x000000 })); screen.position.z = 0.01;
  panel.add(frame, screen); g.add(panel);

  return { g, body, bulb, lant, ring, label, panel, screen, col, name, vel: 0, face: 0, target: new THREE.Vector3(), crouch: 0, tex: null, vid: null, speak: 0 };
}

// ---- the scene -----------------------------------------------------------------------------------------

export function buildRelic(stage: Stage, host: HTMLElement) {
  const { scene, camera } = stage;
  const reduced = stage.reduced;
  if (stage.renderer) { stage.renderer.shadowMap.enabled = true; stage.renderer.shadowMap.type = THREE.PCFSoftShadowMap; stage.renderer.toneMappingExposure = 1.15; }
  scene.background = new THREE.Color(0x070b16);
  scene.fog = new THREE.FogExp2(0x0a1020, 0.026);
  camera.fov = 52; camera.near = 0.2; camera.far = 160; camera.updateProjectionMatrix();

  const hemi = new THREE.HemisphereLight(0x6f8cc8, 0x141018, 0.9); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xaec6ff, 1.5); moon.position.set(-22, 34, -14);
  moon.castShadow = true; moon.shadow.mapSize.set(1536, 1536);
  Object.assign(moon.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 90 }); moon.shadow.bias = -0.0004;
  scene.add(moon, moon.target);

  // sky: stars and a moon
  const starPos = new Float32Array(500 * 3); const sr = rng(11);
  for (let i = 0; i < 500; i++) { const a = sr() * 6.28, e = 0.15 + sr() * 1.2, d = 110; starPos.set([Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d], i * 3); }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.9, color: 0xdfe8ff, fog: false, transparent: true, opacity: 0.85 })); scene.add(stars);
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 18), new THREE.MeshBasicMaterial({ color: 0xe9f0ff, fog: false })); moonMesh.position.set(-60, 70, -45); scene.add(moonMesh);

  // terrain
  const SIZE = 84, SEG = 110;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); tg.rotateX(-Math.PI / 2);
  const tp = tg.attributes.position; const tcol = new Float32Array(tp.count * 3); const tr = rng(5); const c = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i); tp.setY(i, heightAt(x, z));
    const n = tr() * 0.07; const moss = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + 0.5;
    c.setRGB(0.09 + n + moss * 0.02, 0.12 + n + moss * 0.07, 0.1 + n); tcol.set([c.r, c.g, c.b], i * 3);
  }
  tg.setAttribute("color", new THREE.BufferAttribute(tcol, 3)); tg.computeVertexNormals();
  const ground = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.receiveShadow = true; scene.add(ground);

  // static dressing: gravestones, rocks, a ring of dead trees outside the playable square
  const pr = rng(2026);
  const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.1, 0.2), mat(0x585c6a), 70); stones.castShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 70; i++) {
    let x, z; do { x = (pr() - 0.5) * 52; z = (pr() - 0.5) * 52; } while (Math.hypot(x, z) < 6);
    dummy.position.set(x, heightAt(x, z) + 0.45, z); dummy.rotation.set((pr() - 0.5) * 0.25, pr() * 6.28, (pr() - 0.5) * 0.3); dummy.scale.setScalar(0.7 + pr() * 0.7); dummy.updateMatrix(); stones.setMatrixAt(i, dummy.matrix);
  }
  scene.add(stones);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x3b3e48), 50);
  for (let i = 0; i < 50; i++) { const x = (pr() - 0.5) * 56, z = (pr() - 0.5) * 56; dummy.position.set(x, heightAt(x, z) + 0.1, z); dummy.rotation.set(pr() * 3, pr() * 3, pr() * 3); dummy.scale.set(0.5 + pr(), 0.4 + pr() * 0.6, 0.5 + pr()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); }
  scene.add(rocks);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2, d = 32 + pr() * 7; const t = deadTree(pr, 1.3);
    t.position.set(Math.cos(a) * d, heightAt(Math.cos(a) * d, Math.sin(a) * d) - 0.1, Math.sin(a) * d); t.rotation.y = pr() * 6; scene.add(t);
  }

  // the altar
  const altar = new THREE.Group(); altar.position.y = heightAt(0, 0);
  const stoneM = mat(0x555968);
  const step = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.25, 8), stoneM); step.position.y = 0.12; step.receiveShadow = true;
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.7, 8), stoneM); slab.position.y = 0.6; slab.castShadow = true;
  altar.add(step, slab);
  const altarRune = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.5, 48), new THREE.MeshBasicMaterial({ color: 0x7affc8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  altarRune.rotation.x = -Math.PI / 2; altarRune.position.y = 0.27; altar.add(altarRune);
  scene.add(altar);

  // landmarks
  const lmr = rng(77); let landmarks: THREE.Group[] = []; let lmKey = "";
  const strands: THREE.Object3D[] = [];
  const ensureLandmarks = (zones) => {
    const key = zones.map((z) => `${z.x},${z.z}`).join("|");
    if (key === lmKey) return;
    for (const l of landmarks) scene.remove(l);
    landmarks = zones.map((z, i) => buildLandmark(i, z, lmr)); lmKey = key;
    strands.length = 0;
    for (const l of landmarks) { scene.add(l); l.traverse((o) => { if (o.name === "strand") strands.push(o); }); }
  };

  // the relic (on the altar, carried, or rising from the grave) and the gravekeeper
  const relicHolder = new THREE.Group(); scene.add(relicHolder);
  const relicLight = new THREE.PointLight(0x9dffe0, 7, 9, 2); relicHolder.add(relicLight);
  let relicKey = ""; let relicObj: THREE.Group | null = null;
  const ensureRelic = (key) => { if (key === relicKey) return; if (relicObj) relicHolder.remove(relicObj); relicObj = makeRelic(key); relicHolder.add(relicObj); relicKey = key; relicLight.color.setHex(relicObj.userData.color); };

  const keeper = new THREE.Group(); keeper.visible = false;
  const kr = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.3, 16), mat(0x08080c, { roughness: 1 })); kr.position.y = 1.15;
  const kh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), mat(0x050507)); kh.position.y = 2.4;
  keeper.add(kr, kh);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glow(0xff3a3a, 3)); e.position.set(s * 0.1, 2.42, 0.25); keeper.add(e); }
  scene.add(keeper);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9dffe0, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beam.position.y = 20; beam.visible = false; scene.add(beam);

  // mist over the burial zone
  const mistTex = mistTexture(); const mist = new THREE.Group(); const mistMats = []; const mr = rng(31);
  for (let i = 0; i < 20; i++) {
    const m = new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0, depthWrite: false, color: 0xbad2ee }); const s = new THREE.Sprite(m);
    const a = mr() * 6.28, d = Math.sqrt(mr()) * (ZONE_RADIUS - 1); s.position.set(Math.cos(a) * d, 0.8 + mr() * 2, Math.sin(a) * d); s.scale.setScalar(5 + mr() * 4); s.userData.ph = mr() * 6; mist.add(s); mistMats.push(m);
  }
  mist.visible = false; scene.add(mist);
  let mistLevel = 0;

  // fireflies and wail wisps
  const FF = 140; const ffPos = new Float32Array(FF * 3); const ffSeed = new Float32Array(FF);
  for (let i = 0; i < FF; i++) { ffPos.set([(Math.random() - 0.5) * 60, 0.5 + Math.random() * 2.5, (Math.random() - 0.5) * 60], i * 3); ffSeed[i] = Math.random() * 6.28; }
  const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute("position", new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({ size: 0.16, color: 0xd8ff7a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(ffGeo, ffMat));
  const sparks = createParticles(scene, 420, 0.17, 8);

  // heat ripples that leave the lantern
  const ripples = []; for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); ripples.push({ m, t: 9 });
  }

  // the local lantern light
  const myLight = new THREE.PointLight(0xffd27a, 8, 11, 2); scene.add(myLight);

  // ---- state --------------------------------------------------------------------------------------------
  let S: RelicSceneState | null = null;
  const figs = new Map<string, ReturnType<typeof makeAvatar>>();
  const holes = []; const seenHoles = { n: 0 };
  const me = { x: 0, z: 0, ry: 0, init: false, moving: false, lastSent: 0, lastX: 1e9, lastZ: 1e9 };
  const cam = { yaw: Math.PI, pitch: 0.5, dist: 8.5, pos: new THREE.Vector3(0, 8, 12), look: new THREE.Vector3(), shake: 0 };
  let lastPhase = ""; let revealDone = false; let revealAt = 0; let lastDig = 0; let lastWails = 0; let flash = 0; let heartT = 0; let rippleT = 0;
  const keys = new Set<string>();
  const phaseElapsed = () => (S ? Math.max(0, (Date.now() + S.skew - S.play.phase_at) / 1000) : 0);

  // input: keyboard + drag to look + wheel to zoom
  const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
  const kd = (e: KeyboardEvent) => { if (typing(e)) return; const k = e.key.toLowerCase(); if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "q", "e"].includes(k)) { keys.add(k); if (k.startsWith("arrow")) e.preventDefault(); } };
  const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const blur = () => keys.clear();
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", blur);
  let drag: { x: number; y: number; id: number } | null = null;
  const pd = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const pm = (e: PointerEvent) => { if (!drag || drag.id !== e.pointerId) return; cam.yaw -= (e.clientX - drag.x) * 0.006; cam.pitch = Math.min(1.1, Math.max(0.15, cam.pitch + (e.clientY - drag.y) * 0.004)); drag.x = e.clientX; drag.y = e.clientY; };
  const pu = (e: PointerEvent) => { if (drag && drag.id === e.pointerId) drag = null; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); cam.dist = Math.min(16, Math.max(4.5, cam.dist + e.deltaY * 0.008)); };
  host.style.touchAction = "none";
  host.addEventListener("pointerdown", pd); host.addEventListener("pointermove", pm); host.addEventListener("pointerup", pu); host.addEventListener("pointercancel", pu); host.addEventListener("wheel", wheel, { passive: false });

  const figFor = (name: string) => {
    let f = figs.get(name);
    if (!f) { f = makeAvatar(name, S ? name === S.you : false); scene.add(f.g); figs.set(name, f); }
    return f;
  };
  const addHole = (h, animate) => {
    const g = new THREE.Group(); g.position.set(h.x, heightAt(h.x, h.z) + 0.03, h.z);
    const pit = new THREE.Mesh(new THREE.CircleGeometry(0.62, 20), new THREE.MeshBasicMaterial({ color: 0x050403 })); pit.rotation.x = -Math.PI / 2;
    const mound = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.2, 8, 20), mat(0x2b2118)); mound.rotation.x = Math.PI / 2; mound.position.y = 0.06;
    g.add(pit, mound); g.scale.setScalar(animate ? 0.01 : 1); g.userData.t = animate ? 0 : 1; scene.add(g); holes.push(g);
  };

  // ---- per-frame ----------------------------------------------------------------------------------------
  stage.frame((t, dt) => {
    if (!S) return;
    const p = S.play; const phase = p.phase; const e = phaseElapsed();
    const hunting = phase === "hunt" || phase === "found";
    ensureLandmarks(p.zones); ensureRelic(p.relic.key);
    const zone = p.zone !== undefined ? p.zones[p.zone] : null;
    const heat = S.priv ? S.priv.heat : 0;

    // phase changes
    if (phase !== lastPhase) {
      if (phase === "hunt") me.init = false;
      lastPhase = phase;
    }
    if (p.wails > lastWails) { lastWails = p.wails; cam.shake = 1; flash = 0.7; }

    // ---- local movement (prediction; the server clamps and may pull us back) ----
    const mine = p.pos[S.you];
    if (mine && !me.init) { me.x = mine[0]; me.z = mine[1]; me.ry = mine[2]; me.init = true; }
    let ix = 0, iy = 0;
    if (hunting && !S.spectating && phase === "hunt") {
      if (keys.has("w") || keys.has("arrowup")) iy += 1; if (keys.has("s") || keys.has("arrowdown")) iy -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1; if (keys.has("a") || keys.has("arrowleft")) ix -= 1;
      ix += S.joy.x; iy += S.joy.y;
      if (keys.has("q")) cam.yaw += 1.8 * dt; if (keys.has("e")) cam.yaw -= 1.8 * dt;
    }
    const mag = Math.hypot(ix, iy); me.moving = mag > 0.08;
    if (me.moving) {
      const k = Math.min(1, mag) / mag;
      const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
      const dx = (rx * ix + fx * iy) * k, dz = (rz * ix + fz * iy) * k;
      me.x = Math.max(-27.6, Math.min(27.6, me.x + dx * SPEED * dt)); me.z = Math.max(-27.6, Math.min(27.6, me.z + dz * SPEED * dt));
      const want = Math.atan2(dx, dz); let d = want - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); me.ry += d * damp(12, dt);
      const now = performance.now();
      if (now - me.lastSent > 125 && (Math.abs(me.x - me.lastX) > 0.02 || Math.abs(me.z - me.lastZ) > 0.02)) { me.lastSent = now; me.lastX = me.x; me.lastZ = me.z; S.onMove(me.x, me.z, me.ry); }
    } else if (mine && hunting && me.init) {
      // stopped: if the server disagrees (it clamped a fast move), follow the server
      if (Math.hypot(mine[0] - me.x, mine[1] - me.z) > 3.5) { me.x = mine[0]; me.z = mine[1]; }
    }
    S.onLocal?.(me.x, me.z);

    // ---- avatars ----
    const names = Object.keys(p.pos);
    for (const n of names) {
      const f = figFor(n); const sp = p.pos[n]; const isMe = n === S.you;
      const tx = isMe && hunting && !S.spectating ? me.x : sp[0], tz = isMe && hunting && !S.spectating ? me.z : sp[1];
      const ox = f.g.position.x, oz = f.g.position.z;
      if (f.g.userData.init) { f.g.position.x = lerp(ox, tx, damp(isMe ? 30 : 9, dt)); f.g.position.z = lerp(oz, tz, damp(isMe ? 30 : 9, dt)); } else { f.g.position.x = tx; f.g.position.z = tz; f.g.userData.init = true; }
      const sp2 = Math.hypot(f.g.position.x - ox, f.g.position.z - oz) / Math.max(dt, 0.001);
      f.vel = lerp(f.vel, sp2, damp(8, dt));
      const faceTo = isMe && hunting ? me.ry : (f.vel > 0.6 ? Math.atan2(f.g.position.x - ox, f.g.position.z - oz) : sp[2]);
      let d = faceTo - f.face; d = Math.atan2(Math.sin(d), Math.cos(d)); f.face += d * damp(10, dt); f.g.rotation.y = f.face;
      const bob = Math.min(1, f.vel / 4);
      f.g.position.y = heightAt(f.g.position.x, f.g.position.z) + Math.abs(Math.sin(t * 11 + f.g.id)) * 0.07 * bob;
      f.body.rotation.z = Math.sin(t * 9 + f.g.id) * 0.06 * bob;
      f.crouch = Math.max(0, f.crouch - dt * 2.2); f.body.scale.y = 1 - Math.sin(Math.min(1, f.crouch) * Math.PI) * 0.22;
      f.bulb.material.emissiveIntensity = 2 + Math.sin(t * 7 + f.g.id) * 0.5;
      f.speak = lerp(f.speak, S.speaking[n] ? 1 : 0, damp(14, dt));
      f.ring.material.opacity = f.speak * 0.7; f.ring.scale.setScalar(1 + f.speak * Math.sin(t * 9) * 0.12);
      // hologram panel
      const vid = n === S.you ? S.localVideo : S.videos[n]; const on = !!S.cams[n] && vid && vid.readyState >= 2;
      f.panel.visible = !!on;
      if (on) {
        if (f.vid !== vid) { f.tex?.dispose(); f.tex = new THREE.VideoTexture(vid); f.tex.colorSpace = THREE.SRGBColorSpace; f.screen.material.map = f.tex; f.screen.material.color.set(0xffffff); f.screen.material.needsUpdate = true; f.vid = vid; }
        f.panel.quaternion.copy(camera.quaternion); f.panel.position.y = 3.5 + Math.sin(t * 1.6 + f.g.id) * 0.06;
        f.panel.children[0].material.opacity = 0.35 + f.speak * 0.5;
      }
      f.label.sprite.visible = true;
    }
    for (const [n, f] of figs) if (!(n in p.pos)) { scene.remove(f.g); figs.delete(n); }

    // someone dug: crouch + dirt, and new holes appear
    if (p.holes.length > seenHoles.n) {
      for (let i = seenHoles.n; i < p.holes.length; i++) {
        const h = p.holes[i]; addHole(h, seenHoles.n > 0 || holes.length > 0 ? true : p.holes.length < 3);
        const f = figs.get(h.by); if (f) f.crouch = 1;
        sparks.burst(h.x, heightAt(h.x, h.z) + 0.2, h.z, 26, 3.4, [0x3a2c20, 0x5a4636, 0x241a12], 1.1);
      }
      seenHoles.n = p.holes.length;
    } else if (p.holes.length < seenHoles.n) { for (const h of holes) scene.remove(h); holes.length = 0; seenHoles.n = 0; }
    for (const h of holes) if (h.userData.t < 1) { h.userData.t = Math.min(1, h.userData.t + dt * 3.2); h.scale.setScalar(smooth(0, 1, h.userData.t)); }
    if (S.digCount !== lastDig) { lastDig = S.digCount; const f = figs.get(S.you); if (f) f.crouch = 1; }

    // ---- the relic, the keeper, the mist ----
    altarRune.material.opacity = phase === "show" ? 0.55 + Math.sin(t * 3) * 0.2 : 0.2;
    let relicShown = false; keeper.visible = false; let wantMist = 0;
    const zx = zone ? zone.x : 0, zz = zone ? zone.z : 0;
    if (phase === "show") {
      relicShown = true; relicHolder.position.set(0, heightAt(0, 0) + 1.9 + Math.sin(t * 1.6) * 0.12, 0); relicHolder.rotation.y = t * 0.9; relicHolder.scale.setScalar(1.25);
    } else if (phase === "bury") {
      const k = smooth(0, 1.7, e); keeper.visible = e < 6.4; wantMist = smooth(1.5, 2.6, e);
      const kx = lerp(0, zx, k), kz = lerp(0, zz, k);
      keeper.position.set(kx, heightAt(kx, kz), kz); keeper.rotation.y = Math.atan2(zx, zz);
      keeper.scale.setScalar(e > 5.4 ? Math.max(0.01, 1 - (e - 5.4)) : 1);
      relicShown = e < 5.2;
      relicHolder.position.set(kx + Math.sin(keeper.rotation.y) * 0.5, heightAt(kx, kz) + 1.3, kz + Math.cos(keeper.rotation.y) * 0.5);
      relicHolder.rotation.y = t * 1.4; relicHolder.scale.setScalar(0.8);
      if (e > 1.7 && e < 5.2 && !reduced) { // dirt flying up somewhere inside the mist: never at the true spot
        const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * (ZONE_RADIUS - 1.5);
        if (Math.random() < dt * 9) sparks.burst(zx + Math.cos(a) * d, heightAt(zx, zz) + 0.4, zz + Math.sin(a) * d, 14, 3, [0x3a2c20, 0x6a5440, 0x9dffe0], 1.0);
      }
      if (e > 5.2 && e < 5.6 && flash < 0.6) { flash = 1; if (!reduced) sparks.burst(zx, heightAt(zx, zz) + 1, zz, 60, 5, [0x9dffe0, 0xffffff], 1.6); }
    } else if (phase === "hunt") {
      wantMist = 0.3;
    } else if (phase === "found" && p.spot) {
      const [sx, sz] = p.spot;
      if (!revealDone) { revealDone = true; revealAt = t; cam.shake = 1.2; flash = 1; sparks.burst(sx, heightAt(sx, sz) + 0.4, sz, 120, 6, [0x9dffe0, 0xffffff, relicObj.userData.color], 2); }
      const k = smooth(0, 1.8, t - revealAt);
      relicShown = true; relicHolder.position.set(sx, heightAt(sx, sz) - 1.2 + k * 2.6, sz); relicHolder.rotation.y = t * 1.2; relicHolder.scale.setScalar(1.1);
      beam.visible = true; beam.position.set(sx, heightAt(sx, sz) + 20, sz); beam.material.opacity = 0.3 * k * (0.8 + Math.sin(t * 6) * 0.2);
      wantMist = 0;
    }
    if (phase !== "found") { revealDone = false; beam.visible = false; }
    relicHolder.visible = relicShown;
    relicLight.intensity = relicShown ? 6 + Math.sin(t * 5) * 2 : 0;
    if (relicKey === "idol" && relicObj) relicObj.traverse((o) => { if (o.name === "tear") o.position.y = 0.96 - ((t * 0.5) % 1) * 0.3; });

    mistLevel = lerp(mistLevel, wantMist, damp(2.2, dt)); mist.visible = mistLevel > 0.01; mist.position.set(zx, heightAt(zx, zz), zz);
    for (const sp of mist.children) { sp.material.opacity = mistLevel * 0.55; sp.position.x += Math.sin(t * 0.3 + sp.userData.ph) * dt * 0.25; sp.position.y = 1.1 + Math.sin(t * 0.5 + sp.userData.ph) * 0.4; }
    for (const s of strands) s.rotation.z = Math.sin(t * 0.8 + s.userData.sway) * 0.07;

    // ---- the curse: lantern colour and rhythm, ripples, wail ----
    const wail = p.wail && phase === "hunt";
    const col = HEAT_COL[Math.max(0, Math.min(4, heat))];
    const myFig = figs.get(S.you);
    const hot = hunting && phase === "hunt";
    heartT += dt * (hot ? 1 + heat * 0.9 : 1);
    const pulse = hot ? 0.55 + 0.45 * Math.pow(Math.max(0, Math.sin(heartT * 4)), 3) : 0.6;
    myLight.color.setHex(hot ? col : 0xffd27a); myLight.intensity = (hot ? 6 + heat * 3.5 : 8) * (0.6 + pulse * 0.6) * (wail ? 0.6 + Math.random() * 0.8 : 1);
    if (myFig) {
      myLight.position.set(myFig.g.position.x, myFig.g.position.y + 2, myFig.g.position.z);
      myFig.bulb.material.emissive.setHex(hot ? col : 0xffd27a); myFig.bulb.material.color.setHex(hot ? col : 0xffd27a);
    }
    if (hot && myFig && HEAT_GAP[heat] > 0) {
      rippleT += dt;
      if (rippleT > HEAT_GAP[heat]) { rippleT = 0; const r = ripples.find((q) => q.t > 1.4); if (r) { r.t = 0; r.m.visible = true; r.m.position.set(myFig.g.position.x, heightAt(me.x, me.z) + 0.08, myFig.g.position.z); r.m.material.color.setHex(wail ? 0xff3a3a : col); } }
    }
    for (const r of ripples) { if (!r.m.visible) continue; r.t += dt; const k = r.t / 1.3; r.m.scale.setScalar(0.5 + k * 5); r.m.material.opacity = Math.max(0, 0.6 * (1 - k)); if (k >= 1) { r.m.visible = false; r.t = 9; } }

    const fogC = wail ? 0x2a0a12 : 0x0a1020; scene.fog.color.lerp(new THREE.Color(fogC), damp(3, dt)); scene.background.lerp(new THREE.Color(wail ? 0x14060c : 0x070b16), damp(3, dt));
    scene.fog.density = lerp(scene.fog.density, wail ? 0.05 : 0.026, damp(2, dt));
    hemi.intensity = lerp(hemi.intensity, wail ? 0.35 : 0.9, damp(3, dt)); moon.intensity = lerp(moon.intensity, wail ? 0.5 : 1.5, damp(3, dt));
    flash = Math.max(0, flash - dt * 1.6); renderer_flash(flash);
    const pa = ffGeo.attributes.position; for (let i = 0; i < FF; i++) { pa.setY(i, 0.7 + Math.abs(Math.sin(t * 0.6 + ffSeed[i])) * 2.2); pa.setX(i, pa.getX(i) + Math.sin(t * 0.4 + ffSeed[i]) * dt * 0.6); }
    pa.needsUpdate = true; ffMat.color.setHex(wail ? 0xff4a6a : 0xd8ff7a); ffMat.opacity = wail ? 1 : 0.75;
    sparks.update(dt);

    // ---- camera ----
    const want = new THREE.Vector3(); const look = new THREE.Vector3();
    if (phase === "show") {
      const a = t * 0.3 + 0.6; want.set(Math.cos(a) * 8.4, 4.6, Math.sin(a) * 8.4); look.set(0, 2.4, 0);
    } else if (phase === "bury") {
      if (e < 1.8) { const kp = keeper.position; want.set(kp.x * 0.5 + 5, 5 + e, kp.z * 0.5 + 8); look.copy(kp).y += 1.4; }
      else { want.set(zx * 0.15 + 8, 13, zz * 0.15 + 15); look.set(zx, 1, zz); }
    } else if (phase === "found" && p.spot) {
      const [sx, sz] = p.spot; const a = t * 0.3 + 0.8; want.set(sx + Math.cos(a) * 10, heightAt(sx, sz) + 6, sz + Math.sin(a) * 10); look.set(sx, heightAt(sx, sz) + 1.8, sz);
    } else {
      const fx = myFig ? myFig.g.position.x : me.x, fz = myFig ? myFig.g.position.z : me.z, fy = myFig ? myFig.g.position.y : 0;
      const hCam = Math.sin(cam.pitch) * cam.dist, dCam = Math.cos(cam.pitch) * cam.dist;
      want.set(fx + Math.sin(cam.yaw) * dCam, fy + 1.4 + hCam, fz + Math.cos(cam.yaw) * dCam); look.set(fx, fy + 1.5, fz);
    }
    const gy = heightAt(want.x, want.z) + 0.8; if (want.y < gy) want.y = gy;
    camera.position.lerp(want, damp(phase === "hunt" ? 7 : 2.6, dt)); cam.look.lerp(look, damp(phase === "hunt" ? 9 : 3, dt));
    cam.shake = Math.max(0, cam.shake - dt * 1.5);
    const sk = reduced ? 0 : cam.shake * 0.25; camera.position.x += (Math.random() - 0.5) * sk; camera.position.y += (Math.random() - 0.5) * sk;
    camera.lookAt(cam.look);
  });

  function renderer_flash(f) { (host.parentElement || host).style.setProperty("--relic-flash", f.toFixed(3)); }

  const update = (s: RelicSceneState) => { S = s; };
  const dispose = () => {
    window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur);
    host.removeEventListener("pointerdown", pd); host.removeEventListener("pointermove", pm); host.removeEventListener("pointerup", pu); host.removeEventListener("pointercancel", pu); host.removeEventListener("wheel", wheel);
    for (const f of figs.values()) f.tex?.dispose();
  };
  return { update, dispose };
}

export function createRelicScene(host: HTMLElement): SceneHandle<RelicSceneState> | null {
  const stage = createStage(host, { fov: 52 });
  if (!stage) return null;
  const built = buildRelic(stage, host);
  return { update: built.update, dispose: () => { built.dispose(); stage.dispose(); } };
}
