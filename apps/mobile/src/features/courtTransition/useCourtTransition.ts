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
 * subscription — mounted from the first open until a close has taken the card
 * off screen. That is NOT when the spring settles: the spring is overdamped
 * (ζ ≈ 1.06), so it spends its last ~1.1 s crawling p from 0.05 to 0, long
 * after the card's own fade slice (SPEC.sheet.fade) has put it at opacity 0 at
 * p = 0.25 — reached in ≈ 0.38 s. Unmounting on the completion callback alone
 * therefore left an invisible card holding the stage, and kept the on-net
 * "Check availability" button hidden (it reads `sheetMounted`), for about a
 * second of apparently dead screen. So a close retires the sheet on a listener
 * the frame p crosses below that fade floor, and keeps the completion callback
 * as the backstop for a spring that is stopped before it ever gets there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { REDUCED_MOTION_MS, SPEC, SPRING, type Dir } from './spec';

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
  /** Removes the pending close's "p crossed the fade floor" listener, if any. */
  const retire = useRef<(() => void) | null>(null);
  const clearRetire = useCallback(() => {
    retire.current?.();
    retire.current = null;
  }, []);

  const goTo = useCallback(
    (target: 0 | 1) => {
      const inFlight = running.current !== null;
      running.current?.stop();
      // Either direction abandons a close's pending retire: a re-open must keep
      // the sheet, and a fresh close installs its own.
      clearRetire();
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

      // Closing: drop the sheet the frame it is no longer visible, rather than
      // when the spring finally settles. Native-driven values still deliver JS
      // listener callbacks (Court3D drives the rally off this same value).
      if (target === 0) {
        const id = progress.addListener(({ value }) => {
          if (value > SPEC.sheet.fade[0]) return;
          progress.removeListener(id);
          retire.current = null;
          setMounted(false);
        });
        retire.current = () => progress.removeListener(id);
      }

      const anim = Animated.spring(progress, { toValue: target, ...SPRING, useNativeDriver: true });
      running.current = anim;
      anim.start(({ finished }) => {
        if (running.current === anim) running.current = null;
        // A close that was interrupted by a re-open keeps the sheet mounted.
        if (finished && target === 0) {
          clearRetire();
          setMounted(false);
        }
      });
    },
    [progress, veil, reduceMotion, clearRetire],
  );

  useEffect(
    () => () => {
      running.current?.stop();
      retire.current?.();
    },
    [],
  );

  const openBooking = useCallback(() => goTo(1), [goTo]);
  const closeBooking = useCallback(() => goTo(0), [goTo]);

  return { progress, veil, direction, isOpen, sheetMounted, openBooking, closeBooking };
}
