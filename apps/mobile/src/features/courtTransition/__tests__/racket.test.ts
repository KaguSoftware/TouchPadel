import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRacketKit, HOLE_CENTRES } from '../racket';
import { HEAD_ARM, PIVOT_Y, RACKET_SCALE } from '../swing';

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
      const rig = buildRacketKit(tier).create(1);
      const body = rig.lay.children[0]!.children[0]!;
      const meshes = body.children as THREE.Mesh[];
      const white = meshes.filter(
        (m) => (m.material as THREE.MeshStandardMaterial).color.getHexString() === 'ffffff',
      );
      // ONE mesh for the lot: a mesh per hole would be 30-odd extra draw calls
      // per racket, four times over, every frame.
      expect(white).toHaveLength(1);
      const plugs = white[0]!.geometry;
      const face = meshes.find(
        (m) => (m.material as THREE.MeshStandardMaterial).color.getHexString() === '3360ab',
      )!.geometry;
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

  it('the rows widen to the sweet spot and back, evenly on both sides', () => {
    // The design tapers the lower half twice as fast as the outline does, which
    // leaves rows 2-4 up from the throat visibly bare and makes the counts
    // zig-zag 3, 4, 3, 4. Both halves read the outline now.
    const rows = new Map<number, number>();
    for (const [, y] of HOLE_CENTRES) rows.set(+y.toFixed(6), (rows.get(+y.toFixed(6)) ?? 0) + 1);
    const counts = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
    expect(counts).toEqual([4, 5, 6, 7, 6, 5, 4]);
    // Every row centred on the face's own centre line.
    for (const [y, n] of rows) {
      const xs = HOLE_CENTRES.filter(([, hy]) => +hy.toFixed(6) === y).map(([x]) => x);
      expect(xs).toHaveLength(n);
      expect(xs.reduce((a, b) => a + b, 0) / n).toBeCloseTo(0, 9);
    }
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
