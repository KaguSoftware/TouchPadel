/**
 * The phone's movement as the points card's lean (Majed, 2026-10-22): the gyroscope, read only
 * while `active` (the Club tab in front, Reduce Motion off) and the app in the foreground, folded
 * through motion.ts into two Animated values the card adds to a finger's lean.
 *
 * expo-sensors is required LAZILY, as staff/photo.ts does its native modules: it is a native
 * module, and a binary built before it was added has none, so a top-level import would throw on
 * the Club tab. Lazy, that binary just gets a card that leans under a finger only. NATIVE CHANGE:
 * the motion reaches phones with the next dev client and store build.
 *
 * About 30 readings a second while listening. A reading becomes a `setValue` on a native-driven
 * value only when the lean actually moved: the lean leaks toward rest without ever reaching it,
 * so unguarded, a phone lying still still sent ~120 updates a second to the native card (a
 * gradient, a glare and a tilted shadowed layer), which kept a mid-range Android phone's CPU
 * busy. Under `REST_EPS` the lean snaps to exactly rest and goes quiet. The gyroscope stops the
 * moment the tab, the app or the screen does.
 */
import { useEffect, useState } from 'react';
import { Animated, AppState } from 'react-native';
import type * as Sensors from 'expo-sensors';
import { LEAN_REST, stepLean } from './motion';

/** One reading every other frame (30 Hz): smooth enough for a lean that leaks over half a second.
 * Well under Android 12's 200 Hz cap, so no extra permission. */
const INTERVAL_MS = 33;
/** A lean smaller than this (the card's -1..1 units, well under a pixel of tilt) is rest. */
const REST_EPS = 0.002;

function loadGyroscope(): typeof Sensors.Gyroscope | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see the header
    return (require('expo-sensors') as typeof Sensors).Gyroscope ?? null;
  } catch {
    return null;
  }
}

export function useCardMotion(active: boolean): {
  x: Animated.Value;
  y: Animated.Value;
  /** True while the phone is turning the card (and it has not settled): the card pauses its light sweep. */
  moving: boolean;
} {
  const [moving, setMoving] = useState(false);
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  const on = active && foreground;
  useEffect(() => {
    if (!on) return;
    const gyro = loadGyroscope();
    if (!gyro) return;
    let lean = LEAN_REST;
    let last: number | null = null;
    // What the native side holds now, so an unchanged lean sends nothing.
    let sentX = 0;
    let sentY = 0;
    // Told to React only when it flips (a few times a tilt), never per reading.
    let isMoving = false;
    let sub: { remove(): void } | null = null;
    try {
      gyro.setUpdateInterval(INTERVAL_MS);
      sub = gyro.addListener((r) => {
        // Both platforms stamp readings in seconds; the first one has nothing to step from.
        const dt = last === null ? 0 : r.timestamp - last;
        last = r.timestamp;
        const next = stepLean(lean, r, dt);
        lean = {
          x: Math.abs(next.x) < REST_EPS ? 0 : next.x,
          y: Math.abs(next.y) < REST_EPS ? 0 : next.y,
        };
        if (lean.x !== sentX) x.setValue((sentX = lean.x));
        if (lean.y !== sentY) y.setValue((sentY = lean.y));
        const nowMoving = lean.x !== 0 || lean.y !== 0;
        if (nowMoving !== isMoving) setMoving((isMoving = nowMoving));
      });
    } catch {
      // No gyroscope on this device, or no module in this binary: the card leans under a finger only.
      sub = null;
    }
    return () => {
      sub?.remove();
      setMoving(false);
      // Back to rest when it stops listening, not frozen mid-lean for the next visit.
      const rest = { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 0 };
      Animated.parallel([Animated.spring(x, rest), Animated.spring(y, rest)]).start();
    };
  }, [on, x, y]);

  return { x, y, moving };
}
