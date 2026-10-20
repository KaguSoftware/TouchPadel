/**
 * EVERYTHING THE BACK BUTTON NEEDS, in one place.
 *
 * The button itself is not ours. Every screen sits on the ROOT stack (pinned by
 * `__tests__/routes.test.ts`), so every push leaves real history and UIKit draws
 * its OWN back item: native chevron, native SF Pro label, native push/pop
 * animation, the interactive edge-swipe, and correct RTL mirroring. Its looks
 * are configured once, in `headerOptions.tsx`.
 *
 * What a screen may need is one of exactly two things, and this module is the
 * only place either is spelled out:
 *
 *   useBack()        leave, from a button in the page
 *   useBackGuard()   intercept a departure the user has to confirm first
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useNavigation, useNavigationContainerRef, useRouter, type Href } from 'expo-router';
import type { NavigationAction } from 'expo-router/react-navigation';

/**
 * Completes a guarded departure. Called bare it replays whatever was blocked;
 * given a callback it runs that instead, for a screen that must not just pop.
 */
export type Leave = (elsewhere?: () => void) => void;

/**
 * Leave this screen, without ever dead-ending.
 *
 * Screens are reached by deep link (verification and recovery emails, push
 * taps) with no history beneath them; `router.back()` is a silent no-op there
 * and the guest is stuck. When there is nothing to pop to, this lands on
 * `fallback` instead — the tabs unless a screen knows better (Review came from
 * the availability grid, so that is where its guest belongs).
 *
 * Stable across renders, so it is safe in an effect's dependency list.
 */
export function useBack(fallback: Href = '/(tabs)'): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}

/**
 * Start over on `href`: pop the root stack to its first screen, then replace
 * that with `href`, so it is the ONLY screen and a back-swipe finds nothing.
 *
 * For a switch of worlds (staff view ↔ guest view, sign-out), where whatever
 * sat underneath belongs to the old one. A bare `replace` swaps the top screen
 * only and left the old Today, Book tab or signed-in screens beneath.
 *
 * The pop is aimed at the ROOT stack by key. `router.dismissAll()` is not:
 * it pops the deepest focused stack, so called from inside a nested group
 * ((matches), (coaching), …) it emptied only that group and left the screens
 * beneath it on the root stack. The `replace` is queued and resolved when the
 * routing queue runs, so it sees the state after the pop.
 *
 * Stable across renders, so it is safe in an effect's dependency list.
 */
/**
 * Down to a tab from a root-stack page over the tabs (Profile's member card row
 * to the Club tab's card; Sait, 2026-10-20): the page closes and the tab under
 * it is switched to, instead of the tab opening as a new page that swipes back
 * to the one it came from. With nothing under it, the tab opens in its place.
 */
export function useDownToTab(): (href: Href) => void {
  const router = useRouter();
  return useCallback(
    (href: Href) => {
      if (router.canGoBack()) router.dismissTo(href);
      else router.replace(href);
    },
    [router],
  );
}

/**
 * Back to a list with the item just sent on it (Sait, 2026-10-17: after
 * sending, show it in the list): the list's `?id=` lists that row first and
 * marks it, as it does for an item a push names. The list under the form is
 * returned to with the id; with nothing under it, the list opens.
 */
export function useBackToItem(list: '/staff-request' | '/staff-suggestions' | '/staff-marketing-requests' | '/staff-deductions'): (id: string) => void {
  const router = useRouter();
  return useCallback(
    (id: string) => {
      const href = { pathname: list, params: { id } } as const;
      if (router.canGoBack()) router.dismissTo(href);
      else router.replace(href);
    },
    [router, list],
  );
}

export function useResetTo(): (href: Href) => void {
  const router = useRouter();
  const container = useNavigationContainerRef();
  return useCallback(
    (href: Href) => {
      const root = container.isReady() ? container.getRootState() : undefined;
      if (root && root.routes.length > 1) {
        container.dispatch({ type: 'POP_TO_TOP', target: root.key });
      }
      router.replace(href);
    },
    [router, container],
  );
}

