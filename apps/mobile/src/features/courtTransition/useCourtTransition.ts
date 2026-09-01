/**
 * Drives the court → booking transition on the Book tab: ONE native-driven
 * progress value p (0 = court view, 1 = booking view) that every layer reads —
 * the pitched court, the on-net button, the frosted sheet and its staggers.
 *
 * Play and reverse are a spring on p itself (spec.SPRING: stiffness 60,
 * damping 18, mass 1.2 — critically damped, ≈ 1.6 s), never a duration, so a
 * reversal mid-flight starts from wherever p is. Under OS reduced motion the
 * spring becomes one short linear fade (REDUCED_MOTION_MS).
 *
 * `direction` feeds the direction-aware PITCH ease tables (spec.pitchEase);
 * `sheetMounted` keeps the sheet — and its availability queries and realtime
 * subscription — mounted only from the first open until a close settles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { REDUCED_MOTION_MS, SPRING, type Dir } from './spec';

export interface CourtTransition {
  progress: Animated.Value;
  direction: Dir;
  /** The target state — true from the open tap until the close tap. */
  isOpen: boolean;
  sheetMounted: boolean;
  openBooking: () => void;
  closeBooking: () => void;
}

export function useCourtTransition(): CourtTransition {
  const progressRef = useRef<Animated.Value | null>(null);
  if (progressRef.current === null) progressRef.current = new Animated.Value(0);
  const progress = progressRef.current;
  const reduceMotion = useReduceMotion();
  const [direction, setDirection] = useState<Dir>(1);
  const [isOpen, setOpen] = useState(false);
  const [sheetMounted, setMounted] = useState(false);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const goTo = useCallback(
    (target: 0 | 1) => {
      running.current?.stop();
      setDirection(target === 1 ? 1 : -1);
      setOpen(target === 1);
      if (target === 1) setMounted(true);
      const anim = reduceMotion
        ? Animated.timing(progress, {
            toValue: target,
            duration: REDUCED_MOTION_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        : Animated.spring(progress, { toValue: target, ...SPRING, useNativeDriver: true });
      running.current = anim;
      anim.start(({ finished }) => {
        if (running.current === anim) running.current = null;
        // A close that was interrupted by a re-open keeps the sheet mounted.
        if (finished && target === 0) setMounted(false);
      });
    },
    [progress, reduceMotion],
  );

  useEffect(() => () => running.current?.stop(), []);

  const openBooking = useCallback(() => goTo(1), [goTo]);
  const closeBooking = useCallback(() => goTo(0), [goTo]);

  return { progress, direction, isOpen, sheetMounted, openBooking, closeBooking };
}
