import { Platform } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Standard `UITabBar` content height, above the home-indicator inset. */
const IOS_TAB_BAR_HEIGHT = 49;

/**
 * Height of whichever tab bar is mounted, so screens can pad their scroll
 * content past it. Android runs the custom JS bar, which publishes its measured
 * height through context; iOS runs the native `UITabBar`, which has no such
 * hook, so its standard height plus the bottom inset is used instead.
 *
 * `Platform.OS` is constant for the lifetime of the app, so this branch always
 * takes the same path and the rules of hooks hold.
 */
export function useTabBarHeight(): number {
  /* eslint-disable react-hooks/rules-of-hooks */
  if (Platform.OS === 'ios') {
    return IOS_TAB_BAR_HEIGHT + useSafeAreaInsets().bottom;
  }
  return useBottomTabBarHeight();
  /* eslint-enable react-hooks/rules-of-hooks */
}
