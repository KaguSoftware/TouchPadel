import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth } from '../../src/features/auth/context';
import { needsProfileCompletion } from '../../src/features/auth/social';
import { usePendingSlot } from '../../src/features/booking/pendingSlot';
import { useOwnProfile } from '../../src/features/profile/hooks';
import { Loading } from '../../src/components/ui';

/**
 * Public auth group. A signed-in user is bounced out — EXCEPT:
 *  - verify-email / verify-result, which legitimately render around the moment
 *    the session lands (the emailed link signs the user in mid-screen),
 *  - complete-profile, which a signed-in user must be allowed to stay on, and
 *  - any screen while a pending slot exists: the screen's own post-auth
 *    continuation is about to place the hold and route to Review, and a layout
 *    redirect racing it would win and strand the guest on the tabs.
 *
 * WHERE a signed-in user goes is decided from DERIVED state (the own-profile
 * row), so a screen's own navigation can never race a <Redirect>: a first
 * social sign-in has no phone (the trigger writes NULL for OAuth users) -> the
 * complete-profile step (owner decision D3, 2026-09-01); otherwise the tabs.
 * The profile query shares its cache entry with useSocialSignIn's fetch (one
 * request); a query error fails open to the tabs — the booking path re-checks.
 * useSocialSignIn therefore navigates to complete-profile itself ONLY while a
 * pending slot exists (the exempt case below); otherwise it returns and this
 * layout routes — two replaces would re-key and remount the form.
 *
 * The pending slot is a SUBSCRIPTION (usePendingSlot), so this guard actually
 * re-evaluates when it changes, and it stays set until the hold has settled.
 */
export default function AuthLayout() {
  const { session, initializing } = useAuth();
  const segments = useSegments();
  const pending = usePendingSlot();
  const profile = useOwnProfile(!!session);
  const screen = segments[segments.length - 1];
  const exempt =
    screen === 'verify-email' ||
    screen === 'verify-result' ||
    screen === 'complete-profile' ||
    pending !== null;

  if (initializing) return <Loading />;
  if (session && !exempt) {
    if (profile.isPending) return <Loading />;
    if (needsProfileCompletion(profile.data)) return <Redirect href="/(auth)/complete-profile" />;
    return <Redirect href="/(tabs)" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
