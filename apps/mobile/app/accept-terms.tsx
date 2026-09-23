import { useState } from 'react';
import { Linking, Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useBack } from '../src/navigation/back';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { signOut } from '../src/features/auth/api';
import { useAcceptTerms } from '../src/features/profile/hooks';
import { supabase } from '../src/lib/supabase';
import { legalUrl, type LegalPage } from '../src/lib/legal';
import { captureException } from '../src/lib/telemetry';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, FormScreen, LinkText, Screen, Title } from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * The Terms consent gate (migration 0153), pushed by useTermsGate for any
 * account that has not accepted CURRENT_TERMS_VERSION: Apple / Google
 * sign-ups (they never see the sign-up form), desk-created accounts, accounts
 * from before 2026-09-23, and everyone after a version bump.
 *
 * A native modal the guest cannot swipe away (its presentation is declared on
 * the root stack, app/_layout.tsx): the only ways out are to accept,
 * sign out, or delete the account instead. The documents open in the system
 * browser, as everywhere else in the app (5.1.1(i)).
 */
function AcceptTermsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const back = useBack();
  const toast = useToast();
  const accept = useAcceptTerms();
  const [agreed, setAgreed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (page: LegalPage) => {
    void Linking.openURL(legalUrl(page, locale)).catch(() => toast(t('settings.linkFailed'), 'error'));
  };

  const onAccept = async () => {
    if (!agreed || accept.isPending) return;
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
    <Screen gutter={20}>
      <FormScreen contentStyle={{ flexGrow: 1, paddingTop: space.l }}>
        <Title plain>{t('consent.title')}</Title>
        <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 22, color: colors.mut, marginTop: space.sm }}>
          {t('consent.body')}
        </Text>

        <View style={{ gap: space.sm, marginTop: space.m }}>
          <LinkText testID="accept-terms.read-terms" label={t('consent.readTerms')} onPress={() => open('terms')} />
          <LinkText testID="accept-terms.read-privacy" label={t('consent.readPrivacy')} onPress={() => open('privacy')} />
        </View>

        {/* The whole row toggles, so the label is a real target too. */}
        <Pressable
          testID="accept-terms.agree-row"
          accessibilityRole="switch"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.l }}
        >
          <Switch
            testID="accept-terms.agree"
            value={agreed}
            onValueChange={setAgreed}
            trackColor={{ true: colors.blue, false: colors.line }}
            accessibilityLabel={t('consent.agree')}
          />
          <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 20, color: colors.ink }}>
            {t('consent.agree')}
          </Text>
        </Pressable>

        <ErrorText>{error}</ErrorText>

        <Button
          testID="accept-terms.accept"
          label={t('consent.accept')}
          variant="primary"
          busy={accept.isPending}
          disabled={!agreed || signingOut}
          onPress={() => void onAccept()}
          style={{ marginTop: space.m }}
        />
        <Button
          testID="accept-terms.sign-out"
          label={t('consent.signOut')}
          variant="secondary"
          busy={signingOut}
          disabled={busy}
          onPress={() => void onSignOut()}
          style={{ marginTop: space.sm }}
        />
        <View style={{ marginTop: 'auto', paddingTop: space.l, alignItems: 'center' }}>
          <LinkText
            testID="accept-terms.delete-instead"
            label={t('consent.deleteInstead')}
            color={colors.redtext}
            onPress={() => router.push('/delete-account')}
          />
        </View>
      </FormScreen>
    </Screen>
  );
}

export default function GuardedAcceptTermsScreen() {
  return (
    <RequireSession>
      <AcceptTermsScreen />
    </RequireSession>
  );
}
