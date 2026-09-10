/**
 * The racket from `docs/design/mobile-ui/padel-racket.html`, built for the
 * court: the teardrop frame with its throat window, the face plate with its
 * white perforations and the brand mark decalled on the front of it, the
 * cartoon rim highlights, the lofted collar that morphs the frame's slab
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
 * `lite` (low-end phones) drops the rim highlights and the lofted collar and
 * halves every curve's segments — but keeps the perforations, which are what
 * makes a padel racket one, and the brand mark, which is what the racket is
 * doing on this court: the same silhouette for a shade over a third of them.
 */
import * as THREE from 'three';
import { buildSmileyShapes } from './smileyMark';
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
  hole: 0xffffff,
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
 * Perforation radius: ≈ 5.5 cm across once the racket is at court scale, ≈ 2 px
 * on the phone at the camera's rest distance. Widen this if they read as mush.
 * Exported because a hole is a disc, not a point: the clearance the test checks
 * against HOLE_FIELD is the rim's, not the centre's.
 */
export const HOLE_R = 0.0065;
/**
 * How proud of the face plate each white plug stands, model metres. Non-zero
 * so the plug's caps are strictly in front of the plate's and nothing z-fights;
 * 0.5 mm here is 2 mm at court scale, which no camera in the transition sees.
 */
const PLUG_PROUD = 0.0005;

/**
 * The smiley ball on the face, as a RADIUS — see `smileyMark.ts` for the mark
 * itself. A ball's honest measure is a circle, and this one is barely a box at
 * all (109.95 x 110.87 artwork units), so the question the round face asks and
 * the question the mark answers are for once the same one.
 *
 * 0.06714 is 60 % of the 0.1119 the mark was first dropped in at — "the smiley
 * face is too big, make it 40 % smaller" (owner, 2026-09-05) — and the 40 % is
 * off the RADIUS, so the ball covers a third of the area it did. That first
 * number was the lockup's own ceiling, inherited because the swap was a swap,
 * and it did not survive the swap: a wordmark only touches its enclosing circle
 * at a few extremes, while a ball fills it, so the same radius that read as a
 * mark on a face read as the face itself.
 *
 * At this size the ink stops 48.9 mm of model short of the FRAME's 0.116
 * opening and sits inside the perforations rather than under all of them: the
 * lattice reaches ±0.075 in x and the ball ±0.067, so the outermost dots are on
 * blue and the mark reads as printed on the plate. The ceiling is still 0.116,
 * and the test still measures the built buffers against FACE_OUTLINE every run
 * rather than trusting any number written here.
 */
const MARK_R = 0.06714;

/**
 * Where the decal sits through the plate. The plate's front flat face is at
 * faceDepth / 2 + bevelThickness = 0.016 and the plugs' caps stand to ±0.0165,
 * so this puts the mark a tenth of a millimetre proud of the blue — far enough
 * that nothing z-fights — and leaves it 0.4 mm BEHIND the white.
 *
 * So the dots pierce the mark, which is what a drilled plate does to anything
 * printed on it. It went the other way for exactly one day, when the mark was
 * the wordmark: 13 of the 30 holes have their rims on the ink, and a word read
 * through 13 holes is not a word ("the racket dots don't pierce through the
 * logo", owner, 2026-09-05). The smiley wants no such protection and was chosen
 * partly for that — "we could have the dots piercing this no problem" — so the
 * decal is back under the white where it belongs, and the three layers below
 * fit in the 0.4 mm that leaves. Front only; the back of a sticker is not
 * printed.
 */
const DECAL_Z = 0.0161;

