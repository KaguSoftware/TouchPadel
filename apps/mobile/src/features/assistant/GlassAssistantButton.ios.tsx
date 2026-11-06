/**
 * The assistant button on iOS: the system's own round SwiftUI button with the
 * "sparkles" symbol. Today's header (glass): Liquid Glass on iOS 26 and bordered
 * before it, tinted brand green; the floating one (`prominent`): a solid brand-blue
 * circle with a green spark, as the old one drew (Sait, 2026-11-02). Same pattern as `SheetButtons.ios.tsx`.
 * Other platforms are `GlassAssistantButton.tsx`.
 *
 * `testID` is REQUIRED and sits on the native button itself. The size is the
 * system's (large control), so `size` is not used here.
 */
import { Button as SwiftButton, Host } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  foregroundColor,
  labelStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../../lib/liquidGlass';
import { brand, useTheme } from '../../theme';
import type { GlassAssistantButtonProps } from './GlassAssistantButton';

const glassStyle = buttonStyle(liquidGlass ? 'glass' : 'bordered');
const prominentStyle = buttonStyle(liquidGlass ? 'glassProminent' : 'borderedProminent');

export function GlassAssistantButton({
  testID,
  label,
  onPress,
  prominent = false,
}: GlassAssistantButtonProps) {
  const { appearance } = useTheme();
  return (
    <Host matchContents colorScheme={appearance === 'dark' ? 'dark' : 'light'}>
      <SwiftButton
        testID={testID}
        label={label}
        systemImage="sparkles"
        onPress={onPress}
        modifiers={
          prominent
            ? [
                prominentStyle,
                buttonBorderShape('circle'),
                controlSize('large'),
                labelStyle('iconOnly'),
                tint(brand.blue),
                foregroundColor(brand.green),
              ]
            : [
                glassStyle,
                buttonBorderShape('circle'),
                controlSize('large'),
                labelStyle('iconOnly'),
                tint(brand.green),
              ]
        }
      />
    </Host>
  );
}
