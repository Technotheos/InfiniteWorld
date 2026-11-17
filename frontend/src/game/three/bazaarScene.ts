// @ts-nocheck
// Brain Bazaar: a night market. Lantern strings sway over a golden dais, every player
// has a stack of coins that grows and shrinks with their winnings, and the market
// event (bull / crash / tip) changes the light and the weather.
import * as THREE from "three";
import { canvasTexture, createParticles, createStage, damp, lerp, makeLabel, type SceneHandle, type Stage } from "./common";

export interface BazaarSceneState {
  players: string[];
  net: Record<string, number>;
  you: string;
  status: "ask" | "between";
  event: "none" | "bull" | "crash" | "tip";
  locked: string[];
  /** changes whenever a round resolves, so the scene can celebrate once */
  roundKey: string;
  gains: Record<string, number>;
}

const EVENT_COLOR: Record<string, number> = { none: 0xffb347, bull: 0xffd23f, crash: 0xff3b5c, tip: 0x4de1ff };
const MAX_COINS = 30;
const COIN_UNIT = 25; // coins of net worth per visible coin

export function buildBazaar(stage: Stage) {
  const { scene, camera } = stage;
  scene.background = new THREE.Color(0x0d0610);
  scene.fog = new THREE.FogExp2(0x0d0610, 0.03);
  camera.position.set(0, 4.4, 9.6);
  camera.lookAt(0, 1.3, 0);

  scene.add(new THREE.HemisphereLight(0xffd9a8, 0x1a0f2e, 0.9));
  const key = new THREE.PointLight(0xffb347, 90, 30, 2);
  key.position.set(0, 7, 3);
  scene.add(key);
  const spot = new THREE.SpotLight(0xffe2a8, 160, 22, 0.55, 0.6, 1.6);
  spot.position.set(0, 10, 2);
  spot.target.position.set(0, 0.4, 0);
  scene.add(spot, spot.target);

  // ground: dark planks and a golden dais
  const planks = canvasTexture(512, 512, (g, w, h) => {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `hsl(${22 + (i % 3) * 4} 38% ${12 + (i % 4) * 2}%)`;
      g.fillRect(0, (i * h) / 16, w, h / 16 - 2);
    }
  });
  planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
  planks.repeat.set(3, 3);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.3, 64), new THREE.MeshStandardMaterial({ color: 0x3a1f10, roughness: 0.6, metalness: 0.3 }));
  dais.position.y = 0.15;
  scene.add(dais);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.65, 0.06, 12, 96), new THREE.MeshStandardMaterial({ color: 0xf5b942, emissive: 0x6a4300, metalness: 0.8, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.31;
  scene.add(rim);

  // market stalls in an arc behind the dais
  const stripe = (a: string, b: string) => canvasTexture(128, 128, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect((i * w) / 8, 0, w / 8, h); }
  });
  const stallColors: Array<[string, string]> = [["#e63946", "#fff1d6"], ["#2a9d8f", "#fff1d6"], ["#f4a261", "#3d2a1d"], ["#7b5ea7", "#fff1d6"], ["#e9c46a", "#3d2a1d"]];
  const posts: THREE.Vector3[] = [];
  stallColors.forEach(([a, b], i) => {
    const ang = Math.PI * (0.18 + (i / (stallColors.length - 1)) * 0.64); // back arc
    const sx = -Math.cos(ang) * 8.2, sz = -Math.sin(ang) * 7.2 - 1.2;
    const g = new THREE.Group();
    g.position.set(sx, 0, sz);
    g.rotation.y = Math.atan2(-sx, -sz);
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.1), new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.8 }));
    table.position.y = 0.55;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.1, 4, 1, true), new THREE.MeshStandardMaterial({ map: stripe(a, b), roughness: 0.8, side: THREE.DoubleSide }));
    roof.position.y = 3.0;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.25, 1, 0.85);
    for (const px of [-1.2, 1.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0x3a2412 }));
      post.position.set(px, 1.25, 0.4);
      g.add(post);
    }
    // goods on the table: little glowing orbs
    for (let k = 0; k < 4; k++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color().setHSL((i * 0.17 + k * 0.08) % 1, 0.8, 0.5), emissiveIntensity: 0.8 }));
      orb.position.set(-0.8 + k * 0.53, 1.28, 0);
      g.add(orb);
    }
    g.add(table, roof);
    scene.add(g);
    posts.push(new THREE.Vector3(sx, 3.3, sz));
  });

  // lantern strings between the stalls, swaying and pulsing
  const lanterns: Array<{ m: THREE.Mesh; base: THREE.Vector3; ph: number }> = [];
  const lanternMat = (h: number) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(h, 0.8, 0.25), emissive: new THREE.Color().setHSL(h, 0.9, 0.55), emissiveIntensity: 1.4 });
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.9;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineBasicMaterial({ color: 0x2a1a10 })));
    for (let k = 1; k < 5; k++) {
      const p = curve.getPoint(k / 5);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), lanternMat((i * 0.12 + k * 0.05) % 1));
      m.scale.y = 1.25;
      m.position.copy(p);
      scene.add(m);
      lanterns.push({ m, base: p.clone(), ph: i * 1.7 + k });
    }
  }

  // the orb of the market, floating over the dais
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: new THREE.Color(EVENT_COLOR.none), emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.4 });
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), orbMat);
  orb.position.y = 2.4;
  scene.add(orb);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.7 }));
  halo.position.y = 2.4;
  scene.add(halo);
  const orbLight = new THREE.PointLight(EVENT_COLOR.none, 30, 12, 2);
  orbLight.position.y = 2.4;
  scene.add(orbLight);

  // coin stacks, one per player, on a ring around the dais
  const coinGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 28);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xf5b942, emissive: 0x7a4a00, emissiveIntensity: 0.6, metalness: 0.75, roughness: 0.32 });
  type Stack = { name: string; mesh: THREE.InstancedMesh; cur: number; target: number; label: ReturnType<typeof makeLabel>; group: THREE.Group; pulse: number };
  let stacks: Stack[] = [];
  let playersKey = "";
  const dummy = new THREE.Object3D();
  const clearStacks = () => {
    for (const s of stacks) { scene.remove(s.group); s.mesh.dispose?.(); s.label.sprite.material.map.dispose(); s.label.sprite.material.dispose(); }
    stacks = [];
  };
  const rebuild = (names: string[]) => {
    clearStacks();
    names.forEach((name, i) => {
      const ang = (i / Math.max(1, names.length)) * Math.PI * 2 + Math.PI / 2;
      const group = new THREE.Group();
      group.position.set(Math.cos(ang) * 2.5, 0.3, Math.sin(ang) * 2.5);
      const mesh = new THREE.InstancedMesh(coinGeo, coinMat, MAX_COINS);
      for (let k = 0; k < MAX_COINS; k++) {
        dummy.position.set(Math.sin(k * 2.1) * 0.03, 0.05 + k * 0.095, Math.cos(k * 1.7) * 0.03);
        dummy.rotation.y = k * 0.7;
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.count = 0;
      const label = makeLabel(name, "#ffe7b0", 0.9);
      label.sprite.position.y = 3.3;
      group.add(mesh, label.sprite);
      scene.add(group);
      stacks.push({ name, mesh, cur: 0, target: 0, label, group, pulse: 0 });
    });
  };

  const sparks = createParticles(scene, 420, 0.16, 7);
  let flash = 0;
  let shake = 0;
  let lastRound = "";
  let current: BazaarSceneState | null = null;
  const targetColor = new THREE.Color(EVENT_COLOR.none);

  stage.frame((t, dt) => {
    const slow = stage.reduced ? 0.15 : 1;
    // camera drifts gently
    const sway = Math.sin(t * 0.18) * 2.4 * slow;
    camera.position.x = lerp(camera.position.x, sway + (shake > 0 ? (Math.random() - 0.5) * shake : 0), damp(2, dt));
    camera.position.y = 4.4 + Math.sin(t * 0.23) * 0.25 * slow;
    camera.lookAt(0, 1.4, 0);
    shake = Math.max(0, shake - dt * 1.6);

    for (const l of lanterns) {
      l.m.position.x = l.base.x + Math.sin(t * 0.9 + l.ph) * 0.12 * slow;
      l.m.position.y = l.base.y + Math.sin(t * 1.3 + l.ph) * 0.05 * slow;
      l.m.material.emissiveIntensity = 1.2 + Math.sin(t * 2 + l.ph * 3) * 0.35;
    }
    orb.rotation.y += dt * 0.8 * slow;
    orb.rotation.x += dt * 0.3 * slow;
    orb.position.y = 2.4 + Math.sin(t * 1.4) * 0.12 * slow;
    halo.position.y = orb.position.y;
    halo.rotation.x = Math.PI / 2 + Math.sin(t * 0.7) * 0.3;
    halo.rotation.y += dt * 0.6 * slow;
    orbMat.emissive.lerp(targetColor, damp(4, dt));
    orbLight.color.lerp(targetColor, damp(4, dt));
    halo.material.color.lerp(targetColor, damp(4, dt));
    flash = Math.max(0, flash - dt * 2.2);
    orbLight.intensity = 30 + flash * 260;
    key.intensity = 90 + flash * 220;

    for (const s of stacks) {
      s.cur = lerp(s.cur, s.target, damp(3.5, dt));
      s.mesh.count = Math.max(0, Math.min(MAX_COINS, Math.round(s.cur)));
      s.pulse = Math.max(0, s.pulse - dt * 2);
      const k = 1 + s.pulse * 0.25;
      s.group.scale.set(k, k, k);
      s.group.rotation.y += dt * 0.15 * slow;
      s.label.sprite.position.y = 0.4 + s.mesh.count * 0.095 + 0.9;
    }
    sparks.update(dt);
  });

  return (state: BazaarSceneState) => {
    current = state;
    const key2 = state.players.join("|");
    if (key2 !== playersKey) { playersKey = key2; rebuild(state.players); }
    for (const s of stacks) {
      const net = state.net[s.name] ?? 0;
      s.target = Math.max(1, Math.min(MAX_COINS, Math.round(Math.max(0, net) / COIN_UNIT) + 1));
      s.label.set(`${s.name} · ${net}`, s.name === state.you ? "#ffffff" : "#ffd98a");
    }
    targetColor.set(EVENT_COLOR[state.event] ?? EVENT_COLOR.none);
    if (state.roundKey !== lastRound) {
      lastRound = state.roundKey;
      if (state.status === "between") {
        // celebrate winners, flash for a crash
        for (const s of stacks) {
          const g = state.gains[s.name] ?? 0;
          if (g > 0) {
            s.pulse = 1;
            const p = s.group.position;
            sparks.burst(p.x, 1.2, p.z, 46, 5, [0xffd23f, 0xfff1a8, 0xffffff]);
          } else if (g < 0) {
            sparks.burst(s.group.position.x, 1.0, s.group.position.z, 18, 3, [0xff3b5c, 0x7a1d2b]);
          }
        }
        if (state.event === "bull") sparks.burst(0, 3, 0, 160, 7, [0xffd23f, 0xffe9a0, 0xffa400], 2.4);
        if (state.event === "crash") { flash = 1; shake = 0.8; }
        if (state.event === "tip") sparks.burst(0, 2.5, 0, 70, 4, [0x4de1ff, 0xbdf4ff]);
      }
    }
    void current;
  };
}

export function createBazaarScene(host: HTMLElement): SceneHandle<BazaarSceneState> | null {
  const stage = createStage(host, { fov: 42 });
  if (!stage) return null;
  const update = buildBazaar(stage);
  return { update, dispose: stage.dispose };
}
