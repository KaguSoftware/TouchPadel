/**
 * Shows its children with a short reveal and hides them with the reverse: they
 * fade and drift into place while the layout around them eases to make (or
 * give back) the room, so a field that appears because of what was typed above
 * it does not snap the form around. Sign-in uses it for the password field, the
 * forgot-password link and the "we will send a code" hint.
 *
 * The fade and drift are the children's own (native driver); the neighbours
 * moving is `LayoutAnimation`, which needs no measuring of the children. They
 * stay mounted until the close has played. Under the OS "Reduce Motion" they
 * simply appear and disappear.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, LayoutAnimation } from 'react-native';
import { useReduceMotion } from '../lib/useReduceMotion';

const OPEN_MS = 280;
const CLOSE_MS = 200;
const DRIFT = 12;
const EASE = { duration: 260, update: { type: LayoutAnimation.Types.easeInEaseOut } } as const;

export function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const [mounted, setMounted] = useState(show);
  const [progress] = useState(() => new Animated.Value(show ? 1 : 0));
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    progress.stopAnimation();
    // Nothing to play on the first run: the children are already as `show` says.
    if (first.current) {
      first.current = false;
      return;
    }
    if (show) {
      if (!reduceMotion) LayoutAnimation.configureNext(EASE);
      setMounted(true);
      if (reduceMotion) {
        progress.setValue(1);
        return;
      }
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    if (reduceMotion) {
      progress.setValue(0);
      setMounted(false);
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // A timer, not the callback: unmounted on time whether or not it reports
    // back, and the room is given back with the same ease as it was made.
    closeTimer.current = setTimeout(() => {
      LayoutAnimation.configureNext(EASE);
      setMounted(false);
    }, CLOSE_MS);
  }, [show, reduceMotion, progress]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  if (!mounted) return null;
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-DRIFT, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
