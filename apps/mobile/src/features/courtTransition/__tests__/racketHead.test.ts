import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

/**
 * A copy of scene.ts's traced outline (the scene builds its meshes inside a
 * WebGL-bound factory, so the maths is re-stated here rather than imported).
 * Keep the coefficients in step with `headR` in scene.ts.
 */
const headR = (a: number) =>
  0.50361 +
  0.01304 * Math.cos(a) +
  0.00767 * Math.cos(2 * a) -
  0.00189 * Math.cos(3 * a) -
  0.00745 * Math.cos(4 * a);

describe('racket head outline', () => {
  it('is a near-circle, marginally longer along the handle', () => {
    // Traced off the sticker: the drawn head is essentially round, NOT the
    // teardrop the previous racket used. a = 0 is the tip, a = π the throat.
    expect(headR(0)).toBeCloseTo(0.515, 3);
    expect(headR(Math.PI / 2)).toBeCloseTo(0.488, 3);
    expect(headR(Math.PI)).toBeCloseTo(0.493, 3);
    // The whole outline stays within ±4% of its mean radius — that near-
    // circularity is the point, and a fitting slip would show up as a lobe.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 720; i++) {
      const r = headR((i / 720) * Math.PI * 2);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(hi).toBeCloseTo(0.523, 3);
    expect(lo).toBeCloseTo(0.487, 3);
    expect((hi - lo) / 2 / ((hi + lo) / 2)).toBeLessThan(0.04);
  });

  it('is no longer monotonic from tip to throat', () => {
    // The teardrop shrank all the way from tip to throat. This one does not:
    // it bulges just off the tip (max at a ≈ 0.63) before easing back, so a
    // monotonic assertion would now be wrong.
    const vals = Array.from({ length: 201 }, (_, i) => headR((i / 200) * Math.PI));
    const mono = vals.every((v, i) => i === 0 || v < vals[i - 1]!);
    expect(mono).toBe(false);
  });

  it('lays 33 studs on the traced grid, clear of the band', () => {
    // The dot field is its own traced grid — a staggered diamond cut to a
    // radius of its own, not derived from the bed outline.
    const PITCH = 0.0942;
    const CZ = -0.047;
    let n = 0;
    for (let row = -3; row <= 3; row++) {
      const z = CZ + row * PITCH;
      for (let col = -3; col <= 3; col++) {
        const x = (col + (row % 2 === 0 ? 0 : 0.5)) * PITCH;
        if (Math.hypot(x, z - CZ) > 0.309) continue;
        n++;
        // Every dot sits on the bed (which reaches 0.8 of the outline) with
        // its full width clear of the band, leaving the drawn bare margin.
        const a = Math.atan2(x, -z);
        expect(Math.hypot(x, z) + 0.0257).toBeLessThan(headR(a) * 0.8);
      }
    }
    expect(n).toBe(33);
  });

  it('the frame band and bed build as real geometry', () => {
    const SEG = 64;
    const headPt = (a: number, scale = 1) => {
      const r = headR(a) * scale;
      return new THREE.Vector2(Math.sin(a) * r, -Math.cos(a) * r);
    };
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < SEG; i++) {
      const p = headPt((i / SEG) * Math.PI * 2, 0.897);
      pts.push(new THREE.Vector3(p.x, 0, p.y));
    }
    const band = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), SEG, 0.052, 14, true);
    band.computeBoundingBox();
    const bb = band.boundingBox!;
    expect(Number.isFinite(bb.min.x)).toBe(true);
    // Flat in y (the band's thickness), wide across x and z.
    expect(bb.max.y - bb.min.y).toBeCloseTo(0.104, 2);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(0.85);
    // The band's outer wall lands on the traced outline: 0.897 + 0.052 ≈ 0.95
    // of it, so the silhouette is the drawing's, not the centreline's.
    expect(0.897 * headR(0) + 0.052).toBeCloseTo(headR(0), 1);

    const shape = new THREE.Shape();
    for (let i = 0; i <= SEG; i++) {
      const p = headPt((i / SEG) * Math.PI * 2, 0.8);
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    }
    const bed = new THREE.ExtrudeGeometry(shape, {
      depth: 0.06,
      bevelEnabled: false,
      curveSegments: SEG,
    });
    expect(bed.attributes.position!.count).toBeGreaterThan(100);
  });
});
