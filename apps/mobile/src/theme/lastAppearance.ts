/**
 * The appearance preference the app last resolved — readable from OUTSIDE the
 * React tree, for the two fallback screens in app/_layout.tsx (a crash on a
 * dark-mode install must not come up light and flip the OS scheme). Set by the
 * boot hook and by every change in Settings.
 *
 * Two values, deliberately: the PREFERENCE ('automatic' included) is what gets
 * remembered, and `lastKnownAppearance()` resolves it against the device scheme
 * at the moment it is asked. Storing the resolved value instead would freeze an
 * automatic install into whichever scheme the device happened to be in at boot.
 */
import { Appearance as NativeAppearance } from 'react-native';

/** What the user picked. */
export type AppearancePreference = 'light' | 'dark' | 'automatic';
/** What actually gets painted. Never 'automatic'. */
export type AppearanceName = 'light' | 'dark';

let current: AppearancePreference = 'light';

/**
 * The device's own light/dark setting. Defaults to light when the OS reports
 * nothing (`null` before the first native read, and on platforms with no
 * scheme at all) — the app's own default, so an unknown device scheme looks
 * like a fresh install rather than a dark flash.
 */
export function deviceAppearance(): AppearanceName {
  try {
    return NativeAppearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Resolve a preference to the scheme it paints as, now. */
export function resolveAppearance(preference: AppearancePreference): AppearanceName {
  return preference === 'automatic' ? deviceAppearance() : preference;
}

export function rememberAppearance(preference: AppearancePreference): void {
  current = preference;
}

export function lastKnownPreference(): AppearancePreference {
  return current;
}

export function lastKnownAppearance(): AppearanceName {
  return resolveAppearance(current);
}
