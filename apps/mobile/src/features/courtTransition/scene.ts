/**
 * The three.js court from `Court Transition Prototype.html` (`buildCourt`),
 * ported 1:1 for expo-gl: real net, lime glass + mesh cage with the brand's
 * white window stickers, four 3D rackets, a ball with a seam, a 36-ghost
 * trail, a ground disc AND a real cast shadow on the turf. As in the
 * prototype the ball, its trail and its disc live in a SECOND scene
 * (`overlay`) drawn on a transparent surface stacked above the native button,
 * so the rally flies over the button; an invisible caster in the main scene
 * keeps the ball's real shadow on the turf, under the button (see
 * `docs/design/mobile-ui/Court Transition Prototype.html` header for the spec).
 *
 * All motion numbers come from rally.ts (unit-tested); this file only builds
 * meshes and applies those numbers each frame. The `lite` tier (quality.ts,
 * low-end phones) builds the same court with no shadow pass — no caster, no
 * receiver, no invisible ball caster — and no trail; the ball's ground disc
 * stands in for its shadow. Colours are the prototype's own
 * (its brand stickers); the page colour behind the court is the renderer's
 * clear colour, set by the component per theme.
 */
import * as THREE from 'three';
import { nearCageOpacity, PLAYERS, playerYaw, rallyAt, BALL_RADIUS } from './rally';
import { makeCamera, poseCamera } from './camera';
import { lerp, slice, SPEC } from './spec';
import type { CourtQuality } from './quality';

const NAVY = 0x1b2a47;
const LIME = 0xa5d06f;
const BLUE = 0x3360ab;
const TURF = 0x3a63b8;
/** The ghost trail: 36 fading spheres spread over the last 22 samples. */
const TRAIL_N = 36;
const TRAIL_HISTORY = 24;
const TRAIL_SPAN = 22;

export interface CourtScene {
  /** The court: cage, net, rackets, turf with the ball's cast shadow. Opaque, under the button. */
  scene: THREE.Scene;
  /** The ball, its trail and its ground disc. Transparent, drawn above the button with the same camera. */
  overlay: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Apply camera + rally + fades for time t (s) and eased pitch camK; p is the raw progress. */
  update(t: number, p: number, camK: number): void;
  /** Everything with a `dispose()`: geometries, materials. */
  dispose(): void;
}

