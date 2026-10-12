/**
 * The shared motion of the Play and Coaches tabs (Majed, 2026-10-11: "match the
 * Book page's energy across the app"). The Book tab pitches a court back in 3D
 * and lets the booking card rise over it; these pieces carry the same moves to
 * pages that hold lists instead of a GL court:
 *
 *   Rise        a block fades in, rises 16 px and settles from 97 % on mount,
 *               staggered by its index (55 ms a step, capped so a long list
 *               never waits on its tail)
 *   useScrollY  the page's scroll as an Animated value, for the 3D court
 *               behind it (`CourtStage`, which pitches the Book tab's own
 *               court on it) and any scroll-linked piece
 *   TiltPress   a pressable that leans into the finger: scale to 97 % and
 *               3° of rotateX on press-in, released on a spring
 *
 * Every animation is transform / opacity on the native driver, eased out
 * exponentially (no bounce: the press release is a critically damped spring),
 * and every one holds still under the OS Reduce Motion setting.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useReduceMotion } from '../lib/useReduceMotion';

/** ease-out-expo: fast off the mark, long settle. */
export const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);

const RISE_MS = 520;
const RISE_STEP_MS = 55;
/** Past this many steps every block arrives together, so row 30 does not wait 1.6 s. */
const RISE_MAX_STEPS = 8;

/** Fade + rise + settle on mount, staggered by `index`. */
export function Rise({
  index = 0,
  from = 16,
  children,
  style,
}: {
  index?: number;
  /** How far below its place the block starts, in pt. */
  from?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const [p] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) {
      p.setValue(1);
      return;
    }
    const anim = Animated.timing(p, {
      toValue: 1,
      duration: RISE_MS,
      delay: Math.min(index, RISE_MAX_STEPS) * RISE_STEP_MS,
      easing: EASE_OUT_EXPO,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [p, index, reduce]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: p,
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
            { scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The page's vertical scroll as an Animated value, for `CourtStage` and any
 * scroll-linked piece. Spread `onScroll` onto an Animated.ScrollView /
 * Animated.FlatList / Animated.SectionList with `scrollEventThrottle={16}`.
 */
export function useScrollY() {
  const [y] = useState(() => new Animated.Value(0));
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true }),
    [y],
  );
  return { y, onScroll };
}

/** A pressable that leans into the finger. Forwards `testID` explicitly. */
export function TiltPress({
  testID,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  haptic = true,
  children,
  style,
}: {
  testID: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** What a tap does, when the label alone does not say. */
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: { selected?: boolean; disabled?: boolean; checked?: boolean };
  /** A light tap of the Taptic engine on press. */
  haptic?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReduceMotion();
  const [pressed] = useState(() => new Animated.Value(0));
  const to = (v: number) =>
    Animated.spring(pressed, {
      toValue: v,
      useNativeDriver: true,
      stiffness: 420,
      damping: 34,
      mass: 1,
    }).start();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (haptic) void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      onPressIn={reduce ? undefined : () => to(1)}
      onPressOut={reduce ? undefined : () => to(0)}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
    >
      <Animated.View
        style={[
          style,
          {
            transform: [
              { perspective: 700 },
              { scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
              { rotateX: pressed.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '3deg'] }) },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