/**
 * The mark is three coplanar paint layers and they OVERLAP — the felt and the
 * seams are painted into the navy's windows, and the left eye is painted back
 * over the felt — so they cannot share a z or they will z-fight, which reads on
 * a phone as the mark flickering as the racket swings. Each layer is lifted by
 * this much over the one beneath: 0.1 mm of model, 0.4 mm at RACKET_SCALE, and
 * 0.0163 for the topmost still clears the plugs' 0.0165. The dots stay in front
 * of all three.
 *
 * This gap is what SEPARATES the layers; it is not what ORDERS them. 0.42 mm at
 * RACKET_SCALE survives iOS's 24-bit depth buffer and is invisible to Android's
 * 16-bit one, so the ordering is stated outright in FACE_STACK instead.
 */
const DECAL_LAYER = 0.0001;

/**
 * The face's coplanar stack, back to front, as explicit `renderOrder`s —
 * because on Android the depth buffer cannot tell these surfaces apart.
 *
 * expo-gl asks Android's EGL for `EGL_DEPTH_SIZE, 16` (its GLContext.java) and
 * eglChooseConfig returns the smallest conforming config, so the phone gets 16
 * bits where iOS gets GL_DEPTH24_STENCIL8 (its GLView.swift). Against the
 * camera's near 5 / far 200, with the racket at the orbit's 46–60 m, one 16-bit
 * LSB is 6.3 to 10.7 mm of world space — while the whole stack, plate to plugs,
 * spans 0.42 mm at RACKET_SCALE. Every surface here therefore quantises to the
 * SAME depth value: the depth test settles nothing and draw order settles
 * everything.
 *
 * Left to itself that order is an accident. three's `painterSortStable` breaks
 * a renderOrder tie on `material.id` — the order `mat()` happened to construct
 * them in — and that order is wrong twice: faceMat is built after frameMat, so
 * the PLATE would paint over the mark's navy line work, and gripMat after
 * frameMat, so the felt would paint over the left eye that exists only to sit
 * on top of it. renderOrder is compared BEFORE material.id, so writing the
 * stack down settles it on every phone and at every distance.
 */
const FACE_STACK = { plate: 0, mark: 1, plugs: 4 } as const;

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
 * The face plate's outline: the blue teardrop the perforations and the brand
 * decal are both drawn on. Module-level and exported for the reason HOLE_FIELD
 * is — it is the boundary everything laid on the face has to stay inside of,
 * and the decal's clearance test measures the built mark against this curve
 * rather than against a second copy of these four numbers.
 */
export const FACE_OUTLINE = teardrop(0.1195, 25, 0.2, 0.05);

/**
 * The hole field: the face plate's own teardrop, pulled in by 27.5 mm of model
 * (0.1195 → 0.092) with its tail dropped 20 mm and its neck widened 5 mm. That
 * is a DESIGN INSET, not a rounding allowance — 115 mm at RACKET_SCALE, a tenth
 * of the head's 1.09 m width left deliberately bare on each side, so the plate
 * reads as a drilled panel with a margin rather than as a sieve. It no longer
 * GENERATES the pattern — the row counts do that now — but it is still the
 * statement of where a perforation is allowed to be, and the test holds every
 * generated centre against it.
 *
 * Both halves of the face read this one outline. The design tested them with
 * different rules — a circle of r 0.09 above the centre line, but
 * `|x| <= 0.088 - |y| * 0.55` below it, a linear taper pulling in about twice
 * as fast as the outline actually does, which left the lower rows visibly bare.
 */
export const HOLE_FIELD = teardrop(0.092, 25, 0.22, 0.055).getPoints(64);

