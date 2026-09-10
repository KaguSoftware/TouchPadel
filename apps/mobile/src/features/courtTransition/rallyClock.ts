/**
 * HOW MUCH RALLY TIME ONE DRAWN FRAME IS WORTH.
 *
 * The court's rally is drawn from a JS `requestAnimationFrame` loop (Court3D),
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
 * The cap, in seconds: 30 fps.
 *
 * Deliberately not tighter. The phone really does render at 30 in places — the
 * `lite` quality tier, a hot device, the frames either side of a transition —
 * and a cap below the true frame interval would not merely refuse to jump the
 * rally, it would slow it down whenever the device was working hard, which is a
 * second, quieter version of the same complaint.
 */
export const MAX_STEP_S = 1 / 30;

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
