import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Android: collapse the system navigation bar (back / home / recents) while the
 * app is in front, so the app owns the whole screen.
 *
 * A hidden bar comes back on a swipe from the bottom edge as a translucent
 * overlay and then hides itself again. That used to be `setBehaviorAsync`,
 * which SDK 57 removed along with the opt-out from edge-to-edge: with the app
 * always drawing under the system bars, overlay-swipe is the only behaviour
 * left, so it is now simply what hiding the bar does.
 *
 * Android re-shows the bar on its own after certain system events (a keyboard,
 * a permission dialog, returning from background), so hiding it once at boot is
 * not enough — `useVisibility` reports every change and we push it back down.
 * The guard on 'visible' is what stops that subscription from looping.
 *
 * iOS has no navigation bar; every call here is a documented no-op there.
 */
export function useImmersiveNavBar() {
  const visibility = NavigationBar.useVisibility();
  useEffect(() => {
    if (Platform.OS !== 'android' || visibility !== 'visible') return;
    void NavigationBar.setVisibilityAsync('hidden').catch(() => {});
  }, [visibility]);
}

/**
 * ZEROES THE BOTTOM SAFE-AREA INSET, BECAUSE THIS APP HIDES THE ANDROID NAV BAR.
 *
 * The inset does NOT fall to 0 when the bar goes away. Safe-area insets come
 * from the window's `WindowInsets`, and under gesture navigation Android keeps
 * reporting the gesture inset whether or not the bar is drawn — the swipe
 * region still belongs to the system. So every consumer of `insets.bottom` went
 * on reserving a strip for a bar that is no longer there: the tab bar
 * (`TAB_BAR_BASE + insets.bottom`) grew a dead band under its items, and the
 * `24 + insets.bottom` paddings on the pushed screens left the same gap above
 * the edge.
 *
 * Fixing it at each call site would mean teaching a dozen screens about
 * navigation-bar state. This overrides the inset at the SOURCE instead: the
 * provider measures as it always did, and this re-publishes the same object
 * with `bottom: 0`, so `useSafeAreaInsets()` and `<SafeAreaView>` below it see
 * no bottom inset and every existing `+ insets.bottom` collapses on its own.
 *
 * ZEROED UNCONDITIONALLY, NOT WHILE `useVisibility()` SAYS 'hidden' — that was
 * the first attempt and it did nothing on a real phone. That hook seeds its
 * state to `null` and only leaves it when the NATIVE LISTENER FIRES A CHANGE;
 * on a normal launch the bar is already hidden before anything subscribes, no
 * change is ever emitted, and the value sits at `null` forever. Gating the
 * override on it meant the real inset stayed published and the gap survived.
 * The bar's hidden state is this app's own policy (useImmersiveNavBar keeps it
 * that way), so the layout follows the policy rather than an event that may
 * never arrive.
 *
 * The trade-off is the swipe-up overlay: while the bar is revealed it floats
 * OVER the tab bar instead of pushing it up. That is what an overlay is meant
 * to do — it is translucent, it sits above the content by design, and it hides
 * itself again a moment later. Re-publishing the real inset for those few
 * seconds would relayout the whole app twice per swipe, which is the worse
 * artefact.
 *
 * On iOS this returns children untouched, so the home-indicator inset is
 * preserved exactly as it is today.
 */
export function ImmersiveInsets({ children }: { children: React.ReactNode }) {
  useImmersiveNavBar();
  const insets = useSafeAreaInsets();

  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
