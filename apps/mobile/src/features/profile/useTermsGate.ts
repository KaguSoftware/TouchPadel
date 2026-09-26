import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '../auth/context';
import { isStaffArea } from '../staff/status';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { consentAction } from './consent';
import { useAcceptTerms, useOwnConsent } from './hooks';

/**
 * Screens the gate never covers: the consent screen itself, and the one a
 * guest who will not accept is offered instead of accepting.
 */
const EXEMPT = new Set(['/accept-terms', '/delete-account']);

/**
 * The Terms consent gate (0153), mounted once in the root stack.
 *
 * A signed-in account whose recorded version is not CURRENT_TERMS_VERSION is
 * either recorded silently (it ticked the switch at sign-up for this version,
 * see consent.ts) or shown app/accept-terms.tsx. An anonymous session has no
 * profile and is never gated; a consent row that has not loaded yet never
 * triggers anything, so the gate cannot flash over a guest who already agreed.
 *
 * A staff account is never gated either (build-contracts-2026-09-23 §6.6): the
 * guest Terms are the booking app's, and a staff member works under the
 * venue's staff notice. Nor is its consent row read, which is why nothing is
 * read until the account's own staff row has answered: before that a staff
 * account reads `guest`.
 */
export function useTermsGate(): void {
  const { session } = useAuth();
  const { status, answered } = useStaffStatus();
  const user = session?.user ?? null;
  const uid = user && !user.is_anonymous && answered && !isStaffArea(status.kind) ? user.id : null;
  const pathname = usePathname();
  const consent = useOwnConsent(uid);
  const accept = useAcceptTerms();
  const recording = useRef(false);

  const action = uid ? consentAction(consent.data, user?.user_metadata) : 'none';

  useEffect(() => {
    if (action === 'record' && !recording.current) {
      recording.current = true;
      addBreadcrumb('consent.record-from-signup');
      accept.mutate(undefined, {
        // A failure (offline) leaves the row as it was; the next launch retries.
        onError: (error) => captureException(error, { scope: 'consent.record' }),
        onSettled: () => {
          recording.current = false;
        },
      });
    } else if (action === 'ask' && !EXEMPT.has(pathname)) {
      addBreadcrumb('consent.ask');
      router.push('/accept-terms');
    }
    // `accept` is a fresh object each render; the action and route decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, pathname]);
}