/** Ray crossing, so the field is whatever shape the outline is. */
export function inField(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = HOLE_FIELD.length - 1; i < HOLE_FIELD.length; j = i++) {
    const a = HOLE_FIELD[i]!;
    const b = HOLE_FIELD[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * The perforations, row by row from the throat up. These numbers are the spec,
 * not something a lattice happens to produce once it is clipped, so they are
 * written down rather than derived.
 *
 * THE SOURCE IS THE OWNER, NOT THE STICKER SHEET: "first row 4 then 5 then 6
 * then 6 then 5 then 4 and thats it no more rows" (2026-09-05). Written out
 * because this cited the brand's p8 for a day and that citation was wrong — the
 * racket on `docs/brand/stickers-5cm.pdf` page 8 carries 32 dots, not 30, in
 * six rows of 4, 5, 6, 6, 6, 5 read down from the tip, and its lattice spaces
 * rows ≈ 6.4 units against ≈ 6.1 across a row, i.e. rows further apart than
 * columns rather than the compression below. So the sheet is NOT authority for
 * anything here: someone checking the dots against it will find a different,
 * unmirrored pattern and must not "fix" the code toward it.
 */
const ROWS = [4, 5, 6, 6, 5, 4] as const;

/**
 * The perforations' centres: 30 holes, 30 mm apart across a row and 26 mm
 * between rows (30 · sin 60°, the hex spacing the face keeps). Six rows
 * STRADDLE the sweet spot — y = HEAD.y + (i − 2.5) · 26 mm, so ± 13, 39 and
 * 65 mm — rather than one row sitting on it, which is what an even row count
 * costs and what it buys: the pattern mirrors about the centre line.
 *
 * Worth knowing before it reads as a bug: an even, mirror-symmetric row count
 * CANNOT be a strict alternating hex lattice. Rows of 4 and 6 need the half-step
 * offset to stay centred on x = 0 and rows of 5 do not, so the stagger runs
 * half, none, half | half, none, half — and the two 6-rows therefore sit
 * directly above one another across the centre line instead of interleaving.
 * That is forced by the count; it is the only way six rows are both symmetric
 * and centred on the face.
 *
 * Every centre clears HOLE_FIELD with room for its own radius, and the tightest
 * is NOT where it looks. Measured perpendicular to the field's own curve, less
 * HOLE_R: an outermost hole of the TOP 4-row, (± 0.045, 0.385), has 6.43 mm of
 * model to spare, while the outermost holes of the 6-rows — the ones that reach
 * furthest in x, at ± 0.075 — have 9.37 mm. The crown has already begun to
 * close over the top row while the field is still widening past the 6-rows, so
 * reach in x is the wrong thing to budget against. 6.43 mm of model (27 mm at
 * RACKET_SCALE) is the number to spend before widening HOLE_R or opening the
 * row pitch; the test re-measures every rim against the built field rather than
 * trusting this paragraph.
 */
export const HOLE_CENTRES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  ROWS.forEach((n, i) => {
    const y = HEAD.y + (i - 2.5) * 0.026;
    for (let j = 0; j < n; j++) out.push([HEAD.x + (j - (n - 1) / 2) * 0.03, y]);
  });
  return out;
})();

/**
 * The perforations, as one merged geometry of white plugs.
 *
 * The design cuts them clean through the face plate, which puts the COURT
 * behind every hole — from the top-down camera the strings read as turf. The
 * brand's racket has white holes (the flat court illustration draws them that
 * way too), so they are filled instead: a short capped cylinder per hole,
 * standing PLUG_PROUD of the plate on both sides.
 *
 * One geometry, not one mesh per hole — thirty-odd extra draw calls per racket
 * would be four times that on the court, every frame. And with the holes
 * filled there is nothing to cut, so the face plate goes back to a plain
 * teardrop: the cut was most of its triangles (every hole tessellated at the
 * outline's own resolution).
 */
