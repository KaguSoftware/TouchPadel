/**
 * The React Native root is pinned LEFT-TO-RIGHT, permanently.
 *
 * Layout direction in this app is application state (src/i18n/direction.tsx):
 * a `direction` style on the root view mirrors the whole Yoga tree the moment
 * the language changes, with no reload, no restart. The native flag
 * (`I18nManager`) would only add a second, boot-time notion of direction that
 * the running bundle cannot even observe — `I18nManager.isRTL` is captured
 * once when the JS loads — and that, when RTL, makes Fabric rewrite every
 * physical `left`/`right` style into start/end for the whole surface. Two
 * render models for one language is exactly the class of bug this replaces.
 * So the flag is held at LTR on every launch:
 *
 *  - Standalone builds: app.config.ts passes `supportsRTL: false` to
 *    expo-localization, whose OnCreate writes RCTI18nUtil_allowRTL=false
 *    (and, on iOS, RCTI18nUtil_forceRTL=false) BEFORE React loads —
 *    deterministic, no race with the surface's first sample.
 *  - This function writes all three preferences from JS as the bundle's first
 *    act (index.js): the whole job in Expo Go (no Info.plist keys there), and
 *    on Android the retirement of the `forceRTL(true)` older builds of this
 *    app persisted, which the plugin does not touch (see app.config.ts).
 *
 * The left/right swap flag goes off as well, so `left` means left everywhere
 * (only the decorative court art uses physical offsets — see LtrIsland).
 *
 * THIS IS THE ONLY FILE THAT MAY IMPORT I18nManager (lint: no-restricted-imports).
 */
import { I18nManager } from 'react-native';

export function pinNativeRootLtr(): void {
  try {
    I18nManager.swapLeftAndRightInRTL(false);
    I18nManager.allowRTL(false);
    I18nManager.forceRTL(false);
  } catch {
    // No native module here (unit tests): nothing to pin.
  }
}
