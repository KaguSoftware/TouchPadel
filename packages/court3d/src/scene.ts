/**
 * The three.js court from `Court Transition Prototype.html` (`buildCourt`),
 * ported 1:1 for expo-gl: real net, lime glass + mesh cage with the brand's
 * white window stickers, four 3D rackets, a ball with a seam, a 36-ghost
 * trail, a ground disc AND a real cast shadow on the turf. The rackets are the
 * SECOND design, `padel-racket.html` — its mesh in racket.ts, its swing clip in
 * swing.ts, scheduled onto the rally by rally.ts. As in the
 * prototype the ball, its trail and its disc live in a SECOND scene
 * (`overlay`) drawn on a transparent surface stacked above the native button,
 * so the rally flies over the button; an invisible caster in the main scene
 * keeps the ball's real shadow on the turf, under the button (see
 * `docs/design/mobile-ui/Court Transition Prototype.html` header for the spec).
 *
 * All motion numbers come from rally.ts (unit-tested); this file only builds
 * meshes and applies those numbers each frame. The `lite` tier (low-end phones,
 * decided by the app) builds the same court with no shadow pass — no caster, no
 * receiver, no invisible ball caster — and a plainer racket (racket.ts); the
 * ball's ground disc stands in for its shadow. The trail is the same on both.
 * Colours are the prototype's own (its brand stickers); the page colour behind
 * the court is the renderer's clear colour, set by the component per theme.
 *
 * TWO THINGS CAN PLAY ON IT (`scene`, fixed at build). `rally`, the default and
 * the Book tab's: the four rackets' rally above. `drill`, the Coaches tab's: the
 * same court, rackets, ball, trail, disc and caster, with a ball machine and a
 * coach on the right half (drillProps.ts) feeding the four rackets down the left
 * one at a time (drill.ts), each swinging the same clip on its turn. The ball
 * takes a scale there (it grows out of the barrel and shrinks away on the turf,
 * and is hidden at 0), and the props cast shadows on `full` only, like the rest.
 * Nothing on the rally path reads any of it: a rally scene is built and drawn
 * exactly as it was before the drill existed.
 *
 * AND TWO WAYS TO SEE IT (`view`, fixed at build). `book`, the default: the
 * orbit above. `top`, the Play and Coaches tabs': straight down and horizontal
 * (camera.ts, topCameraPose), never pitched, without the walls' glass and mesh
 * (seen edge-on from there), the ball scaled with its height. Either scene in
 * either view; the Book tab and the web are `rally` + `book`, as before.
 *
 * ONE court, two hosts. apps/mobile (components/Court3D.tsx, expo-gl) and
 * apps/web (features/court3d/courtCanvas.ts, a browser canvas) both build it
 * here. Where they differ it is an option (CourtSceneOptions). Every default is the
 * phone's EXCEPT the backdrop: with none, nothing is drawn behind the court, and the
 * phone passes its brand pattern (apps/mobile courtTransition/phoneCourt.ts).
 */
import * as THREE from 'three';
import {
  nearCageOpacity,
  PLAYERS,
  playerYaw,
  rallyAt,
  ballSampler,
  BALL_RADIUS,
  layAngle,
  RACKET_Y,
  LEG_SECONDS,
} from './rally';
import { buildRacketKit } from './racket';
import { mergeStatic } from './merge';
import { buildGhostTrail } from './trail';
import { makeCamera, poseCamera, poseTopCamera, topBallScale } from './camera';
import { DRILL_PLAYERS, drillAt, drillBallSampler, MACHINE } from './drill';
import { buildDrillProps } from './drillProps';
import { lerp, slice, SPEC } from './spec';
import type { CourtQuality } from './quality';

