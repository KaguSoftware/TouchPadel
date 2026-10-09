/**
 * The screen options of a flow that runs in a stack of its own: tournaments
 * (`app/(tournaments)`) and lessons with a coach (`app/(coaching)`).
 *
 * WHY THESE FLOWS NEST. On the root stack every screen shares ONE native bar,
 * and popping back to the tabs (which draw none) made UIKit animate that bar's
 * back item on its own clock: a fast swipe back left it trailing over the Book
 * tab after the page had gone (owner's recordings, 2026-10-09). In a nested
 * stack the native bar belongs to that stack, whose view IS the page the root
 * stack pushes and pops, so the bar and its back button leave with the page at
 * the swipe's own speed. The root stack shows no bar for the group.
 *
 * Inside a group, a push is an ordinary one with UIKit's own back item. The
 * group's FIRST screen has no history in its own stack, so its back is a native
 * bar button (a real UIBarButtonItem with the system chevron, Liquid Glass and
 * all, drawn by UIKit) that leaves the group; Android's toolbar gets its own back
 * arrow. These groups are the only exceptions to the root-stack rule
 * (`__tests__/routes.test.ts` ALLOWED_GROUPS).
 */
import { useCallback, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import type { Stack } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import { useLocale } from '../i18n/LocaleProvider';
import { useBack } from './back';
import { useNativeHeaderOptions } from './headerOptions';
import { useNativeBarDirection } from './headerDirection';

type ScreenOptions = Extract<
  NonNullable<ComponentProps<typeof Stack>['screenOptions']>,
  (...args: never[]) => unknown
>;

/** `screenOptions` for a group's own `Stack`: the shared native bar, plus the first screen's way out. */
export function useGroupStackOptions(): ScreenOptions {
  const { t, dir } = useLocale();
  const { rebuilding } = useNativeBarDirection();
  const header = useNativeHeaderOptions(rebuilding);
  const back = useBack();

  return useCallback(
    ({ route, navigation }) => {
      // Any screen above the first has history here, so UIKit draws its own back item.
      if (navigation.getState().routes[0]?.key !== route.key) return header;
      // The group's first screen: back leaves the group (`useBack` pops the root stack).
      return {
        ...header,
        ...(Platform.OS === 'ios'
          ? {
              unstable_headerLeftItems: () => [
                {
                  type: 'button' as const,
                  label: t('common.back'),
                  // `chevron.backward` resolves against UIKit's RTL flag, which this app
                  // pins LTR (app.config.ts), so the direction is chosen here.
                  icon: {
                    type: 'sfSymbol' as const,
                    name: dir === 'rtl' ? 'chevron.right' : 'chevron.left',
                  },
                  accessibilityLabel: t('common.back'),
                  onPress: back,
                },
              ],
            }
          : {
              headerLeft: ({ tintColor }: { tintColor?: string }) => (
                <HeaderBackButton tintColor={tintColor} onPress={back} />
              ),
            }),
      };
    },
    [header, t, dir, back],
  );
}
