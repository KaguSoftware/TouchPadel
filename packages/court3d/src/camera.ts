/**
 * The prototype's camera as pure three.js maths (no renderer): the one
 * PerspectiveCamera recipe used by the GL scene AND by the native layers that
 * must follow the picture — the on-net button rides the projected net tape
 * exactly as the prototype recomputes `netY` every frame. Sampled into a
 * native-driver table by the Book tab, so nothing runs per frame on JS.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { BALL_RADIUS, cameraPose, type CameraPose } from './rally';
import { SPEC } from './spec';

/** The net tape: 0.9 m high, posts just inside the sidelines at x = ±4.83 m. */
export const NET = { y: 0.9, halfSpan: 4.83 } as const;

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

// ── The top view (Play and Coaches tabs) ────────────────────────────────────

/**
 * The court seen STRAIGHT DOWN and HORIZONTAL, with no pitch (Majed,
 * 2026-10-11: the Play and Coaches pages show the court from a bird's-eye view,
 * long axis left to right, net a vertical line in the middle; never the upright
 * Book court and never an angled view, which costs the GPU more for nothing).
 * Only `view: 'top'` poses its camera here (scene.ts); the Book tab's orbit
 * above and the web are untouched.
 *
 * The camera stands over the court looking down −y with its up vector on −x,
 * so on screen:
 *
 *   screen right = −z   (the court's far end, the Book's top of screen)
 *   screen up    = −x   (the far sideline)
 *   the net (z = 0) is a vertical line through the middle
 *
 * It is the Book's own camera recipe (makeCamera: the 24° vertical fov), only
 * fixed: no orbit, no progress, no lift. Two numbers frame it:
 *   · SPAN: the distance is chosen from the view's aspect so `span` metres (the
 *     20 m court, its corner posts and a little margin) fill the view's WIDTH;
 *     on a box too wide for that the court's `depth` fills its height instead.
 *   · RAISE: the Play and Coaches stages run 82 pt under the page's content
 *     plate, so the window onto the court is the stage's upper part. The camera
 *     pans so the court's centre sits `raise` (NDC) above the stage's middle —
 *     a pure pan, the picture is otherwise the same.
 */
export const TOP_VIEW = {
  /** Metres across the view's width: the court's 20 m plus its posts and a margin. */
  span: 23,
  /** Metres top to bottom the court needs at least: the 10.2 m base, the post caps the perspective spreads, a margin. */
  depth: 12.4,
  /** How far above the stage's middle the court's centre sits, in NDC. */
  raise: 0.2,
} as const;

/** The top view's camera pose for a view of this aspect (width / height). */
export function topCameraPose(aspect: number): CameraPose {
  const half = Math.tan((SPEC.camera.fov * Math.PI) / 360);
  const distance = Math.max(
    TOP_VIEW.span / 2 / (half * Math.max(aspect, 1e-3)),
    TOP_VIEW.depth / 2 / (half * (1 - TOP_VIEW.raise)),
  );
  // Pan toward +x (screen-down), which puts the court's centre `raise` above the middle.
  const pan = TOP_VIEW.raise * distance * half;
  return {
    position: { x: pan, y: distance, z: 0 },
    up: { x: -1, y: 0, z: 0 },
    lookAt: { x: pan, y: 0, z: 0 },
  };
}

/** Put a camera over the court, framed for its own aspect. */
export function poseTopCamera(camera: PerspectiveCamera): void {
  const pose = topCameraPose(camera.aspect);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.up.set(pose.up.x, pose.up.y, pose.up.z);
  camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
  camera.updateMatrixWorld();
}

/**
 * Where a point on the court lands in a width × height top view, px from the
 * view's top-left (y down). The Play tab puts a touch target over each open
 * spot (join.ts) from this, so the target and the drawn spot agree.
 */
export function projectTop(
  point: { x: number; y: number; z: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const camera = makeCamera(width / height);
  poseTopCamera(camera);
  vC.set(point.x, point.y, point.z).project(camera);
  return { x: ((vC.x + 1) / 2) * width, y: ((1 - vC.y) / 2) * height };
}

/**
 * Seen straight down a ball's height is otherwise invisible, so the top view
 * draws it bigger the higher it flies (on top of its ground disc moving off
 * it, rally.ts / drill.ts): ×1 on the turf, about ×1.3 at the top of a lob.
 */
export const TOP_BALL_GROWTH = 0.13;
export function topBallScale(y: number): number {
  return 1 + TOP_BALL_GROWTH * Math.max(0, y - BALL_RADIUS);
}
