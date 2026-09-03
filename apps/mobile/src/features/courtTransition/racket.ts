/**
 * The racket from `docs/design/mobile-ui/padel-racket.html`, built for the
 * court: the teardrop frame with its throat window, the perforated face plate,
 * the cartoon rim highlights, the lofted collar that morphs the frame's slab
 * section into a round grip, the wrapped handle and the butt cap. Ported mesh
 * for mesh, in the design's own model metres (a 26 cm head), then blown up by
 * swing.RACKET_SCALE where it is used — the court's four rackets stand in for
 * the players themselves, so they are person-sized.
 *
 * Colours are the court's, not the design file's: the racket is a brand
 * sticker on this court (navy frame, blue face, sky rim, lime grip) and has to
 * sit with the cage and the ball.
 *
 * The geometry is built ONCE and shared by all four rackets — `create()` only
 * clones the node tree, which copies geometry and material by reference. It
 * returns the design's rig, three nested groups the scene drives per frame:
 *
 *   mount   the stance (rally: position + yaw + top-view roll)
 *     pivot the hand (rally: the swing clip's travel + turn)
 *       lay  the top-view cheat (rally.layAngle)
 *         hold → body, both fixed: the racket, held
 *
 * `lite` (low-end phones) drops the face perforations, the rim highlights and
 * the lofted collar, and halves every curve's segments: the same silhouette
 * for roughly a third of the triangles.
 */
import * as THREE from 'three';
import type { CourtQuality } from './quality';
import {
  applyEulerYXZ,
  HAND_HOLD,
  HEAD_Y,
  mirrorRotation,
  PIVOT_Y,
  RACKET_SCALE,
  v3,
} from './swing';

/** The court's palette (scene.ts): the racket is the brand's, not the design file's. */
const COLORS = {
  frame: 0x1b2a47,
  face: 0x3360ab,
  rim: 0x6ec3f0,
  grip: 0xa5d06f,
  trim: 0x101b30,
} as const;

const rad = (d: number): number => (d * Math.PI) / 180;

/** Head centre and outer radius, model metres (padel-racket.html: HEAD). */
const HEAD = { x: 0, y: HEAD_Y, r: 0.13 } as const;
/** Frame thickness through the face. */
const T = 0.038;
/** Half-width of the neck where the frame runs into the handle. */
const NW = 0.018;
/** Grip radius. */
const R = 0.0195;
/**
 * Perforation radius. Real padel holes: ≈ 5.5 cm across once the racket is at
 * court scale, ≈ 2 px on the phone at the camera's rest distance — they read
 * as the face's texture rather than as holes, which is what they should do.
 */
const HOLE_R = 0.0065;

export interface RacketRig {
  /** Add this to the scene: the player's stance. */
  mount: THREE.Group;
  /** The hand — the swing clip drives its position and rotation. */
  pivot: THREE.Group;
  /** The top-view cheat: `rotation.x = layAngle(camK)`. */
  lay: THREE.Group;
}

export interface RacketKit {
  /** A racket held in the given hand, sharing this kit's geometry and materials. */
  create(hand: 1 | -1): RacketRig;
  /** Geometries and materials, for the scene's dispose list. */
  disposables: { dispose(): void }[];
}

/** The teardrop the frame, its face opening and the face plate all share. */
function teardrop(r: number, a: number, bottomY: number, neckW: number): THREE.Path {
  const p = new THREE.Path();
  const lx = -r * Math.cos(rad(a));
  const ly = HEAD.y - r * Math.sin(rad(a));
  p.absarc(HEAD.x, HEAD.y, r, rad(-a), rad(180 + a), false);
  p.bezierCurveTo(lx + 0.02, ly - 0.045, -neckW, bottomY, 0, bottomY);
  p.bezierCurveTo(neckW, bottomY, -lx - 0.02, ly - 0.045, -lx, ly);
  p.closePath();
  return p;
}

/**
 * One perforation as an explicit polygon rather than an arc: ExtrudeGeometry
 * subdivides every curve in a shape at the SAME resolution, so a circle drawn
 * with absarc would cost the outline's segment count 35 times over. Eight
 * sides is more than a 2 px hole can show.
 */