export function buildCourtScene(quality: CourtQuality = 'full'): CourtScene {
  const shadows = quality === 'full';
  const trailN = quality === 'full' ? TRAIL_N : 0;
  const disposables: { dispose(): void }[] = [];
  const scene = new THREE.Scene();
  const overlay = new THREE.Scene();
  const camera = makeCamera(390 / 844);

  // the overlay is lit like the court, minus the shadow pass
  overlay.add(new THREE.HemisphereLight(0xffffff, 0xb9c8e0, 0.95));
  const sun2 = new THREE.DirectionalLight(0xffffff, 1.4);
  sun2.position.set(6, 30, 10);
  overlay.add(sun2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c8e0, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 30, 10);
  sun.castShadow = shadows;
  if (shadows) {
    // 2048 in the prototype; 1024 keeps the shadow pass cheap on a phone.
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 4;
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 12, bottom: -12, near: 5, far: 60 });
  }
  scene.add(sun);

  const Mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
    disposables.push(m);
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G): G => {
    disposables.push(g);
    return g;
  };
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    shadow = false,
  ) => {
    const m = new THREE.Mesh(geo(geometry), material);
    m.position.set(x, y, z);
    m.castShadow = shadow && shadows;
    scene.add(m);
    return m;
  };

  // ground + turf (base top sits 6 cm below the turf; lines use polygonOffset — no z-fighting)
  add(new THREE.BoxGeometry(11.4, 0.3, 21.4), Mat(NAVY), 0, -0.21, 0);
  const turf = add(new THREE.PlaneGeometry(10, 20), Mat(TURF), 0, 0, 0);
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = shadows;

  // lines (opacity driven by p)
  const lineMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(lineMat);
  const line = (w: number, d: number, x: number, z: number) => {
    const m = add(new THREE.PlaneGeometry(w, d), lineMat, x, 0.02, z);
    m.rotation.x = -Math.PI / 2;
  };
  const LW = 0.1;
  line(10, LW, 0, -10 + LW / 2);
  line(10, LW, 0, 10 - LW / 2);
  line(LW, 20, -5 + LW / 2, 0);
  line(LW, 20, 5 - LW / 2, 0);
  line(10, LW, 0, -7);
  line(10, LW, 0, 7);
  line(LW, 3, 0, -8.5);
  line(LW, 3, 0, 8.5);

  // net
  const netMat = new THREE.MeshBasicMaterial({
    color: NAVY,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
  });
  disposables.push(netMat);
  add(new THREE.PlaneGeometry(10.3, 0.86, 62, 6), netMat, 0, 0.45, 0);
  add(new THREE.BoxGeometry(10.3, 0.07, 0.035), Mat(0xffffff, { roughness: 0.5 }), 0, 0.9, 0);
  add(new THREE.BoxGeometry(0.06, 0.9, 0.04), Mat(0xffffff), 0, 0.45, 0);
  const postMat = Mat(NAVY, { roughness: 0.4 });
  for (const x of [-5.3, 5.3])
    add(new THREE.CylinderGeometry(0.07, 0.07, 1.05, 14), postMat, x, 0.52, 0);

  // cage: lime glass panels with white "window" squares (brand sticker) + dark mesh fence.
  // The near side (z > 0) gets its own materials so it can fade as the camera pitches.
  const glassFar = new THREE.MeshStandardMaterial({
    color: LIME,
    transparent: true,
    opacity: 0.55,
    roughness: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const paneFar = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fenceFar = new THREE.MeshBasicMaterial({
    color: NAVY,
    wireframe: true,
    transparent: true,
    opacity: 0.42,
  });
  const frameFar = Mat(NAVY, { roughness: 0.4, transparent: true });
  const glassNear = glassFar.clone();
  const paneNear = paneFar.clone();
  const fenceNear = fenceFar.clone();
  const frameNear = frameFar.clone();
  disposables.push(glassFar, paneFar, fenceFar, glassNear, paneNear, fenceNear, frameNear);
  const capMat = Mat(0x9fe0c8, { roughness: 0.5 });

  const panel = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    mat: THREE.Material,
    mesh = false,
  ) => {
    const m = add(
      new THREE.PlaneGeometry(w, h, mesh ? Math.round(w * 4) : 1, mesh ? Math.round(h * 4) : 1),
      mat,
      x,
      y,
      z,
    );
    m.rotation.y = ry;
    return m;
  };
  // white window squares inset in each 2 m glass bay
  const windows = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    mat: THREE.Material,
  ) => {
    const n = Math.round(w / 2);
    const dx = Math.cos(ry);
    const dz = -Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 2;
      panel(1.4, h - 0.8, x + dx * o, y, z + dz * o, ry, mat);
    }
  };
  for (const s of [-1, 1] as const) {
    const near = s > 0;
    const glass = near ? glassNear : glassFar;
    const pane = near ? paneNear : paneFar;
    const fence = near ? fenceNear : fenceFar;
    const frame = near ? frameNear : frameFar;
    const post = (x: number, z: number, h: number) => {
      add(new THREE.BoxGeometry(0.1, h, 0.1), frame, x, h / 2, z);
      add(new THREE.BoxGeometry(0.18, 0.08, 0.18), capMat, x, h + 0.04, z);
    };
    const rail = (len: number, x: number, y: number, z: number, ry: number) => {
      const m = add(new THREE.BoxGeometry(len, 0.08, 0.08), frame, x, y, z);
      m.rotation.y = ry;
    };
    panel(10, 3, 0, 1.5, s * 10, 0, glass);
    windows(10, 3, 0, 1.5, s * 10 - s * 0.01, 0, pane);
    panel(10, 1, 0, 3.5, s * 10, 0, fence, true);
    rail(10.1, 0, 4, s * 10, 0);
    rail(10.1, 0, 3, s * 10, 0);
    for (const x of [-2.5, 0, 2.5]) post(x, s * 10, 4);
    for (const sx of [-1, 1] as const) {
      const x = sx * 5;
      panel(4, 3, x, 1.5, s * 8, Math.PI / 2, glass);
      windows(4, 3, x - sx * 0.01, 1.5, s * 8, Math.PI / 2, pane);
      panel(4, 1, x, 3.5, s * 8, Math.PI / 2, fence, true);
      panel(6, 3, x, 1.5, s * 3, Math.PI / 2, fence, true);
      rail(4.1, x, 4, s * 8, Math.PI / 2);
      rail(4.1, x, 3, s * 8, Math.PI / 2);
      rail(6.1, x, 3, s * 3, Math.PI / 2);
      post(x, s * 10, 4);
      post(x, s * 6, 4);
      post(x, s * 2, 3);
    }
  }

  // racket (brand sticker): blue frame + blue face, white holes, lime grip, dark cap
  const frameMat = Mat(NAVY, { roughness: 0.45 });
  const rimMat = Mat(0x6ec3f0, { roughness: 0.4 });
  const faceMat = Mat(BLUE, { roughness: 0.6 });
  const holeMat = Mat(0xffffff, { roughness: 0.6 });
  const throatMat = Mat(BLUE, { roughness: 0.45 });
  const gripMat = Mat(LIME, { roughness: 0.6 });
  const wrapMat = Mat(NAVY);
  const makeRacket = () => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(geo(new THREE.TorusGeometry(0.42, 0.06, 14, 48)), frameMat);
    frame.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(geo(new THREE.TorusGeometry(0.4, 0.045, 14, 48)), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    const face = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 48)), faceMat);
    g.add(frame, rim, face);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < (r === 0 ? 1 : r * 6); i++) {
        const a = (i / (r * 6 || 1)) * Math.PI * 2;
        const rad = r * 0.11;
        const h = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 10)), holeMat);
        h.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
        g.add(h);
      }
    }
    const throat = new THREE.Mesh(geo(new THREE.BoxGeometry(0.16, 0.08, 0.2)), throatMat);
    throat.position.z = 0.5;
    const handle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.075, 0.075, 0.6, 14)), gripMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.9;
    for (const z of [0.72, 0.86, 1.0, 1.14]) {
      const w = new THREE.Mesh(geo(new THREE.TorusGeometry(0.076, 0.012, 8, 24)), wrapMat);
      w.position.z = z;
      g.add(w);
    }
    const cap = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14)), wrapMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 1.22;
    g.add(throat, handle, cap);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = shadows;
    });
    return g;
  };
  const rackets = PLAYERS.map((pl) => {
    const g = makeRacket();
    g.scale.setScalar(1.15);
    g.position.set(pl.x, 0.75, pl.z);
    g.rotation.order = 'YXZ';
    g.rotation.y = playerYaw(pl);
    scene.add(g);
    return g;
  });

  // ball (brand sticker): lime with a white + blue wavy seam — in the overlay, over the button
  const ball = new THREE.Group();
  ball.add(
    new THREE.Mesh(geo(new THREE.SphereGeometry(BALL_RADIUS, 32, 24)), Mat(LIME, { roughness: 0.55 })),
  );
  const seamW = new THREE.Mesh(
    geo(new THREE.TorusGeometry(0.215, 0.022, 8, 64)),
    Mat(0xf3f5f9, { roughness: 0.6 }),
  );
  seamW.rotation.set(0.9, 0.4, 0);
  const seamB = new THREE.Mesh(
    geo(new THREE.TorusGeometry(0.212, 0.014, 8, 64)),
    Mat(BLUE, { roughness: 0.6 }),
  );
  seamB.rotation.set(0.9, 0.4, 0);
  seamB.position.set(0.012, -0.012, 0.01);
  ball.add(seamW, seamB);
  overlay.add(ball);
  // invisible caster in the court scene so the ball still throws a real shadow on the turf
  let caster: THREE.Mesh | null = null;
  if (shadows) {
    const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    disposables.push(casterMat);
    caster = add(new THREE.SphereGeometry(BALL_RADIUS, 16, 12), casterMat, 0, 0, 0, true);
  }

  // trail: fading ghosts of recent ball positions (none on the lite tier)
  const trail: THREE.Mesh[] = [];
  for (let i = 0; i < trailN; i++) {
    const k = 1 - i / TRAIL_N;
    const m = new THREE.Mesh(
      geo(new THREE.SphereGeometry(BALL_RADIUS * (0.25 + 0.7 * k), 12, 10)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1 * k,
        depthWrite: false,
      }),
    );
    disposables.push(m.material as THREE.Material);
    m.visible = false;
    overlay.add(m);
    trail.push(m);
  }
  const history: THREE.Vector3[] = [];

  // the ground disc under the ball (overlay too: the prototype's disc rides over the button)
  const shadeMat = new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0.28 });
  disposables.push(shadeMat);
  const shade = new THREE.Mesh(geo(new THREE.CircleGeometry(0.24, 24)), shadeMat);
  shade.position.set(0, 0.012, 0);
  shade.rotation.x = -Math.PI / 2;
  overlay.add(shade);

  return {
    scene,
    overlay,
    camera,
    update(t, p, camK) {
      poseCamera(camera, camK);

      lineMat.opacity = lerp(
        SPEC.lines.opacity[0],
        SPEC.lines.opacity[1],
        slice(p, SPEC.lines.range),
      );
      const cage = nearCageOpacity(camK);
      fenceNear.opacity = cage.fence;
      glassNear.opacity = cage.glass;
      frameNear.opacity = cage.frame;
      paneNear.opacity = cage.pane;

      const state = rallyAt(t, camK);
      state.rackets.forEach((r, i) => {
        const g = rackets[i]!;
        g.position.set(r.position.x, r.position.y, r.position.z);
        g.rotation.set(r.rotation.x, r.rotation.y, r.rotation.z);
      });
      ball.position.set(state.ball.x, state.ball.y, state.ball.z);
      caster?.position.copy(ball.position);
      ball.rotation.x += 0.12;
      ball.rotation.z += 0.07;
      if (trailN > 0) {
        if (state.newLeg) history.length = 0;
        history.unshift(ball.position.clone());
        if (history.length > TRAIL_HISTORY) history.pop();
      }
      trail.forEach((m, i) => {
        const f = ((i + 1) * TRAIL_SPAN) / TRAIL_N;
        const j = Math.floor(f);
        const a = history[j];
        const b = history[j + 1];
        m.visible = !!(a && b);
        if (a && b) m.position.lerpVectors(a, b, f - j);
      });
      shade.position.set(state.shade.x, 0.012, state.shade.z);
      shade.scale.setScalar(state.shade.scale);
      shadeMat.opacity = state.shade.opacity;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      scene.clear();
      overlay.clear();
    },
  };
}