/** Where the court's surface sits in its window (the phone's pattern backdrop places itself by it). */
export interface BackdropViewport {
  /**
   * The box the pattern is sliced over, in dp: the box the PAGE's copy of it
   * occupies. Both are measured by onLayout in the same coordinate space (see
   * the Book tab), so neither has to know what that space is.
   */
  boxWidth: number;
  boxHeight: number;
  /** The GL view's top-left corner inside that box, in dp. */
  offsetX: number;
  offsetY: number;
  /** The GL view's own size, in dp. */
  viewWidth: number;
  viewHeight: number;
}

/**
 * Something drawn behind the court, hung off the camera (the phone's brand
 * pattern: apps/mobile/src/features/courtTransition/patternBackdrop.ts).
 */
export interface CourtBackdrop {
  /** Added to the camera, so it stays on the glass while the camera orbits. */
  group: THREE.Group;
  /** Put it where the page has it; `lift` is the court layer's own translateY. */
  place(view: BackdropViewport, lift: number): void;
  /** Its colour, already blended into the page colour behind it. */
  setInk(color: string): void;
  dispose(): void;
}

/**
 * What plays on the court. `rally` (default): the Book tab's four-racket rally
 * (rally.ts). `drill`: the Coaches tab's coaching drill (drill.ts), a ball
 * machine and a coach on the right half feeding the four rackets down the
 * left, with the machine's and coach's meshes (drillProps.ts). Fixed at build.
 */
export type CourtSceneKind = 'rally' | 'drill';

/**
 * How the court is seen. `book` (default): the Book tab's orbit, top-down
 * portrait at rest pitching back to the upright court as p runs to 1
 * (rally.cameraPose). `top`: straight down and horizontal, fixed, for the Play
 * and Coaches tabs (camera.ts, topCameraPose): no pitch, p and camK ignored,
 * the walls' edge-on glass and mesh not built, and the ball drawn bigger the
 * higher it flies (topBallScale), the one cue to height a view from directly
 * above has besides the disc. Fixed at build.
 */
export type CourtView = 'book' | 'top';

export interface CourtSceneOptions {
  /** What plays on the court (see CourtSceneKind). Default `rally`. */
  scene?: CourtSceneKind;
  /** How the court is seen (see CourtView). Default `book`. */
  view?: CourtView;
  /**
   * A backdrop to hang behind the court, built for the camera's vertical fov.
   * The phone passes its brand pattern; without one (the web) nothing is drawn
   * there and the renderer's clear colour shows.
   */
  backdrop?: (fovDeg: number) => CourtBackdrop;
  /**
   * How the ball spins. `frame` (default, the phone) turns it a fixed step per
   * drawn frame, so a 120 Hz screen spins it twice as fast as a 60 Hz one;
   * `time` turns it by the rally clock (0.12 / 0.07 rad per 1/60 s), the same on
   * every screen.
   */
  spin?: 'frame' | 'time';
  /** The sun's shadow map, px square. Default 1024 (the phone's saving); the prototype drew 2048. */
  shadowMapSize?: number;
  /**
   * Cheaper frames, the same picture to the bit (Android only, for now: its
   * frame loop is bound by the JS thread). Two savings, both in `update` and
   * the matrix pass three runs before each draw:
   *   · the court's static meshes (base, turf, lines, net, cage) get their
   *     matrices once at build and are skipped by every frame's matrix pass,
   *     instead of being recomposed and re-multiplied each frame;
   *   · the trail's ghosts read the ball alone (rally.ts, ballSampler) instead
   *     of a whole rally state each: 36 × six racket poses a frame become two;
   *   · and fewer draw calls, each of which Android pays for on the JS thread:
   *     the static court and each racket's body are merged into one mesh per
   *     draw state (merge.ts), and the trail is one instanced mesh (trail.ts).
   *     ~250 draws a frame (full, both surfaces) become ~90.
   * Off by default, so iOS and the web run exactly what they always did.
   */
  lean?: boolean;
}

/** The ball's spin in rad/s under `spin: 'time'`: the phone's 0.12 / 0.07 rad a frame, at 60 fps. */
export const BALL_SPIN = { x: 7.2, z: 4.2 } as const;

