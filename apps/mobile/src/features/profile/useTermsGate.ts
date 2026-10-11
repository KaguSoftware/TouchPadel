import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/context';
import { isStaffArea } from '../staff/status';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { consentAction } from './consent';
import { useAcceptTerms, useOwnConsent } from './hooks';

/**
 * The Terms consent record (0153), mounted once in the root stack.
 *
 * A signed-in account that ticked the switch at sign-up for this version is
 * recorded silently once its session lands (see consent.ts). Nobody else is
 * interrupted here: the app does not open the consent screen at launch (owner,
 * 2026-10-10). An account that has not accepted meets app/accept-terms.tsx
 * where an action needs the terms, and that action does not go through until
 * it accepts: Review before a court booking (termsCheck), and the server's
 * TERMS_REQUIRED for open matches, lessons, tournaments and tickets.
 *
 * An anonymous session has no profile and is never recorded; a consent row
 * that has not loaded yet never triggers anything.
 *
 * A staff account is never recorded either (build-contracts-2026-09-23 §6.6):
 * the guest Terms are the booking app's, and a staff member works under the
 * venue's staff notice. Nor is its consent row read, which is why nothing is
 * read until the account's own staff row has answered: before that a staff
 * account reads `guest`.
 */
export function useTermsGate(): void {
  const { session } = useAuth();
  const { status, answered } = useStaffStatus();
  const user = session?.user ?? null;
  const uid = user && !user.is_anonymous && answered && !isStaffArea(status.kind) ? user.id : null;
  const consent = useOwnConsent(uid);
  const accept = useAcceptTerms();
  const recording = useRef(false);

  const action = uid ? consentAction(consent.data, user?.user_metadata) : 'none';

  useEffect(() => {
    if (action !== 'record' || recording.current) return;
    recording.current = true;
    addBreadcrumb('consent.record-from-signup');
    accept.mutate(undefined, {
      // A failure (offline) leaves the row as it was; the next launch retries.
      onError: (error) => captureException(error, { scope: 'consent.record' }),
      onSettled: () => {
        recording.current = false;
      },
    });
    // `accept` is a fresh object each render; the action decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
}