function plugsGeometry(
  centres: readonly (readonly [number, number])[],
  depth: number,
  sides: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const h = depth / 2 + PLUG_PROUD;
  for (const [cx, cy] of centres) {
    const base = pos.length / 3;
    // Wall: a ring at each end, its own vertices so the caps stay crisp.
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const x = Math.cos(a);
      const y = Math.sin(a);
      for (const z of [-h, h]) {
        pos.push(cx + x * HOLE_R, cy + y * HOLE_R, z);
        nrm.push(x, y, 0);
      }
    }
    // The ring pushes −h before +h, so the four corners of a wall quad are
    // (q, q+1) = (back, front) at θ and (q+2, q+3) = (back, front) at θ + dθ.
    // Wound q → q+2 → q+1, which is anticlockwise seen from OUTSIDE and so
    // agrees with the (x, y, 0) normals pushed alongside. Take that ordering
    // for granted and the geometric normal comes out radially inward instead:
    // every wall triangle is then back-face culled by the default FrontSide
    // material, and lit inside-out wherever it is not. The caps below make the
    // same choice explicitly (`if (face > 0)`), and for the same reason.
    for (let i = 0; i < sides; i++) {
      const q = base + i * 2;
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
    // Caps: a centre vertex and a ring, front and back.
    for (const z of [h, -h]) {
      const centre = pos.length / 3;
      const face = Math.sign(z);
      pos.push(cx, cy, z);
      nrm.push(0, 0, face);
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pos.push(cx + Math.cos(a) * HOLE_R, cy + Math.sin(a) * HOLE_R, z);
        nrm.push(0, 0, face);
      }
      for (let i = 0; i < sides; i++) {
        const r = centre + 1 + i;
        if (face > 0) idx.push(centre, r, r + 1);
        else idx.push(centre, r + 1, r);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
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
  const holeMat = mat(COLORS.hole, 0.6);
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
  part(frameGeo, frameMat).name = 'racket_frame';

  // ── Face plate, with the white perforations plugged into it
  const face = new THREE.Shape();
  face.curves = FACE_OUTLINE.curves;
  face.autoClose = true;
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
  const plate = part(faceGeo, faceMat);
  plate.name = 'racket_face';
  plate.renderOrder = FACE_STACK.plate;
  // The bevel adds a bevelThickness at each end, so the plate's flat faces sit
  // a touch beyond `faceDepth`; the plugs have to clear that too.
  const plugs = part(plugsGeometry(HOLE_CENTRES, faceDepth + 0.002, full ? 8 : 6), holeMat);
  plugs.name = 'racket_perforations';
  plugs.renderOrder = FACE_STACK.plugs;

  // ── The brand mark, decalled on the plate and pierced by the dots
  //
  // THE SMILEY BALL, not the lockup: "instead of the logo, have it be the
  // smiley face ball" (owner, 2026-09-05), which is `docs/brand/stickers-5cm.pdf`
  // page 11 and now `smileyMark.ts`. The wordmark it replaces asked to be READ,
  // and a lattice of holes across a word is unreadable — that is what forced
  // the decal in front of the plugs and what the same instruction lifted in the
  // same breath: "we could have the dots piercing this no problem". A ball with
  // holes punched through it is a racket face, so the mark goes back UNDER the
  // white, where a decal on a drilled plate belongs. See DECAL_Z.
  //
  // The mark's beziers are short — 41 mm of model at the very longest, under a
  // third of HEAD.r — so what the tessellation buys here is chords, not arcs.
  // At 4 segments the worst chord misses its own curve by 0.34 mm of model:
  // 1.4 mm at RACKET_SCALE, a 760th of the head's 1.09 m width. The head is
  // 5.6 % of the viewport's height where the orbit comes closest (fov 24°,
  // 46 m), so on a 3x phone that miss is a seventh of one device pixel. `lite`
  // takes that floor; `full`'s 8 segments quarter it to 0.09 mm of model, the
  // same 2:1 the rest of the racket's curves keep (24 / 12).
  const markSegments = full ? 8 : 4;
  const smiley = buildSmileyShapes(MARK_R);
  /** The mark's meshes, kept so the shadow pass can be told to skip them. */
  const decals: THREE.Mesh[] = [];
  const decal = (
    shapes: THREE.Shape[],
    material: THREE.Material,
    name: string,
    layer: number,
  ): void => {
    // ShapeGeometry emits one group per shape with its own incrementing
    // materialIndex, and NOTHING here ever reads them: WebGLRenderer's
    // projectObject and WebGLShadowMap alike walk `geometry.groups` only inside
    // `if (Array.isArray(material))`, and these meshes carry one material
    // apiece, so each buffer draws as a single range. Twelve shapes are four
    // draw calls. Written down because the opposite is the natural reading —
    // a `clearGroups()` rode here for a while on the strength of it, saving
    // nothing.
    const g = new THREE.ShapeGeometry(shapes, markSegments);
    // smileyMark centres the mark on (0, 0) in its own frame; the face's centre
    // is the sweet spot.
    g.translate(HEAD.x, HEAD.y, DECAL_Z + layer * DECAL_LAYER);
    const m = part(g, material);
    m.name = name;
    // The paint order, stated rather than inherited from material.id — the z
    // above is invisible to a 16-bit depth buffer. See FACE_STACK.
    m.renderOrder = FACE_STACK.mark + layer;
    decals.push(m);
  };
  // THREE COLOURS THE RACKET ALREADY WEARS. The sticker is drawn navy, felt
  // green and cream on white paper; the plate is a blue of its own, so the
  // artwork's own inks cannot all be taken literally:
  //
  //  · the PDF's navy is (53, 78, 168) and this plate is (51, 96, 171) — the
  //    same colour to any eye at arm's length. Taken literally the ring, the
  //    eyes and the smile would have dissolved into the face, so the ink is the
  //    FRAME's navy instead: the darkest thing on the racket, and already on it.
  //  · the felt is the grip's lime, a shade off the artwork's own green.
  //  · the seams go white, which is both the paper the brand prints this ball
  //    on and the perforations' colour. That last one was a bug when the mark
  //    was a wordmark — mark and lattice fused into one white mass — and is
  //    right here, because a tennis ball's seams ARE white and they are held
  //    inside a navy outline that the dots cannot blur.
  //
  // Materials are shared objects, not copies: three of the racket's own five
  // for the whole court, so the mark costs draw calls but not a palette.
  //
  // The order is the artwork's, and it is not decoration: the navy is a disc
  // with the felt's windows cut out of it, so it goes down FIRST and everything
  // else is painted into it. See smileyMark's header for why that needs three
  // layers and not twelve.
  decal(smiley.ink, frameMat, 'racket_mark_ink', 0);
  decal(smiley.ball, gripMat, 'racket_mark_ball', 1);
  // Felt and seams never touch each other — only the navy under both — so they
  // share a layer rather than spending one of the three this decal can afford.
  decal(smiley.seam, holeMat, 'racket_mark_seam', 1);
  decal(smiley.inkTop, frameMat, 'racket_mark_ink_top', 2);

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
  grip.name = 'racket_grip';
  grip.position.y = 0.057;
  const wrapGeo = geo(new THREE.TorusGeometry(R - 0.0015, 0.0034, 6, full ? 20 : 10));
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(wrapGeo, gripMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.028 + i * 0.022;
    body.add(ring);
  }
  const cap = part(
    new THREE.CylinderGeometry(R + 0.0015, R + 0.0005, 0.012, full ? 24 : 12),
    trimMat,
  );
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
  // …except the mark, which cannot cast a shadow anyone could see. Its four
  // passes are flat planes a tenth of a millimetre of model in front of an
  // opaque plate that is already a caster, and every vertex of them lies inside
  // that plate's outline (the decal test measures it). With the sun at
  // (6, 30, 10) their silhouette along the light is displaced by well under
  // that tenth of a millimetre — strictly inside the plate's own — and
  // scene.ts's `shadow.normalBias` of 0.05 is a hundred times the whole
  // separation anyway. Only the turf receives shadow, and no racket mesh sets
  // receiveShadow. So this is four shadow-map draw calls a racket, sixteen
  // across the court every `full` frame, whose output is bit-identical to what
  // the plate behind them already wrote.
  for (const m of decals) m.castShadow = false;

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
