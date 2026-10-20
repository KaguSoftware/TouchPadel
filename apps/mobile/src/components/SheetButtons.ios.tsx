/**
 * A sheet's own top-bar text button, native (Sait, 2026-10-20): a SwiftUI
 * capsule button, Liquid Glass on iOS 26 and bordered before it, as the
 * system's own sheets draw them. Android is `SheetButtons.tsx`.
 *
 * `testID` is REQUIRED and sits on the native button itself.
 */
import { Button as SwiftButton, Host } from '@expo/ui/swift-ui';
import { buttonBorderShape, buttonStyle, controlSize } from '@expo/ui/swift-ui/modifiers';
import { liquidGlass } from '../lib/liquidGlass';
import { useTheme } from '../theme';

interface SheetButtonProps {
  testID: string;
  label: string;
  onPress: () => void;
}

const style = buttonStyle(liquidGlass ? 'glass' : 'bordered');

export function SheetTextButton({ testID, label, onPress }: SheetButtonProps) {
  const { appearance } = useTheme();
  return (
    <Host matchContents colorScheme={appearance === 'dark' ? 'dark' : 'light'}>
      <SwiftButton
        testID={testID}
        label={label}
        onPress={onPress}
        modifiers={[style, buttonBorderShape('capsule'), controlSize('large')]}
      />
    </Host>
  );
}
