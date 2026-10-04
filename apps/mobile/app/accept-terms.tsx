import { useState } from 'react';
import { useBack } from '../src/navigation/back';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAcceptTerms } from '../src/features/profile/hooks';
import { TermsReader } from '../src/features/profile/TermsReader';
import { captureException } from '../src/lib/telemetry';

/**
 * The Terms consent gate (migration 0153), pushed by useTermsGate for any
 * account that has not accepted CURRENT_TERMS_VERSION: Apple / Google
 * sign-ups (they never see the sign-up form), desk-created accounts, accounts
 * from before 2026-09-23, and everyone after a version bump.
 *
 * A native modal the guest cannot swipe away (its presentation is declared on
 * the root stack, app/_layout.tsx): the only way on is to read and accept.
 * Accept records the current version through app.accept_terms.
 */
function AcceptTermsScreen() {
  const { t } = useLocale();
  const back = useBack();
  const accept = useAcceptTerms();
  const [error, setError] = useState<string | null>(null);

  const onAccept = async () => {
    if (accept.isPending) return;
    setError(null);
    try {
      await accept.mutateAsync();
      back();
    } catch (err) {
      captureException(err, { scope: 'consent.accept' });
      setError(t('consent.failed'));
    }
  };

  return (
    <TermsReader
      testID="accept-terms"
      busy={accept.isPending}
      error={error}
      onAccept={() => void onAccept()}
    />
  );
}

export default function GuardedAcceptTermsScreen() {
  return (
    <RequireSession>
      <AcceptTermsScreen />
    </RequireSession>
  );
}
