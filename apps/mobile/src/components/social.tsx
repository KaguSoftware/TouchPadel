/**
 * "Continue with Apple" / "Continue with Google" (vendor addition 2026-09-01).
 *
 * Both buttons share ONE geometry — height 50 (= Button regular minH), radius
 * 14, full width — so they read as a pair. Apple is the system-rendered
 * AppleAuthenticationButton (./AppleButton.ios.tsx; nothing on Android, owner
 * decision D2). Google is a custom Pressable in the platform SYSTEM font: Google's
 * official button specifies Google Sans Medium 14, which we cannot ship, and the
 * system face optically matches the native Apple label at this height. The four-
 * colour "G" mark, fill/stroke/text colours and light/dark themes follow Google's
 * branding guidelines exactly; the mark is never recoloured or mirrored.
 *
 * Deliberately NOT the app's `Button`: that one uppercases its label (Archivo)
 * and has no icon slot — these are third-party brand buttons, not app CTAs.
 */
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme, vendor } from '../theme';
import type { SocialProvider } from '../features/auth/social';
import type { SocialAvailability } from '../features/auth/useSocialSignIn';
import { AppleButton } from './AppleButton';
import { GoogleGMark } from './icons';

/** = Button regular minH, so the pair matches the email CTA beneath the divider. */
export const SOCIAL_BUTTON_HEIGHT = 50;
const GAP = 10;

export function GoogleButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { appearance } = useTheme();
  const g = vendor.google[appearance];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        height: SOCIAL_BUTTON_HEIGHT,
        alignSelf: 'stretch',
        borderRadius: radius.button,
        borderWidth: 1,
        borderColor: g.stroke,
        backgroundColor: pressed ? g.pressed : g.bg,
        // A row mirrors under RTL by itself: the mark lands on the leading side.
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingStart: space.l,
        paddingEnd: space.l,
        opacity: disabled && !busy ? 0.55 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={g.text} />
      ) : (
        <>
          <GoogleGMark size={20} />
          {/* No fontFamily on purpose: the platform system face (SF / Roboto). Dynamic
              Type is capped at 1.2x: the row is a fixed 50pt to match the native Apple
              button (which ignores text scaling), and the Arabic label must never
              truncate — Google's guidelines forbid an ellipsised label. */}
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 17, fontWeight: '600', color: g.text }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The block above the email form. Renders nothing when neither provider is
 * available (Android in Expo Go), so those screens look exactly as before.
 * Apple first: the HIG asks for it to be no less prominent than other options.
 */
export function SocialSignInBlock({
  available,
  busyProvider,
  disabled,
  onPress,
  style,
}: {
  available: SocialAvailability;
  busyProvider: SocialProvider | null;
  disabled?: boolean;
  onPress: (provider: SocialProvider) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useLocale();
  if (!available.apple && !available.google) return null;
  const otherBusy = (p: SocialProvider) => busyProvider !== null && busyProvider !== p;
  return (
    <View style={[{ gap: GAP }, style]}>
      {available.apple ? (
        <AppleButton
          label={t('auth.continueWithApple')}
          onPress={() => onPress('apple')}
          busy={busyProvider === 'apple'}
          disabled={disabled || otherBusy('apple')}
          height={SOCIAL_BUTTON_HEIGHT}
        />
      ) : null}
      {available.google ? (
        <GoogleButton
          label={t('auth.continueWithGoogle')}
          onPress={() => onPress('google')}
          busy={busyProvider === 'google'}
          disabled={disabled || otherBusy('google')}
        />
      ) : null}
    </View>
  );
}
