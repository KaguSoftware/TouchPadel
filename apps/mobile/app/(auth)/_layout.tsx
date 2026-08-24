import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/context';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Loading } from '../../src/components/ui';

/** Public auth group. A signed-in user is bounced straight to the app. */
export default function AuthLayout() {
  const { session, initializing } = useAuth();
  const { t } = useLocale();
  if (initializing) return <Loading />;
  if (session) return <Redirect href="/(app)" />;
  return (
    <Stack>
      <Stack.Screen name="sign-in" options={{ title: t('auth.signIn') }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.signUp') }} />
      <Stack.Screen name="verify-email" options={{ title: t('auth.verifyEmailTitle') }} />
      <Stack.Screen name="forgot-password" options={{ title: t('auth.resetPasswordTitle') }} />
    </Stack>
  );
}
