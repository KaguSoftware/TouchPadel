import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { sendPasswordReset } from '../../src/features/auth/api';
import { resetRedirect } from '../../src/features/auth/redirects';
import { linkErrorParam } from '../../src/features/auth/deepLink';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  Screen,
  ScreenHeader,
  Title,
} from '../../src/components/ui';

/**
 * Forgot password (design 2026-08-31). The submitted state deliberately does
 * NOT disclose whether the account exists (spec 05.7).
 */
export default function ForgotPasswordScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where useAuthDeepLink sends a dead recovery link — a new one is one tap away.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(supabase, email, resetRedirect());
      setSent(true);
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20}>
      <ScreenHeader />
      <FormScreen>
        <Title plain size={24}>
          {t('auth.resetPasswordTitle')}
        </Title>
        {sent ? (
          <>
            <View
              style={{
                marginTop: space.m,
                backgroundColor: colors.gtint,
                borderWidth: 1,
                borderColor: colors.gline,
                borderRadius: radius.button,
                padding: space.m,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  lineHeight: 21,
                  color: colors.gtext2,
                }}
              >
                {t('auth.resetSubmitted')}
              </Text>
            </View>
            <Button
              label={t('auth.backToSignIn')}
              variant="secondary"
              size="medium"
              // A dead recovery link lands here with no history beneath it.
              onPress={() => router.replace('/(auth)/sign-in')}
              style={{ marginTop: space.sm }}
            />
          </>
        ) : (
          <>
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 13,
                lineHeight: 20,
                color: colors.mut,
                marginTop: 8,
              }}
            >
              {t('auth.forgotIntro')}
            </Text>
            <Field
              placeholder={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              style={{ marginTop: 2 }}
              onSubmitEditing={() => void onSubmit()}
            />
            <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
            <Button
              label={t('auth.sendResetLink')}
              onPress={() => void onSubmit()}
              busy={busy}
              variant="primary"
              style={{ marginTop: space.sm }}
            />
          </>
        )}
      </FormScreen>
    </Screen>
  );
}
