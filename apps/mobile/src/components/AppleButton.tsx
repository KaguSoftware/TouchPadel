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
}

export function AppleButton(_props: AppleButtonProps): null {
  return null;
}
