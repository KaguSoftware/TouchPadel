/**
 * WHEN MAY THE COURT ANIMATE, AND WHEN MAY IT MERELY DRAW?
 *
 * The 3D court is a GL surface: its framebuffer keeps the last frame drawn into
 * it and changes at no other time. A React commit repaints the tree around it —
 * page, header, tab bar — but the court itself only follows once a frame is
 * rendered. So "which lifecycle states permit a draw" decides whether the court
 * matches the theme or sits in the previous one.
 *
 * Two states, not one:
 *
 *  - ANIMATING — run the rally loop. Wants the app genuinely active: nobody is
 *    watching a rally through the Control Center shade, and running it there is
 *    battery spent on an invisible animation.
 *
 *  - DRAWABLE — a one-shot redraw is worth REQUESTING. True whenever the app is
 *    on screen at all, 'inactive' included.
 *
 * A caveat that matters, because it is the whole reason Court3D also carries a
 * cover: drawable does NOT promise the frame runs promptly. iOS pauses the
 * display link at `UIApplicationWillResignActive` — the Control Center shade
 * coming down — so a request made at 'inactive' is QUEUED and executes when the
 * shade is dismissed. It is still right to request it (the frame is needed, and
 * it must not be dropped), but nothing visual may depend on it having happened:
 * that is what the stale-frame cover in Court3D.tsx is for.
 *
 * What this split does fix is the loop teardown. Gating both concerns on one
 * `active` flag meant the shade coming down stopped the loop AND made the
 * component treat its surface as dead, so the theme redraw was never even
 * requested and nothing was queued to correct the court on return.
 *
 * Pure, and separate from Court3D.tsx, so the rule is checked by tests rather
 * than by reasoning about a component that cannot be mounted under plain node
 * (it imports expo-gl and three). Same split, one layer down, as
 * theme/appearanceEvents.ts makes for the crossfade.
 */
/** RN's AppState values this cares about; anything else is treated as hidden. */
export type AppStateName = string;

/**
 * Is the app on screen at all? True for 'active' AND 'inactive' — the shade is
 * over us, but the app is still composited on screen behind it (frames are a
 * separate question; see the caveat in the header).
 */
export function isVisible(appState: AppStateName): boolean {
  return appState !== 'background';
}

/** Is the app fully frontmost, with the user actually watching? */
export function isActive(appState: AppStateName): boolean {
  return appState === 'active';
}

/**
 * May the rally loop run? Needs a built surface, the tab focused, and the app
 * frontmost — a held or hidden rally costs nothing and resumes on wake.
 */
export function canAnimate(input: {
  ready: boolean;
  focused: boolean;
  appState: AppStateName;
}): boolean {
  return input.ready && input.focused && isActive(input.appState);
}

/**
 * Is a one-shot redraw worth requesting? Same as `canAnimate` but tolerating
 * 'inactive', so a theme flip under the shade still queues the frame that
 * corrects the court. See the caveat above: the frame may not run until the
 * shade is dismissed, so this licenses the REQUEST, not the appearance.
 */
export function canDraw(input: {
  ready: boolean;
  focused: boolean;
  appState: AppStateName;
}): boolean {
  return input.ready && input.focused && isVisible(input.appState);
}
