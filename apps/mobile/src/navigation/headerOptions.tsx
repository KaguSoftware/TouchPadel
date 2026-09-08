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
import { useLocale } from '../i18n/LocaleProvider';
import { useTheme } from '../theme';

/**
 * The back item's tint, applied through `headerTintColor`.
 *
 * There is no hand-drawn back button left in the app: every screen sits on the
 * root stack, so every push leaves real history and UIKit draws its OWN back
 * item — native chevron, native SF Pro label, native push/pop animation, and
 * the edge-swipe gesture. Screens that need to intercept a back (profile-edit's
 * unsaved-changes prompt) use `useBackGuard` from `./back`, which blocks the
 * POP rather than replacing the button — see there for why NOT
 * `usePreventRemove`, which would cost the chevron.
 */
function useBackTint(): string {
  return useTheme().colors.blue;
}

/**
 * @param rebuilding while true the back item is left OFF the bar, so UIKit
 *   builds a fresh one under the new mirroring instead of keeping a chevron
 *   UIAppearance can no longer restyle. Comes from `useNativeBarDirection`,
 *   which owns the timing — see ./headerDirection.
 */
export function useNativeHeaderOptions(rebuilding = false) {
  const { colors, fonts } = useTheme();
  const tint = useBackTint();
  const { dir } = useLocale();
  // Arabic carries taller ascenders and below-baseline dots than Latin caps,
  // so at a shared 17 pt the Arabic title overflows the fixed native bar and
  // clips top and bottom. Give it a touch less size and an explicit line box.
  const arabic = dir === 'rtl';
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
      /**
       * CHEVRON ONLY — no back title.
       *
       * `'default'` shows the previous screen's title beside the chevron, and
       * on iOS 26 a titled back item is drawn as a Liquid Glass CAPSULE. Once
       * the label is long enough to crowd the bar UIKit drops the chevron from
       * that capsule, which is how Arabic ("رجوع", pushed from a titled screen)
       * ended up as a bordered pill with no arrow at all.
       *
       * `'minimal'` asks for the bare chevron, so there is no label to grow,
       * no capsule, and nothing for UIKit to trade the arrow against. The
       * destination is already named by the title of the screen you return to,
       * and by the push animation itself.
       */
      headerBackButtonDisplayMode: 'minimal' as const,
      // `undefined` rather than `true` when settled: `headerBackVisible: true`
      // also turns on `backButtonInCustomView`, a different layout.
      headerBackVisible: rebuilding ? false : undefined,
    }),
    [colors, fonts, tint, arabic, rebuilding],
  );
}
