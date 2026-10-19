import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../src/i18n/LocaleProvider';
import { Screen } from '../src/components/ui';
import { CafeMenuView } from '../src/features/cafe/CafeMenuView';

/**
 * The café menu as a pushed screen, opened from the account page (Majed, 2026-10-17). To look
 * at, never to order from; the menu itself is `CafeMenuView`, which the Club tab shows too.
 */
export default function CafeMenuScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.cafeMenu') }} />
      <CafeMenuView testID="cafe-menu" bottomPad={insets.bottom + 40} />
    </Screen>
  );
}
