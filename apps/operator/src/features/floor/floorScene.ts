/**
 * The live floor — the three.js half. Loaded lazily by LiveFloor.tsx, and only
 * on a machine that can draw WebGL; the counts and tooltips are React and
 * never depend on it.
 *
 * The venue as built (YCA_PADEL CAD, 2026): two 20 × 10 m courts flanking a
 * 10 m strip that runs locker room → reception → offices → WC → kitchen →
 * vitamin bar → cafe → showrooms → entrance. Metres, y-up, entrance toward the
 * viewer. Architecture is built once; `apply()` rebuilds only the live layer
 * (players, guests, staff) and recolours the court bands and table tops.
 *
 * Motion, per DESIGN.md: only what the server did while the owner was looking
 * elsewhere may move — a figure that arrived scales in over 320 ms. Camera
 * moves (focus, "show whole floor") are navigation, eased over 240 ms so the
 * owner keeps their bearings, and cut straight when the machine asks for
 * reduced motion. The one loop is the RALLY on a court the server says is in
 * play (owner request, 2026-09-18): the mobile app's rackets and stroke
 * (./rally) and the ball between them — the rackets stand in for the players,
 * nobody is drawn holding them (owner call, 2026-09-18). It is
 * the server's state made visible, not decoration — a court that stops being
 * in play stops moving — and under reduced motion it holds the freeze frame
 * the phone holds, the ball on the striker's face.
 *
 * Rendering is on demand: a frame is drawn when the controls moved, a figure
 * is still arriving, or the camera is easing — an idle plan costs nothing on a
 * laptop reading numbers after hours.
 *
 * The wheel zooms, over the canvas and nowhere else: the handler is bound to
 * the canvas, so the plan takes the wheel while the pointer is on it — at the
 * ends of the zoom too, where it simply stops rather than letting the page
 * scroll out from under the owner — and the wheel means what it always meant
 * everywhere else on the page. Closer is also a click on a court, a table or
 * a room, the two step buttons or the upright track between them; back is
 * "Show whole floor".
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ZOOM_MIN_DIST, zoomDistanceAt, zoomLevelOf, type FloorSnapshot, type FloorTarget, type Room } from './floorModel';
import { buildRacketKit, type RacketKit, type RacketRig } from './rally/racket';
import { BALL_RADIUS, PLAYERS, layAngle, nextLegStart, rallyAt } from './rally/rally';

export interface FloorSceneEvents {
  onHover: (target: FloorTarget | null, point: { x: number; y: number }) => void;
  onPick: (target: FloorTarget) => void;
  /** The owner dragged or wheeled the view away from the whole floor. */
  onMoved: () => void;
  /**
   * How close the camera now stands, 0 at the whole floor and 1 at the nearest
   * the plan allows. Fires whenever anything moves the camera — the slider
   * itself, the two buttons, a click on a court, the wheel, a drag, or a
   * resize that re-frames the floor — so a control bound to it never drifts
   * out of step with what is drawn.
   */
  onZoom: (level: number) => void;
}

export interface FloorSceneHandle {
  apply: (snapshot: FloorSnapshot) => void;
  /** Move closer to a target, or back to the whole floor with null. */
  focus: (target: FloorTarget | null) => void;
  /** One step closer ('in') or further ('out') along the line of sight. */
  zoom: (direction: 'in' | 'out') => void;
  /**
   * Stand at a point on the same line the buttons walk: 0 the whole floor,
   * 1 the closest the plan allows. Dragged, so it arrives without the 240 ms
   * ease the buttons and the focus moves use — the view must follow the thumb.
   */
  setZoomLevel: (level: number) => void;
  /**
   * Let the wheel over the canvas zoom the plan. On everywhere today; the
   * switch stays because the handler is the one thing that can take the wheel
   * away from the page, so turning it off must remain one call.
   */
  setWheelZoom: (on: boolean) => void;
  dispose: () => void;
}

/** One zoom step multiplies the camera's distance by this (or its inverse). */
const ZOOM_STEP = 0.7;

/** The five brand colours plus the two functional ones (DESIGN.md). */
const BLUE = 0x3360ab;
const GREEN = 0xa5d06f;
const GRAY = 0xbcbdbf;
const AMBER = 0xd9a64b;

const CZ = -2; // court-hall centre on z
const COURT_X = [-15, 15] as const;
// [x, z, seats]: outer columns seat four, the centre column two.
const TABLE_DEF: readonly (readonly [number, number, 2 | 4])[] = [
  [-2.1, 1.2, 4],
  [2.1, 1.2, 4],
  [0, 2.3, 2],
  [-2.1, 2.5, 4],
  [2.1, 2.9, 4],
  [0, 3.6, 2],
  [-2.1, 3.8, 4],
  [2.1, 4.25, 4],
  [0, 4.8, 2],
];
interface Station {
  x: number;
  z: number;
  w: number;
  d: number;
  slots: readonly (readonly [number, number])[];
}
const ROOMS: Record<Room, Station> = {
  reception: { x: 0, z: -13.05, w: 3.4, d: 2.3, slots: [[0, -0.2], [-1.0, 0.6]] },
  office: { x: -2.95, z: -10.2, w: 3.9, d: 3.1, slots: [[-1.4, 0.1], [0.6, 0.7]] },
  meeting: { x: 2.95, z: -10.2, w: 3.9, d: 3.1, slots: [[-1.9, 0.15], [1.45, 0.15]] },
  kitchen: { x: 0, z: -3.9, w: 5.8, d: 2.4, slots: [[-1.2, 0.05], [1.3, 0.05], [0, -0.35]] },
  bar: { x: 0, z: -1.3, w: 5.4, d: 1.7, slots: [[-1.1, 0.05], [1.1, 0.05]] },
  floor: { x: 0, z: 0.4, w: 3.2, d: 1.4, slots: [[-1.05, 0], [1.05, 0]] },
};

