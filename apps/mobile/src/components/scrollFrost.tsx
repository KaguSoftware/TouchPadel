/**
 * The scroll frosting shared by the tabs that keep the Book tab's 3D court
 * fixed behind a scrolling page (Coaches, Join): one blur over the court and
 * the brand lines, under the page, that comes up as the page scrolls; and the
 * title pinned over the top of the screen on it.
 *
 * ONE frosting for the whole screen, never a second one over the page under
 * the title: two blurs side by side draw a seam where they meet (owner,
 * 2026-10-12). So the page ends at the title's foot rather than passing under it.
 */
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useTheme, withAlpha } from '../theme';

/** The frosting at full; an Android page with no `FrostTarget` veils with the page's ground instead. */
const FROST_BLUR = 40;
const FROST_VEIL = 0.7;
const ios = Platform.OS === 'ios';

/**
 * A blur that comes up with the scroll, from 0 at rest to `max` once the page
 * has scrolled `span`, and a 0..1 fade over the same stretch.
 *
 * The blur's INTENSITY is what ramps, never an opacity over it: a blur under
 * an alpha < 1 draws nothing on iOS (the Book tab's `ParkedGlass`). The
 * intensity is a plain prop, so it follows the scroll through a listener and
 * re-renders its owner once per whole step. Android has no blur, so it stays 0
 * there and the fade carries the change (on the native driver).
 */
export function useScrollRamp(scrollY: Animated.Value, span: number, max: number) {
  const [blur, setBlur] = useState(0);
  useEffect(() => {
    if (span <= 0) return;
    const id = scrollY.addListener(({ value }) => {
      const p = Math.min(Math.max(value / span, 0), 1);
      const next = Math.round(p * max);
      setBlur((prev) => (prev === next ? prev : next));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, span, max]);
  const fade = useMemo(
    () =>
      scrollY.interpolate({
        inputRange: [0, Math.max(span, 1)],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [scrollY, span],
  );
  return { blur, fade };
}

/**
 * The page's one frosting, laid over the court and the brand lines and under
 * the page, across the whole screen (the title and the clock sit on it too).
 * Clear at rest; it comes up as the page scrolls and is full once the court's
 * slot has scrolled away (`span`).
 *
 * Android blurs only what sits inside a `FrostTarget` (`target`, the court and
 * the brand lines), and only from Android 12 (`dimezisBlurViewSdk31Plus`);
 * older phones get the blur view's own tint. A page with no target keeps the
 * old veil of the page's ground.
 */
export function Frost({
  scrollY,
  span,
  target,
}: {
  scrollY: Animated.Value;
  span: number;
  target?: RefObject<View | null>;
}) {
  const { colors, appearance } = useTheme();
  const { blur, fade } = useScrollRamp(scrollY, span, FROST_BLUR);
  if (ios || target) {
    return blur > 0 ? (
      <BlurView
        pointerEvents="none"
        intensity={blur}
        tint={appearance === 'dark' ? 'dark' : 'light'}
        blurTarget={target}
        blurMethod={target ? 'dimezisBlurViewSdk31Plus' : undefined}
        style={StyleSheet.absoluteFill}
      />
    ) : null;
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { opacity: fade, backgroundColor: withAlpha(colors.page, FROST_VEIL) },
      ]}
    />
  );
}

/**
 * What `Frost` blurs on Android: the court and the brand lines go in here,
 * the frosting and the page go after it, outside. A plain view on iOS.
 */
export const FrostTarget = BlurTargetView;

/**
 * The pinned title over the top of the screen, from its top edge (the clock
 * and battery sit in it). Clear: the frosting under it is the page's own. The
 * caller pads the children by the safe-area top and lays its scroll view from
 * the measured height down, so the page ends at the title's foot.
 * `box-none`: a button in the title row (Join's Start a match) still takes touches.
 */
export function PinnedTitle({
  onHeight,
  children,
}: {
  onHeight: (h: number) => void;
  children: ReactNode;
}) {
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={{ position: 'absolute', top: 0, start: 0, end: 0 }}
    >
      {children}
    </View>
  );
}
