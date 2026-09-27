/**
 * Per-screen gate for the staff area, the RequireSession shape: every
 * `app/staff*.tsx` wraps itself in it (build-contracts-2026-09-23 §6.1).
 *
 *   pending      the row is still being read: a spinner, then after 10 s a
 *                way to try again or sign out, never an endless wheel
 *   guest, none  the guest app
 *   wrong role   Today
 *   revoked      "This staff account is switched off", full screen, Sign out
 *   unsupported  "Update the app", full screen, Sign out
 *
 * Revoked and unsupported never fall back to the guest UI: the account is a
 * staff account, and showing it the tabs would hide why its work vanished.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect } from 'expo-router';
import type { StaffRole } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { supabase } from '../../lib/supabase';
import { captureException } from '../../lib/telemetry';
import { space, useTheme } from '../../theme';
import { Button, ErrorText, Loading, Screen } from '../../components/ui';
import { ErrorState } from '../../components/states';
import { signOut } from '../auth/api';
import { mapErrorToKey } from '../booking/errors';
import { staffGate } from './gate';
import { useStaffStatus } from './StaffStatusProvider';

/** How long the pending spinner runs before it offers a way out. */
const SLOW_MS = 10_000;

/**
 * Sign the staff account out. Where the phone goes next is the gates' call:
 * the status turns `none`, and RequireStaff sends a signed-out phone to the
 * guest app.
 */
export function useStaffSignOut(): {
  signOut: () => Promise<void>;
  busy: boolean;
  error: string | null;
} {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await signOut(supabase);
    } catch (err) {
      captureException(err, { scope: 'staff.signOut' });
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  }, [t]);
  return { signOut: run, busy, error };
}

export function StaffPending() {
  const { t } = useLocale();
  const { retry } = useStaffStatus();
  const out = useStaffSignOut();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return <Loading />;
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.l }}>
        <ErrorState
          testID="staff.pending"
          title={t('errors.loadFailedTitle')}
          message={t('staff.shell.pending.slow')}
          retryLabel={t('common.retry')}
          onRetry={retry}
        />
        <Button
          testID="staff.pending.sign-out"
          label={t('auth.signOut')}
          variant="secondary"
          size="medium"
          busy={out.busy}
          onPress={() => void out.signOut()}
        />
        <ErrorText>{out.error}</ErrorText>
      </View>
    </Screen>
  );
}

/** The two dead ends a staff account can reach: switched off, or a role this build does not know. */
export function StaffBlocked({ kind }: { kind: 'revoked' | 'unsupported' }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const out = useStaffSignOut();
  const copy: Record<typeof kind, { title: MessageKey; body: MessageKey; testID: string }> = {
    revoked: {
      title: 'staff.shell.revoked.title',
      body: 'staff.shell.revoked.body',
      testID: 'staff.revoked.sign-out',
    },
    unsupported: {
      title: 'staff.shell.update.title',
      body: 'staff.shell.update.body',
      testID: 'staff.update.sign-out',
    },
  };
  const { title, body, testID } = copy[kind];
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: space.m }}>
        <Text
          style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}
        >
          {t(title)}
        </Text>
        <Text
          style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 21, color: colors.mut }}
        >
          {t(body)}
        </Text>
        <Button
          testID={testID}
          label={t('auth.signOut')}
          variant="primary"
          busy={out.busy}
          onPress={() => void out.signOut()}
          style={{ marginTop: space.l }}
        />
        <ErrorText>{out.error}</ErrorText>
      </ScrollView>
    </Screen>
  );
}

export function RequireStaff({
  roles,
  children,
}: {
  roles?: readonly StaffRole[];
  children: ReactNode;
}) {
  const { status } = useStaffStatus();
  switch (staffGate(status, roles)) {
    case 'loading':
      return <StaffPending />;
    case 'redirect-guest':
      return <Redirect href="/(tabs)" />;
    case 'redirect-staff-home':
      return <Redirect href="/staff" />;
    case 'revoked':
      return <StaffBlocked kind="revoked" />;
    case 'unsupported':
      return <StaffBlocked kind="unsupported" />;
    default:
      return <>{children}</>;
  }
}
