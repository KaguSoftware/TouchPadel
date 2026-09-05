import { useContext } from 'react';
import { Platform } from 'react-native';
import { useBottomTabBarHeight } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Standard `UITabBar` content height, above the home-indicator inset. */
const IOS_TAB_BAR_HEIGHT = 49;

/** Design: 62 pt bar; the nav-bar inset is added below it (TabsLayout.android). */
const ANDROID_TAB_BAR_HEIGHT = 62;

/**
 * Height of whichever tab bar is mounted, so screens can pad their scroll
 * content past it.
 *
 * Neither navigator reliably publishes a height. iOS runs the real `UITabBar`
 * via expo-router `NativeTabs`, which is not a react-navigation bottom-tab
 * navigator at all, so it provides no height context. Android runs the custom
 * JS bar, which normally does — but the context is still missing while a screen
 * renders outside the navigator (a modal route, or the first paint of a screen
 * expo-router mounts before the tabs settle).
 *
 * So the context is READ rather than required: `useBottomTabBarHeight()` throws
 * when it is absent, which crashed the Book tab on render. `useContext` yields
 * `undefined` instead, and the design's own bar height plus the safe-area inset
 * is used as the fallback — the same number the bar draws itself.
 */
export function useTabBarHeight(): number {
  const measured = useContext(BottomTabBarHeightContext);
  const bottomInset = useSafeAreaInsets().bottom;
  if (measured != null) return measured;
  return (Platform.OS === 'ios' ? IOS_TAB_BAR_HEIGHT : ANDROID_TAB_BAR_HEIGHT) + bottomInset;
}
