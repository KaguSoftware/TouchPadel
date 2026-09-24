/**
 * WEB ONLY (not a copy): keep the whole court inside a box of any aspect.
 *
 * The phone's camera (spec.ts: 24° vertical fov, 60 → 46 m) was framed for one
 * tall screen. On the site the stage is a 4:5 or 3:4 box, and the fov is
 * vertical, so the top-down court is height-bound (84 % of the box) and fine,
 * but once the camera pitches the near corners swing wide: at k ≈ 0.9 the court
 * is ~1.3 box-widths across a 3:4 box and its near corner is cut off.
 *
 * `fitZoom` measures the court's bounding box through the posed camera and
 * returns the PerspectiveCamera.zoom (≤ 1: never closer than the phone) that
 * keeps every corner inside the margins. It zooms about the view centre, so the
 * court stays where the phone puts it and only recedes as far as it must.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { poseCamera } from './camera';

/** The court's outer box, metres: base slab ±5.7 × ±10.7 (+ post caps), slab bottom to cage caps. */
const BOUNDS = { x: 5.8, z: 10.8, yLow: -0.36, yHigh: 4.08 } as const;

/** Largest |NDC| a corner may reach: a little air at the sides; top/bottom as the phone frames it. */
export const FIT_MARGIN = { x: 0.94, y: 0.99 } as const;

const v = new Vector3();

/** The zoom that fits the court at eased pitch k for the camera's current aspect. */
export function fitZoom(camera: PerspectiveCamera, k: number): number {
  const prevZoom = camera.zoom;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  poseCamera(camera, k);
  let maxX = 0;
  let maxY = 0;
  for (const x of [-BOUNDS.x, BOUNDS.x]) {
    for (const z of [-BOUNDS.z, BOUNDS.z]) {
      for (const y of [BOUNDS.yLow, BOUNDS.yHigh]) {
        v.set(x, y, z).project(camera);
        maxX = Math.max(maxX, Math.abs(v.x));
        maxY = Math.max(maxY, Math.abs(v.y));
      }
    }
  }
  camera.zoom = prevZoom;
  camera.updateProjectionMatrix();
  const zoom = Math.min(1, FIT_MARGIN.x / maxX, FIT_MARGIN.y / maxY);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** Apply fitZoom to the camera (updates its projection only when it changes). */
export function applyFit(camera: PerspectiveCamera, k: number): number {
  const zoom = fitZoom(camera, k);
  if (Math.abs(camera.zoom - zoom) > 1e-4) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  return zoom;
}
