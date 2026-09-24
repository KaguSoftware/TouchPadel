import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { makeCamera, poseCamera } from '../camera';
import { applyFit, FIT_MARGIN, fitZoom } from '../framing';
import { pitchEase } from '../spec';
import { SCROLL_P_MAX } from '../progress';

const corners = () => {
  const out: Vector3[] = [];
  for (const x of [-5.8, 5.8]) for (const z of [-10.8, 10.8]) for (const y of [-0.36, 4.08]) out.push(new Vector3(x, y, z));
  return out;
};

describe('fitting the court into the stage box', () => {
  it('never zooms in past the phone framing', () => {
    // A very wide box: the court is height-bound and small, and stays so.
    expect(fitZoom(makeCamera(16 / 9), 0)).toBe(1);
  });

  it('leaves the top-down court alone in the hero boxes (4:5 and 3:4)', () => {
    expect(fitZoom(makeCamera(4 / 5), 0)).toBe(1);
    expect(fitZoom(makeCamera(3 / 4), 0)).toBe(1);
  });

  for (const aspect of [4 / 5, 3 / 4, 390 / 844]) {
    it(`keeps every corner inside the margins while pitching (aspect ${aspect.toFixed(2)})`, () => {
      const ease = pitchEase(1, 0);
      for (let p = 0; p <= SCROLL_P_MAX + 1e-9; p += 0.05) {
        const k = ease(p);
        const cam = makeCamera(aspect);
        applyFit(cam, k);
        poseCamera(cam, k);
        for (const c of corners()) {
          const n = c.clone().project(cam);
          expect(Math.abs(n.x)).toBeLessThanOrEqual(FIT_MARGIN.x + 1e-6);
          expect(Math.abs(n.y)).toBeLessThanOrEqual(FIT_MARGIN.y + 1e-6);
        }
      }
    });
  }

  it('zooms out once the pitched court is wider than the box', () => {
    const k = pitchEase(1, 0)(SCROLL_P_MAX);
    expect(fitZoom(makeCamera(4 / 5), k)).toBeLessThan(1);
  });

  it('restores the zoom it found (a pure measurement)', () => {
    const cam = makeCamera(4 / 5);
    cam.zoom = 0.8;
    cam.updateProjectionMatrix();
    fitZoom(cam, 0.9);
    expect(cam.zoom).toBe(0.8);
  });
});
