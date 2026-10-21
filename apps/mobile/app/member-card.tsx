import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { MemberCardPanel } from '../src/features/loyalty/MemberCardPanel';
import { Screen } from '../src/components/ui';

/**
 * The member card as a pushed screen (loyalty plan §5.1), opened from Profile and Points &
 * rewards. The card itself is `MemberCardPanel`, which the Club tab shows too.
 */
function MemberCardScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('loyalty.guest.card.title') }} />
      <MemberCardPanel testID="member-card" bottomPad={40 + insets.bottom} />
    </Screen>
  );
}

/** Signed-in only: a member card belongs to an account (RequireSession). */
export default function GuardedMemberCardScreen() {
  return (
    <RequireSession>
      <MemberCardScreen />
    </RequireSession>
  );
}