/**
 * Come back from a root-stack detour (tickets, a payment, the success screen)
 * to the flow it left, instead of opening a second copy of that flow.
 *
 * A bare `replace` from the detour builds a NEW `under` route (a nested group
 * such as `(matches)`, or the `(tabs)`) on top of the one still waiting below:
 * after buying tickets for a start, a back-swipe from the new match found the
 * old "Start a match" form. So this pops the root stack back to the latest
 * `under` route, by key like `useResetTo`, and then lands on `href` inside it:
 *
 *   'replace'  in place of the screen on top of it (the form becomes the match;
 *              a tab is switched to)
 *   'push'     above it, keeping the trail (a paid lesson over the times it
 *              was picked from)
 *
 * With no `under` route on the stack (a cold start into the detour) it is a
 * plain `replace`. The landing is queued and resolved after the pop.
 */
export function useReturnTo(): (href: Href, under: string, how?: 'replace' | 'push') => void {
  const router = useRouter();
  const container = useNavigationContainerRef();
  return useCallback(
    (href: Href, under: string, how: 'replace' | 'push' = 'replace') => {
      const root = container.isReady() ? container.getRootState() : undefined;
      let at = -1;
      if (root) {
        for (let i = root.routes.length - 1; i >= 0; i--) {
          if (root.routes[i]?.name === under) {
            at = i;
            break;
          }
        }
      }
      if (!root || at === -1) {
        router.replace(href);
        return;
      }
      const above = root.routes.length - 1 - at;
      if (above > 0) container.dispatch({ type: 'POP', payload: { count: above }, target: root.key });
      if (how === 'push') router.push(href);
      else router.replace(href);
    },
    [router, container],
  );
}

/**
 * Open a root-stack screen in place of the screen on top, keeping the rest of
 * its group's trail.
 *
 * A `replace` from inside a nested group swaps the WHOLE group (the root stack
 * is where the target lives), so paying from a lesson's review threw away the
 * coach and the times it was picked from. This pops just the top screen out of
 * its group and pushes `href` over the group. Outside a group, or on a group's
 * only screen, it is a plain `replace`.
 */
export function useReplaceTop(): (href: Href) => void {
  const router = useRouter();
  const container = useNavigationContainerRef();
  return useCallback(
    (href: Href) => {
      const root = container.isReady() ? container.getRootState() : undefined;
      const group = root?.routes[root.index]?.state;
      if (group?.type === 'stack' && group.key && group.routes.length > 1) {
        container.dispatch({ type: 'POP', payload: { count: 1 }, target: group.key });
        router.push(href);
      } else router.replace(href);
    },
    [router, container],
  );
}

/**
 * Whether the screen on top right now is `name` (a route as the root state
 * spells it, e.g. `match/[id]`) for this `id`. A notification tap uses it to
 * leave the page the guest is already reading alone rather than push a copy.
 */
export function useIsOnScreen(): (name: string, id: string) => boolean {
  const container = useNavigationContainerRef();
  return useCallback(
    (name: string, id: string) => {
      if (!container.isReady()) return false;
      // The container is typed for no param list, which makes the route `never`.
      const route = container.getCurrentRoute() as { name: string; params?: { id?: unknown } } | undefined;
      return route?.name === name && route.params?.id === id;
    },
    [container],
  );
}

/**
 * Hold a departure open until the screen says it may proceed.
 *
 * JS can hold what JS dispatches: Android's back button and gesture (which
 * native-stack routes through JS), a deep link pushing elsewhere, and any
 * `router` call. On iOS it CANNOT hold what UIKit does itself. The back item
 * and the edge-swipe pop the screen natively, and native-stack only tells JS
 * afterwards (`onDismissed` → a POP sourced from this route). Calling
 * `preventDefault` on that leaves the route in JS state with no screen behind
 * it: "removed natively but didn't get removed from JS state", and a stack the
 * next navigation trips over. So, while armed:
 *
 *   - the edge-swipe is switched off (`gestureEnabled: false`), and
 *   - a native pop is let through: never prevented, never handed to
 *     `onBlocked` (no dialog can ask about a screen that is already gone).
 *     `onDismissed` runs instead, for whatever leaving must still do.
 *
 * `when` is read live, so a screen may start and stop guarding as its form
 * turns dirty and clean. `onBlocked` and `onDismissed` are likewise read
 * through a ref: they are rebuilt on every render, and subscribing to them
 * directly would tear the listener down and re-add it mid-gesture.
 *
 * NOT built on `usePreventRemove`, deliberately. That hook registers the route
 * as prevented, and NativeStackView then forces
 * `headerBackButtonMenuEnabled: false` regardless of what the screen passes
 * (NativeStackView.native.js). react-native-screens reads that as
 * `disableBackButtonMenu` and swaps UIKit's back item for a plain
 * UIBarButtonItem carrying only a title — a bordered capsule with NO CHEVRON,
 * in the default tint, for exactly as long as the guard is armed. The price of
 * keeping the chevron is the iOS back item above: it always leaves.
 *
 * `onBlocked` is handed a `leave` callback, and `useBackGuard` returns the same
 * one. Calling it lifts the guard for good and completes the departure:
 *
 *   leave()             replay whatever was blocked — the back item, the
 *                       edge-swipe, or the push that was intercepted
 *   leave(elsewhere)    discard it and run `elsewhere` instead, for a screen
 *                       that must not simply pop (complete-profile)
 *
 * Lifting is permanent for the life of the screen. Nothing re-arms it, which is
 * what stops the redirect a guard fires from being caught by that same guard —
 * an inescapable loop. A screen that cancels instead (the discard dialog's
 * "Keep editing") simply never calls it, and stays guarded.
 */
