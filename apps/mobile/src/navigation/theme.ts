/**
 * THE NAVIGATION THEME — the one the NATIVE BAR reads.
 *
 * react-navigation keeps a theme of its own, entirely separate from
 * `src/theme`. `useHeaderConfigProps` reads `dark` from it and sends it to
 * react-native-screens as the header config's `userInterfaceStyle`, which
 * becomes `navctr.navigationBar.overrideUserInterfaceStyle`
 * (RNSScreenStackHeaderConfig.mm). That single flag decides how UIKit draws
 * the parts of the bar we do NOT colour by hand — above all the back item's
 * chevron and its label.
 *
 * expo-router owns the NavigationContainer and defaults that theme to
 * `DefaultTheme` (`dark: false`), with no prop to change it. Left alone, the
 * native bar is therefore told it is LIGHT even in the app's dark mode: UIKit
 * draws the chevron and label for a light bar, so on our dark ground the
 * chevron disappears and the title reads black. `headerTintColor` cannot save
 * it — the tint colours the item, the interface style decides how it is drawn.
 *
 * So the theme is provided again INSIDE the container, around the Stack, the
 * same way `LocaleDirContext` is (see app/_layout.tsx). It is built from our
 * own palette rather than react-navigation's stock DarkTheme, whose colours are
 * a generic iOS grey ramp and would leak into anything that reads them.
 */
import { useMemo } from 'react';
import { DefaultTheme, type Theme } from 'expo-router';
import { useTheme } from '../theme';

export function useNavigationTheme(): Theme {
  const { appearance, colors } = useTheme();
  return useMemo(
    () => ({
      ...DefaultTheme,
      // The flag that matters: it reaches UIKit as the bar's
      // `overrideUserInterfaceStyle`.
      dark: appearance === 'dark',
      colors: {
        ...DefaultTheme.colors,
        primary: colors.blue,
        background: colors.bg,
        card: colors.bg,
        text: colors.ink,
        border: colors.line,
        notification: colors.redtext,
      },
    }),
    [appearance, colors],
  );
}
