import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '../../src/features/auth/context';
import { getPendingSlot } from '../../src/features/booking/pendingSlot';
import { Loading } from '../../src/components/ui';

/**
 * Public auth group. A signed-in user is bounced to the tabs — EXCEPT:
 *  - verify-email / verify-result, which legitimately render around the moment
 *    the session lands (the emailed link signs the user in mid-screen), and
 *  - any screen while a pending slot exists: the screen's own post-auth
 *    continuation is about to place the hold and route to Review, and a layout
 *    redirect racing it would win and strand the guest on the tabs.
 */
export default function AuthLayout() {
  const { session, initializing } = useAuth();
  const segments = useSegments();
  const screen = segments[segments.length - 1];
  const exempt =
    screen === 'verify-email' || screen === 'verify-result' || getPendingSlot() !== null;

  if (initializing) return <Loading />;
  if (session && !exempt) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
