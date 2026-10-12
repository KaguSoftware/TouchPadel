/**
 * The + at the end of a page's native bar, the way a page opens its "new"
 * form (owner, 2026-10-11: incidents, protocols, teachings, requests,
 * suggestions, ask marketing, deductions).
 *
 * iOS: a real UIBarButtonItem with the system `plus` symbol, so UIKit draws the
 * button (and its Liquid Glass) itself. Android: a toolbar action with
 * Material's plus glyph and the platform's borderless ripple.
 *
 * Spread the result into the page's `<Stack.Screen options>`; pass `null` to
 * show no + (a role that cannot add).
 */
import { Platform, Pressable } from 'react-native';
import { PlusIcon } from '../components/icons';
import { useTheme } from '../theme';

export type HeaderAdd = {
  /** `<route>.add`; Android's button carries it (UIKit's item takes no testID). */
  testID: string;
  label: string;
  onPress: () => void;
};

export function useHeaderAddOptions(add: HeaderAdd | null) {
  const { colors } = useTheme();
  if (!add) return { unstable_headerRightItems: undefined, headerRight: undefined };
  if (Platform.OS === 'ios') {
    return {
      unstable_headerRightItems: () => [
        {
          type: 'button' as const,
          label: add.label,
          icon: { type: 'sfSymbol' as const, name: 'plus' as const },
          accessibilityLabel: add.label,
          onPress: add.onPress,
        },
      ],
      headerRight: undefined,
    };
  }
  return {
    unstable_headerRightItems: undefined,
    headerRight: () => (
      <Pressable
        testID={add.testID}
        accessibilityRole="button"
        accessibilityLabel={add.label}
        hitSlop={10}
        onPress={add.onPress}
        android_ripple={{ color: colors.sub, borderless: true, radius: 20 }}
        style={{ padding: 6 }}
      >
        <PlusIcon size={24} color={colors.blue} strokeWidth={2.2} />
      </Pressable>
    ),
  };
}
