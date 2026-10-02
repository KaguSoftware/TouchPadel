/**
 * Per-screen gate for coach mode, the RequireStaff shape: every
 * `app/coach-mode*.tsx` wraps itself in it (docs/design/coaching/guest.md
 * §4.13.1).
 *
 *   pending           coach_me is being read: a spinner
 *   coach             the screen
 *   retired           the statements screen (`allowRetired`), else sent there (C-25)
 *   guest, none       Profile; a staff session goes on to the hub through GuestTabsGate
 *   error             "Coach mode didn't open", with Try again
 *
 * A coach-mode screen is a READER (it keeps coach_me read while mounted) and
 * re-reads it when it mounts on an answer older than half a minute, so a coach
 * paused, retired or switched off at the desk meets the new state on the next
 * screen they open. RequireStaff is never on these screens: a staff member who
 * coaches reaches them from the hub (C-27), and StaffStatusProvider still
 * answers `staff` and still owns the tabs.
 */
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useLocale } from '../../i18n/LocaleProvider';
import { space } from '../../theme';
import { Loading, Screen } from '../../components/ui';
import { ErrorState } from '../../components/states';
import { coachGate } from './gate';
import { useCoachStatus } from './CoachStatusProvider';

/** How old a coach_me answer may be when a coach-mode screen mounts. */
export const COACH_SCREEN_REFRESH_MS = 30_000;

export function RequireCoach({
  allowRetired = false,
  children,
}: {
  /** The statements screen only (C-25, R45). */
  allowRetired?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { status, retry, refreshIfOlder } = useCoachStatus({ read: true });

  useEffect(() => {
    refreshIfOlder(COACH_SCREEN_REFRESH_MS);
  }, [refreshIfOlder]);

  switch (coachGate(status, allowRetired ? 'statements' : 'mode')) {
    case 'loading':
      return <Loading />;
    case 'redirect-statements':
      return <Redirect href="/coach-mode-statements" />;
    case 'redirect-home':
      return <Redirect href="/(tabs)/profile" />;
    case 'error':
      return (
        <Screen edges={[]}>
          <View style={{ flex: 1, justifyContent: 'center', gap: space.l }}>
            <ErrorState
              testID="coach-mode.status-error"
              title={t('coaching.coach.status.errorTitle')}
              message={t('coaching.coach.status.error')}
              retryLabel={t('common.retry')}
              onRetry={retry}
            />
          </View>
        </Screen>
      );
    default:
      return <>{children}</>;
  }
}
