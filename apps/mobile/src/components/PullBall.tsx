/**
 * Pull to refresh, drawn as the brand ball floating OVER the screen (Sait, 2026-11-16).
 *
 * The system spinner pushed the list down on iOS and sat in a grey disc on Android. This replaces
 * it with a small round chip that comes down over the content while the list stays where it is.
 * Both platforms use the same pull and no `RefreshControl` at all (on Android a transparent one
 * still drew its own ring beside the ball): a downward drag that starts with the list at its top
 * moves the chip, and letting go past `THRESHOLD` starts the refresh. Nothing is reserved at the
 * top, so nothing is pushed down.
 *
 * Use it with `usePullRefresh` (the refresh state follows the guest's pull, not the query):
 *
 *   const ball = usePullBall(pull);
 *   <View style={{ flex: 1 }}>
 *     <ScrollView onScroll={ball.onScroll} onScrollEndDrag={ball.onScrollEndDrag}
 *       scrollEventThrottle={16} refreshControl={ball.refreshControl}>…</ScrollView>
 *     {ball.overlay}
 *   </View>
 *
 * A screen that has its own `onScroll` calls `ball.onScroll(e)` from it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  View,
  type GestureResponderHandlers,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme';
import { SmileyBall } from './SmileyBall';

/** Points the list must be dragged past its top before letting go refreshes. */
const THRESHOLD = 72;
const MAX_PULL = 130;
/** One turn of the ball, and the least time it stays up (a turn plus the fade in). */
const TURN_MS = 800;
const MIN_SHOWN_MS = TURN_MS + 180;
const CHIP = 38;
const BALL = 22;
const RING_R = 17;
const RING_LEN = 2 * Math.PI * RING_R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface PullBall {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** false on iOS: the list does not bounce past its top, so no gap opens above it. */
  bounces: boolean;
  /** Spread on the view that wraps the list (the one that also holds `overlay`). */
  wrapHandlers: GestureResponderHandlers;
  /** Always undefined: kept so a list can pass it to `refreshControl` and get no native spinner. */
  refreshControl: undefined;
  /** Draw as the LAST child of the view that wraps the list, so it floats over it. */
  overlay: ReactElement;
}

export function usePullBall(
  pull: { refreshing: boolean; onRefresh: () => void },
  opts: {
    /** A list that reports its offset through this value (`useScrollY`) instead of `onScroll(e)`. */
    scrollY?: Animated.Value;
    /** false switches the pull off (a signed-out page); default true. */
    enabled?: boolean;
  } = {},
): PullBall {
  const { scrollY, enabled = true } = opts;
  const enabledRef = useRef(enabled);
  const { colors } = useTheme();
  // How far the list is dragged past its top, in points (>= 0).
  const [dragged] = useState(() => new Animated.Value(0));
  // 0 = chip tucked away above the screen, 1 = shown while loading.
  const [loading] = useState(() => new Animated.Value(0));
  const [spin] = useState(() => new Animated.Value(0));
  const crossed = useRef(false);
  const refreshing = useRef(pull.refreshing);
  const pullRef = useRef(pull);
  useEffect(() => {
    refreshing.current = pull.refreshing;
    pullRef.current = pull;
    enabledRef.current = enabled;
  }, [pull, enabled]);

  const atTop = useRef(true);
  useEffect(() => {
    if (!scrollY) return undefined;
    const id = scrollY.addListener(({ value }) => {
      atTop.current = value <= 1;
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  // The ball stays up for one full turn at least, however fast the refresh answers.
  const [shown, setShown] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    if (pull.refreshing) {
      startedAt.current = Date.now();
      setShown(true);
      return undefined;
    }
    const wait = Math.max(0, MIN_SHOWN_MS - (Date.now() - startedAt.current));
    const id = setTimeout(() => setShown(false), wait);
    return () => clearTimeout(id);
  }, [pull.refreshing]);

  useEffect(() => {
    if (shown) {
      Animated.timing(loading, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      spin.setValue(0);
      const loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: TURN_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(loading, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    return undefined;
  }, [shown, loading, spin]);

  // The list never rubber-bands past its top on iOS (that is what left a gap above it), so the pull
  // is read from the finger instead: a downward drag that starts with the list at its top.
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentInset } = e.nativeEvent;
    atTop.current = contentOffset.y + (contentInset?.top ?? 0) <= 1;
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          enabledRef.current &&
          atTop.current &&
          !refreshing.current &&
          g.dy > 8 &&
          g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_, g) => {
          const pulled = Math.min(MAX_PULL, Math.max(0, g.dy) * 0.55);
          dragged.setValue(pulled);
          if (pulled >= THRESHOLD && !crossed.current) {
            crossed.current = true;
            void Haptics.selectionAsync();
          } else if (pulled < THRESHOLD * 0.6) {
            crossed.current = false;
          }
        },
        onPanResponderRelease: (_, g) => {
          const pulled = Math.max(0, g.dy) * 0.55;
          crossed.current = false;
          if (pulled >= THRESHOLD && !refreshing.current) pullRef.current.onRefresh();
          Animated.timing(dragged, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          crossed.current = false;
          Animated.timing(dragged, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        },
      }),
    [dragged],
  );

  // Pull progress 0..1 drives the chip's slide, size and ring on iOS; `loading` takes over after.
  const progress = dragged.interpolate({
    inputRange: [0, THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const show = Animated.add(progress, loading).interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, 1, 1],
  });
  const slide = dragged.interpolate({
    inputRange: [0, THRESHOLD, THRESHOLD * 2],
    outputRange: [0, 70, 90],
    extrapolate: 'clamp',
  });
  const restSlide = loading.interpolate({ inputRange: [0, 1], outputRange: [0, 64] });
  const scale = show.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const ringOffset = Animated.multiply(
    progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    loading.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  ).interpolate({ inputRange: [0, 1], outputRange: [0, RING_LEN] });
  const rotate = Animated.add(
    dragged.interpolate({
      inputRange: [0, THRESHOLD * 2],
      outputRange: [0, 360],
      extrapolate: 'clamp',
    }),
    spin.interpolate({ inputRange: [0, 1], outputRange: [0, 360] }),
  ).interpolate({ inputRange: [0, 720], outputRange: ['0deg', '720deg'] });

  const overlay = (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, start: 0, end: 0, alignItems: 'center' }}
    >
      <Animated.View
        style={{
          width: CHIP,
          height: CHIP,
          marginTop: -CHIP,
          borderRadius: CHIP / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.card,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
          opacity: show,
          transform: [
            { translateY: Animated.add(slide, restSlide) },
            { scale },
          ],
        }}
      >
        <Svg
          width={CHIP}
          height={CHIP}
          style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
        >
          <Circle
            cx={CHIP / 2}
            cy={CHIP / 2}
            r={RING_R}
            stroke={colors.line}
            strokeWidth={2}
            fill="none"
          />
          <AnimatedCircle
            cx={CHIP / 2}
            cy={CHIP / 2}
            r={RING_R}
            stroke={colors.blue}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={RING_LEN}
            strokeDashoffset={ringOffset}
          />
        </Svg>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <SmileyBall size={BALL} />
        </Animated.View>
      </Animated.View>
    </View>
  );

  return {
    onScroll,
    bounces: Platform.OS !== 'ios' || !enabled,
    wrapHandlers: panResponder.panHandlers,
    refreshControl: undefined,
    overlay,
  };
}
