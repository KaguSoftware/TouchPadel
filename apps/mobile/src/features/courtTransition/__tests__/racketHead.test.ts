import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

const headR = (a: number) => 0.395 + 0.065 * Math.cos(a) - 0.012 * Math.cos(2 * a);

describe('racket head outline', () => {
  it('is a teardrop: broad at the tip, pinched at the throat', () => {
    expect(headR(0)).toBeCloseTo(0.448, 3);        // tip
    expect(headR(Math.PI)).toBeCloseTo(0.318, 3);  // throat
    expect(headR(Math.PI / 2)).toBeCloseTo(0.407, 3); // sides
    // monotonic from tip to throat, so no lumps in the silhouette
    for (let i = 0; i < 40; i++) {
      expect(headR(((i + 1) / 40) * Math.PI)).toBeLessThan(headR((i / 40) * Math.PI));
    }
  });

  it('every hole lands inside the bed', () => {
    const PITCH = 0.1;
    let n = 0;
    for (let row = -4; row <= 4; row++) {
      const z = row * PITCH;
      for (let col = -4; col <= 4; col++) {
        const x = (col + (row % 2 === 0 ? 0 : 0.5)) * PITCH;
        const a = Math.atan2(x, -z);
        if (Math.hypot(x, z) > headR(a) - 0.1) continue;
        n++;
        // clear of the frame wall (bed runs to 0.98 of the outline)
        expect(Math.hypot(x, z) + 0.034).toBeLessThan(headR(a) * 0.98);
      }
    }
    // the sticker's face carries ~30 studs; keep the grid in that range
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n).toBeLessThanOrEqual(36);
  });

  it('the bed and frame build as real geometry', () => {
    const SEG = 64;
    const headPt = (a: number, scale = 1) => {
      const r = headR(a) * scale;
      return new THREE.Vector2(Math.sin(a) * r, -Math.cos(a) * r);
    };
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < SEG; i++) {
      const p = headPt((i / SEG) * Math.PI * 2);
      pts.push(new THREE.Vector3(p.x, 0, p.y));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), SEG, 0.105, 12, true);
    tube.computeBoundingBox();
    const bb = tube.boundingBox!;
    expect(Number.isFinite(bb.min.x)).toBe(true);
    // the tube is flat-ish in y (the frame's thickness), wide in x/z
    expect(bb.max.y - bb.min.y).toBeCloseTo(0.21, 1);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(0.7);

    const shape = new THREE.Shape();
    for (let i = 0; i <= SEG; i++) {
      const p = headPt((i / SEG) * Math.PI * 2, 0.98);
      if (i === 0) shape.moveTo(p.x, p.y);
      else shape.lineTo(p.x, p.y);
    }
    const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false, curveSegments: SEG });
    expect(ex.attributes.position!.count).toBeGreaterThan(100);
  });
});
