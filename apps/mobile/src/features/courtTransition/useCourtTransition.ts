/**
 * Drives the court → booking transition on the Book tab: ONE native-driven
 * progress value p (0 = court view, 1 = booking view) that every layer reads —
 * the pitched court, the on-net button, the frosted sheet and its staggers.
 *
 * Play and reverse are a spring on p itself (spec.SPRING: stiffness 60,
 * damping 18, mass 1.2 — critically damped, ≈ 1.6 s), never a duration, so a
 * reversal mid-flight starts from wherever p is.
 *
 * `direction` feeds the direction-aware PITCH ease tables (spec.pitchEase). It
 * changes only when a transition starts FROM REST: the play and reverse curves
 * agree only at p = 0 and 1, so swapping tables under a live value would make
 * the court and the sheet jump in one frame (the prototype's global DIR has
 * the same discontinuity; a phone shows it as a hard cut). A reversal
 * mid-flight therefore keeps the curve it is on and stays continuous.
 *
 * OS reduced motion: no pitch, no slide. The stage dips through the page
 * colour (`veil` 0 → 1 → 0 over REDUCED_MOTION_MS) and p jumps behind it.
 *
 * `sheetMounted` keeps the sheet — and its availability queries and realtime
 * subscription — mounted only from the first open until a close settles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { REDUCED_MOTION_MS, SPRING, type Dir } from './spec';

export interface CourtTransition {
  progress: Animated.Value;
  /** 0 = clear, 1 = the page colour over the stage (reduced-motion dip). */
  veil: Animated.Value;
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
  const veilRef = useRef<Animated.Value | null>(null);
  if (veilRef.current === null) veilRef.current = new Animated.Value(0);
  const veil = veilRef.current;
  const reduceMotion = useReduceMotion();
  const [direction, setDirection] = useState<Dir>(1);
  const [isOpen, setOpen] = useState(false);
  const [sheetMounted, setMounted] = useState(false);
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const goTo = useCallback(
    (target: 0 | 1) => {
      const inFlight = running.current !== null;
      running.current?.stop();
      if (!inFlight) setDirection(target === 1 ? 1 : -1);
      setOpen(target === 1);
      if (target === 1) setMounted(true);

      if (reduceMotion) {
        const half = REDUCED_MOTION_MS / 2;
        const cover = Animated.timing(veil, {
          toValue: 1,
          duration: half,
          easing: Easing.linear,
          useNativeDriver: true,
        });
        running.current = cover;
        cover.start(({ finished }) => {
          if (!finished) return;
          progress.setValue(target);
          const reveal = Animated.timing(veil, {
            toValue: 0,
            duration: half,
            easing: Easing.linear,
            useNativeDriver: true,
          });
          running.current = reveal;
          reveal.start(({ finished: revealed }) => {
            if (running.current === reveal) running.current = null;
            if (revealed && target === 0) setMounted(false);
          });
        });
        return;
      }

      const anim = Animated.spring(progress, { toValue: target, ...SPRING, useNativeDriver: true });
      running.current = anim;
      anim.start(({ finished }) => {
        if (running.current === anim) running.current = null;
        // A close that was interrupted by a re-open keeps the sheet mounted.
        if (finished && target === 0) setMounted(false);
      });
    },
    [progress, veil, reduceMotion],
  );

  useEffect(() => () => running.current?.stop(), []);

  const openBooking = useCallback(() => goTo(1), [goTo]);
  const closeBooking = useCallback(() => goTo(0), [goTo]);

  return { progress, veil, direction, isOpen, sheetMounted, openBooking, closeBooking };
}
