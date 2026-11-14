import { View } from 'react-native';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { AccountButton } from '../../src/components/AccountButton';
import { Screen, TAB_TITLE_TOP, Title } from '../../src/components/ui';
import { space } from '../../src/theme';
import { RanksView } from '../../src/features/ranks/RanksView';

/**
 * Rankings, the players' leaderboard (Majed, 2026-11-12): the bar's first tab, in the slot My
 * reservations held. My reservations is a page off Profile now (app/bookings.tsx). It was a
 * segment of Club from 2026-10-25 and a tab of its own before that (0364).
 *
 * The label is "Rankings", not "Ranks", so it carries about the width of Coaches at the other
 * end of the bar and Book stays in the middle.
 *
 * The view is the shared one (features/ranks/RanksView.tsx): signed out it still shows the
 * public board and asks for a sign-in below it, so this screen needs no prompt of its own.
 */
export default function RanksScreen() {
  const { t } = useLocale();
  const tabBarHeight = useTabBarHeight();

  return (
    <Screen pattern="blur">
      <View
        style={{
          paddingTop: TAB_TITLE_TOP,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Title fit>{t('tabs.ranks')}</Title>
        </View>
        <AccountButton testID="ranks.account" />
      </View>
      <View style={{ flex: 1, marginTop: space.s }}>
        <RanksView testID="ranks.view" bottomPad={tabBarHeight + 24} />
      </View>
    </Screen>
  );
}
