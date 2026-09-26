/**
 * Sign in with Apple button — the NON-iOS resolution (Metro picks
 * AppleButton.ios.tsx on iOS). Apple is iOS only (owner decision D2), so this
 * renders nothing and Android never bundles expo-apple-authentication. tsc
 * type-checks against THIS file: both files must export the same props.
 */
export interface AppleButtonProps {
  /** Accessibility label for the busy placeholder (the native button self-labels). */
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Shared geometry with the Google button (components/social.tsx). */
  height: number;
  /**
   * `<route>.apple`. Forwarded on iOS to the busy placeholder and to the
   * native `AppleAuthenticationButton` (AppleButton.ios.tsx). Nothing renders
   * here, so nothing carries it on Android — a test that looks for it is
   * asserting the platform, which is what `available.apple` already says.
   */
  testID?: string;
}

export function AppleButton(_props: AppleButtonProps): null {
  return null;
}
