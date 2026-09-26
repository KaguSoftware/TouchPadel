/**
 * WHAT TO DO when the device scheme or the app's lifecycle moves — decided as
 * pure functions so the transition that actually broke can be tested.
 *
 * The bug this exists to prevent: a system appearance change fires while the app
 * is BACKGROUNDED (changing it means Control Center or Settings), and the
 * crossfade awaits an `Animated.timing` that cannot advance there, so the theme
 * commit behind it never ran and the app came back half-flipped. The fix is a
 * branch — crossfade only when someone is watching, commit outright otherwise —
 * plus a reconcile on return for the case where the OS delivers no event at all.
 *
 * That branch is the whole correctness story, and inline in the provider it
 * needed a renderer to exercise. Here it is a function of (preference, device
 * scheme, painted scheme, app state) → an action, so every path the phone can
 * take is a table entry in appearanceEvents.test.ts.
 */
import type { AppearanceName, AppearancePreference } from './lastAppearance';

/** What the provider should do in response to an event. */
export type AppearanceAction =
  /** Nothing to do: not following the device, or already painting the right scheme. */
  | { type: 'none' }
  /** Someone is watching: dissolve from the current scheme to `appearance`. */
  | { type: 'crossfade'; appearance: AppearanceName }
  /** No one is watching (or nothing to watch): commit `appearance` outright. */
  | { type: 'apply'; appearance: AppearanceName };

export interface AppearanceEventInput {
  /** What the user picked. Only 'automatic' follows the device. */
  preference: AppearancePreference;
  /** The device's scheme, read through any pin (see deviceAppearance). */
  device: AppearanceName;
  /** The scheme currently painted. */
  painted: AppearanceName;
  /** RN's AppState at the moment of the event. */
  appState: string;
}

/**
 * The OS told us the device scheme changed.
 *
 * Backgrounded → apply, never crossfade: the animation cannot advance, so a
 * dissolve started here would strand the cover and block the commit. Foreground
 * → crossfade, which is the transition the design asks for.
 *
 * Note this does NOT bail when `device === painted`. Getting the event at all
 * means the device moved, and the provider still has to record the commit —
 * a same-scheme event is reported as 'none' only because there is nothing to
 * repaint, which is the caller's cue to skip the visual work, not the state.
 */
export function onDeviceSchemeChange(input: AppearanceEventInput): AppearanceAction {
  if (input.preference !== 'automatic') return { type: 'none' };
  if (input.device === input.painted) return { type: 'none' };
  // ANYTHING BUT 'active' COMMITS OUTRIGHT — and that includes 'inactive', the
  // Control Center shade, which is where this change is actually reported.
  //
  // It is tempting to crossfade under the shade, since the app is still on
  // screen there and the dissolve would be visible. It does not work: the
  // crossfade awaits an `Animated.timing`, which is driven by
  // `requestAnimationFrame`, and rAF does not advance while the app is not
  // active. The commit that flips the palette sits behind a fade that never
  // finishes, so NOTHING changes until the shade is dismissed — the whole app,
  // not just the court, arrives late. Cutting instead means the React tree is
  // already in the new palette while the shade is still down.
  //
  // The court is a separate problem with the same shape, and it is not solved
  // here: its picture lives in a GL framebuffer that expo-gl refuses to flush
  // while the app is not active (`_appIsBackgrounded` in EXGLContext.mm), so it
  // cannot repaint under the shade at any cost. Court3D covers it with a plain
  // React view in the new page colour for exactly that window — which only
  // works because this commit lands promptly, giving that cover the new colour
  // to paint. See the `stale` flag in components/Court3D.tsx.
  if (input.appState !== 'active') return { type: 'apply', appearance: input.device };
  return { type: 'crossfade', appearance: input.device };
}

/**
 * The app became active again.
 *
 * The reconcile: whatever happened while we were away — an event we could not
 * act on, an event the OS coalesced, or a scheme that changed with no event at
 * all because we were suspended — the device is the truth on return. Commit
 * outright rather than crossfading: the change happened off-screen, so there is
 * no transition to show; the app should simply already be right on the first
 * frame back.
 */
export function onForeground(input: AppearanceEventInput): AppearanceAction {
  if (input.appState !== 'active') return { type: 'none' };
  if (input.preference !== 'automatic') return { type: 'none' };
  if (input.device === input.painted) return { type: 'none' };
  return { type: 'apply', appearance: input.device };
}
