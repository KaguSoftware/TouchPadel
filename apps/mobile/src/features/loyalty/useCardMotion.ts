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
 * About 60 readings a second while listening, each one a `setValue` on a native-driven value;
 * the gyroscope stops the moment the tab, the app or the screen does.
 */
import { useEffect, useState } from 'react';
import { Animated, AppState } from 'react-native';
import type * as Sensors from 'expo-sensors';
import { LEAN_REST, stepLean } from './motion';

/** One reading a frame at 60 Hz. Well under Android 12's 200 Hz cap, so no extra permission. */
const INTERVAL_MS = 16;

function loadGyroscope(): typeof Sensors.Gyroscope | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see the header
    return (require('expo-sensors') as typeof Sensors).Gyroscope ?? null;
  } catch {
    return null;
  }
}

export function useCardMotion(active: boolean): { x: Animated.Value; y: Animated.Value } {
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
    let sub: { remove(): void } | null = null;
    try {
      gyro.setUpdateInterval(INTERVAL_MS);
      sub = gyro.addListener((r) => {
        // Both platforms stamp readings in seconds; the first one has nothing to step from.
        const dt = last === null ? 0 : r.timestamp - last;
        last = r.timestamp;
        lean = stepLean(lean, r, dt);
        x.setValue(lean.x);
        y.setValue(lean.y);
      });
    } catch {
      // No gyroscope on this device, or no module in this binary: the card leans under a finger only.
      sub = null;
    }
    return () => {
      sub?.remove();
      // Back to rest when it stops listening, not frozen mid-lean for the next visit.
      const rest = { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 0 };
      Animated.parallel([Animated.spring(x, rest), Animated.spring(y, rest)]).start();
    };
  }, [on, x, y]);

  return { x, y };
}
