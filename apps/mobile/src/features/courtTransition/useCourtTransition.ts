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
 * subscription — mounted only from the first open until the CARD is off
 * screen, which is p ≤ SHEET_GONE (0.25) and NOT the spring's rest: those are
 * ≈ 0.40 s and ≈ 1.70 s into a close, and the second one is the court settling
 * behind a card that has already left (SHEET_GONE has the arithmetic). Waiting
 * for it left the card parked over the tab bar and, since the on-net "check
 * availability" button takes its `hidden` from this same flag, dead to touch
 * for 1.3 s after the sheet had visibly gone (owner, 2026-09-05).
 *
 * So a close watches p and lets go of the stage at the crossing; the
 * animation's own callback stays as the backstop that catches a close whose
 * value updates never arrive.
 *
 * An OPEN starts its spring one frame late, on purpose, so that React has
 * finished mounting the sheet before anything moves — goTo has the reasoning.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { REDUCED_MOTION_MS, SHEET_GONE, SPRING, type Dir } from './spec';

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
  /** The id of the close's p listener, while one is attached. */
  const watch = useRef<string | null>(null);
  /** An open whose spring is waiting for the sheet's mount frame (see goTo). */
  const armed = useRef<number | null>(null);
  const unwatch = useCallback(() => {
    if (watch.current === null) return;
    progress.removeListener(watch.current);
    watch.current = null;
  }, [progress]);
  const disarm = useCallback(() => {
    if (armed.current === null) return;
    cancelAnimationFrame(armed.current);
    armed.current = null;
  }, []);

  const goTo = useCallback(
    (target: 0 | 1) => {
      // An armed open counts as in flight: its direction is already chosen and
      // a close that lands before the spring starts must not swap the tables.
      const inFlight = running.current !== null || armed.current !== null;
      running.current?.stop();
      unwatch();
      disarm();
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

      const play = () => {
        // Off screen ≠ at rest: drop the sheet the frame p crosses SHEET_GONE
        // rather than ~1.3 s later when the spring stops creeping. p is
        // native-driven, so this costs one bridge event per frame — for the
        // ~0.4 s of a close only, and the listener takes itself off at the
        // crossing.
        if (target === 0) {
          watch.current = progress.addListener(({ value }) => {
            if (value > SHEET_GONE) return;
            unwatch();
            setMounted(false);
          });
        }

        const anim = Animated.spring(progress, {
          toValue: target,
          ...SPRING,
          useNativeDriver: true,
        });
        running.current = anim;
        anim.start(({ finished }) => {
          if (running.current === anim) running.current = null;
          unwatch();
          // A close that was interrupted by a re-open keeps the sheet mounted.
          if (finished && target === 0) setMounted(false);
        });
      };

      // Opening gets ONE FRAME of head start before the spring runs.
      //
      // `setMounted` above used to bring up the whole booking sheet — the
      // availability queries, the realtime subscription and every one of its
      // staggered animation nodes — and React committed that in the tick this
      // call returned to. Starting the spring here as well put the transition's
      // first frames inside that commit, and the court is the one layer that
      // cannot ride it out: the sheet and the button are native, but the
      // court's pitch is drawn from p in a JS rAF loop (Court3D), so a blocked
      // thread showed as the court jerking while everything over it glided
      // (owner, 2026-09-08: "it glitches a bit and shakes").
      //
      // The Book tab now mounts the sheet long before the tap (`sheetPrewarmed`
      // in app/(tabs)/index.tsx), so on that surface there is usually nothing
      // left to commit. The frame is kept all the same: it still covers the
      // re-render this call does cause, it is what the standalone entry points
      // get on their first open, and 16 ms is well under the ~100 ms a tap has
      // to feel instant. Closing mounts nothing, so it still starts here and
      // now: the back button has to answer immediately.
      if (target === 1) {
        armed.current = requestAnimationFrame(() => {
          armed.current = null;
          play();
        });
      } else {
        play();
      }
    },
    [progress, veil, reduceMotion, unwatch, disarm],
  );

  useEffect(
    () => () => {
      running.current?.stop();
      unwatch();
      disarm();
    },
    [unwatch, disarm],
  );

  const openBooking = useCallback(() => goTo(1), [goTo]);
  const closeBooking = useCallback(() => goTo(0), [goTo]);

  return { progress, veil, direction, isOpen, sheetMounted, openBooking, closeBooking };
}
