import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/context';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Loading } from '../../src/components/ui';

/** Auth-gated group: everything here requires a session. */
export default function AppLayout() {
  const { session, initializing } = useAuth();
  const { t } = useLocale();
  if (initializing) return <Loading />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('courts.title') }} />
      <Stack.Screen name="availability" options={{ title: t('booking.title') }} />
      <Stack.Screen name="confirm" options={{ title: t('booking.confirmBooking') }} />
      <Stack.Screen name="bookings" options={{ title: t('booking.myBookings') }} />
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
    </Stack>
  );
}
