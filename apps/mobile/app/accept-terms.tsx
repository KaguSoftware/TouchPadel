import { useState } from 'react';
import { View } from 'react-native';
import { useBack } from '../src/navigation/back';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAcceptTerms } from '../src/features/profile/hooks';
import { TermsReader } from '../src/features/profile/TermsReader';
import { captureException } from '../src/lib/telemetry';
import { space } from '../src/theme';
import { Button } from '../src/components/ui';

/**
 * The Terms consent screen (migration 0153) for an account that has not
 * accepted CURRENT_TERMS_VERSION: Apple / Google sign-ups (they never see the
 * sign-up form), desk-created accounts, accounts from before 2026-09-23, and
 * everyone after a version bump.
 *
 * Never pushed at launch (owner, 2026-10-10). It opens where an action needs
 * the terms: Review before a court booking, and the open-match, lesson,
 * tournament and ticket screens on the server's TERMS_REQUIRED. Accept records
 * the current version through app.accept_terms and pops back to that action.
 *
 * The same sheet as the sign-up review (app/terms-review.tsx): swipe it away or
 * press Not now and nothing is recorded, so the action that opened it is still
 * refused. The account stays usable for everything else, deleting it included
 * (Edit profile; App Store 5.1.1(v), SEC-16).
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
      footer={
        <View style={{ marginBottom: space.l }}>
          <Button
            testID="accept-terms.not-now"
            label={t('consent.notNow')}
            variant="secondary"
            disabled={accept.isPending}
            onPress={back}
          />
        </View>
      }
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
