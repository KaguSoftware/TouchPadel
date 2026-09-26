/**
 * Fill the stage box with the court, at any aspect and any pitch.
 *
 * The phone's camera (@touch/court3d spec.ts: 24° vertical fov, 60 → 46 m, a
 * look-at that drifts toward the near end) was framed for one tall screen, with
 * room for a header above and a sheet below. On the site the court is the whole
 * picture in its box, so `frameCourt` measures the court's outer box through the
 * posed camera and then:
 *
 *  - zooms until that box meets the margin on its binding side (in OR out: there
 *    is no cap at the phone's framing), and
 *  - re-centres it with a view offset, so the off-centre look-at leaves no empty
 *    band on one side.
 *
 * The camera's position and orientation are untouched: only the projection moves
 * (zoom + setViewOffset), so projectNet, which reads the projection, still puts
 * "Book a court" on the tape.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { poseCamera } from '@touch/court3d/camera';

/** The court's outer box, metres: base slab ±5.7 × ±10.7 (+ post caps), slab bottom to cage caps. */
const BOUNDS = { x: 5.8, z: 10.8, yLow: -0.36, yHigh: 4.08 } as const;

/** Largest |NDC| the box may reach on its binding side: 3 % of air at each edge. */
export const FRAME_MARGIN = 0.94;

const v = new Vector3();

/**
 * Frame the court in a w × h box at pitch k: sets the camera's aspect, zoom and
 * view offset and updates its projection. Returns the zoom it chose.
 */
export function frameCourt(camera: PerspectiveCamera, k: number, w: number, h: number): number {
  camera.clearViewOffset();
  camera.aspect = w / h;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  poseCamera(camera, k);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const x of [-BOUNDS.x, BOUNDS.x]) {
    for (const z of [-BOUNDS.z, BOUNDS.z]) {
      for (const y of [BOUNDS.yLow, BOUNDS.yHigh]) {
        v.set(x, y, z).project(camera);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
    }
  }
  const zoom = Math.min((2 * FRAME_MARGIN) / (x1 - x0), (2 * FRAME_MARGIN) / (y1 - y0));
  if (!(Number.isFinite(zoom) && zoom > 0)) return 1;
  // The box's centre, in NDC at zoom 1; zoom scales NDC about the view centre.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  camera.zoom = zoom;
  // setViewOffset shifts the window in px of the full view (x right, y down), and
  // updates the projection itself.
  camera.setViewOffset(w, h, (cx * zoom * w) / 2, (-cy * zoom * h) / 2, w, h);
  return zoom;
}
