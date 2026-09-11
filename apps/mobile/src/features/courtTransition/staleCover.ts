/**
 * THE STALE-FRAME COVER's state machine.
 *
 * The court is a GL surface, and expo-gl refuses to present one while the app is
 * not active: `EXGLContext.mm` observes `UIApplicationWillResignActive` — which
 * fires the instant the Control Center shade opens — sets `_appIsBackgrounded`,
 * and from then until `DidBecomeActive` its `flush` returns immediately. The
 * draw calls still run; nothing reaches the screen.
 *
 * So while the shade is down the court band shows whatever was last PRESENTED,
 * which after a theme flip is the previous palette — measured off the reported
 * video as #eff4e9 (white) sitting in a page that had already gone #172C4F.
 * That cannot be fixed by drawing harder. The court's own picture genuinely
 * cannot change until the shade closes.
 *
 * What CAN be right immediately is the colour of that region, because a plain
 * React view flips on the commit like everything else. So a cover in the new
 * page colour goes over the surface the moment the theme changes, and comes off
 * only once a frame has actually been PRESENTED in the new palette.
 *
 * The subtlety this module exists to pin down, and the bug that survived three
 * attempts: "a frame was drawn" is not the same as "a frame was presented".
 * Clearing the cover when `endFrameEXP` returns is wrong, because under the
 * shade that call is a no-op — the cover came off over a framebuffer still
 * holding the old palette, which is exactly the white band the video shows.
 * A frame only counts while the app is active.
 *
 * CALLED FROM EXACTLY ONE PLACE: `renderFrame` in components/Court3D.tsx,
 * immediately after the court surface's `endFrameEXP`. If nothing imports
 * `frameRepaints`, that call has been lost — it was, in the merge afe7f57
 * (2026-09-09), and the cover then stayed up forever after any theme flip. The
 * test alongside this file reads Court3D.tsx and fails when the call is gone.
 */

/** What the component knows when it is deciding whether to cover the court. */
export interface CoverInput {
  /** The last presented frame's palette disagrees with the current theme. */
  stale: boolean;
  /** RN's AppState. Only 'active' can present a GL frame. */
  appState: string;
}

/** Does a frame rendered right now actually reach the screen? */
export function framePresents(appState: string): boolean {
  return appState === 'active';
}

/**
 * Should `renderFrame` treat the frame it just issued as having repainted the
 * court? Only when the app is active — otherwise expo-gl dropped it and the
 * surface still holds the old palette, cover or no cover.
 */
export function frameRepaints(input: { repaintPending: boolean; appState: string }): boolean {
  return input.repaintPending && framePresents(input.appState);
}

/**
 * Must the cover be up? True whenever the surface disagrees with the theme —
 * including, crucially, for the whole time the shade is down, since no frame
 * can resolve the disagreement there.
 */
export function coverRequired(input: CoverInput): boolean {
  return input.stale;
}

/**
 * What the court REGION shows, as a colour role, for a given state. The point
 * of the fix in one function: under the shade the region reads as the new page
 * colour rather than as the old surface.
 */
export function courtRegionShows(input: CoverInput): 'new-page-colour' | 'stale-surface' {
  return coverRequired(input) ? 'new-page-colour' : 'stale-surface';
}
