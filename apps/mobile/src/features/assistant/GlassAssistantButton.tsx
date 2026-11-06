/**
 * The round assistant button for Today's header and the floating one (Sait,
 * 2026-11-02): with `prominent` the solid brand-blue circle with a green spark,
 * without it a translucent green one with a glow. This file is Android and
 * everything that is not iOS; iOS draws a native SwiftUI button instead
 * (`GlassAssistantButton.ios.tsx`).
 *
 * `testID` is REQUIRED and sits on the pressable.
 */
import { Pressable } from 'react-native';
import { SparkIcon } from '../../components/icons';
import { brand, withAlpha } from '../../theme';

export interface GlassAssistantButtonProps {
  testID: string;
  size: number;
  label: string;
  hint: string;
  onPress: () => void;
  /** iOS only: the floating button's solid brand-blue circle, not the glass one. */
  prominent?: boolean;
}

export function GlassAssistantButton({
  testID,
  size,
  label,
  hint,
  onPress,
  prominent = false,
}: GlassAssistantButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: prominent ? brand.blue : withAlpha(brand.green, 0.14),
        borderWidth: prominent ? 0 : 1,
        borderColor: withAlpha(brand.green, 0.45),
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        elevation: 6,
        shadowColor: prominent ? '#000' : brand.green,
        shadowOpacity: prominent ? 0.25 : 0.3,
        shadowRadius: prominent ? 8 : 12,
        shadowOffset: { width: 0, height: 0 },
      })}
    >
      <SparkIcon size={Math.round(size * 0.46)} color={brand.green} />
    </Pressable>
  );
}
