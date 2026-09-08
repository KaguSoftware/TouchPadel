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
import { useNavigation, useRouter, type Href } from 'expo-router';
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
 * Hold a departure open until the screen says it may proceed.
 *
 * Covers every way off the screen at once — the native back item, the
 * edge-swipe, Android's back gesture, and a deep link pushing elsewhere —
 * because all of them dispatch through the same `beforeRemove` event.
 *
 * `when` is read live, so a screen may start and stop guarding as its form
 * turns dirty and clean. `onBlocked` is likewise read through a ref: it is
 * rebuilt on every render, and subscribing to it directly would tear the
 * listener down and re-add it mid-gesture.
 *
 * NOT built on `usePreventRemove`, deliberately. That hook registers the route
 * as prevented, and NativeStackView then forces
 * `headerBackButtonMenuEnabled: false` regardless of what the screen passes
 * (NativeStackView.native.js). react-native-screens reads that as
 * `disableBackButtonMenu` and swaps UIKit's back item for a plain
 * UIBarButtonItem carrying only a title — a bordered capsule with NO CHEVRON,
 * in the default tint, for exactly as long as the guard is armed. Listening to
 * `beforeRemove` is the very event that hook wraps, and leaves the back item
 * untouched.
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
}: {
  when: boolean;
  onBlocked: (leave: Leave) => void;
}): Leave {
  const navigation = useNavigation();
  const back = useBack();
  const blocked = useRef<NavigationAction | null>(null);
  const lifted = useRef(false);
  // Written in an effect, not during render: the listener only ever reads it
  // from a callback, so it is never needed before the commit lands.
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
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

  useEffect(() => {
    if (!when) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (lifted.current) return;
      e.preventDefault();
      blocked.current = e.data.action;
      onBlockedRef.current(leave);
    });
  }, [navigation, when, leave]);

  return leave;
}
