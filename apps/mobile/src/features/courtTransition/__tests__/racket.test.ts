import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRacketKit, FACE_OUTLINE, HOLE_CENTRES, HOLE_FIELD, HOLE_R, inField } from '../racket';
import { HEAD_ARM, HEAD_Y, PIVOT_Y, RACKET_SCALE } from '../swing';

const triangles = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (!g) return;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
};

const boxOf = (rig: { mount: THREE.Group }): THREE.Box3 => {
  rig.mount.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.mount);
};

/** The racket's parts: the body group's children, one mesh apiece. */
const partsOf = (rig: { lay: THREE.Group }): THREE.Mesh[] =>
  rig.lay.children[0]!.children[0]!.children as THREE.Mesh[];

/** The one part with this name — the miss and the duplicate both fail here. */
const byName = (parts: readonly THREE.Mesh[], name: string): THREE.Mesh => {
  const found = parts.filter((m) => m.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
};

/** A part's own geometry box, in the body's frame. */
const localBox = (mesh: THREE.Mesh): THREE.Box3 => {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!;
};

const hexOf = (mesh: THREE.Mesh): string =>
  (mesh.material as THREE.MeshStandardMaterial).color.getHexString();

/**
 * Ray crossing over a sampled outline. The module has `inField` for the hole
 * field, but this is a different polygon and, more to the point, a test that
 * borrows the code under test proves nothing about it — so the decal's
 * containment is measured here, independently.
 */
const insideOutline = (x: number, y: number, poly: readonly THREE.Vector2[]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/**
 * How much room a hole of HOLE_R centred here has before its RIM touches the
 * field, measured perpendicular to the field's own curve.
 *
 * Perpendicular, and that is the point: a horizontal half-width answers "how
 * far can this row reach in x", which is a different question on a teardrop
 * whose crown is already closing over the top row while its waist is still
 * widening past the middle ones. The comment on HOLE_CENTRES quotes the number
 * this returns, so it is measured here rather than remembered there.
 */
const clearance = (x: number, y: number): number => {
  let best = Infinity;
  for (let i = 0, j = HOLE_FIELD.length - 1; i < HOLE_FIELD.length; j = i++) {
    const a = HOLE_FIELD[i]!;
    const b = HOLE_FIELD[j]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best - HOLE_R;
};

/**
 * Is a point strictly inside a triangle, by at least `eps`?
 *
 * STRICTLY, and that is the whole point: the mark's felt and its seams are cut
 * from one another and therefore SHARE edges, so vertices lying exactly on a
 * neighbour's edge are the normal case and only a point genuinely in a
 * triangle's interior is an overlap. `eps` is the width of that indifference.
 */
const deepInside = (px: number, py: number, t: readonly number[], eps: number): boolean => {
  const [ax, ay, bx, by, cx, cy] = t as [number, number, number, number, number, number];
  const half = (x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    return len === 0 ? 0 : (dx * (py - y1) - dy * (px - x1)) / len; // signed distance
  };
  const d = [half(ax, ay, bx, by), half(bx, by, cx, cy), half(cx, cy, ax, ay)];
  return d.every((v) => v > eps) || d.every((v) => v < -eps);
};

/** A mesh's triangles as flat [ax, ay, bx, by, cx, cy] tuples, in the body's frame. */
const trianglesOf = (mesh: THREE.Mesh): number[][] => {
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getIndex()!;
  const out: number[][] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    out.push([pos.getX(a!), pos.getY(a!), pos.getX(b!), pos.getY(b!), pos.getX(c!), pos.getY(c!)]);
  }
  return out;
};

/** The mark's four passes, in the artwork's own paint order. */
const DECAL_NAMES = [
  'racket_mark_ink',
  'racket_mark_ball',
  'racket_mark_seam',
  'racket_mark_ink_top',
] as const;

describe('the racket mesh (padel-racket.html)', () => {
  it('nests the design rig: mount → pivot → lay → hold → body', () => {
    const kit = buildRacketKit('full');
    const rig = kit.create(1);
    expect(rig.mount.children).toEqual([rig.pivot]);
    expect(rig.pivot.children).toEqual([rig.lay]);
    expect(rig.lay.children[0]!.name).toBe('hand_hold');
    expect(rig.lay.children[0]!.children[0]!.name).toBe('racket_body');
    // Every group turns in the order the clip's Eulers are written in.
    expect(rig.mount.rotation.order).toBe('YXZ');
    expect(rig.pivot.rotation.order).toBe('YXZ');
  });

  it('puts the grip on the pivot and the head one arm out', () => {
    const kit = buildRacketKit('full');
    const rig = kit.create(1);
    rig.lay.rotation.x = 0; // the front view: the racket stands as the design holds it
    rig.mount.updateMatrixWorld(true);
    const body = rig.lay.children[0]!.children[0]!;
    // The butt cap is PIVOT_Y below the hand, the sweet spot HEAD_ARM above it.
    const butt = body.localToWorld(new THREE.Vector3(0, 0, 0));
    const head = body.localToWorld(new THREE.Vector3(0, HEAD_ARM + PIVOT_Y, 0));
    expect(butt.length()).toBeCloseTo(PIVOT_Y * RACKET_SCALE, 6);
    expect(head.length()).toBeCloseTo(HEAD_ARM * RACKET_SCALE, 6);
  });

  it('is a person-sized racket, taller than it is wide', () => {
    const kit = buildRacketKit('full');
    const rig = kit.create(1);
    rig.lay.rotation.x = 0;
    const size = boxOf(rig).getSize(new THREE.Vector3());
    // The old cartoon racket was ≈ 1.1 m across the head and ≈ 2 m long.
    expect(Math.max(size.x, size.y)).toBeGreaterThan(1.5);
    expect(Math.max(size.x, size.y)).toBeLessThan(2.2);
    expect(size.z).toBeLessThan(0.4); // a flat racket, not a paddle-shaped blob
  });

  it('shares one build across every racket on the court', () => {
    const kit = buildRacketKit('full');
    const a = kit.create(1);
    const b = kit.create(-1);
    const geoOf = (rig: { mount: THREE.Group }) => {
      const out: THREE.BufferGeometry[] = [];
      rig.mount.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g) out.push(g);
      });
      return out;
    };
    const ga = geoOf(a);
    const gb = geoOf(b);
    expect(ga.length).toBeGreaterThan(5);
    expect(gb.length).toBe(ga.length);
    for (let i = 0; i < ga.length; i++) expect(gb[i]).toBe(ga[i]); // same objects, not copies
    // Four rackets are four node trees over ONE set of geometries.
    expect(new Set(ga).size).toBeLessThan(ga.length); // the grip wraps share theirs
  });

  it('the other hand is the same racket, held mirrored', () => {
    const kit = buildRacketKit('full');
    const right = kit.create(1);
    const left = kit.create(-1);
    const hr = right.lay.children[0]!.rotation;
    const hl = left.lay.children[0]!.rotation;
    expect(hl.x).toBeCloseTo(hr.x, 12);
    expect(hl.y).toBeCloseTo(-hr.y, 12);
    expect(hl.z).toBeCloseTo(-hr.z, 12);
    expect(left.lay.children[0]!.position.x).toBeCloseTo(-right.lay.children[0]!.position.x, 12);
  });

  it('the perforations are WHITE, and on every tier', () => {
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      // Selected by NAME, not by colour. The decal is lime rather than white
      // now, so a colour filter would happen to pass again — but it would pass
      // by luck, and go on passing right up until someone reverses the mark
      // back into white. The name is what this test actually means.
      const white = parts.filter((m) => m.name === 'racket_perforations');
      // ONE mesh for the lot: a mesh per hole would be 30-odd extra draw calls
      // per racket, four times over, every frame.
      expect(white).toHaveLength(1);
      expect(hexOf(white[0]!)).toBe('ffffff');
      const plugs = white[0]!.geometry;
      const faceMesh = byName(parts, 'racket_face');
      expect(hexOf(faceMesh)).toBe('3360ab');
      const face = faceMesh.geometry;
      plugs.computeBoundingBox();
      face.computeBoundingBox();
      // Proud of the plate on BOTH sides, or the white z-fights the blue.
      expect(plugs.boundingBox!.min.z).toBeLessThan(face.boundingBox!.min.z);
      expect(plugs.boundingBox!.max.z).toBeGreaterThan(face.boundingBox!.max.z);
      // …and inside its outline, not spilling over the rim.
      expect(plugs.boundingBox!.min.x).toBeGreaterThan(face.boundingBox!.min.x);
      expect(plugs.boundingBox!.max.x).toBeLessThan(face.boundingBox!.max.x);
      expect(plugs.boundingBox!.min.y).toBeGreaterThan(face.boundingBox!.min.y);
      expect(plugs.boundingBox!.max.y).toBeLessThan(face.boundingBox!.max.y);
      // Each hole is a closed plug: a wall ring plus two caps.
      expect(plugs.index!.count / 3).toBe(HOLE_CENTRES.length * 4 * (tier === 'full' ? 8 : 6));
    }
  });

  it('the rows read 4, 5, 6, 6, 5, 4 up from the throat, evenly on both sides', () => {
    // These counts are the OWNER's — "first row 4 then 5 then 6 then 6 then 5
    // then 4 and thats it no more rows" (2026-09-05) — so they are the spec
    // rather than whatever a clipped lattice yields, and this is the assertion
    // that pins them. Not the brand's sticker sheet: p8 of it draws 32 dots in
    // 4, 5, 6, 6, 6, 5, which is a different and unmirrored pattern (see
    // racket.ts). Six rows means none sits ON the sweet spot: they straddle it,
    // which is what an even count costs and what it buys.
    const rows = new Map<number, number>();
    for (const [, y] of HOLE_CENTRES) rows.set(+y.toFixed(6), (rows.get(+y.toFixed(6)) ?? 0) + 1);
    const counts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
    expect(counts).toEqual([4, 5, 6, 6, 5, 4]);
    expect(HOLE_CENTRES).toHaveLength(30);
    // Every row centred on the face's own centre line — which is why the two
    // 6-rows sit above one another rather than interleaving (see racket.ts).
    for (const [y, n] of rows) {
      const xs = HOLE_CENTRES.filter(([, hy]) => +hy.toFixed(6) === y).map(([x]) => x);
      expect(xs).toHaveLength(n);
      expect(xs.reduce((a, b) => a + b, 0) / n).toBeCloseTo(0, 9);
    }
  });

  it('every perforation lands inside the field the face allows', () => {
    // The counts generate the pattern now, so nothing clips it: the field is
    // still the statement of where a perforation may go, and this is what holds
    // the two to each other. Rim as well as centre — a hole that fits by its
    // centre alone would break the inset outline.
    for (const [x, y] of HOLE_CENTRES) {
      expect(inField(x, y)).toBe(true);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        expect(inField(x + dx * HOLE_R, y + dy * HOLE_R)).toBe(true);
      }
    }
    // …with room to spare at the widest point of the widest rows.
    const widest = Math.max(...HOLE_CENTRES.map(([x]) => Math.abs(x)));
    expect(widest).toBeCloseTo(0.075, 9);
    expect(Math.max(...HOLE_FIELD.map((pt) => Math.abs(pt.x)))).toBeGreaterThan(widest + HOLE_R);
    // WHERE the field is tightest, because that is the number anyone widening
    // HOLE_R or opening the row pitch will spend — and it is not where reach in
    // x says it is. The outermost holes of the TOP 4-row are the tight ones,
    // not the outermost holes of the 6-rows that stand 30 mm further out.
    const ranked = HOLE_CENTRES.map(([x, y]) => ({ x, y, gap: clearance(x, y) })).sort(
      (a, b) => a.gap - b.gap,
    );
    const tightest = ranked[0]!;
    expect(Math.abs(tightest.x)).toBeCloseTo(0.045, 9);
    expect(tightest.y).toBeCloseTo(0.385, 9);
    expect(tightest.gap * 1000).toBeCloseTo(6.43, 2); // mm of model — HOLE_CENTRES quotes this
    // …and the 6-rows' outermost, which look like the tight ones, are not.
    const sixes = ranked.filter((h) => Math.abs(h.x) > 0.07);
    expect(Math.min(...sixes.map((h) => h.gap)) * 1000).toBeCloseTo(9.37, 2);
  });

  it('the mark lies on the plate and BEHIND the dots, on every tier', () => {
    // Where the decal lives, in one assertion: on the blue and under the white.
    // Every pass clears the plate so nothing z-fights against it, and every
    // pass stays short of the plugs' caps, so the perforations punch through
    // the mark — which is what a drilled plate does to anything printed on it,
    // and what the smiley (unlike the wordmark it replaced) can carry.
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      const plate = localBox(byName(parts, 'racket_face'));
      const plugs = localBox(byName(parts, 'racket_perforations'));
      for (const name of DECAL_NAMES) {
        const decal = localBox(byName(parts, name));
        expect(decal.min.z).toBeCloseTo(decal.max.z, 9); // flat: a decal, not a boss
        expect(decal.min.z).toBeGreaterThan(plate.max.z);
        expect(decal.max.z).toBeLessThan(plugs.max.z);
      }
      // …and the passes stack in the ARTWORK's order, because the navy is a
      // disc with windows cut in it rather than a set of lines: painted over
      // the felt it would swallow the ball, and the left eye painted under the
      // felt would vanish. Felt and seam share a level (see the next test).
      const z = (name: string): number => localBox(byName(parts, name)).min.z;
      expect(z('racket_mark_ball') - z('racket_mark_ink')).toBeCloseTo(0.0001, 7);
      expect(z('racket_mark_seam')).toBeCloseTo(z('racket_mark_ball'), 9);
      expect(z('racket_mark_ink_top') - z('racket_mark_ball')).toBeCloseTo(0.0001, 7);
    }
  });

  it('the felt and the seams never overlap, which is what lets them share a z', () => {
    // Two coplanar passes at the same z would z-fight wherever they cover the
    // same ground, and on a phone that reads as the ball flickering as the
    // racket swings. They are safe here because the artwork CUTS them from one
    // another — but that is a property of an extraction that may be redone, so
    // it is measured rather than remembered. Both directions: a vertex of each
    // against every triangle of the other.
    const parts = partsOf(buildRacketKit('full').create(1));
    const felt = trianglesOf(byName(parts, 'racket_mark_ball'));
    const seam = trianglesOf(byName(parts, 'racket_mark_seam'));
    // A tenth of a millimetre of model, ~0.4 mm at RACKET_SCALE: wider than the
    // shared edges' own rounding, far narrower than any real overlap.
    const eps = 1e-4;
    const pierces = (pts: number[][], tris: number[][]): number =>
      pts.filter((t) =>
        [0, 2, 4].some((i) => tris.some((u) => deepInside(t[i]!, t[i + 1]!, u, eps))),
      ).length;
    expect(pierces(seam, felt)).toBe(0);
    expect(pierces(felt, seam)).toBe(0);
  });

  it('the decal clears the face plate on every side', () => {
    const parts = partsOf(buildRacketKit('full').create(1));
    const plate = localBox(byName(parts, 'racket_face'));
    const mark = localBox(byName(parts, 'racket_mark_ink'))
      .clone()
      .union(localBox(byName(parts, 'racket_mark_ball')));
    expect(mark.min.x).toBeGreaterThan(plate.min.x);
    expect(mark.max.x).toBeLessThan(plate.max.x);
    expect(mark.min.y).toBeGreaterThan(plate.min.y);
    expect(mark.max.y).toBeLessThan(plate.max.y);
    // EVERY VERTEX, not the four corners of a box. The mark is sized by its
    // ink's enclosing circle, and a circle's bounding box reaches past it at
    // four corners that hold nothing. Testing those corners would fail the mark
    // for empty air, and worse, would pass a mark whose ink bulged out between
    // them. The teardrop narrows fast off its centre line, so the only honest
    // question is whether the drawn triangles are inside it.
    const outline = FACE_OUTLINE.getPoints(512);
    for (const name of DECAL_NAMES) {
      const g = byName(parts, name).geometry;
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++)
        expect(insideOutline(pos.getX(i), pos.getY(i), outline)).toBe(true);
    }
    // …and the ink fills the circle it says it does: MARK_R, to the extraction's
    // own rounding. Tight on BOTH sides — a mark that merely fits is not the
    // same as a mark that fills, and on a ball the two bounds are one question:
    // it IS its enclosing circle, so the clearance to the frame is all in the
    // radius and nowhere else.
    const reach = Math.max(
      ...DECAL_NAMES.flatMap((name) => {
        const pos = byName(parts, name).geometry.getAttribute('position');
        return Array.from({ length: pos.count }, (_, i) =>
          Math.hypot(pos.getX(i), pos.getY(i) - HEAD_Y),
        );
      }),
    );
    expect(reach).toBeGreaterThan(0.06714 - 1e-4);
    expect(reach).toBeLessThan(0.06714 + 1e-4);
  });

  it("wears the racket's own three colours, and NOT the plate's blue", () => {
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      // The sticker is drawn navy, felt green and cream on white paper. Two of
      // those survive as themselves and one cannot, which is what this pins.
      //
      // THE TRAP: the artwork's navy is (53, 78, 168) and the face plate is
      // (51, 96, 171) — the same colour at arm's length. Taken literally the
      // ring, the eyes and the smile would dissolve into the face and the mark
      // would read as a green blob. So the ink is the FRAME's navy: the darkest
      // thing on the racket, and already on it.
      expect(hexOf(byName(parts, 'racket_mark_ink'))).toBe('1b2a47');
      expect(hexOf(byName(parts, 'racket_mark_ink'))).toBe(hexOf(byName(parts, 'racket_frame')));
      expect(hexOf(byName(parts, 'racket_mark_ink'))).not.toBe(hexOf(byName(parts, 'racket_face')));
      // The eye painted back over the felt is the same ink, or it is a hole.
      expect(hexOf(byName(parts, 'racket_mark_ink_top'))).toBe(
        hexOf(byName(parts, 'racket_mark_ink')),
      );
      // The felt is the grip's lime, a shade off the artwork's own green…
      expect(hexOf(byName(parts, 'racket_mark_ball'))).toBe('a5d06f');
      expect(hexOf(byName(parts, 'racket_mark_ball'))).toBe(hexOf(byName(parts, 'racket_grip')));
      // …and the seams are the perforations' white, which is both the paper the
      // brand prints this ball on and, now, the colour of the dots punched
      // through it. That collision sank the wordmark this mark replaced — mark
      // and lattice fused into one white mass — and is right here, because a
      // tennis ball's seams ARE white and the navy outlines them either way.
      expect(hexOf(byName(parts, 'racket_mark_seam'))).toBe('ffffff');
      expect(hexOf(byName(parts, 'racket_mark_seam'))).toBe(
        hexOf(byName(parts, 'racket_perforations')),
      );
    }
  });

  it('builds the decal once per colour and shares it with every racket', () => {
    const kit = buildRacketKit('full');
    const a = partsOf(kit.create(1));
    const b = partsOf(kit.create(-1));
    for (const name of DECAL_NAMES) {
      expect(byName(b, name).geometry).toBe(byName(a, name).geometry); // same object, not a copy
      expect(byName(b, name).material).toBe(byName(a, name).material);
    }
    // Four buffers for the whole mark — not one per shape: its 12 shapes are 4
    // draw calls, one per pass, over THREE materials the racket already owns.
    const decals = a.filter((m) => m.name.startsWith('racket_mark_'));
    expect(decals).toHaveLength(4);
    expect(new Set(decals.map((m) => m.geometry)).size).toBe(4);
    expect(new Set(decals.map((m) => m.material)).size).toBe(3);
  });

  it('gives each decal ONE material, which is what makes 12 shapes 4 draw calls', () => {
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      for (const name of DECAL_NAMES) {
        const mesh = byName(parts, name);
        // ShapeGeometry emits one group per shape with an incrementing
        // materialIndex — and they are never read. WebGLRenderer's
        // projectObject and WebGLShadowMap both walk `geometry.groups` only
        // inside `if (Array.isArray(material))`, so a single material is the
        // whole reason each buffer draws as one range. This is the property
        // that carries the draw-call claim; clearing the groups would not.
        expect(Array.isArray(mesh.material)).toBe(false);
        expect(mesh.geometry.index!.count).toBeGreaterThan(0);
      }
    }
  });

  it('paints the face back to front by renderOrder, not by depth', () => {
    // The stack — plate, ink, felt + seams, the eye on top, then the plugs —
    // spans 0.42 mm at RACKET_SCALE, and one LSB of Android's 16-bit depth
    // buffer is 6.3 to 10.7 mm of world at the orbit's 46-60 m. So every one of
    // these surfaces quantises to the SAME depth and the test settles nothing:
    // order is all there is. Left to material.id (three's tiebreak) it would
    // run wrong twice over — the plate over the ink, the felt over the eye.
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      const stack = ['racket_face', ...DECAL_NAMES, 'racket_perforations'].map((name) => {
        const mesh = byName(parts, name);
        return { name, order: mesh.renderOrder, z: localBox(mesh).max.z };
      });
      // Every step forward in the stack is a step toward the camera, and never
      // a step back in renderOrder.
      for (let i = 1; i < stack.length; i++) {
        expect(stack[i]!.order).toBeGreaterThanOrEqual(stack[i - 1]!.order);
        expect(stack[i]!.z).toBeGreaterThanOrEqual(stack[i - 1]!.z - 1e-12);
      }
      // The two that material.id would have inverted, stated outright.
      expect(byName(parts, 'racket_mark_ink').renderOrder).toBeGreaterThan(
        byName(parts, 'racket_face').renderOrder,
      );
      expect(byName(parts, 'racket_mark_ink_top').renderOrder).toBeGreaterThan(
        byName(parts, 'racket_mark_ball').renderOrder,
      );
      // Felt and seams share a level in z, so they share one in order too.
      expect(byName(parts, 'racket_mark_seam').renderOrder).toBe(
        byName(parts, 'racket_mark_ball').renderOrder,
      );
      // …and the dots stay in front of everything printed on the plate.
      expect(byName(parts, 'racket_perforations').renderOrder).toBeGreaterThan(
        byName(parts, 'racket_mark_ink_top').renderOrder,
      );
    }
  });

  it('winds every plug triangle outward, walls as well as caps', () => {
    // A triangle-count test cannot see winding, and PLUG_PROUD leaves so little
    // wall standing that a back-face-culled one is invisible at the transition's
    // distance — so a wall wound inward would sit there being wrong, and lit
    // inside-out, until PLUG_PROUD or the material's `side` changed. Measured
    // against the normals the buffer itself carries.
    for (const tier of ['full', 'lite'] as const) {
      const parts = partsOf(buildRacketKit(tier).create(1));
      const g = byName(parts, 'racket_perforations').geometry;
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const idx = g.getIndex()!;
      const at = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      let disagree = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] as [
          number,
          number,
          number,
        ];
        const face = at(b)
          .sub(at(a))
          .cross(at(c).sub(at(a)));
        const vertex = new THREE.Vector3();
        for (const v of [a, b, c])
          vertex.add(new THREE.Vector3(nrm.getX(v), nrm.getY(v), nrm.getZ(v)));
        if (face.dot(vertex) <= 0) disagree++;
      }
      expect(disagree).toBe(0);
    }
  });

  it('keeps the mark out of the shadow pass', () => {
    // The decal is four flat planes 0.1 mm of model in front of a plate that
    // already casts, entirely inside that plate's outline, under a sun at
    // (6, 30, 10) — so their shadow is a subset of one already being drawn.
    // On `full` that would be four shadow-map draw calls a racket, sixteen
    // across the court every frame, for output nothing can distinguish.
    const parts = partsOf(buildRacketKit('full').create(1));
    for (const name of DECAL_NAMES) expect(byName(parts, name).castShadow).toBe(false);
    for (const name of ['racket_face', 'racket_frame', 'racket_perforations', 'racket_grip'])
      expect(byName(parts, name).castShadow).toBe(true);
    // `lite` has no shadow pass at all, so nothing casts.
    const lite = partsOf(buildRacketKit('lite').create(1));
    for (const mesh of lite) expect(mesh.castShadow).toBe(false);
  });

  it('lite drops the highlights and the collar loft for a third of the triangles', () => {
    const full = triangles(buildRacketKit('full').create(1).mount);
    const lite = triangles(buildRacketKit('lite').create(1).mount);
    expect(lite).toBeLessThan(full / 2);
    // Four of these are drawn twice a frame on `full` (scene + shadow pass).
    expect(full).toBeLessThan(14_000);
  });

  it('every geometry and material lands on the dispose list', () => {
    const kit = buildRacketKit('full');
    const rig = kit.create(1);
    const used = new Set<{ dispose(): void }>();
    rig.mount.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) used.add(m.geometry);
      if (m.material) used.add(m.material as THREE.Material);
    });
    for (const u of used) expect(kit.disposables).toContain(u);
  });
});