export function useBackGuard({
  when,
  onBlocked,
  onDismissed,
}: {
  when: boolean;
  onBlocked: (leave: Leave) => void;
  /** iOS only: UIKit already popped the screen (back item), see above. */
  onDismissed?: () => void;
}): Leave {
  const navigation = useNavigation();
  const back = useBack();
  const blocked = useRef<NavigationAction | null>(null);
  const lifted = useRef(false);
  // Written in an effect, not during render: the listener only ever reads them
  // from a callback, so they are never needed before the commit lands.
  const onBlockedRef = useRef(onBlocked);
  const onDismissedRef = useRef(onDismissed);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
    onDismissedRef.current = onDismissed;
  });

  const leave = useCallback<Leave>(
    (elsewhere) => {
      lifted.current = true;
      const action = blocked.current;
      blocked.current = null;
      if (elsewhere) elsewhere();
      else if (action) navigation.dispatch(action);
      else back();
    },
    [navigation, back],
  );

  // The native half of the guard. On iOS the back item and the edge-swipe pop
  // in UIKit BEFORE `beforeRemove` reaches JS, so `preventDefault` alone left
  // the screen gone from the stack but still in JS state ("The screen
  // 'profile-edit' was removed natively but didn't get removed from JS
  // state"), and "Keep editing" had no screen left to keep (guest report,
  // 2026-10-11). `preventNativeDismiss` makes react-native-screens put the
  // screen back and report the attempt instead, which the native stack turns
  // into a JS pop, and that pop is what the listener below catches. Passed
  // through `unstable_nativeProps`, which the stack spreads AFTER its own
  // `preventNativeDismiss`, rather than through `usePreventRemove`, which
  // would also cost the chevron (above). A pop the screen dispatches itself
  // (`leave`) is a JS removal and is not blocked by it.
  useEffect(() => {
    navigation.setOptions({ unstable_nativeProps: { preventNativeDismiss: when } });
  }, [navigation, when]);

  useEffect(() => {
    if (!when) return;
    navigation.setOptions({ gestureEnabled: false });
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (lifted.current) return;
      if (isNativeDismissal(e.data.action, e.target)) {
        lifted.current = true;
        onDismissedRef.current?.();
        return;
      }
      e.preventDefault();
      blocked.current = e.data.action;
      onBlockedRef.current(leave);
    });
    return () => {
      unsubscribe();
      // `undefined`, not `true`: the stack's own default comes back.
      navigation.setOptions({ gestureEnabled: undefined });
    };
  }, [navigation, when, leave]);

  return leave;
}

/**
 * The POP native-stack dispatches from `onDismissed` once UIKit has removed the
 * screen: sourced from the route itself. Android's back item dispatches the
 * same shape from `onHeaderBackButtonClicked`, but there the screen is still
 * up and the pop can be held, hence iOS only. A `router` call is a GO_BACK,
 * POP_TO, NAVIGATE or REPLACE, never this.
 */
function isNativeDismissal(action: NavigationAction, routeKey: string | undefined): boolean {
  return Platform.OS === 'ios' && action.type === 'POP' && routeKey !== undefined && action.source === routeKey;
}
