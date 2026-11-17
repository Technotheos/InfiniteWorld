// @ts-nocheck
// Midnight Mystery: a noir interrogation room. Suspects stand around a table under a
// searchlight, an evidence board with red strings shakes when someone presses a claim,
// and the unmask swings the camera to the culprit while the vote lines light up.
import * as THREE from "three";
import { canvasTexture, createParticles, createStage, damp, lerp, makeLabel, type SceneHandle, type Stage } from "./common";

export interface MysterySceneState {
  suspects: { name: string; coat: number }[];
  theme: string; // museum | lab | liner
  phase: string; // intro | alibi | investigate | interrogate | vote | unmask
  focus: string; // suspect to spotlight, "" lets the light roam
  you: string;
  pressCount: number;
  culprit: string; // only known during the unmask
  caught: boolean;
  votes: Record<string, string>;
}

export const COAT_HEX = [0xe63946, 0x3a7bd5, 0x2fbf71, 0xf2c94c, 0x8e5ad7, 0xf28c28, 0xecebe6, 0x1fb5b0];
const SKIN = [0xf1c8a5, 0xd9a272, 0x9b6a45, 0x6b4430, 0xe8b894, 0xc68642, 0x8d5524, 0xffdbb4];
const RING = 3.7;

export function buildMystery(stage: Stage) {
  const { scene, camera } = stage;
  scene.background = new THREE.Color(0x04050a);
  scene.fog = new THREE.FogExp2(0x04050a, 0.042);
  camera.position.set(0, 6.9, 11.6);
  camera.lookAt(0, 1.2, 0);

  const hemi = new THREE.HemisphereLight(0x6f84b8, 0x0a0a14, 0.95);
  scene.add(hemi);
  const spot = new THREE.SpotLight(0xfff0d0, 320, 32, 0.4, 0.6, 1.2);
  spot.position.set(0, 11, 0);
  const aim = new THREE.Object3D();
  scene.add(spot, aim);
  spot.target = aim;
  const rimLight = new THREE.PointLight(0xff2a4a, 0, 10, 2); // red light on the culprit
  scene.add(rimLight);

  // floor: dark checker, slightly glossy
  const floorTex = canvasTexture(512, 512, (g, w, h) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? "#14161f" : "#0b0c13"; g.fillRect((x * w) / 8, (y * h) / 8, w / 8, h / 8); }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(3, 3);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(15, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.45, metalness: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // the table and the object everyone is arguing about
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.14, 48), new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.5, metalness: 0.2 }));
  tableTop.position.y = 0.95;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.95, 16), new THREE.MeshStandardMaterial({ color: 0x1a120c }));
  leg.position.y = 0.47;
  scene.add(tableTop, leg);
  const prize = new THREE.Group();
  const gem = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x2ad4ff, emissiveIntensity: 1.1, roughness: 0.1, metalness: 0.3 });
  let prizeMesh: THREE.Mesh;
  const makePrize = (theme: string) => {
    prize.clear();
    if (theme === "lab") {
      prizeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 20), gem);
      gem.emissive.set(0x3dff9a);
    } else if (theme === "liner") {
      prizeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.5), gem);
      gem.emissive.set(0xffb84d);
    } else {
      prizeMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), gem);
      prizeMesh.scale.y = 1.5;
      gem.emissive.set(0x2ad4ff);
    }
    prize.add(prizeMesh);
  };
  prize.position.set(0, 1.7, 0);
  scene.add(prize);
  const prizeLight = new THREE.PointLight(0x2ad4ff, 14, 8, 2);
  prizeLight.position.set(0, 1.9, 0);
  scene.add(prizeLight);

  // evidence board with red strings
  const board = new THREE.Group();
  board.position.set(0, 3.6, -9);
  const cork = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = "#6b4a2e"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${40 + Math.random() * 60},${25 + Math.random() * 40},10,.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  board.add(new THREE.Mesh(new THREE.PlaneGeometry(11, 5.5), new THREE.MeshStandardMaterial({ map: cork, roughness: 0.95 })));
  const cards: THREE.Vector3[] = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.3), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xf1ead2 : 0xd8cfae, roughness: 1 }));
    c.position.set(-4.4 + (i % 5) * 2.2 + (Math.random() - 0.5) * 0.4, (i < 5 ? 1.2 : -1.2) + (Math.random() - 0.5) * 0.4, 0.02);
    c.rotation.z = (Math.random() - 0.5) * 0.25;
    board.add(c);
    cards.push(c.position);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: 0xd62839 }));
    pin.position.set(c.position.x, c.position.y + 0.5, 0.06);
    board.add(pin);
  }
  for (const [a, b] of [[0, 3], [1, 6], [2, 8], [3, 5], [4, 7], [5, 1], [6, 2], [7, 0]]) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cards[a].x, cards[a].y + 0.5, 0.08), new THREE.Vector3(cards[b].x, cards[b].y + 0.5, 0.08)]);
    board.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd62839 })));
  }
  scene.add(board);

  // floating dust in the beam
  const dustN = 160;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dustPos.set([(Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9], i * 3); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.05, color: 0xfff0d0, transparent: true, opacity: 0.55, depthWrite: false })));

  const sparks = createParticles(scene, 300, 0.14, 4);

  // suspects
  type Fig = { name: string; group: THREE.Group; body: THREE.Mesh; head: THREE.Mesh; hat: THREE.Group; label: ReturnType<typeof makeLabel>; pos: THREE.Vector3; cuffs: THREE.Mesh; mats: THREE.Material[]; hatLift: number; push: number };
  let figs: Fig[] = [];
  let figKey = "";
  const clearFigs = () => { for (const f of figs) { scene.remove(f.group); f.label.sprite.material.map.dispose(); f.label.sprite.material.dispose(); } figs = []; };
  const rebuild = (s: MysterySceneState) => {
    clearFigs();
    s.suspects.forEach((p, i) => {
      const ang = (i / s.suspects.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(ang) * RING, z = Math.sin(ang) * RING;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(-x, -z);
      const coat = new THREE.MeshStandardMaterial({ color: COAT_HEX[p.coat % COAT_HEX.length], roughness: 0.7, emissive: 0x000000 });
      const skin = new THREE.MeshStandardMaterial({ color: SKIN[i % SKIN.length], roughness: 0.6 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.95, 6, 14), coat);
      body.position.y = 1.0;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 20), skin);
      head.position.y = 1.92;
      const hat = new THREE.Group();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.035, 24), dark);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.24, 20), dark);
      crown.position.y = 0.13;
      hat.add(brim, crown);
      hat.position.y = 2.08;
      for (const ex of [-0.09, 0.09]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), dark);
        eye.position.set(ex, 1.95, 0.22);
        group.add(eye);
      }
      const cuffs = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 32), new THREE.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x6a4b00, metalness: 0.8, roughness: 0.3 }));
      cuffs.rotation.x = Math.PI / 2;
      cuffs.position.y = 1.0;
      cuffs.visible = false;
      const label = makeLabel(p.name, p.name === s.you ? "#ffffff" : "#d8dcf0", 0.95);
      label.sprite.position.y = 2.75;
      group.add(body, head, hat, cuffs, label.sprite);
      scene.add(group);
      figs.push({ name: p.name, group, body, head, hat, label, pos: group.position.clone(), cuffs, mats: [coat, skin, dark], hatLift: 0, push: 0 });
    });
  };

  // vote lines (drawn at the unmask)
  let lines: Array<{ geo: THREE.BufferGeometry; n: number }> = [];
  const clearLines = () => { for (const l of lines) { l.geo.dispose(); } lines.forEach((l) => scene.remove(l.line)); lines = []; };
  const drawVotes = (s: MysterySceneState) => {
    clearLines();
    for (const [voter, target] of Object.entries(s.votes)) {
      const a = figs.find((f) => f.name === voter), b = figs.find((f) => f.name === target);
      if (!a || !b) continue;
      const p0 = a.pos.clone().setY(2.3), p2 = b.pos.clone().setY(2.3);
      const p1 = p0.clone().lerp(p2, 0.5).setY(3.9);
      const pts = new THREE.QuadraticBezierCurve3(p0, p1, p2).getPoints(28);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      geo.setDrawRange(0, 0);
      const hit = target === s.culprit;
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: hit ? 0x42e695 : 0x8a8fa8, transparent: true, opacity: hit ? 1 : 0.55 }));
      scene.add(line);
      lines.push({ geo, n: pts.length, line });
    }
  };

  let state: MysterySceneState | null = null;
  let themeKey = "";
  let shake = 0;
  let lastPress = 0;
  let unmaskKey = "";
  let unmaskT = 0;
  let flashT = 0;
  let nextFlash = 2;
  const aimTarget = new THREE.Vector3();
  const camTarget = new THREE.Vector3(0, 6.9, 11.6);
  const lookTarget = new THREE.Vector3(0, 1.3, 0);
  const look = new THREE.Vector3(0, 1.3, 0);
  makePrize("museum");

  stage.frame((t, dt) => {
    const slow = stage.reduced ? 0.1 : 1;
    const s = state;
    const phase = s?.phase ?? "intro";

    // the searchlight: focused on a suspect, or roaming the ring
    const f = s ? figs.find((x) => x.name === s.focus) : undefined;
    if (f) aimTarget.copy(f.pos).setY(1.4);
    else aimTarget.set(Math.cos(t * 0.3 * slow) * RING * 0.8, 1.2, Math.sin(t * 0.3 * slow) * RING * 0.8);
    if (phase === "unmask" && s?.culprit) {
      const c = figs.find((x) => x.name === s.culprit);
      if (c) aimTarget.copy(c.pos).setY(1.4);
    }
    aim.position.lerp(aimTarget, damp(3.2, dt));
    spot.angle = lerp(spot.angle, f || phase === "unmask" ? 0.2 : 0.38, damp(2, dt));

    // lighting by phase, plus lightning in the intro
    let base = 320;
    if (phase === "vote") base = 380;
    if (phase === "intro") {
      nextFlash -= dt;
      if (nextFlash <= 0 && !stage.reduced) { flashT = 0.22; nextFlash = 1.2 + Math.random() * 2.2; }
    }
    flashT = Math.max(0, flashT - dt);
    const flick = 1 + Math.sin(t * 31) * 0.03 + (phase === "intro" ? Math.sin(t * 9) * 0.12 : 0);
    spot.intensity = flashT > 0 ? 0 : base * flick;
    hemi.intensity = 0.95 + (flashT > 0 ? 3.2 : 0);
    spot.color.set(phase === "vote" ? 0xffd2c0 : 0xfff0d0);

    // props
    prize.rotation.y += dt * 0.9 * slow;
    prize.position.y = 1.7 + Math.sin(t * 1.6) * 0.1 * slow;
    prizeLight.intensity = 14 + Math.sin(t * 3) * 3;

    // board shake when somebody presses a claim
    shake = Math.max(0, shake - dt * 1.8);
    board.rotation.z = Math.sin(t * 46) * 0.012 * shake;
    board.position.x = Math.sin(t * 61) * 0.05 * shake;

    // figures: breathing, and the unmask choreography
    figs.forEach((fg, i) => {
      fg.body.scale.y = 1 + Math.sin(t * 1.6 + i) * 0.012 * slow;
      fg.head.position.y = 1.92 + Math.sin(t * 1.6 + i) * 0.01 * slow;
      const isC = phase === "unmask" && s && fg.name === s.culprit;
      fg.push = lerp(fg.push, isC ? 1 : 0, damp(3, dt));
      fg.group.position.copy(fg.pos).multiplyScalar(1 - fg.push * 0.22);
      fg.group.scale.setScalar(1 + fg.push * 0.14);
      if (isC) {
        fg.mats[0].emissive.setRGB(0.35 + Math.sin(t * 6) * 0.15, 0.02, 0.04);
        fg.hatLift = Math.min(1.6, fg.hatLift + dt * 1.8);
        fg.hat.position.y = 2.08 + fg.hatLift;
        fg.hat.rotation.y += dt * 6;
        fg.hat.rotation.z = fg.hatLift * 0.4;
        if (!s.caught) {
          for (const m of fg.mats) { m.transparent = true; m.opacity = Math.max(0.2, m.opacity - dt * 0.6); }
          fg.label.sprite.material.opacity = Math.max(0.25, fg.label.sprite.material.opacity - dt * 0.6);
        }
      } else if (phase !== "unmask") {
        fg.mats[0].emissive.setRGB(0, 0, 0);
      }
    });
    if (phase === "unmask") unmaskT += dt; else unmaskT = 0;
    for (const l of lines) l.geo.setDrawRange(0, Math.max(0, Math.min(l.n, Math.floor(((unmaskT - 1.2) / 1.4) * l.n))));

    // prize flies to the culprit at the unmask
    const cf = phase === "unmask" && s ? figs.find((x) => x.name === s.culprit) : undefined;
    if (cf) {
      prize.position.x = lerp(prize.position.x, cf.pos.x * 0.55, damp(1.4, dt));
      prize.position.z = lerp(prize.position.z, cf.pos.z * 0.55, damp(1.4, dt));
      rimLight.position.set(cf.pos.x * 0.8, 2.4, cf.pos.z * 0.8);
      rimLight.intensity = lerp(rimLight.intensity, 60, damp(2, dt));
      camTarget.set(-cf.pos.x * 0.18, 2.7, -cf.pos.z * 0.18 + 0.01);
      lookTarget.copy(cf.pos).setY(1.8);
    } else {
      prize.position.x = lerp(prize.position.x, 0, damp(3, dt));
      prize.position.z = lerp(prize.position.z, 0, damp(3, dt));
      rimLight.intensity = lerp(rimLight.intensity, 0, damp(4, dt));
      camTarget.set(Math.sin(t * 0.17) * 2.2 * slow, 6.9 + Math.sin(t * 0.21) * 0.25 * slow, 11.6);
      lookTarget.set(0, 1.4, 0);
    }
    camera.position.lerp(camTarget, damp(1.6, dt));
    look.lerp(lookTarget, damp(2.2, dt));
    camera.lookAt(look);

    // dust drift
    for (let i = 0; i < dustN; i++) { dustPos[i * 3 + 1] += dt * 0.12 * slow; if (dustPos[i * 3 + 1] > 6) dustPos[i * 3 + 1] = 0; }
    dustGeo.attributes.position.needsUpdate = true;
    sparks.update(dt);
  });

  return (next: MysterySceneState) => {
    state = next;
    const key = next.suspects.map((p) => `${p.name}:${p.coat}`).join("|") + "@" + next.you;
    if (key !== figKey) { figKey = key; rebuild(next); }
    if (next.theme !== themeKey) { themeKey = next.theme; makePrize(next.theme); prizeLight.color.copy(gem.emissive); }
    if (next.pressCount > lastPress) { shake = 1; }
    lastPress = next.pressCount;
    const uk = next.phase === "unmask" && next.culprit ? `${next.culprit}:${next.caught}` : "";
    if (uk !== unmaskKey) {
      unmaskKey = uk;
      if (uk) {
        drawVotes(next);
        const c = figs.find((x) => x.name === next.culprit);
        if (c) {
          if (next.caught) { c.cuffs.visible = true; sparks.burst(c.pos.x, 1.4, c.pos.z, 90, 5, [0xf5c542, 0x42e695, 0xffffff], 2); }
          else sparks.burst(c.pos.x, 1.4, c.pos.z, 120, 3, [0x8a8fa8, 0x4a4f66], 2.6);
        }
      } else {
        clearLines();
        for (const f of figs) { f.cuffs.visible = false; f.hatLift = 0; f.hat.position.y = 2.08; f.hat.rotation.set(0, 0, 0); for (const m of f.mats) { m.opacity = 1; m.transparent = false; } }
      }
    }
  };
}

export function createMysteryScene(host: HTMLElement): SceneHandle<MysterySceneState> | null {
  const stage = createStage(host, { fov: 44 });
  if (!stage) return null;
  const update = buildMystery(stage);
  return { update, dispose: stage.dispose };
}
