import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBack } from '../src/navigation/back';
import { space, useTheme } from '../src/theme';

/**
 * `touchpadel://auth-callback?code=…` — where GoTrue sends the browser after
 * Google sign-in in the browser (src/features/auth/providers/googleWeb.ts, the
 * Android fallback).
 *
 * It does NOTHING with the code. The sign-in that opened the browser, or
 * useAuthDeepLink when nobody is waiting, exchanges it; expo-router only routes
 * the same link here as well. So this steps out of the way: back to the sign-in
 * or sign-up screen underneath, where the sign-in goes on, or on to the tabs
 * when the app was started by the link and there is nothing underneath.
 */
export default function AuthCallbackScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const back = useBack();

  useEffect(() => {
    // Once per landing: useBack is stable across renders.
    back();
  }, [back]);

  return (
    <View
      testID="auth-callback.waiting"
      accessibilityRole="progressbar"
      accessibilityLabel={t('auth.signingIn')}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        backgroundColor: colors.bg,
      }}
    >
      <ActivityIndicator color={colors.blue} size="large" />
      <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>{t('auth.signingIn')}</Text>
    </View>
  );
}
