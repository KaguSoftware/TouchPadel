import { useEffect } from 'react';
import { Stack, usePathname, useRouter } from 'expo-router';
import { useLocale } from '../src/i18n/LocaleProvider';
import { captureMessage } from '../src/lib/telemetry';
import { requestBookingSheet } from '../src/features/courtTransition/openIntent';
import { PayStateLayout } from '../src/features/deposit/PayStateLayout';
import { Button, Screen } from '../src/components/ui';

/**
 * Any path into the app that names no screen (plan §5.1): a mangled deep link,
 * an old push, a typo'd return URL from a payment page. expo-router's own
 * fallback is a developer screen; this is the guest's, with the two places a
 * guest is most likely to have been heading.
 *
 * The path is logged (not its query, which may carry a code or a ref) so a
 * link that keeps landing here can be found and fixed at its source.
 */
export default function NotFoundScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    captureMessage('route.not-found', 'info', { pathname });
  }, [pathname]);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: '' }} />
      <PayStateLayout
        testID="not-found.state"
        tone="missing"
        title={t('errors.pageMissingTitle')}
        body={t('errors.pageMissingBody')}
        actions={
          <>
            <Button
              testID="not-found.bookings"
              label={t('booking.myBookings')}
              variant="cta"
              onPress={() => router.replace('/(tabs)/bookings')}
            />
            <Button
              testID="not-found.book"
              label={t('booking.title')}
              variant="secondary"
              onPress={() => {
                requestBookingSheet();
                router.replace('/(tabs)');
              }}
            />
          </>
        }
      />
    </Screen>
  );
}
