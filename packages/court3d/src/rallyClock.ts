/**
 * HOW MUCH RALLY TIME ONE DRAWN FRAME IS WORTH.
 *
 * The court's rally is drawn from a JS `requestAnimationFrame` loop (apps/mobile Court3D),
 * on the same thread React commits on. So anything expensive the Book tab does
 * — mounting the booking sheet, rebuilding the time grid for a new day, a GC
 * pause — is time the loop does not get, and the rally misses frames.
 *
 * Missing frames is not the bug. The bug was what happened NEXT. The rally read
 * its time straight off the wall clock (`t = (now − start) / 1000`), so the
 * first frame after a 200 ms block did not resume the animation, it CAUGHT IT
 * UP: 200 ms of flight, swing and bounce applied in a single step, with the
 * ball and all four rackets snapping to where they would have been. A pause
 * people barely notice; a teleport they do (owner, 2026-09-10: changing dates
 * "stops the background padel game animation … looks really glitchy").
 *
 * The fix is to stop treating the wall clock as the authority. The rally is a
 * decorative loop synchronised to nothing — no score, no sound, no other layer
 * reads its time — so it may simply run slow for a moment. `advance` therefore
 * accumulates per frame and CAPS the step: a frame that arrives late costs the
 * animation the frames it missed and moves the picture on by one ordinary step,
 * so it plays on from where the eye last saw it.
 *
 * That leaves the court a fraction of a second "behind" real time after a
 * hitch, and permanently so. Nothing observes that. What it buys is that no
 * amount of JS-thread contention can ever produce a jump — including the ones
 * this file cannot fix, on devices slower than the ones we test on.
 *
 * Pure and separate from Court3D.tsx so the rule is checked by tests rather
 * than by reasoning about a component that cannot be mounted under plain node
 * (it imports expo-gl and three), exactly as surfaceState.ts is.
 */

/**
 * The cap, in seconds: 15 fps.
 *
 * Deliberately not tighter. It was 1/30, and a cap below the true frame
 * interval does not merely refuse to jump the rally, it slows it down whenever
 * the device is working hard: the Play build on a mid-range Android phone drew
 * the court at 20–30 fps, so every frame was capped and the whole rally played
 * at two thirds of its speed (screen recording, 2026-10-11: "court 3d is so
 * slow"). At 1/15 anything down to 15 fps plays at real time, and a 200 ms
 * block still moves the picture on by one 15 fps step — a dropped frame, not
 * the teleport this file exists to prevent.
 */
export const MAX_STEP_S = 1 / 15;

/**
 * The rally time to draw this frame.
 *
 * `sincePrevMs` is the wall-clock interval since the last frame that was
 * actually DRAWN, or null when there is no such frame to measure from — the
 * first frame of all, and the first after any stop (the idle hold, leaving the
 * tab, backgrounding). Null advances nothing: the rally was not on screen for
 * that interval and must not be billed for it.
 */
export function advance(t: number, sincePrevMs: number | null, maxStepS = MAX_STEP_S): number {
  if (sincePrevMs === null) return t;
  // A negative interval means the clock went backwards under us; treat it as no
  // time passing rather than running the rally in reverse.
  const step = Math.max(0, Math.min(sincePrevMs / 1000, maxStepS));
  return t + step;
}
