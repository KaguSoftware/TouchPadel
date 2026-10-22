/**
 * The points card's lean from the phone's own movement (Majed, 2026-10-22), as pure arithmetic so
 * vitest can hold it without a device. PointsCard feeds it the gyroscope; nothing here imports
 * react-native or expo.
 *
 * WHY THE GYROSCOPE AND NOT DEVICE MOTION. expo-sensors' DeviceMotion names its axes differently
 * per platform (its iOS `rotationRate.alpha` is the z rate, its Android one the x rate) and its
 * attitude angles come from two different conventions. The plain Gyroscope is the platforms' own
 * reading on both (CMGyroData, TYPE_GYROSCOPE): rad/s about the device's axes, x to the right, y
 * up the screen, z out of it toward the face, counter-clockwise positive. It also starts without a
 * permission prompt on iOS (CMMotionManager; only the pedometer asks).
 *
 * WHAT IT DOES WITH IT. The lean is the turn the card has not caught up with yet: each reading
 * adds the turn since the last one, and the lean leaks back to rest over about half a second.
 * So the card answers MOVEMENT and settles while the phone is held still, at whatever angle; no
 * resting angle has to be guessed. It leans against the turn, as a card with weight would in a
 * holder: turn the phone's right edge away and the card's right edge comes toward you.
 *
 * The output is in the card's lean units, the same -1..1 a finger gives: x > 0 lowers the right
 * edge, y > 0 lowers the bottom edge.
 */

export interface CardLean {
  x: number;
  y: number;
}

export const LEAN_REST: CardLean = { x: 0, y: 0 };

/** A turn of about 17 degrees, made faster than the leak, leans the card all the way. */
const GAIN_PER_RAD = 3.3;
/** How quickly the lean returns to rest, in seconds (the time to fall to about 37%). */
const LEAK_S = 0.5;
/** Below this rate (rad/s) a reading is the sensor's noise, not a hand. */
const NOISE_RAD_S = 0.015;
/** The longest gap between readings counted as one step; longer (a stall) counts as this. */
const MAX_STEP_S = 0.1;

// `+ 0` turns a -0 into 0, so a card at rest is exactly LEAN_REST.
const clamp = (v: number) => Math.max(-1, Math.min(1, v)) + 0;
const quiet = (rate: number) => (Math.abs(rate) < NOISE_RAD_S ? 0 : rate);

/**
 * One gyroscope reading folded into the lean. `rate` is the reading's x and y in rad/s, `dt` the
 * seconds since the last one.
 */
export function stepLean(prev: CardLean, rate: { x: number; y: number }, dt: number): CardLean {
  const step = Math.max(0, Math.min(MAX_STEP_S, Number.isFinite(dt) ? dt : 0));
  const keep = Math.exp(-step / LEAK_S);
  // About y (the turn that swings the right edge away, positive): the card's right edge comes
  // toward the face, a negative x. About x (the top edge toward the face, positive): the card's
  // top edge goes away, which is a negative y on the card's scale.
  return {
    x: clamp(prev.x * keep - quiet(rate.y) * step * GAIN_PER_RAD),
    y: clamp(prev.y * keep - quiet(rate.x) * step * GAIN_PER_RAD),
  };
}
