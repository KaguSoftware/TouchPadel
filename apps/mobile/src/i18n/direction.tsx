/**
 * Layout direction as APPLICATION STATE.
 *
 * `useLocale().dir` is the one direction in this app. `DirectionRoot` puts it
 * on the root view as a Yoga `direction` style, and Fabric does the rest for
 * every descendant, live: row order, start/end insets and paddings, absolute
 * `start`/`end`, text alignment, per-view native layout direction
 * (`semanticContentAttribute` on iOS, `View.layoutDirection` on Android), and
 * horizontal scroll views. Switching language is one React commit — strings,
 * faces and mirror together — with no reload, no restart, no native flag.
 *
 * The native flag (`I18nManager`) is pinned LTR for good; see nativeDirection.ts.
 *
 * What Yoga does NOT mirror, and what the helpers here are for:
 *  - drawings: an SVG chevron or a brand stroke keeps its path data — `mirror()`
 *  - decorative art drawn in physical coordinates — `LtrIsland`
 *  - physical transforms (translateX) — `logicalSign()`
 */
import type { ReactNode } from 'react';
import { Animated, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import type { Direction } from '@touch/i18n';
import { useTheme } from '../theme';
import { useLocale, useLocaleSwitch } from './LocaleProvider';

export type Dir = Direction;
export { logicalSign, oppositeDir } from '@touch/i18n';

const MIRRORED: ViewStyle = { transform: [{ scaleX: -1 }] };
const ISLAND: ViewStyle = { direction: 'ltr' };

/** Style that flips a drawing under RTL (chevrons, arrows, the title squiggle). */
export function mirror(dir: Dir): ViewStyle | undefined {
  return dir === 'rtl' ? MIRRORED : undefined;
}

/**
 * The root of the mirrored tree. Sits inside LocaleProvider and ThemeProvider
 * and ABOVE everything that paints — toasts, banners, the navigator — so all
 * of it follows the language.
 *
 * Also hosts the switch crossfade, as an opaque COVER over the tree rather
 * than the tree's own opacity: the tree hosts UIKit material (the native bar,
 * the native tab bar's blur, BlurView) whose effects break under an ancestor
 * alpha below 1, and a translucent root would force an offscreen pass of the
 * whole surface for the fade. The cover fades up, the language flips in one
 * commit beneath it, the cover fades away; it takes the touches meanwhile.
 */
export function DirectionRoot({ children }: { children: ReactNode }) {
  const { dir } = useLocale();
  const { switching, cover } = useLocaleSwitch();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, direction: dir }}>
      {children}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.bg, opacity: cover, pointerEvents: switching ? 'auto' : 'none' },
        ]}
      />
    </View>
  );
}

/**
 * A subtree that stays LEFT-TO-RIGHT whatever the language: decorative art
 * positioned in physical coordinates (a picture of a symmetric court has
 * nothing to mirror). The only place physical `left`/`right` styles are
 * allowed (eslint override in eslint.config.mjs, pinned by the direction tests).
 */
export function LtrIsland({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[style, ISLAND]}>
      {children}
    </View>
  );
}
