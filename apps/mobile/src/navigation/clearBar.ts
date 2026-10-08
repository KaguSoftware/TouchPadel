/**
 * A bar with no fill, for the screens a coach page is pushed from (the coaches
 * list, a class, a lesson).
 *
 * On iOS every screen of a stack shares ONE UINavigationBar, and a pop
 * cross-fades its background from the top screen's to the one beneath. The
 * coach page's bar is clear over its photo, so an edge-swipe back from it
 * faded the solid bar of the page beneath in over the photo. Giving that page
 * a clear bar too leaves nothing to fade: its ground (`Screen`'s `colors.bg`)
 * shows through the bar, and the page starts below the bar, so it looks the
 * same as the solid bar it replaces. The system back item stays.
 *
 * iOS only: Android draws a toolbar per screen, so nothing is shared there.
 */
import { useContext } from 'react';
import { Platform } from 'react-native';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const IOS = Platform.OS === 'ios';

/** Spread into the screen's `Stack.Screen` options. */
export const clearBarOptions = IOS
  ? { headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }
  : {};

/** The `Screen` style that starts the page below the clear bar. */
export function useClearBarPad(): { paddingTop: number } | undefined {
  const insets = useSafeAreaInsets();
  const measured = useContext(HeaderHeightContext);
  if (!IOS) return undefined;
  return { paddingTop: measured ?? insets.top + 44 };
}
