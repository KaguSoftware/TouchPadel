/**
 * The prototype's camera as pure three.js maths (no renderer): the one
 * PerspectiveCamera recipe used by the GL scene AND by the native layers that
 * must follow the picture — the on-net button rides the projected net tape
 * exactly as the prototype recomputes `netY` every frame. Sampled into a
 * native-driver table by the Book tab, so nothing runs per frame on JS.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraPose } from './rally';
import { SPEC } from './spec';

/** The net tape: 0.9 m high, posts at x = ±5.15 m. */
export const NET = { y: 0.9, halfSpan: 5.15 } as const;

export function makeCamera(aspect: number): PerspectiveCamera {
  return new PerspectiveCamera(SPEC.camera.fov, aspect, 5, 200);
}

/** Put the camera on its orbit at eased pitch progress k. */
export function poseCamera(camera: PerspectiveCamera, k: number): void {
  const pose = cameraPose(k);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  camera.updateMatrixWorld();
}

export interface NetProjection {
  /** Tape centre, px from the viewport's top-left (y down). */
  centreX: number;
  centreY: number;
  /** Post to post, px. */
  width: number;
}

const vL = new Vector3();
const vR = new Vector3();
const vC = new Vector3();

/** Where the net tape lands in a width × height viewport at eased pitch progress k. */
export function projectNet(
  k: number,
  width: number,
  height: number,
  camera: PerspectiveCamera = makeCamera(width / height),
): NetProjection {
  if (camera.aspect !== width / height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  poseCamera(camera, k);
  vL.set(-NET.halfSpan, NET.y, 0).project(camera);
  vR.set(NET.halfSpan, NET.y, 0).project(camera);
  vC.set(0, NET.y, 0).project(camera);
  const x = (ndc: number) => ((ndc + 1) / 2) * width;
  const y = (ndc: number) => ((1 - ndc) / 2) * height;
  return { centreX: x(vC.x), centreY: y(vC.y), width: x(vR.x) - x(vL.x) };
}

/**
 * The far end of the court as the camera sees it at rest: the fence top
 * (y 4, z −10) and the base slab's far edge (z −10.7), whichever lands higher.
 */
const FAR_EDGE = [
  { x: 0, y: 4, z: -10 },
  { x: 0, y: 0, z: -10.7 },
] as const;

/**
 * The blank band above the court at rest, as a fraction of the viewport's
 * height (the 24° fov is vertical, so it is the same for every aspect). The
 * Book tab starts the GL box that far above the stage so the court's far wall
 * sits just under the title instead of floating below a band of page colour.
 */
export function courtTopFraction(): number {
  const camera = makeCamera(390 / 844);
  poseCamera(camera, 0);
  let top = 1;
  for (const p of FAR_EDGE) {
    vC.set(p.x, p.y, p.z).project(camera);
    top = Math.min(top, (1 - vC.y) / 2);
  }
  return top;
}
