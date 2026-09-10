/**
 * Sign in with Apple button — iOS. The system-rendered control: it self-localises
 * to the DEVICE language, mirrors natively, and is HIG-compliant by construction.
 * BLACK on the light theme; WHITE in dark (highest contrast on the navy #0D1830 —
 * WHITE_OUTLINE's black hairline is designed for white surfaces and vanishes
 * there). CONTINUE on both screens: a social tap may be a sign-in or a sign-up.
 */
import { ActivityIndicator, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { radius, useTheme, vendor } from '../theme';
import type { AppleButtonProps } from './AppleButton';

export type { AppleButtonProps } from './AppleButton';

export function AppleButton({ label, onPress, busy, disabled, height }: AppleButtonProps) {
  const { appearance } = useTheme();
  const dark = appearance === 'dark';
  if (busy) {
    // The native button cannot show a spinner; a same-geometry placeholder
    // avoids any layout shift while the Apple sheet / Supabase call runs.
    return (
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: true, disabled: true }}
        style={{
          height,
          alignSelf: 'stretch',
          borderRadius: radius.button,
          backgroundColor: dark ? vendor.apple.white : vendor.apple.black,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={dark ? vendor.apple.black : vendor.apple.white} />
      </View>
    );
  }
  return (
    // While disabled the wrapper becomes the accessibility element (so VoiceOver says
    // "dimmed" instead of offering a button that swallows the tap); enabled, the native
    // control speaks for itself.
    <View
      accessible={disabled}
      accessibilityRole={disabled ? 'button' : undefined}
      accessibilityLabel={disabled ? label : undefined}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={{ alignSelf: 'stretch', opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={
          dark
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={radius.button}
        onPress={onPress}
        style={{ height, width: '100%' }}
      />
    </View>
  );
}
