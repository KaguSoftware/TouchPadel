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
import { useTheme, useThemeSwitch } from '../theme';
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
 * Also hosts the two switch crossfades — language and theme — each as an
 * opaque COVER over the tree rather than the tree's own opacity: the tree
 * hosts UIKit material (the native bar, the native tab bar's blur, BlurView)
 * whose effects break under an ancestor alpha below 1, and a translucent root
 * would force an offscreen pass of the whole surface for the fade. A cover
 * fades up, the change flips in one commit beneath it, the cover fades away;
 * it takes the touches meanwhile.
 *
 * The theme cover is the OUTER of the two. The language cover is painted from
 * `colors.bg`, so a theme switch would recolor it mid-fade if it sat on top;
 * underneath, it is simply hidden for the one frame that matters. The two
 * never run together anyway — each blocks input for its whole window.
 */
export function DirectionRoot({ children }: { children: ReactNode }) {
  const { dir } = useLocale();
  const { switching, cover } = useLocaleSwitch();
  const {
    switching: themeSwitching,
    cover: themeCover,
    coverColor: themeCoverColor,
  } = useThemeSwitch();
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
      {/* Painted from the theme switch's own color, which lags the commit by a
          phase: the outgoing background on the way up, the incoming one on the
          way down. `colors.bg` would flip with the tree and cut the dissolve
          in half. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: themeCoverColor,
            opacity: themeCover,
            pointerEvents: themeSwitching ? 'auto' : 'none',
          },
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
