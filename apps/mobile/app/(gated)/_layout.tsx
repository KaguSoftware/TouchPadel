import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/features/auth/context';
import { Loading } from '../../src/components/ui';

/**
 * Auth-gated group: review/success/booking-detail/profile-edit/change-password.
 * Browsing lives OUTSIDE this group (public); only writes and personal records
 * demand a session.
 */
export default function GatedLayout() {
  const { session, initializing } = useAuth();
  if (initializing) return <Loading />;
  if (!session) return <Redirect href="/(auth)/welcome" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
