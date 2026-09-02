/**
 * Native header options shared by EVERY stack in the app.
 *
 * The bar is the platform's real one (`UINavigationBar` / Android toolbar), not
 * a view drawn in the page. That is what buys the system material — Liquid
 * Glass on iOS 26, which blurs page content as it scrolls under the bar — plus
 * the interactive edge-swipe pop and correct RTL mirroring, none of which an
 * in-content header row can reproduce. Same reasoning as the native tab bar in
 * `TabsLayout.ios.tsx`: let the system draw its own chrome.
 *
 * Deliberately OPAQUE (`headerTransparent` unset): a transparent header leaves
 * the bar's background to the page, and UIKit then paints no material at all.
 * The blur-on-scroll is applied by the system to the opaque bar.
 *
 * Call it inside a Stack's parent — it is theme- and locale-aware.
 */
import { useMemo } from 'react';
import { I18nManager, Platform } from 'react-native';
import { useLocale } from '../i18n/LocaleProvider';
import { useTheme } from '../theme';

/**
 * The back item's tint, applied through `headerTintColor`.
 *
 * There is no hand-drawn back button left in the app: every screen sits on the
 * root stack, so every push leaves real history and UIKit draws its OWN back
 * item — native chevron, native SF Pro label, native push/pop animation, and
 * the edge-swipe gesture. Screens that need to intercept a back (profile-edit's
 * unsaved-changes prompt) use `usePreventRemove`, which blocks the POP rather
 * than replacing the button.
 */
function useBackTint(): string {
  return useTheme().colors.blue;
}

export function useNativeHeaderOptions() {
  const { colors, fonts } = useTheme();
  const tint = useBackTint();
  const { t, dir } = useLocale();
  const backLabel = t('common.back');
  // Cairo carries taller ascenders and below-baseline dots than Archivo, so at
  // a shared 17 pt the Arabic title overflows the fixed native bar and clips
  // top and bottom. Give it a touch less size and an explicit line box.
  const arabic = dir === 'rtl';

  // TEMP DIAGNOSTIC (remove once the Arabic chevron is confirmed): prints the
  // values that actually decide whether UIKit draws its back item.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[backprobe]', JSON.stringify({
      dir,
      backLabel,
      tint,
      iosVersion: String(Platform.Version),
      nativeIsRTL: I18nManager.isRTL,
      nativeConstIsRTL: I18nManager.getConstants().isRTL,
      titleFont: fonts.display800,
      // The glyph is drawn only when UIKit owns the back item. These are the
      // props that decide that, per useHeaderConfigProps.
      backDisplayMode: 'default',
      backTitleSet: true,
    }));
  }
  return useMemo(
    () => ({
      // Blank unless a screen sets its own, so a screen whose title has not
      // been applied yet never falls back to its route name ("[id]", "index").
      title: '',
      headerShadowVisible: false,
      // Tints the system back item — its chevron and label.
      headerTintColor: tint,
      headerTitleStyle: {
        fontFamily: fonts.display800,
        fontSize: arabic ? 16 : 17,
        lineHeight: arabic ? 24 : undefined,
        color: colors.ink,
      },
      headerStyle: { backgroundColor: colors.bg },
      contentStyle: { backgroundColor: colors.bg },
      // The system back item labels itself with the PREVIOUS screen's title
      // (Profile → Settings reads "Profile"). A push out of the tabs has no
      // title to inherit, so this is the fallback word for that case.
      headerBackButtonDisplayMode: 'default' as const,
      headerBackTitle: backLabel,
    }),
    [colors, fonts, tint, backLabel, arabic],
  );
}