const HOME_TARGET = new THREE.Vector3(0, 0, -2);
/** Where the whole-floor view looks from: the entrance toward the viewer, a little off-axis. */
const HOME_DIR = new THREE.Vector3(10, 30, 36).normalize();
/** The box the whole venue sits in (metres): both slabs, the strip, the entrance mat. */
const HOME_BOX = new THREE.Box3(new THREE.Vector3(-25.5, 0, -17.5), new THREE.Vector3(25.5, 4.2, 13));
/** How much of the view the venue should fill from the whole-floor camera. */
const HOME_FILL = 0.92;

export function createFloorScene(host: HTMLElement, events: FloorSceneEvents, opts: { reducedMotion: boolean }): FloorSceneHandle {
  // ---- renderer, camera, controls ---------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.outline = 'none';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
  /**
   * The whole-floor camera distance depends on the box the plan was given: a
   * wide, short panel needs to stand back for the courts to fit across it,
   * a square one can come closer. Framed so the venue fills the narrower of
   * the two fields of view.
   */
  const homePosition = () => {
    // Project the venue's box from a trial distance and scale the distance
    // by how far its furthest corner lands from the centre of the view.
    // Perspective is not linear in distance, so three rounds settle it.
    const probe = camera.clone();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) => new THREE.Vector3(i & 1 ? HOME_BOX.max.x : HOME_BOX.min.x, i & 2 ? HOME_BOX.max.y : HOME_BOX.min.y, i & 4 ? HOME_BOX.max.z : HOME_BOX.min.z),
    );
    let dist = 48;
    for (let round = 0; round < 3; round++) {
      probe.position.copy(HOME_TARGET).add(HOME_DIR.clone().multiplyScalar(dist));
      probe.lookAt(HOME_TARGET);
      probe.updateMatrixWorld();
      let extent = 0;
      for (const c of corners) {
        const p = c.clone().project(probe);
        extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
      }
      dist *= extent / HOME_FILL;
    }
    return HOME_TARGET.clone().add(HOME_DIR.clone().multiplyScalar(dist));
  };
  camera.position.copy(homePosition());

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.46;
  // The wheel, when it is allowed, moves between the same two limits the
  // buttons do; maxDistance follows the whole-floor distance in fit().
  controls.minDistance = ZOOM_MIN_DIST;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(20, 40, 25);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  const span = 32;
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = span;
  key.shadow.camera.bottom = -span;
  key.shadow.camera.far = 120;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
  fill.position.set(-25, 15, -20);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- materials ----------------------------------------------------------
  const disposables: { dispose: () => void }[] = [];
  const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
    disposables.push(m);
    return m;
  };
  const M = {
    blue: mat(BLUE),
    green: mat(GREEN, { roughness: 0.7 }),
    gray: mat(GRAY),
    paper: mat(0xf7f8fa, { roughness: 0.9 }),
    line: mat(0xffffff, { roughness: 0.6 }),
    ink: mat(0x1b2c47, { roughness: 0.6, metalness: 0.2 }),
    concrete: mat(0xe4e8ef, { roughness: 1 }),
    wall: mat(0xeef1f6, { roughness: 0.95 }),
    wood: mat(0xd3d8e2, { roughness: 0.8 }),
    glass: mat(0xbfd3f5, { transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    fence: mat(0x1b2c47, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    amber: mat(AMBER, { roughness: 0.7 }),
    guest: mat(0xffffff, { roughness: 0.55 }),
    foliage: mat(0x5b7a4a, { roughness: 0.95 }),
    acrylic: mat(0xebeef4, { roughness: 0.6 }),
    light: mat(0x7d9fd8, { roughness: 0.4, emissive: BLUE, emissiveIntensity: 0.35 }),
    hit: mat(BLUE, { transparent: true, opacity: 0.0, depthWrite: false }),
  };

  // ---- geometry helpers ---------------------------------------------------
  const geos: THREE.BufferGeometry[] = [];
  const geo = <G extends THREE.BufferGeometry>(g: G): G => {
    geos.push(g);
    return g;
  };
  const root = new THREE.Group();
  const arch = new THREE.Group();
  const live = new THREE.Group();
  root.add(arch, live);
  scene.add(root);

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = arch) => {
    const g = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    g.position.set(x, y, z);
    g.castShadow = true;
    g.receiveShadow = true;
    parent.add(g);
    return g;
  };
  const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 24, parent: THREE.Object3D = arch) => {
    const g = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, h, seg)), m);
    g.position.set(x, y, z);
    g.castShadow = true;
    g.receiveShadow = true;
    parent.add(g);
    return g;
  };

  // ---- slabs --------------------------------------------------------------
  box(20, 0.2, 26, M.concrete, -15, -0.1, CZ);
  box(20, 0.2, 26, M.concrete, 15, -0.1, CZ);
  box(10, 0.2, 26, M.paper, 0, -0.099, CZ);
  box(10, 0.2, 2, M.paper, 0, -0.099, -16);

  // ---- courts -------------------------------------------------------------
  const courtBands: THREE.Mesh[] = [];
  const courtGroups: THREE.Group[] = [];
  for (const cx of COURT_X) {
    const g = new THREE.Group();
    g.position.set(cx, 0, CZ);
    arch.add(g);
    courtGroups.push(g);
    box(10, 0.06, 20, M.blue, 0, 0.03, 0, g);
    const shape = new THREE.Shape();
    shape.moveTo(-5.5, -10.5);
    shape.lineTo(5.5, -10.5);
    shape.lineTo(5.5, 10.5);
    shape.lineTo(-5.5, 10.5);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-5.05, -10.05);
    hole.lineTo(5.05, -10.05);
    hole.lineTo(5.05, 10.05);
    hole.lineTo(-5.05, 10.05);
    hole.closePath();
    shape.holes.push(hole);
    const band = new THREE.Mesh(geo(new THREE.ShapeGeometry(shape)), M.gray);
    band.rotation.x = -Math.PI / 2;
    band.position.y = 0.012;
    band.receiveShadow = true;
    g.add(band);
    courtBands.push(band);
    box(10, 0.01, 0.1, M.line, 0, 0.066, 3.05, g);
    box(10, 0.01, 0.1, M.line, 0, 0.066, -3.05, g);
    box(0.1, 0.01, 6.95, M.line, 0, 0.066, 6.525, g);
    box(0.1, 0.01, 6.95, M.line, 0, 0.066, -6.525, g);
    box(10, 0.86, 0.02, M.fence, 0, 0.49, 0, g);
    box(10, 0.06, 0.05, M.line, 0, 0.9, 0, g);
    cyl(0.05, 1.0, M.ink, -5.1, 0.5, 0, 12, g);
    cyl(0.05, 1.0, M.ink, 5.1, 0.5, 0, 12, g);
    for (const s of [-1, 1]) {
      box(10, 3, 0.04, M.glass, 0, 1.5, s * 10, g);
      for (const t of [-1, 1]) {
        box(0.04, 3, 2, M.glass, t * 5, 1.5, s * 9, g);
        box(0.03, 4, 16, M.fence, t * 5, 2, 0, g);
      }
    }
    const posts: [number, number][] = [
      [-5, -10], [5, -10], [-5, 10], [5, 10], [-5, -8], [5, -8], [-5, 8], [5, 8],
      [-5, -4], [5, -4], [-5, 0], [5, 0], [-5, 4], [5, 4], [0, -10], [0, 10],
    ];
    for (const [x, z] of posts) {
      const tall = Math.abs(x) === 5 && Math.abs(z) < 9;
      box(0.1, tall ? 4 : 3, 0.1, M.ink, x, (tall ? 4 : 3) / 2, z, g);
    }
    box(10.1, 0.08, 0.08, M.ink, 0, 3.04, -10, g);
    box(10.1, 0.08, 0.08, M.ink, 0, 3.04, 10, g);
    box(0.08, 0.08, 20.1, M.ink, -5, 4.04, 0, g);
    box(0.08, 0.08, 20.1, M.ink, 5, 4.04, 0, g);
  }

  // ---- central strip ------------------------------------------------------
  const WH = 1.2;
  const WT = 0.12;
  const wall = (x1: number, z1: number, x2: number, z2: number, m: THREE.Material = M.wall) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const w = box(len, WH, WT, m, (x1 + x2) / 2, WH / 2, (z1 + z2) / 2);
    w.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    return w;
  };
  wall(-5, -17, -5, -8.6);
  wall(5, -17, 5, -8.6);
  wall(-5, 6.6, -5, 11);
  wall(5, 6.6, 5, 11);
  // locker block
  wall(-5, -17, 5, -17);
  wall(-5, -15, -0.9, -15);
  wall(0.9, -15, 5, -15);
  wall(-3.2, -17, -3.2, -15);
  wall(3.2, -17, 3.2, -15);
  for (let i = 0; i < 6; i++) wall(-3.2 + i * 1.28, -17, -3.2 + i * 1.28, -15.6);
  for (let i = 0; i < 5; i++) {
    const x = -3.2 + 0.64 + i * 1.28;
    box(0.9, 0.06, 0.35, M.wood, x, 0.45, -16.75);
    cyl(0.12, 0.02, M.ink, x, 1.15, -16.85, 12);
  }
  for (const s of [-1, 1]) {
    cyl(0.22, 0.4, M.paper, s * 4.5, 0.2, -15.6, 16);
    box(0.5, 0.1, 0.42, M.paper, s * 4.1, 0.85, -16.7);
  }
  // reception block
  wall(-5, -14.3, 5, -14.3);
  wall(-1.8, -14.3, -1.8, -11.8);
  wall(1.8, -14.3, 1.8, -11.8);
  wall(-5, -13.2, -1.8, -13.2);
  wall(1.8, -13.2, 5, -13.2);
  wall(-3.4, -13.2, -3.4, -11.8);
  wall(-5, -11.8, -0.6, -11.8);
  wall(0.6, -11.8, 5, -11.8);
  for (let i = 0; i < 6; i++) {
    box(0.5, 0.9, 0.55, M.wood, -4.65 + i * 0.55, 0.45, -13.95);
    box(0.5, 0.9, 0.55, M.wood, 1.95 + i * 0.55, 0.45, -13.95);
  }
  for (let i = 0; i < 5; i++) box(0.6, 0.9, 0.55, M.wood, -1.3 + i * 0.65, 0.45, -13.95);
  const recepDesk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.85, 0.85, 1.1, 32, 1, false, 0, Math.PI)), M.blue);
  recepDesk.position.set(0, 0.55, -12.75);
  recepDesk.rotation.y = -Math.PI / 2;
  recepDesk.castShadow = true;
  arch.add(recepDesk);
  box(1.7, 1.1, 0.1, M.blue, 0, 0.55, -12.8);
  const recepTop = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.9, 0.9, 0.05, 32, 1, false, 0, Math.PI)), M.wood);
  recepTop.position.set(0, 1.125, -12.75);
  recepTop.rotation.y = -Math.PI / 2;
  arch.add(recepTop);
  cyl(0.2, 0.45, M.ink, 0, 0.22, -13.25, 14);
  cyl(0.22, 0.4, M.paper, -2.3, 0.2, -12.2, 16);
  box(0.5, 0.1, 0.42, M.paper, -2.9, 0.85, -12.85);
  box(0.4, 1.1, 1.1, M.wood, -4.7, 0.55, -12.4);
  box(0.4, 1.1, 1.1, M.wood, 4.7, 0.55, -12.4);
  // offices
  wall(-0.95, -11.8, -0.95, -8.6, M.glass);
  wall(0.95, -11.8, 0.95, -8.6, M.glass);
  wall(-3.5, -8.6, -0.95, -8.6, M.glass);
  wall(0.95, -8.6, 3.5, -8.6, M.glass);
  wall(-5, -8.6, -3.5, -8.6);
  wall(3.5, -8.6, 5, -8.6);
  box(0.85, 0.06, 2.15, M.wood, -3.3, 0.74, -9.95);
  box(0.85, 0.7, 0.06, M.wood, -3.3, 0.36, -11.0);
  box(0.85, 0.7, 0.06, M.wood, -3.3, 0.36, -8.9);
  box(0.03, 0.35, 0.55, M.ink, -3.5, 0.98, -10.3);
  cyl(0.22, 0.45, M.ink, -4.35, 0.22, -10.1, 14);
  cyl(0.2, 0.44, M.ink, -2.45, 0.22, -10.7, 14);
  cyl(0.2, 0.44, M.ink, -2.45, 0.22, -9.35, 14);
  box(0.4, 0.5, 0.6, M.wood, -2.4, 0.25, -10.0);
  box(0.45, 0.3, 0.4, M.gray, -3.3, 0.92, -9.1);
  const oval = cyl(1, 0.05, M.wood, 2.7, 0.75, -10.05, 40);
  oval.scale.set(1.3, 1, 0.68);
  cyl(0.12, 0.72, M.ink, 2.7, 0.37, -10.05, 12);
  for (const [cx2, dz] of [[2.0, -0.95], [2.7, -0.95], [3.35, -0.95], [2.0, 0.95], [2.7, 0.95], [3.35, 0.95], [1.05, 0], [4.4, 0]] as const) {
    cyl(0.19, 0.44, M.ink, cx2, 0.22, -10.05 + dz, 14);
  }
  // lobby floor lighting
  for (const s of [-1, 1]) {
    box(0.06, 0.012, 2.2, M.light, s * 0.6, 0.006, -10.7);
    const arc = new THREE.Mesh(geo(new THREE.TorusGeometry(1.0, 0.03, 6, 24, Math.PI / 2)), M.light);
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = s < 0 ? -Math.PI / 2 : Math.PI;
    arc.position.set(s * 1.6, 0.006, -9.6);
    arch.add(arc);
    box(2.4, 0.012, 0.06, M.light, s * 2.8, 0.006, -8.6);
  }
  // WC block
  wall(-3.5, -7.45, -2.7, -7.45);
  wall(-1.8, -7.45, 1.8, -7.45);
  wall(2.7, -7.45, 3.5, -7.45);
  wall(-3.5, -5.2, 3.5, -5.2);
  wall(-3.5, -7.45, -3.5, -5.2);
  wall(3.5, -7.45, 3.5, -5.2);
  wall(0, -7.45, 0, -5.2);
  for (const s of [-1, 1]) {
    wall(s * 1.6, -7.35, s * 1.6, -5.3);
    wall(s * 0.12, -6.35, s * 1.6, -6.35);
    cyl(0.22, 0.4, M.paper, s * 0.8, 0.2, -6.95, 16);
    cyl(0.22, 0.4, M.paper, s * 0.8, 0.2, -5.75, 16);
    box(0.42, 0.1, 0.5, M.paper, s * 3.15, 0.85, -6.8);
    box(0.42, 0.1, 0.5, M.paper, s * 3.15, 0.85, -5.85);
  }
  // kitchen
  wall(-2.95, -5.2, -2.95, -2.65);
  wall(3.0, -5.2, 3.0, -4.0);
  wall(3.0, -3.3, 3.0, -2.65);
  for (let i = 0; i < 8; i++) box(0.55, 0.9, 0.6, M.paper, -2.55 + i * 0.6, 0.45, -4.85);
  box(4.8, 0.04, 0.65, M.wood, -0.45, 0.92, -4.85);
  box(0.65, 0.9, 1.6, M.paper, -2.55, 0.45, -3.75);
  box(0.7, 0.04, 1.65, M.wood, -2.55, 0.92, -3.75);
  box(0.5, 0.05, 0.5, M.ink, -2.55, 0.95, -4.1);
  box(5.9, 0.95, 0.7, M.blue, 0, 0.475, -3.0);
  box(6.0, 0.05, 0.8, M.wood, 0, 0.975, -3.0);
  // vitamin bar
  const BW = 5.6;
  const BD = 1.85;
  const BT = 0.6;
  const BR = 0.9;
  const barShape = new THREE.Shape();
  barShape.moveTo(-BW / 2, 0);
  barShape.lineTo(-BW / 2, BD - BR);
  barShape.absarc(-BW / 2 + BR, BD - BR, BR, Math.PI, Math.PI / 2, true);
  barShape.lineTo(BW / 2 - BR, BD);
  barShape.absarc(BW / 2 - BR, BD - BR, BR, Math.PI / 2, 0, true);
  barShape.lineTo(BW / 2, 0);
  barShape.lineTo(BW / 2 - BT, 0);
  barShape.lineTo(BW / 2 - BT, BD - BR);
  barShape.absarc(BW / 2 - BR, BD - BR, BR - BT, 0, Math.PI / 2, false);
  barShape.lineTo(-BW / 2 + BR, BD - BT);
  barShape.absarc(-BW / 2 + BR, BD - BR, BR - BT, Math.PI / 2, Math.PI, false);
  barShape.lineTo(-BW / 2 + BT, 0);
  barShape.closePath();
  const bar = new THREE.Mesh(geo(new THREE.ExtrudeGeometry(barShape, { depth: 1.1, bevelEnabled: false })), M.blue);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, 1.1, -2.1);
  bar.castShadow = true;
  arch.add(bar);
  const barTop = new THREE.Mesh(geo(new THREE.ExtrudeGeometry(barShape, { depth: 0.05, bevelEnabled: false })), M.wood);
  barTop.rotation.x = Math.PI / 2;
  barTop.position.set(0, 1.15, -2.1);
  arch.add(barTop);
  for (const x of [-1.9, -0.95, 0, 0.95, 1.9]) cyl(0.17, 0.72, M.ink, x, 0.36, 0.2, 16);
  // cafe
  const rrect = (w: number, d: number, r: number) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -d / 2);
    s.lineTo(w / 2 - r, -d / 2);
    s.absarc(w / 2 - r, -d / 2 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(w / 2, d / 2 - r);
    s.absarc(w / 2 - r, d / 2 - r, r, 0, Math.PI / 2, false);
    s.lineTo(-w / 2 + r, d / 2);
    s.absarc(-w / 2 + r, d / 2 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-w / 2, -d / 2 + r);
    s.absarc(-w / 2 + r, -d / 2 + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  };
  const pad = new THREE.Mesh(geo(new THREE.ExtrudeGeometry(rrect(6.2, 6.0, 0.9), { depth: 0.02, bevelEnabled: false })), M.acrylic);
  pad.rotation.x = Math.PI / 2;
  pad.position.set(0, 0.02, 3.1);
  pad.receiveShadow = true;
  arch.add(pad);
  const tableTops: THREE.Mesh[] = [];
  TABLE_DEF.forEach(([x, z, seats]) => {
    cyl(0.26, 0.03, M.ink, x, 0.015, z, 20);
    cyl(0.04, 0.72, M.ink, x, 0.37, z, 10);
    tableTops.push(cyl(seats === 2 ? 0.38 : 0.45, 0.05, M.gray, x, 0.75, z, 32));
    for (let k = 0; k < seats; k++) {
      const a = seats === 2 ? k * Math.PI : (k * Math.PI) / 2 + Math.PI / 4;
      const rr = seats === 2 ? 0.7 : 0.8;
      cyl(0.17, 0.44, M.ink, x + Math.cos(a) * rr, 0.22, z + Math.sin(a) * rr, 14);
    }
  });
  // plants
  const leafGeo = geo(new THREE.CapsuleGeometry(0.045, 0.5, 3, 6));
  const tree = (x: number, z: number, r = 0.55) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    arch.add(g);
    const pot = new THREE.Mesh(geo(new THREE.CylinderGeometry((0.22 * r) / 0.55 + 0.02, (0.17 * r) / 0.55 + 0.02, 0.36, 18)), M.paper);
    pot.position.y = 0.6;
    pot.castShadow = true;
    g.add(pot);
    const n = 9 + Math.round(r * 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + x * 3.1;
      const tilt = 0.55 + (i % 3) * 0.2;
      const len = (0.7 + (i % 4) * 0.15) * (r / 0.55);
      const leaf = new THREE.Mesh(leafGeo, M.foliage);
      leaf.scale.set(1.6, len / 0.6, 0.35);
      leaf.position.set(Math.sin(a) * 0.06, 0.78 + len * 0.42, Math.cos(a) * 0.06);
      leaf.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
      g.add(leaf);
    }
  };
  const planter = (x: number, z: number, w = 0.7, d = 0.7) => box(w, 0.42, d, M.concrete, x, 0.21, z);
  for (const s of [-1, 1]) {
    planter(s * 2.1, 5.35, 1.3, 0.6);
    tree(s * 2.1, 5.35, 0.6);
    for (let i = 0; i < 9; i++) {
      const z = -4.75 + i * 1.25;
      planter(s * 4.55, z);
      if (i % 3 === 0) tree(s * 4.55, z, 0.45);
    }
    tree(s * 3.3, -4.7, 0.42);
    planter(s * 3.3, -4.7, 0.6, 0.6);
  }
  // showrooms + entrance
  wall(-5, 6.6, -1.5, 6.6);
  wall(1.5, 6.6, 5, 6.6);
  wall(-1.5, 6.6, -1.5, 11);
  wall(1.5, 6.6, 1.5, 11);
  wall(-5, 11, -1.5, 11);
  wall(1.5, 11, 5, 11);
  for (const [x, s] of [[-3.25, -1], [3.25, 1]] as const) {
    box(0.35, 1.8, 3.6, M.wood, s * 4.7, 0.9, 8.8);
    const arc = new THREE.Shape();
    arc.absarc(0, 0, 1.4, 0, Math.PI / 2, false);
    arc.absarc(0, 0, 1.0, Math.PI / 2, 0, true);
    const counter = new THREE.Mesh(geo(new THREE.ExtrudeGeometry(arc, { depth: 1.0, bevelEnabled: false })), M.blue);
    counter.rotation.x = Math.PI / 2;
    counter.rotation.z = s < 0 ? Math.PI / 2 : 0;
    counter.position.set(s * 1.7, 1.0, 7.0);
    counter.castShadow = true;
    arch.add(counter);
    box(1.1, 0.75, 1.5, M.gray, x, 0.375, 9.4);
    box(1.2, 0.04, 1.6, M.wood, x, 0.77, 9.4);
  }
  box(0.12, 2.6, 0.12, M.ink, -1.5, 1.3, 11.1);
  box(0.12, 2.6, 0.12, M.ink, 1.5, 1.3, 11.1);
  box(3.12, 0.12, 0.12, M.ink, 0, 2.66, 11.1);
  box(3.0, 0.02, 1.6, M.blue, 0, 0.011, 11.9);

  // ---- hit zones (invisible; what the pointer can be over) ---------------
  interface Zone {
    mesh: THREE.Mesh;
    target: FloorTarget;
    radius: number;
  }
  const zones: Zone[] = [];
  const zoneMeshes: THREE.Mesh[] = [];
  const addZone = (target: FloorTarget, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), M.hit);
    m.position.set(x, y, z);
    m.visible = false;
    root.add(m);
    zones.push({ mesh: m, target, radius: Math.max(w, d) * 0.62 });
    zoneMeshes.push(m);
    return m;
  };
  // Court and table zones are (re)bound to ids on apply(); rooms are fixed.
  const courtZones = COURT_X.map((cx, i) => addZone({ kind: 'court', id: `slot-${i}` }, cx, 1.5, CZ, 11, 3.2, 21));
  const tableZones = TABLE_DEF.map(([x, z], i) => addZone({ kind: 'table', id: `slot-${i}` }, x, 0.5, z, 2.2, 1.1, 2.2));
  for (const [room, s] of Object.entries(ROOMS) as [Room, Station][]) addZone({ kind: 'room', room }, s.x, 0.7, s.z, s.w, 1.5, s.d);
  const zoneOf = (mesh: THREE.Object3D) => zones.find((z) => z.mesh === mesh) ?? null;

  // ---- live layer ---------------------------------------------------------
  const capGeo = geo(new THREE.CapsuleGeometry(0.22, 0.62, 4, 14));
  const capSitGeo = geo(new THREE.CapsuleGeometry(0.22, 0.34, 4, 14));
  const bandGeo = geo(new THREE.CylinderGeometry(0.235, 0.235, 0.11, 16));
  const hatGeo = geo(new THREE.CylinderGeometry(0.19, 0.21, 0.13, 16));
  const brimGeo = geo(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 20));
  const arriving: THREE.Object3D[] = [];
  const spawn = (g: THREE.Object3D) => {
    g.userData.spawn = performance.now();
    if (!opts.reducedMotion) {
      g.scale.setScalar(0.001);
      arriving.push(g);
    }
    live.add(g);
    return g;
  };
  const person = (m: THREE.Material, x: number, z: number, seated = false) => {
    const p = new THREE.Mesh(seated ? capSitGeo : capGeo, m);
    p.position.set(x, seated ? 0.6 : 0.53, z);
    p.castShadow = true;
    p.receiveShadow = true;
    return spawn(p);
  };
  // Staff: blue body with green bands (the brand pattern); the hat says the state.
  const staffFigure = (hat: THREE.Material, x: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.53, z);
    const body = new THREE.Mesh(capGeo, M.blue);
    body.castShadow = true;
    g.add(body);
    for (const [i, y] of [[0, -0.18], [1, 0.02], [2, 0.22]] as const) {
      const b = new THREE.Mesh(bandGeo, M.green);
      b.position.y = y;
      b.scale.y = i === 1 ? 0.55 : 1;
      g.add(b);
    }
    const h = new THREE.Mesh(hatGeo, hat);
    h.position.y = 0.55;
    g.add(h);
    const brim = new THREE.Mesh(brimGeo, hat);
    brim.position.y = 0.49;
    g.add(brim);
    return spawn(g);
  };

  // ---- the rally on a court in play ---------------------------------------
  // The rackets and their stroke are the mobile app's (./rally, copied); the
  // court there is the same 10 × 20 m with the net on z = 0, so the rally's
  // court-local metres drop straight into a court group here. One kit shared
  // by every racket; each in-play court gets four rigs (the count hides the
  // spots the booking leaves empty), the ball and its ground disc. No figure
  // holds the racket: the swinging racket IS the player. Built on first use, kept and hidden
  // once the court empties, so a court that goes in and out of play does not
  // rebuild thirty geometries each time.
  interface CourtRally {
    group: THREE.Group;
    rigs: RacketRig[];
    ball: THREE.Group;
    shade: THREE.Mesh;
    count: number;
    /** Seconds into the loop this court started at, so two courts do not play in step. */
    phase: number;
  }
  const rallies = new Map<number, CourtRally>();
  let kit: RacketKit | null = null;
  const ballGeo = geo(new THREE.SphereGeometry(BALL_RADIUS, 18, 12));
  const seamGeo = geo(new THREE.TorusGeometry(BALL_RADIUS * 0.98, BALL_RADIUS * 0.12, 6, 32));
  const shadeGeo = geo(new THREE.CircleGeometry(BALL_RADIUS * 1.6, 20));
  const ballMat = mat(GREEN, { roughness: 0.6 });
  const shadeMat = mat(0x1b2c47, { transparent: true, opacity: 0.2, depthWrite: false });
  const lay = layAngle(1); // the plan always looks at standing rackets
  const T0 = performance.now();

  const rallyFor = (slot: number): CourtRally => {
    const have = rallies.get(slot);
    if (have) return have;
    kit ??= buildRacketKit('full');
    const group = new THREE.Group();
    group.visible = false;
    courtGroups[slot]!.add(group);
    const rigs = PLAYERS.map((pl) => {
      const rig = kit!.create(pl.hand);
      rig.lay.rotation.x = lay;
      group.add(rig.mount);
      return rig;
    });
    const ball = new THREE.Group();
    const core = new THREE.Mesh(ballGeo, ballMat);
    core.castShadow = true;
    const seam = new THREE.Mesh(seamGeo, M.line);
    seam.rotation.x = Math.PI / 3;
    ball.add(core, seam);
    group.add(ball);
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.075;
    group.add(shade);
    const r: CourtRally = { group, rigs, ball, shade, count: 4, phase: slot * 0.7 };
    rallies.set(slot, r);
    return r;
  };

  /** Pose one court's rally at rally-time t (seconds). */
  const poseRally = (r: CourtRally, t: number) => {
    const state = rallyAt(t, 1, r.count);
    state.rackets.forEach((pose, i) => {
      const rig = r.rigs[i]!;
      rig.mount.visible = pose.present;
      if (!pose.present) return;
      rig.mount.position.set(pose.position.x, pose.position.y, pose.position.z);
      rig.mount.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
      rig.pivot.position.set(pose.swing.position.x, pose.swing.position.y, pose.swing.position.z);
      rig.pivot.rotation.set(pose.swing.rotation.x, pose.swing.rotation.y, pose.swing.rotation.z);
    });
    r.ball.position.set(state.ball.x, state.ball.y, state.ball.z);
    r.ball.rotation.x += 0.12;
    r.ball.rotation.z += 0.07;
    r.shade.position.x = state.shade.x;
    r.shade.position.z = state.shade.z;
    r.shade.scale.setScalar(state.shade.scale);
    shadeMat.opacity = state.shade.opacity;
  };

  let dirty = true;
  function apply(snapshot: FloorSnapshot) {
    // A rally group still scaling in must not be left small when the arrival
    // list is dropped below: it outlives the live layer.
    for (const o of arriving) o.scale.setScalar(1);
    while (live.children.length) live.remove(live.children[0]!);
    arriving.length = 0;
    const inPlay = new Set<number>();

    courtBands.forEach((b) => (b.material = M.gray));
    courtZones.forEach((z, i) => (zoneOf(z)!.target = { kind: 'court', id: `slot-${i}` }));
    for (const c of snapshot.courts) {
      if (c.slot === null || c.slot >= COURT_X.length) continue;
      zoneOf(courtZones[c.slot]!)!.target = { kind: 'court', id: c.id };
      courtBands[c.slot]!.material = c.status === 'in_play' ? M.green : c.status === 'booked' ? M.amber : M.gray;
      if (c.status === 'in_play') {
        // A game of padel is four players, always (owner call, 2026-09-22).
        const n = 4;
        const r = rallyFor(c.slot);
        const fresh = !r.group.visible;
        r.count = n;
        r.group.visible = true;
        inPlay.add(c.slot);
        if (opts.reducedMotion) {
          // The freeze frame the phone holds: the ball on the striker's face.
          poseRally(r, nextLegStart(r.phase));
        } else if (fresh) {
          poseRally(r, r.phase + (performance.now() - T0) / 1000);
          r.group.scale.setScalar(0.001);
          r.group.userData.spawn = performance.now();
          arriving.push(r.group);
        }
      }
    }
    for (const [slot, r] of rallies) if (!inPlay.has(slot)) r.group.visible = false;

    tableTops.forEach((t) => (t.material = M.gray));
    tableZones.forEach((z, i) => (zoneOf(z)!.target = { kind: 'table', id: `slot-${i}` }));
    for (const t of snapshot.tables) {
      if (t.slot === null || t.slot >= TABLE_DEF.length) continue;
      zoneOf(tableZones[t.slot]!)!.target = { kind: 'table', id: t.id };
      tableTops[t.slot]!.material = t.status === 'occupied' ? M.green : M.gray;
      if (t.tab) {
        // One figure per open tab, at the seat nearest the entrance. Nothing
        // records how many guests sit there, so nothing more is drawn.
        const [x, z, seats] = TABLE_DEF[t.slot]!;
        const a = seats === 2 ? Math.PI / 2 : Math.PI / 4;
        const rr = seats === 2 ? 0.7 : 0.8;
        person(t.tab.state === 'awaiting_payment' ? M.amber : M.guest, x + Math.cos(a) * rr, z + Math.sin(a) * rr, true);
      }
    }

    const used: Partial<Record<Room, number>> = {};
    for (const s of snapshot.staff) {
      const st = ROOMS[s.room];
      const i = used[s.room] ?? 0;
      used[s.room] = i + 1;
      const slot = st.slots[i % st.slots.length]!;
      const jitter = Math.floor(i / st.slots.length) * 0.55;
      staffFigure(s.status === 'working' ? M.green : M.gray, st.x + slot[0] + jitter, st.z + slot[1]);
    }
    dirty = true;
  }

  // ---- camera easing ------------------------------------------------------
  let ease: { t0: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null = null;
  const moveCamera = (pos: THREE.Vector3, target: THREE.Vector3) => {
    if (opts.reducedMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      ease = null;
    } else {
      ease = { t0: performance.now(), p0: camera.position.clone(), p1: pos, c0: controls.target.clone(), c1: target };
    }
    dirty = true;
  };
  function focus(target: FloorTarget | null) {
    atHome = target === null;
    if (!target) {
      moveCamera(homePosition(), HOME_TARGET.clone());
      return;
    }
    const zone = zones.find((z) =>
      z.target.kind === 'room' ? target.kind === 'room' && z.target.room === target.room : z.target.kind === target.kind && z.target.id === (target as { id: string }).id,
    );
    if (!zone) return;
    const c = new THREE.Vector3();
    zone.mesh.getWorldPosition(c);
    c.y = 0;
    const dir = new THREE.Vector3(0.35, 0.9, 1).normalize();
    const dist = Math.max((zone.radius / Math.tan((camera.fov * Math.PI) / 360)) * 1.25, 6);
    moveCamera(c.clone().add(dir.multiplyScalar(dist)), c);
  }

  function zoom(direction: 'in' | 'out') {
    const home = homePosition().distanceTo(HOME_TARGET);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const current = camera.position.distanceTo(controls.target);
    // Out never goes past the whole-floor distance: further than that is only
    // more empty ground, and "Show whole floor" is the way back anyway.
    const next = Math.min(home, Math.max(ZOOM_MIN_DIST, current * (direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP)));
    if (Math.abs(next - current) < 0.01) return;
    atHome = false;
    moveCamera(controls.target.clone().add(dir.multiplyScalar(next)), controls.target.clone());
  }

  /**
   * Distance and slider position are LOGARITHMIC in each other, because a zoom
   * step multiplies the distance rather than subtracting from it: halving the
   * distance must be the same length of travel wherever the thumb starts, or
   * the far half of the track would do almost nothing and the near half would
   * fly. Same reason the buttons multiply by ZOOM_STEP.
   *
   * The far end is the whole-floor distance, which fit() recomputes for the
   * box the panel gives the plan, so the track is re-read rather than cached:
   * the same level means "as far out as this panel goes" at any size.
   */
  const currentZoomLevel = () => zoomLevelOf(camera.position.distanceTo(controls.target), homePosition().distanceTo(HOME_TARGET));

  /** Tell the page where the camera stands, but only when the answer changed. */
  let reportedZoom = -1;
  const reportZoom = () => {
    const level = currentZoomLevel();
    if (Math.abs(level - reportedZoom) < 0.001) return;
    reportedZoom = level;
    events.onZoom(level);
  };

  function setZoomLevel(level: number) {
    const home = homePosition().distanceTo(HOME_TARGET);
    if (home <= ZOOM_MIN_DIST) return;
    const t = Math.min(1, Math.max(0, level));
    const want = zoomDistanceAt(t, home);
    const dir = camera.position.clone().sub(controls.target).normalize();
    // Straight to the spot, no ease: this is a drag, and easing a drag makes
    // the plan lag the thumb. atHome stays true at the far end so a resize
    // still re-frames the floor and "Show whole floor" stays hidden.
    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(want)));
    atHome = t <= 0.001;
    ease = null;
    controls.update();
    dirty = true;
    reportZoom();
  }

  // ---- pointer ------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let hovered: Zone | null = null;
  const pick = (ev: PointerEvent): Zone | null => {
    const r = canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    zoneMeshes.forEach((z) => (z.visible = true));
    const hit = ray.intersectObjects(zoneMeshes, false)[0];
    zoneMeshes.forEach((z) => (z.visible = false));
    return hit ? zoneOf(hit.object) : null;
  };
  const localPoint = (ev: PointerEvent) => {
    const r = host.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const onMove = (ev: PointerEvent) => {
    const z = pick(ev);
    if (z !== hovered) {
      hovered = z;
      canvas.style.cursor = z ? 'pointer' : '';
    }
    events.onHover(z?.target ?? null, localPoint(ev));
  };
  const onLeave = () => {
    hovered = null;
    canvas.style.cursor = '';
    events.onHover(null, { x: 0, y: 0 });
  };
  let downAt: [number, number] | null = null;
  const onDown = (ev: PointerEvent) => (downAt = [ev.clientX, ev.clientY]);
  const onUp = (ev: PointerEvent) => {
    // A drag is an orbit, not a pick.
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const z = pick(ev);
    if (z) events.onPick(z.target);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  controls.addEventListener('change', () => (dirty = true));
  // 'end' is the owner letting go after a drag or a wheel turn: the view is
  // theirs now, so the resize re-framing stops and the way back is offered.
  controls.addEventListener('end', () => {
    atHome = false;
    events.onMoved();
  });
  /**
   * The wheel zooms the plan whenever the pointer is over it.
   *
   * It is OUR handler rather than OrbitControls' own zoom (which stays off)
   * because this one is bound to the canvas: the wheel is taken only over the
   * plan, and everywhere else on the page it still scrolls. OrbitControls
   * would also work here, but it owns its own limits and easing, and the two
   * step buttons, the upright track and this handler must all walk the same
   * line between ZOOM_MIN_DIST and the whole-floor distance.
   *
   * The event is ALWAYS consumed, including at both ends of the zoom. Handing
   * it back there meant an owner who kept scrolling at the whole floor had the
   * page jump out from under them mid-look; on the plan the wheel means zoom,
   * and at the end of the zoom it means nothing — as on a map.
   */
  let wheelZoom = false;
  const onWheel = (ev: WheelEvent) => {
    if (!wheelZoom || ev.ctrlKey) return;
    // The wheel belongs to the plan for as long as the pointer is on it, at
    // the ends of the zoom too (owner call, 2026-09-21). Reaching the whole
    // floor used to hand the wheel back, and the page jumped out from under
    // the owner mid-look — the plan is what they are pointing at, so it keeps
    // the event and simply stops moving, the way a map does.
    ev.preventDefault();
    const home = homePosition().distanceTo(HOME_TARGET);
    const current = camera.position.distanceTo(controls.target);
    // Trackpads send a stream of small deltas and a mouse sends few large
    // ones; scaling by the delta keeps both feeling like the same gesture,
    // and the clamp stops one violent flick crossing the whole range.
    const factor = Math.exp(Math.max(-0.5, Math.min(0.5, ev.deltaY * 0.002)));
    const next = Math.min(home, Math.max(ZOOM_MIN_DIST, current * factor));
    if (Math.abs(next - current) < 0.001) return;
    const dir = camera.position.clone().sub(controls.target).normalize();
    // No ease: a wheel turn is a direct manipulation, like the slider drag.
    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(next)));
    atHome = next >= home - 0.01;
    ease = null;
    controls.update();
    dirty = true;
    reportZoom();
    if (!atHome) events.onMoved();
  };
  /**
   * Bound to the STAGE, not the canvas. The buttons, the zoom track, the hint
   * and the tooltip are siblings stacked over the canvas, so a wheel turn with
   * the pointer over any of them never touches the canvas at all — and the
   * page scrolled out from under the owner, most obviously over the zoom-out
   * button, which is exactly where a hand already is when it wants to zoom
   * out. The stage is the whole plan as the owner sees it, overlays included,
   * so that is what the wheel belongs to.
   *
   * Falls back to the canvas if the host has no parent (it always does in the
   * app; this keeps the scene constructible on a bare element in a test).
   *
   * Not passive: the whole point is that it may call preventDefault.
   */
  const wheelHost: HTMLElement = host.parentElement ?? canvas;
  wheelHost.addEventListener('wheel', onWheel, { passive: false });

  const setWheelZoom = (on: boolean) => {
    wheelZoom = on;
  };

  // ---- size + loop --------------------------------------------------------
  let atHome = true;
  const fit = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // A resize re-frames the whole floor; a view the owner chose is left alone.
    const want = homePosition().distanceTo(HOME_TARGET);
    controls.maxDistance = want;
    if (atHome && !ease) {
      const dist = camera.position.distanceTo(controls.target);
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (Math.abs(dist - want) > 0.01) camera.position.copy(controls.target.clone().add(dir.multiplyScalar(want)));
    }
    dirty = true;
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(host);

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    for (let i = arriving.length - 1; i >= 0; i--) {
      const o = arriving[i]!;
      const t = Math.min(1, (now - (o.userData.spawn as number)) / 320);
      o.scale.setScalar(0.001 + (1 - Math.pow(1 - t, 3)) * 0.999);
      if (t >= 1) arriving.splice(i, 1);
      dirty = true;
    }
    if (!opts.reducedMotion) {
      const t = (now - T0) / 1000;
      for (const r of rallies.values()) {
        if (!r.group.visible) continue;
        poseRally(r, r.phase + t);
        dirty = true;
      }
    }
    if (ease) {
      const t = Math.min(1, (now - ease.t0) / 240);
      const e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(ease.p0, ease.p1, e);
      controls.target.lerpVectors(ease.c0, ease.c1, e);
      if (t >= 1) ease = null;
      dirty = true;
    }
    const moved = controls.update();
    if (moved || dirty) {
      renderer.render(scene, camera);
      dirty = false;
      // Every way the camera can move ends here — an ease, the wheel, a drag,
      // a resize — so this is the one place the slider needs to be told.
      reportZoom();
    }
  };
  raf = requestAnimationFrame(loop);

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    wheelHost.removeEventListener('wheel', onWheel);
    controls.dispose();
    for (const g of geos) g.dispose();
    for (const m of disposables) m.dispose();
    for (const d of kit?.disposables ?? []) d.dispose();
    (ground.material as THREE.Material).dispose();
    ground.geometry.dispose();
    renderer.dispose();
    canvas.remove();
  }

  return { apply, focus, zoom, setZoomLevel, setWheelZoom, dispose };
}
