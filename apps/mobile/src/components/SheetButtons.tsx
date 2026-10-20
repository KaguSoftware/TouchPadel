/**
 * Android: a sheet's own top-bar text button, the app's plain one (iOS draws
 * the system's own, `SheetButtons.ios.tsx`): a quiet word with a 44-pt target.
 *
 * `testID` is REQUIRED and sits on the Pressable.
 */
import { Pressable } from 'react-native';
import { Text } from '../i18n/text';
import { space, useTheme } from '../theme';

interface SheetButtonProps {
  testID: string;
  label: string;
  onPress: () => void;
}

export function SheetTextButton({ testID, label, onPress }: SheetButtonProps) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingStart: space.sm,
        paddingEnd: space.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.mut }}>{label}</Text>
    </Pressable>
  );
}
