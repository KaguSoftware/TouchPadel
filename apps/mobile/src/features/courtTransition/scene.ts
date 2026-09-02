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
  // Lit exactly like the court, minus the shadow pass — the ball and the
  // rackets must agree about where the sun is.
  overlay.add(new THREE.HemisphereLight(0xffffff, 0xb9c8e0, 0.7));
  const sun2 = new THREE.DirectionalLight(0xffffff, 1.7);
  sun2.position.set(14, 13, 9);
  overlay.add(sun2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c8e0, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  // Low and to one side, not overhead. At (6, 30, 10) the sun was nearly
  // straight up: every shadow fell directly UNDER its racket, where from a
  // top-down camera it hides behind the object casting it — so nothing
  // separated racket from turf and they read as painted on. Dropping the
  // elevation throws each shadow well clear, which is what tells the eye the
  // racket is floating above the court. The stronger key against a dimmer
  // ambient also deepens the modelling on the frame.
  sun.position.set(14, 13, 9);
  sun.castShadow = shadows;
  if (shadows) {
    // 2048 in the prototype; 1024 keeps the shadow pass cheap on a phone.
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.05;
    // Crisper than the prototype's 4: a tight shadow reads as a small object
    // held above a surface, a woolly one as a stain on it.
    sun.shadow.radius = 2;
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 16, bottom: -16, near: 1, far: 70 });
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
  // A padel court, 10 × 20 m with the net on z = 0 (walls at z ±10, x ±5):
  //  · the perimeter, tight inside the glass;
  //  · the service lines, 3 m in from each back wall (z = ±7);
  //  · the centre service line, splitting each pair of service boxes — it runs
  //    from the service line TO THE NET, not from the service line to the back
  //    wall, which is where the prototype drew it (a 3 m stub at z ±8.5, i.e.
  //    dividing the back strip that is a single area in play).
  const LW = 0.1;
  const SERVICE_Z = 7; // service line, 3 m from the back wall
  // Perimeter.
  line(10, LW, 0, -10 + LW / 2);
  line(10, LW, 0, 10 - LW / 2);
  line(LW, 20, -5 + LW / 2, 0);
  line(LW, 20, 5 - LW / 2, 0);
  // Service lines.
  line(10, LW, 0, -SERVICE_Z);
  line(10, LW, 0, SERVICE_Z);
  // Centre service line: service line → net, on both halves.
  line(LW, SERVICE_Z, 0, -SERVICE_Z / 2);
  line(LW, SERVICE_Z, 0, SERVICE_Z / 2);

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

  /**
   * Where the racket turns, along its own handle axis (local +z: head centre
   * 0, throat 0.5, grip wraps 0.72–1.14, cap 1.22).
   *
   * The BUTT of the handle — the hand. Everything ahead of it, head and grip
   * together, then swings as ONE piece: tilt the pitch and the whole racket
   * drops nose-first, which is what a downward strike looks like. Pivoting at
   * the throat (0.5) instead made the racket see-saw about its own middle —
   * the head rising as the handle fell — so a 60° "tip down" actually lifted
   * the head 22 cm rather than dropping it.
   */
  const GRIP = 1.15;
  /**
   * How far the top view lifts the rackets off the turf, purely for looks.
   * Applied here rather than in rally.ts because the ball flies between the
   * racket POSITIONS: raising those would move the rally itself.
   */
  const LIFT = 1.1;

  // racket (brand sticker, traced 2026-09-03): royal-blue frame band with a
  // black ink outline, a darker string bed of 32 white dots, two cyan gloss
  // arcs, a short V-strut throat, a green wrap grip and a blue butt cap.
  const INK = 0x0d0e12;
  /** Flat, unlit fills — the drawing's own (see the header). */
  const flat = (color: number) => {
    const m = new THREE.MeshBasicMaterial({ color });
    disposables.push(m);
    return m;
  };
  /** Ink is drawn BackSide: the fatter twin's far wall IS the brush line. */
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  disposables.push(inkMat);
  const inkFlat = flat(INK);
  const glossMat = flat(0x74cbdf);
  const frameMat = flat(0x4164a5);
  const bedMat = flat(0x224d89);
  const studMat = flat(0xffffff);
  const gripMat = flat(0x9bca64);
  const buttCapMat = flat(0x2b4a8e);

  /**
   * The head's outline, traced (see the header): radius at angle `a`, where
   * a = 0 points at the TIP (local −z, away from the hand) and a = π at the
   * throat. A near-circle, marginally longer along the handle.
   */
  const headR = (a: number) =>
    0.50361 +
    0.01304 * Math.cos(a) +
    0.00767 * Math.cos(2 * a) -
    0.00189 * Math.cos(3 * a) -
    0.00745 * Math.cos(4 * a);
  /** Outline point in the head's own plane (x across, z along the handle). */
  const headPt = (a: number, scale = 1) => {
    const r = headR(a) * scale;
    return new THREE.Vector2(Math.sin(a) * r, -Math.cos(a) * r);
  };
  const SEG = 64;
  /**
   * The outline as a curve — the whole ring by default, or the arc [from, to]
   * for the gloss highlights (open, so the tube has two ends).
   */
  const headCurve = (scale: number, from = 0, to = Math.PI * 2, closed = true) => {
    const pts: THREE.Vector3[] = [];
    const n = Math.max(4, Math.round((SEG * (to - from)) / (Math.PI * 2)));
    for (let i = 0; i < n + (closed ? 0 : 1); i++) {
      const p = headPt(from + ((to - from) * i) / n, scale);
      pts.push(new THREE.Vector3(p.x, 0, p.y));
    }
    return new THREE.CatmullRomCurve3(pts, closed);
  };
  /** The bed: the same outline filled, in to 0.80 of it where the band ends. */
  const headShape = (scale: number) => {
    const shape = new THREE.Shape();
    for (let i = 0; i <= SEG; i++) {
      const p = headPt((i / SEG) * Math.PI * 2, scale);
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    }
    return shape;
  };
  const makeRacket = () => {
    const g = new THREE.Group();
    // Frame band. Measured: the band runs from the outline in to 0.79 of it, so
    // a tube of radius 0.052 centred on the 0.897 curve puts its outer wall ON
    // the traced outline and its inner wall where the bed starts.
    const frame = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.897), SEG, 0.052, 14, true)),
      frameMat,
    );
    const frameInk = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.897), SEG, 0.067, 14, true)),
      inkMat,
    );
    // The bed: darker than the band, as drawn, reaching 0.80 of the outline.
    const bed = new THREE.Mesh(
      geo(
        new THREE.ExtrudeGeometry(headShape(0.8), {
          depth: 0.06,
          bevelEnabled: false,
          curveSegments: SEG,
        }),
      ),
      bedMat,
    );
    // Extrude builds in the xy plane growing along +z; stand it into the head's
    // plane so its face is the string bed.
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -0.01;
    // The ink line the drawing paints where the bed meets the band, and the
    // second one that splits the band into rim and frame — the drawing's
    // double-line head.
    const bedLine = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.8), SEG, 0.014, 8, true)),
      inkFlat,
    );
    bedLine.position.y = 0.05;
    const rimLine = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.9), SEG, 0.011, 8, true)),
      inkFlat,
    );
    rimLine.position.y = 0.05;
    // Gloss: the long upper-left shoulder arc and the short one under the
    // throat on the same side — not a full ring, which read as a second rim.
    const gloss = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.9, -1.55, -0.2, false), 26, 0.026, 8, false)),
      glossMat,
    );
    gloss.position.y = 0.04;
    const gloss2 = new THREE.Mesh(
      geo(new THREE.TubeGeometry(headCurve(0.9, -3.1, -2.45, false), 14, 0.022, 8, false)),
      glossMat,
    );
    gloss2.position.y = 0.04;
    g.add(frameInk, frame, bed, bedLine, rimLine, gloss, gloss2);
    // The dot field, measured: 32 dots on a staggered grid of pitch 0.0942, each
    // 0.0257 across, the whole diamond pushed 0.047 toward the TIP and cut off
    // 0.309 from its own centre.
    const studGeo = geo(new THREE.CylinderGeometry(0.0257, 0.0257, 0.05, 10));
    const PITCH = 0.0942;
    const CZ = -0.047;
    for (let row = -3; row <= 3; row++) {
      const z = CZ + row * PITCH;
      for (let col = -3; col <= 3; col++) {
        const x = (col + (row % 2 === 0 ? 0 : 0.5)) * PITCH;
        if (Math.hypot(x, z - CZ) > 0.309) continue;
        const h = new THREE.Mesh(studGeo, studMat);
        h.position.set(x, 0.06, z);
        g.add(h);
      }
    }
    // Throat: the frame ITSELF comes down to the handle, as the drawing has it —
    // two legs leaving the band tangentially at about 4 and 8 o'clock and
    // converging on the collar, so the outer silhouette is one continuous line:
    // circle into V. Each leg starts ON the band's centreline at the tangent
    // point, so its open end is the band's own cross-section there and vanishes
    // inside it (the ink shell likewise; at the apex the collar's ink covers
    // them). The tangent from the apex (±0.03, 0.68) to the 0.897 curve lands at
    // a = ±2.24 rad. The open triangle between the legs and the bed's bottom
    // edge is the drawing's white gap. Thinner than the band, as drawn.
    for (const sx of [-1, 1] as const) {
      const T = headPt(sx * 2.24, 0.897);
      const legCurve = new THREE.LineCurve3(
        new THREE.Vector3(T.x, 0, T.y),
        new THREE.Vector3(sx * 0.03, 0, 0.68),
      );
      const leg = new THREE.Mesh(geo(new THREE.TubeGeometry(legCurve, 1, 0.036, 12, false)), frameMat);
      const legInk = new THREE.Mesh(geo(new THREE.TubeGeometry(legCurve, 1, 0.05, 12, false)), inkMat);
      g.add(legInk, leg);
    }
    // The collar where the two legs converge onto the handle.
    const collar = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.082, 0.078, 0.1, 12)), frameMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.7;
    const collarInk = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(0.106, 0.102, 0.16, 12)),
      inkMat,
    );
    collarInk.rotation.x = Math.PI / 2;
    collarInk.position.z = 0.7;
    // Grip: the green wrap measured off the drawing — z 0.682 → 1.062, radius
    // 0.078 — with ink wrap seams, then the blue butt cap on the end of it.
    const handle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.078, 0.078, 0.38, 16)), gripMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.872;
    const handleInk = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(0.099, 0.099, 0.39, 16)),
      inkMat,
    );
    handleInk.rotation.x = Math.PI / 2;
    handleInk.position.z = 0.872;
    for (const z of [0.75, 0.84, 0.93, 1.02]) {
      const w = new THREE.Mesh(geo(new THREE.TorusGeometry(0.079, 0.008, 8, 26)), inkFlat);
      w.position.z = z;
      g.add(w);
    }
    const cap = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.082, 0.082, 0.088, 16)), buttCapMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 1.106;
    const capInk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.104, 0.104, 0.11, 16)), inkMat);
    capInk.rotation.x = Math.PI / 2;
    capInk.position.z = 1.106;
    g.add(collarInk, collar, handleInk, handle, capInk, cap);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = shadows;
    });
    return g;
  };
  // Each racket hangs inside a pivot group placed at the player's HAND.
  //
  // The mesh's own origin is the centre of the string bed, so rotating it
  // directly see-sawed the racket about its middle — the face dipping as the
  // handle rose, like a pan on a pivot. Offsetting the mesh by −GRIP along its
  // handle axis puts the grip on the pivot's origin instead, so the hand holds
  // station and the head sweeps an arc around it, the way a person swings one.
  const rackets = PLAYERS.map((pl) => {
    const pivot = new THREE.Group();
    const g = makeRacket();
    // Scale on the PIVOT, not the mesh: a child's position is scaled by its
    // parent, so with the scale on `g` the offset below stayed 0.95 instead of
    // the 1.09 the placement maths assumes.
    g.position.z = -GRIP; // grip to the origin; the head reaches out ahead of it
    pivot.scale.setScalar(1.15);
    pivot.add(g);
    pivot.position.set(pl.x, 0.75, pl.z);
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = playerYaw(pl);
    scene.add(pivot);
    return pivot;
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
        // `r.position` is the HAND — the pivot the swing turns about, and the
        // one point that should hold station while the head sweeps. The ball
        // is aimed at the head instead (rally.ts stringBed), so nothing here
        // needs to compensate: the pivot goes straight to r.position.
        //
        // Pinning the HEAD here instead put the ball on the strings but made
        // the hand sweep 1.8 m while the head barely moved — the swing running
        // backwards, since r.position hardly travels during a stroke.
        // Lifted clear of the turf in the TOP view only, and only visually:
        // the rally's own numbers (and so the ball's flight, which is pinned
        // by a checksum test) are untouched. Down at 0.75 m the racket and
        // the shadow it casts nearly overlap from a top-down camera, welding
        // it to the court; another metre of air puts real daylight between
        // the two and the racket reads as held above the floor. Fades out as
        // the camera pitches, where the height already reads correctly.
        g.position.set(r.position.x, r.position.y + LIFT * (1 - camK), r.position.z);
        // 'YXZ' explicitly: Euler.set() resets the order to 'XYZ' when it is
        // omitted, silently discarding the group's rotation.order set at build
        // time — which yawed the racket about the world axis instead of its own.
        g.rotation.set(r.rotation.x, r.rotation.y, r.rotation.z, 'YXZ');
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