// Brand ramp values (see apps/mobile/src/theme/tokens.ts — the palette is closed to five
// colours). NAVY and TURF are exact shades of brand blue #3360AB; LIME and BLUE
// are the brand colours themselves. NOTE: these are MeshStandardMaterial colours
// under a hemisphere light + directional sun, so they do NOT render as these
// hexes on screen — lighting lifts and desaturates them. Judge on a device.
const NAVY = 0x172c4f;
const LIME = 0xa5d06f;
const BLUE = 0x3360ab;
const TURF = 0x2d5495;
/** The glass's window squares: the sage they read as through the glass in the pitched view. */
const PANE = 0x92a087;
/**
 * The ghost trail: 36 fading spheres over the ball's last 0.367 s of flight.
 *
 * The ghosts are the ball re-evaluated at fixed times behind the rally clock,
 * NOT a buffer of past frames. A per-frame buffer ties ghost spacing to the
 * framerate: the ball crosses the court at ~11 m/s, so at 60 fps it moves
 * ~0.18 m per frame and consecutive ghosts overlap into a streak, while at
 * 30 fps they land ~0.36 m apart — past the 0.44 m the spheres span — and the
 * trail reads as a row of separate circles. That is why it beaded on Android
 * and not on iOS. Sampling on a time grid makes the two identical.
 *
 * 0.367 s is the old 22-frames-at-60fps span, kept so the trail's length on
 * screen is unchanged. The count is what keeps it continuous rather than
 * beaded, so it is not a tier knob; lite saves its frame time on the shadow
 * pass, and these spheres are unlit and never write depth.
 */
const TRAIL_N = 36;
const TRAIL_LAG = 22 / 60;

export interface CourtScene {
  /** The court: cage, net, rackets, turf with the ball's cast shadow. Opaque, under the button. */
  scene: THREE.Scene;
  /** The ball, its trail and its ground disc. Transparent, drawn above the button with the same camera. */
  overlay: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Apply camera + rally + fades for time t (s) and eased pitch camK; p is the raw progress. */
  update(t: number, p: number, camK: number): void;
  /**
   * Where this surface sits in the app window, so the brand pattern behind the
   * court lines up with the page's copy of it (the phone's patternBackdrop). Call it on
   * layout and whenever the window changes; until it is called the backdrop
   * has nothing to place itself against and stays where it was built. A no-op
   * without a backdrop.
   */
  setBackdropViewport(view: BackdropViewport): void;
  /**
   * The pattern's ink, ALREADY blended into the page colour behind it — the
   * page's copy carries a different alpha in each appearance and this one has
   * to be opaque, so the caller does the blend (apps/mobile theme/brandPattern.ts,
   * patternInk) and re-does it on a theme flip. A no-op without a backdrop.
   */
  setBackdropInk(color: string): void;
  /** Everything with a `dispose()`: geometries, materials. */
  dispose(): void;
}