function hole(x: number, y: number, sides: number): THREE.Path {
  const p = new THREE.Path();
  for (let i = 0; i < sides; i++) {
    const a = -(i / sides) * Math.PI * 2; // clockwise: the opposite winding to the outline
    const px = x + Math.cos(a) * HOLE_R;
    const py = y + Math.sin(a) * HOLE_R;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  return p;
}

export function buildRacketKit(quality: CourtQuality): RacketKit {
  const full = quality === 'full';
  const segments = full ? 24 : 12;
  const disposables: { dispose(): void }[] = [];
  const mat = (color: number, roughness: number, metalness = 0.05) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    disposables.push(m);
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G): G => {
    disposables.push(g);
    return g;
  };
  const frameMat = mat(COLORS.frame, 0.5);
  const faceMat = mat(COLORS.face, 0.6);
  const rimMat = mat(COLORS.rim, 0.45);
  const gripMat = mat(COLORS.grip, 0.85, 0);
  const trimMat = mat(COLORS.trim, 0.5);

  const body = new THREE.Group();
  body.name = 'racket_body';
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const m = new THREE.Mesh(geo(geometry), material);
    body.add(m);
    return m;
  };

  // ── Frame: the teardrop outline, with the face opening and the throat window
  const outer = new THREE.Shape();
  const A = 20; // degrees below horizontal where the crown meets the straight sides
  const px = HEAD.r * Math.cos(rad(A));
  const py = HEAD.y - HEAD.r * Math.sin(rad(A));
  outer.absarc(HEAD.x, HEAD.y, HEAD.r, rad(-A), rad(180 + A), false);
  outer.bezierCurveTo(-0.098, 0.205, -NW, 0.165, -NW, 0.125);
  outer.lineTo(-NW, 0.108);
  outer.lineTo(NW, 0.108);
  outer.lineTo(NW, 0.125);
  outer.bezierCurveTo(NW, 0.165, 0.098, 0.205, px, py);
  outer.closePath();
  outer.holes.push(teardrop(0.116, 25, 0.204, 0.05));
  const throat = new THREE.Path();
  throat.moveTo(-0.046, 0.188);
  throat.lineTo(0.046, 0.188);
  throat.quadraticCurveTo(0.016, 0.168, 0, 0.156);
  throat.quadraticCurveTo(-0.016, 0.168, -0.046, 0.188);
  throat.closePath();
  outer.holes.push(throat);
  const frameDepth = T - 0.008;
  const frameGeo = new THREE.ExtrudeGeometry(outer, {
    depth: frameDepth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelOffset: -0.004,
    bevelSegments: full ? 4 : 2,
    curveSegments: segments,
  });
  frameGeo.translate(0, 0, -frameDepth / 2);
  part(frameGeo, frameMat);

  // ── Face plate, perforated
  const face = new THREE.Shape();
  const fp = teardrop(0.1195, 25, 0.2, 0.05);
  face.curves = fp.curves;
  face.autoClose = true;
  if (full) {
    for (let k = -4; k <= 3; k++) {
      const y = k * 0.026;
      for (let j = -4; j <= 4; j++) {
        const x = j * 0.03 + (k % 2 ? 0.015 : 0);
        const inside =
          y >= 0 ? Math.hypot(x, y) <= 0.09 : Math.abs(x) <= 0.088 - Math.abs(y) * 0.55;
        if (!inside) continue;
        face.holes.push(hole(HEAD.x + x, HEAD.y + y, 8));
      }
    }
  }
  const faceDepth = T - 0.008;
  const faceGeo = new THREE.ExtrudeGeometry(face, {
    depth: faceDepth,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.001,
    bevelOffset: -0.001,
    bevelSegments: 2,
    curveSegments: segments,
  });
  faceGeo.translate(0, 0, -faceDepth / 2);
  part(faceGeo, faceMat);

  // ── Cartoon highlight bands on the rim (front + back)
  if (full) {
    const band = (a0: number, a1: number, z: number) => {
      const s = new THREE.Shape();
      s.absarc(HEAD.x, HEAD.y, 0.1255, rad(a0), rad(a1), false);
      s.absarc(HEAD.x, HEAD.y, 0.1205, rad(a1), rad(a0), true);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {
        depth: 0.0012,
        bevelEnabled: false,
        curveSegments: segments,
      });
      g.translate(0, 0, z);
      part(g, rimMat);
    };
    band(100, 160, T / 2 + 0.0003);
    band(20, 80, -T / 2 - 0.0015);
  }

  // ── Collar: a loft that morphs the frame's slab section into the round grip
  if (full) {
    body.add(
      new THREE.Mesh(
        geo(
          loftGeometry(
            0.13,
            0.1,
            { a: NW + 0.0005, b: T / 2 + 0.0005, n: 10 },
            { a: R, b: R, n: 2 },
            24,
            10,
          ),
        ),
        trimMat,
      ),
    );
  } else {
    const collar = part(new THREE.CylinderGeometry(NW + 0.004, R, 0.035, 12), trimMat);
    collar.position.y = 0.1155;
  }

  // ── Grip: wrapped handle on a butt cap
  const grip = part(new THREE.CylinderGeometry(R, R, 0.09, full ? 24 : 12), gripMat);
  grip.position.y = 0.057;
  const wrapGeo = geo(new THREE.TorusGeometry(R - 0.0015, 0.0034, 6, full ? 20 : 10));
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(wrapGeo, gripMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.028 + i * 0.022;
    body.add(ring);
  }
  const cap = part(new THREE.CylinderGeometry(R + 0.0015, R + 0.0005, 0.012, full ? 24 : 12), trimMat);
  cap.position.y = 0.007;
  if (full) {
    const end = part(
      new THREE.SphereGeometry(R + 0.0015, 24, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      trimMat,
    );
    end.scale.y = 0.3;
    end.position.y = 0.0064;
  }

  const shadows = full;
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = shadows;
  });

  return {
    disposables,
    create(hand) {
      const hold = mirrorRotation(HAND_HOLD, hand);
      // hold · T(0, −PIVOT_Y, 0), as three's own T(position) · R(rotation).
      const offset = applyEulerYXZ(v3(0, -PIVOT_Y * RACKET_SCALE, 0), hold);
      const holder = new THREE.Group();
      holder.name = 'hand_hold';
      holder.rotation.order = 'YXZ';
      holder.rotation.set(hold.x, hold.y, hold.z);
      holder.position.set(offset.x, offset.y, offset.z);
      holder.scale.setScalar(RACKET_SCALE);
      holder.add(body.clone());

      const lay = new THREE.Group();
      lay.name = 'lay';
      lay.add(holder);
      const pivot = new THREE.Group();
      pivot.name = 'swing_pivot';
      pivot.rotation.order = 'YXZ';
      pivot.add(lay);
      const mount = new THREE.Group();
      mount.name = 'padel_racket';
      mount.rotation.order = 'YXZ';
      mount.add(pivot);
      return { mount, pivot, lay };
    },
  };
}

/**
 * The design's `loft`: a superellipse swept from `top` to `bottom` over a
 * smoothstep, which is how the collar turns a near-rectangular slab section
 * (n = 10) into a circle (n = 2) without a seam.
 */
function loftGeometry(
  yTop: number,
  yBot: number,
  top: { a: number; b: number; n: number },
  bot: { a: number; b: number; n: number },
  around: number,
  along: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let i = 0; i <= along; i++) {
    const t = smooth(i / along);
    const y = yTop + (yBot - yTop) * (i / along);
    const a = top.a + (bot.a - top.a) * t;
    const b = top.b + (bot.b - top.b) * t;
    const n = top.n + (bot.n - top.n) * t;
    for (let j = 0; j <= around; j++) {
      const th = (j / around) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pos.push(
        a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
        y,
        b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n),
      );
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < around; j++) {
      const p = i * (around + 1) + j;
      const q = p + around + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
