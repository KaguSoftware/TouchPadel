import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useBack } from '../src/navigation/back';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { signOut } from '../src/features/auth/api';
import { useAcceptTerms } from '../src/features/profile/hooks';
import { TermsReader } from '../src/features/profile/TermsReader';
import { supabase } from '../src/lib/supabase';
import { captureException } from '../src/lib/telemetry';
import { space, useTheme } from '../src/theme';
import { Button, LinkText } from '../src/components/ui';

/**
 * The Terms consent gate (migration 0153), pushed by useTermsGate for any
 * account that has not accepted CURRENT_TERMS_VERSION: Apple / Google
 * sign-ups (they never see the sign-up form), desk-created accounts, accounts
 * from before 2026-09-23, and everyone after a version bump.
 *
 * A native modal the guest cannot swipe away (its presentation is declared on
 * the root stack, app/_layout.tsx): the only ways out are to read and accept,
 * sign out, or delete the account instead. A guest who does not agree must
 * still be able to leave and to delete the account in the app (App Store
 * 5.1.1(v), SEC-16). Accept records the current version through app.accept_terms.
 */
function AcceptTermsScreen() {
  const { t } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const back = useBack();
  const accept = useAcceptTerms();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAccept = async () => {
    if (accept.isPending || signingOut) return;
    setError(null);
    try {
      await accept.mutateAsync();
      back();
    } catch (err) {
      captureException(err, { scope: 'consent.accept' });
      setError(t('consent.failed'));
    }
  };

  const onSignOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      await signOut(supabase);
      router.replace('/(tabs)');
    } catch (err) {
      captureException(err, { scope: 'consent.sign-out' });
      setError(t('consent.failed'));
    } finally {
      setSigningOut(false);
    }
  };

  const busy = accept.isPending || signingOut;

  return (
    <TermsReader
      testID="accept-terms"
      busy={accept.isPending}
      error={error}
      onAccept={() => void onAccept()}
      footer={
        <View style={{ gap: space.sm, marginBottom: space.l }}>
          <Button
            testID="accept-terms.sign-out"
            label={t('consent.signOut')}
            variant="secondary"
            busy={signingOut}
            disabled={busy}
            onPress={() => void onSignOut()}
          />
          <View style={{ alignItems: 'center' }}>
            <LinkText
              testID="accept-terms.delete-instead"
              label={t('consent.deleteInstead')}
              color={colors.redtext}
              onPress={() => router.push('/delete-account')}
            />
          </View>
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