export function buildCourtScene(
  quality: CourtQuality = 'full',
  opts: CourtSceneOptions = {},
): CourtScene {
  const shadows = quality === 'full';
  const spinByTime = opts.spin === 'time';
  const top = opts.view === 'top';
  const disposables: { dispose(): void }[] = [];
  const scene = new THREE.Scene();
  const overlay = new THREE.Scene();
  const camera = makeCamera(390 / 844);
  // The backdrop (the phone's pattern) is parented to the CAMERA so it stays
  // put on the glass while the camera orbits, and the camera is parented to the
  // SCENE so `renderer.render(scene, camera)` updates the group's world matrix
  // with everything else. The camera is parented with or without a backdrop:
  // update() relies on it. See apps/mobile's patternBackdrop.ts for why the pattern
  // is geometry and not a transparent clear colour.
  const backdrop = opts.backdrop?.(SPEC.camera.fov) ?? null;
  if (backdrop) camera.add(backdrop.group);
  scene.add(camera);
  let viewport: BackdropViewport | null = null;

  // the overlay is lit like the court, minus the shadow pass
  overlay.add(new THREE.HemisphereLight(0xffffff, 0xb0c5e8, 0.95));
  const sun2 = new THREE.DirectionalLight(0xffffff, 1.4);
  sun2.position.set(6, 30, 10);
  overlay.add(sun2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0c5e8, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 30, 10);
  sun.castShadow = shadows;
  if (shadows) {
    // 2048 in the prototype; the 1024 default keeps the shadow pass cheap on a phone.
    const mapSize = opts.shadowMapSize ?? 1024;
    sun.shadow.mapSize.set(mapSize, mapSize);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 4;
    Object.assign(sun.shadow.camera, {
      left: -8,
      right: 8,
      top: 12,
      bottom: -12,
      near: 5,
      far: 60,
    });
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

  // ground + turf (base top sits 6 cm below the turf; lines use polygonOffset — no z-fighting).
  // The base is only as wide as the cage (the side posts stand at x = ±5): at 11.4 m
  // its 0.7 m side margins showed through the side fences in the pitched view as a
  // dark band over the walls (owner, 2026-09-29).
  add(new THREE.BoxGeometry(10.2, 0.3, 21.4), Mat(NAVY), 0, -0.21, 0);
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

  // net: posts stand just inside the court, touching the sidelines' inner edge (x = ±4.83 m)
  const netMat = new THREE.MeshBasicMaterial({
    color: NAVY,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
  });
  disposables.push(netMat);
  add(new THREE.PlaneGeometry(9.66, 0.86, 58, 6), netMat, 0, 0.45, 0);
  add(new THREE.BoxGeometry(9.66, 0.07, 0.035), Mat(0xffffff, { roughness: 0.5 }), 0, 0.9, 0);
  add(new THREE.BoxGeometry(0.06, 0.9, 0.04), Mat(0xffffff), 0, 0.45, 0);
  const postMat = Mat(NAVY, { roughness: 0.4 });
  for (const x of [-4.83, 4.83])
    add(new THREE.CylinderGeometry(0.07, 0.07, 1.05, 14), postMat, x, 0.52, 0);

  // cage: lime glass panels with sage "window" squares (brand sticker) + dark mesh fence.
  // The bottom end wall (z = +10) gets its own materials so it can fade as the camera pitches.
  const glassFar = new THREE.MeshStandardMaterial({
    color: LIME,
    transparent: true,
    opacity: 0.55,
    roughness: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // The window squares: one flat, unlit, fully opaque colour, drawn AFTER the glass
  // (renderOrder) so the glass never lays over them. They used to be 75 % white
  // over 55 % glass, and three re-sorts those two as the camera moves, so a pane
  // read white from one angle and sage from another, even side by side in the
  // pitched view (owner, 2026-09-29). `transparent` is what puts them in the
  // pass after the glass; the far ones stay at opacity 1, the near ones fade out
  // with the pitch so only the upper side of the cage carries them (nearCage.pane).
  const paneFar = new THREE.MeshBasicMaterial({
    color: PANE,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const paneNear = paneFar.clone();
  const fenceFar = new THREE.LineBasicMaterial({
    color: NAVY,
    transparent: true,
    opacity: SPEC.nearCage.fence[0],
  });
  const frameFar = Mat(NAVY, { roughness: 0.4, transparent: true });
  const glassNear = glassFar.clone();
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
  ) => {
    const m = add(new THREE.PlaneGeometry(w, h), mat, x, y, z);
    m.rotation.y = ry;
    return m;
  };
  // Mesh fence: a square grid of lines, 15 cm cells. NOT a wireframe plane: that
  // draws every cell's diagonal too, and with the camera pitched along the side
  // walls the lines packed into what read as a solid navy sheet over the cage
  // (owner, 2026-09-29).
  const FENCE_CELL = 0.15;
  const fencePanel = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    mat: THREE.LineBasicMaterial,
  ) => {
    const pts: number[] = [];
    const nx = Math.round(w / FENCE_CELL);
    const ny = Math.round(h / FENCE_CELL);
    for (let i = 0; i <= nx; i++) {
      const u = -w / 2 + (i * w) / nx;
      pts.push(u, -h / 2, 0, u, h / 2, 0);
    }
    for (let j = 0; j <= ny; j++) {
      const v = -h / 2 + (j * h) / ny;
      pts.push(-w / 2, v, 0, w / 2, v, 0);
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineSegments(g, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
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
      panel(1.4, h - 0.8, x + dx * o, y, z + dz * o, ry, mat).renderOrder = 1;
    }
  };
  // The top view (camera.ts, topCameraPose) looks straight down, where every
  // wall is seen edge-on: its glass, window panes and mesh would be drawn as
  // slivers a few pixels wide, the mesh as hundreds of lines piled onto one.
  // It skips them and keeps the cage's outline from above (posts, caps, rails).
  const walls = !top;
  for (const s of [-1, 1] as const) {
    const near = s > 0;
    const glass = near ? glassNear : glassFar;
    const pane = near ? paneNear : paneFar;
    const fence = near ? fenceNear : fenceFar;
    const frame = near ? frameNear : frameFar;
    const post = (x: number, z: number, h: number, mat = frame) => {
      add(new THREE.BoxGeometry(0.1, h, 0.1), mat, x, h / 2, z);
      add(new THREE.BoxGeometry(0.18, 0.08, 0.18), capMat, x, h + 0.04, z);
    };
    const rail = (len: number, x: number, y: number, z: number, ry: number, mat = frame) => {
      const m = add(new THREE.BoxGeometry(len, 0.08, 0.08), mat, x, y, z);
      m.rotation.y = ry;
    };
    if (walls) {
      panel(10, 3, 0, 1.5, s * 10, 0, glass);
      windows(10, 3, 0, 1.5, s * 10 - s * 0.01, 0, pane);
      fencePanel(10, 1, 0, 3.5, s * 10, 0, fence);
    }
    rail(10.1, 0, 4, s * 10, 0);
    rail(10.1, 0, 3, s * 10, 0);
    for (const x of [-2.5, 0, 2.5]) post(x, s * 10, 4);
    // Each side wall: a 4 m glass section at the end, then 6 m of mesh to the net.
    // The bottom glass sections fade with the bottom end wall (glass, the fence
    // strip above, rails, corner post); the mesh sections never fade, near half
    // included. Faded, the near mesh left the wall by the net as a bare dark patch
    // (owner, 2026-09-29).
    for (const sx of [-1, 1] as const) {
      const x = sx * 5;
      if (walls) {
        panel(4, 3, x, 1.5, s * 8, Math.PI / 2, glass);
        windows(4, 3, x - sx * 0.01, 1.5, s * 8, Math.PI / 2, pane);
        fencePanel(4, 1, x, 3.5, s * 8, Math.PI / 2, fence);
        fencePanel(6, 3, x, 1.5, s * 3, Math.PI / 2, fenceFar);
      }
      rail(4.1, x, 4, s * 8, Math.PI / 2);
      rail(4.1, x, 3, s * 8, Math.PI / 2);
      rail(6.1, x, 3, s * 3, Math.PI / 2, frameFar);
      post(x, s * 10, 4);
      post(x, s * 6, 4, frameFar);
      post(x, s * 2, 3, frameFar);
    }
  }

  // Everything built so far that is a mesh or a line never moves: freeze it
  // (`lean`). Its matrix is composed here, once, and three skips it on every
  // frame's matrix pass from now on. The scene's own matrix goes with it — it
  // is identity and never changes, but recomposing it each frame flags every
  // child for a world-matrix multiply, frozen or not. What does move (the
  // camera, the rackets, the ball's caster) keeps updating itself: none of it
  // is in this list, and each flags its own subtree when it changes.
  if (opts.lean) {
    // And fold them into one mesh per draw state first (merge.ts): ~100 meshes
    // over 17 materials become ~20 draw calls.
    disposables.push(...mergeStatic(scene));
    for (const o of scene.children) {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.updateMatrix();
        o.matrixAutoUpdate = false;
      }
    }
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
  }

  // racket (brand sticker): the design's teardrop frame, blue face plate with
  // white perforations,
  // rim highlights, lofted collar and wrapped lime grip (racket.ts). One shared
  // build; each player gets the rig — mount (stance) → pivot (hand) → lay (the
  // top-view cheat) → the racket — and the rally drives all three per frame.
  const kit = buildRacketKit(quality, { merge: opts.lean });
  disposables.push(...kit.disposables);
  // The drill (Coaches tab) stands its rackets in its own column, facing their
  // returns (drill.ts), and adds the machine and the coach. The rally builds
  // neither: its court is the one it always was.
  const drill = opts.scene === 'drill' ? buildDrillProps(quality) : null;
  const rackets = drill
    ? DRILL_PLAYERS.map((pl) => {
        const rig = kit.create(pl.hand);
        rig.mount.position.set(pl.x, RACKET_Y.flat, pl.z);
        rig.mount.rotation.y = pl.yaw;
        rig.lay.rotation.x = layAngle(0);
        scene.add(rig.mount);
        return rig;
      })
    : PLAYERS.map((pl) => {
        const rig = kit.create(pl.hand);
        rig.mount.position.set(pl.x, RACKET_Y.flat, pl.z);
        rig.mount.rotation.y = playerYaw(pl);
        rig.lay.rotation.x = layAngle(0);
        scene.add(rig.mount);
        return rig;
      });
  if (drill) {
    disposables.push(...drill.disposables);
    scene.add(drill.group);
  }

  // ball (brand sticker): lime with a white + blue wavy seam — in the overlay, over the button
  const ball = new THREE.Group();
  ball.add(
    new THREE.Mesh(
      geo(new THREE.SphereGeometry(BALL_RADIUS, 32, 24)),
      Mat(LIME, { roughness: 0.55 }),
    ),
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

  // trail: fading ghosts of recent ball positions (both tiers, see TRAIL_N).
  // `lean` draws the same ghosts as one instanced mesh (trail.ts).
  const trail: THREE.Mesh[] = [];
  const ghostBall = opts.lean ? ballSampler() : null;
  const ghostSize = (i: number) => 0.25 + 0.7 * (1 - i / TRAIL_N);
  const ghostAlpha = (i: number) => 0.1 * (1 - i / TRAIL_N);
  const ghosts = opts.lean ? buildGhostTrail(TRAIL_N, BALL_RADIUS, ghostSize, ghostAlpha) : null;
  const ghostAt: { x: number; y: number; z: number }[] = [];
  const ghostScale: number[] = [];
  if (ghosts) {
    disposables.push(ghosts);
    overlay.add(ghosts.mesh);
  }
  // The drill's ghosts always read the ball alone: there is no older path for
  // it to keep bit-for-bit, and the sampler is the same picture, cheaper.
  const ghostDrill = drill ? drillBallSampler() : null;
  for (let i = 0; i < (ghosts ? 0 : TRAIL_N); i++) {
    const m = new THREE.Mesh(
      geo(new THREE.SphereGeometry(BALL_RADIUS * ghostSize(i), 12, 10)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: ghostAlpha(i),
        depthWrite: false,
      }),
    );
    disposables.push(m.material as THREE.Material);
    m.visible = false;
    overlay.add(m);
    trail.push(m);
  }

  // the ground disc under the ball (overlay too: the prototype's disc rides over the button)
  const shadeMat = new THREE.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 0.28 });
  disposables.push(shadeMat);
  const shade = new THREE.Mesh(geo(new THREE.CircleGeometry(0.24, 24)), shadeMat);
  shade.position.set(0, 0.012, 0);
  shade.rotation.x = -Math.PI / 2;
  overlay.add(shade);

  /**
   * The drill's frame (drill.ts): the same rig, ball, trail, disc and caster as
   * the rally's, plus the ball's scale (it grows out of the barrel and shrinks
   * away on the turf, and is not drawn at 0), the barrel's turn and recoil, and
   * the coach's head, sway, weight shift and arms.
   */
  const applyDrill = (
    t: number,
    camK: number,
    props: NonNullable<typeof drill>,
    sample: ReturnType<typeof drillBallSampler>,
  ) => {
    const state = drillAt(t, camK);
    const lay = layAngle(camK);
    state.rackets.forEach((r, i) => {
      const rig = rackets[i]!;
      rig.mount.position.set(r.position.x, r.position.y, r.position.z);
      rig.mount.rotation.set(r.rotation.x, r.rotation.y, r.rotation.z);
      rig.pivot.position.set(r.swing.position.x, r.swing.position.y, r.swing.position.z);
      rig.pivot.rotation.set(r.swing.rotation.x, r.swing.rotation.y, r.swing.rotation.z);
      rig.lay.rotation.x = lay;
    });
    const s = state.ballScale;
    const shown = s > 1e-3;
    ball.visible = shown;
    ball.scale.setScalar(shown ? s * (top ? topBallScale(state.ball.y) : 1) : 1);
    ball.position.set(state.ball.x, state.ball.y, state.ball.z);
    if (caster) {
      caster.visible = shown;
      caster.scale.setScalar(shown ? s : 1);
      caster.position.copy(ball.position);
    }
    if (spinByTime) {
      ball.rotation.x = t * BALL_SPIN.x;
      ball.rotation.z = t * BALL_SPIN.z;
    } else {
      ball.rotation.x += 0.12;
      ball.rotation.z += 0.07;
    }
    // As the rally's: each ghost is the ball at a fixed time behind t, drawn
    // only inside the current flight (trailFrom), so it never reaches back into
    // the barrel or across the racket — and none at all while the ball sits in
    // the machine. Each ghost also takes the ball's scale at its own time, so
    // the trail shrinks away with the ball.
    if (ghosts) {
      ghostAt.length = 0;
      ghostScale.length = 0;
      for (let i = 0; i < TRAIL_N; i++) {
        const at = t - ((i + 1) * TRAIL_LAG) / TRAIL_N;
        if (!(at > state.trailFrom)) break;
        const g = sample(at, camK);
        ghostAt.push(g.ball);
        ghostScale.push(g.scale > 1e-3 ? g.scale * (top ? topBallScale(g.ball.y) : 1) : 0);
      }
      ghosts.place(ball.position, ghostAt, ghostScale);
    }
    trail.forEach((m, i) => {
      const at = t - ((i + 1) * TRAIL_LAG) / TRAIL_N;
      if (!(at > state.trailFrom)) {
        m.visible = false;
        return;
      }
      const g = sample(at, camK);
      m.visible = g.scale > 1e-3;
      if (m.visible) {
        m.position.set(g.ball.x, g.ball.y, g.ball.z);
        m.scale.setScalar(g.scale * (top ? topBallScale(g.ball.y) : 1));
      }
    });
    shade.visible = state.shade.opacity > 1e-3;
    shade.position.set(state.shade.x, 0.012, state.shade.z);
    shade.scale.setScalar(Math.max(state.shade.scale, 1e-3));
    shadeMat.opacity = state.shade.opacity;
    props.barrel.rotation.set(-MACHINE.pitch, state.machine.yaw, 0);
    props.recoil.position.z = -MACHINE.recoil * state.machine.kick;
    props.coachBody.rotation.set(state.coach.sway.x, 0, state.coach.sway.z);
    props.coachBody.position.x = state.coach.shift;
    const { right, left } = state.coach.arms;
    [right, left].forEach((a, i) => {
      const rig = props.coachArms[i]!;
      rig.shoulder.rotation.set(-a.lift, a.yaw, 0);
      rig.elbow.rotation.x = -a.bend;
    });
    props.coachHead.rotation.y = state.coach.head;
  };

  return {
    scene,
    overlay,
    camera,
    setBackdropViewport(view) {
      viewport = view;
    },
    setBackdropInk(color) {
      backdrop?.setInk(color);
    },
    update(t, p, camK) {
      // The top view never pitches: whatever progress the host hands in, it is
      // drawn at rest (camK 0: the rackets lie flat, as in the Book's top view).
      if (top) {
        p = 0;
        camK = 0;
        poseTopCamera(camera);
      } else poseCamera(camera, camK);
      if (backdrop && viewport) {
        // The court layer's own lift, so the backdrop can cancel it and stay
        // with the window. The Book tab (apps/mobile app/(tabs)/index.tsx)
        // drives that lift through a 24-sample table of the same ease
        // (sampleEased) rather than the ease itself, so the two agree to well
        // under a pixel but not to the bit.
        backdrop.place(viewport, lerp(SPEC.court.y[0], SPEC.court.y[1], camK));
      }
      // The overlay pass reuses this camera, and three skips updateMatrixWorld
      // for a camera that has a parent — which this one now does. Doing it here
      // means neither pass depends on the other having run first.
      camera.updateMatrixWorld(true);

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
      paneNear.visible = cage.pane > 0.01;

      if (drill && ghostDrill) {
        applyDrill(t, camK, drill, ghostDrill);
        return;
      }

      const state = rallyAt(t, camK);
      const lay = layAngle(camK);
      state.rackets.forEach((r, i) => {
        const rig = rackets[i]!;
        rig.mount.position.set(r.position.x, r.position.y, r.position.z);
        rig.mount.rotation.set(r.rotation.x, r.rotation.y, r.rotation.z);
        rig.pivot.position.set(r.swing.position.x, r.swing.position.y, r.swing.position.z);
        rig.pivot.rotation.set(r.swing.rotation.x, r.swing.rotation.y, r.swing.rotation.z);
        rig.lay.rotation.x = lay;
      });
      ball.position.set(state.ball.x, state.ball.y, state.ball.z);
      caster?.position.copy(ball.position);
      if (top) ball.scale.setScalar(topBallScale(state.ball.y));
      if (spinByTime) {
        ball.rotation.x = t * BALL_SPIN.x;
        ball.rotation.z = t * BALL_SPIN.z;
      } else {
        ball.rotation.x += 0.12;
        ball.rotation.z += 0.07;
      }
      // Each ghost is the ball re-evaluated at a fixed time BEHIND t, so the
      // spacing is the same at 30fps as at 60 (see TRAIL_LAG). The lookback
      // stops at the current leg's start — the ball turns at the racket, and a
      // trail that reached past it would cut a straight chord through the bat.
      const legStart = Math.floor(t / LEG_SECONDS) * LEG_SECONDS;
      if (ghosts && ghostBall) {
        ghostAt.length = 0;
        ghostScale.length = 0;
        for (let i = 0; i < TRAIL_N; i++) {
          const at = t - ((i + 1) * TRAIL_LAG) / TRAIL_N;
          if (at <= legStart) break;
          const g = ghostBall(at, camK);
          ghostAt.push(g);
          if (top) ghostScale.push(topBallScale(g.y));
        }
        ghosts.place(ball.position, ghostAt, top ? ghostScale : undefined);
      }
      trail.forEach((m, i) => {
        const back = ((i + 1) * TRAIL_LAG) / TRAIL_N;
        const at = t - back;
        m.visible = at > legStart;
        if (m.visible) {
          const p = ghostBall ? ghostBall(at, camK) : rallyAt(at, camK).ball;
          m.position.set(p.x, p.y, p.z);
          if (top) m.scale.setScalar(topBallScale(p.y));
        }
      });
      shade.position.set(state.shade.x, 0.012, state.shade.z);
      shade.scale.setScalar(state.shade.scale);
      shadeMat.opacity = state.shade.opacity;
    },
    dispose() {
      backdrop?.dispose();
      for (const d of disposables) d.dispose();
      scene.clear();
      overlay.clear();
    },
  };
}
