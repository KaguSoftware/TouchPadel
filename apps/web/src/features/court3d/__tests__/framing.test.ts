import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { makeCamera, poseCamera } from '@touch/court3d/camera';
import { FRAME_MARGIN, frameCourt } from '../framing';
import { K_FROM, K_TO } from '../progress';

/** The court's outer box, as framing.ts measures it. */
const corners = () => {
  const out: Vector3[] = [];
  for (const x of [-5.8, 5.8]) for (const z of [-10.8, 10.8]) for (const y of [-0.36, 4.08]) out.push(new Vector3(x, y, z));
  return out;
};

/** The projected box's extent in NDC through the camera as framed. */
function extent(w: number, h: number, k: number) {
  const cam = makeCamera(w / h);
  frameCourt(cam, k, w, h);
  poseCamera(cam, k);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of corners()) {
    const n = c.project(cam);
    x0 = Math.min(x0, n.x);
    x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y);
    y1 = Math.max(y1, n.y);
  }
  return { x0, x1, y0, y1 };
}

// The desktop and phone court boxes (320:396, 357 × 442) and a squarer 4:5.
const BOXES = [
  [544, 673],
  [357, 442],
  [400, 500],
] as const;

describe('frameCourt: the court fills its box at every pitch the site shows', () => {
  for (const [w, h] of BOXES) {
    it(`${w} × ${h}: centred, inside the margin, and touching it on the binding side`, () => {
      for (let k = K_FROM; k <= K_TO + 1e-9; k += 0.05) {
        const e = extent(w, h, k);
        for (const edge of [e.x0, e.x1, e.y0, e.y1]) {
          expect(Math.abs(edge)).toBeLessThanOrEqual(FRAME_MARGIN + 1e-6);
        }
        // Centred: equal air on both sides of each axis.
        expect(e.x0 + e.x1).toBeCloseTo(0, 6);
        expect(e.y0 + e.y1).toBeCloseTo(0, 6);
        // Filled: the binding side reaches the margin, so no box is left half empty.
        expect(Math.max(e.x1, e.y1)).toBeCloseTo(FRAME_MARGIN, 6);
      }
    });
  }
});
