/**
 * Per-screen "signed-out only" gate, replacing the `(auth)` group layout.
 *
 * The group had to go so its screens could sit on the root stack: a screen
 * pushed from the tabs was the first entry of the nested (auth) stack, so
 * `canGoBack` was false there and UIKit drew no back item of its own — the one
 * remaining reason the app shipped a hand-drawn back button.
 *
 * The redirect rule is carried over EXACTLY, including its exemption. A
 * signed-in user is bounced to the tabs, except while a pending slot exists:
 * the screen's own post-auth continuation is about to place the hold and route
 * to Review, and a redirect racing it would win and strand the guest on the
 * tabs. `usePendingSlot` is a subscription, so this re-evaluates when it
 * changes, and the intent lives until the hold has settled.
 *
 * verify-email / verify-result do NOT use this: they legitimately render around
 * the moment the session lands (the emailed link signs the user in mid-screen),
 * which is why the old layout exempted them by name.
 */
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from './context';
import { noSessionGate } from './gate';
import { usePendingSlot } from '../booking/pendingSlot';
import { Loading } from '../../components/ui';

export function RequireNoSession({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  const pending = usePendingSlot();
  switch (
    noSessionGate({ initializing, hasSession: session !== null, hasPendingSlot: pending !== null })
  ) {
    case 'loading':
      return <Loading />;
    case 'redirect':
      return <Redirect href="/(tabs)" />;
    default:
      return <>{children}</>;
  }
}
