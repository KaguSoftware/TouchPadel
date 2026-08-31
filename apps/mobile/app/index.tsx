import { Redirect } from 'expo-router';

/**
 * Entry. Browsing is public (owner decision 2026-08-31): everyone lands on the
 * tabs; auth is demanded at slot selection (pending-slot flow) and on the
 * gated group. The old session-gate redirect to sign-in is deliberately gone.
 */
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
