import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { AccountButton } from '../../src/components/AccountButton';
import { Screen, SegmentedControl, TAB_TITLE_TOP, Title } from '../../src/components/ui';
import { EmptyState, SkeletonList } from '../../src/components/states';
import { space } from '../../src/theme';
import { useAuth } from '../../src/features/auth/context';
import { useMyLoyalty } from '../../src/features/loyalty/hooks';
import { loyaltyOn } from '../../src/features/loyalty/logic';
import { MemberCardPanel } from '../../src/features/loyalty/MemberCardPanel';
import { PointsCard } from '../../src/features/loyalty/PointsCard';
import { useOwnProfile } from '../../src/features/profile/hooks';
import { nameFieldsOf } from '../../src/features/profile/names';
import { CafeMenuView } from '../../src/features/cafe/CafeMenuView';

type ClubView = 'card' | 'menu';

/**
 * The Club tab, the bar's centre (Majed, 2026-10-19): the two things a guest reaches for at the
 * café counter, one tap from anywhere. The member card's live QR (with the points it has earned,
 * opening Points & rewards) and the café menu, to look at; ordering stays at the table's QR and
 * the counter.
 *
 * Signed in with loyalty on, it opens on the card, which is what the cashier asks for. Signed
 * out, the card view asks the guest to sign in. With loyalty switched off by the owner there is
 * no card to show (build contracts L-1), so the switch goes and the tab is the menu alone.
 *
 * `show=card` (Profile's member card, Points & rewards' "Show my member card") opens it on the
 * card whatever was picked last: there is one member card screen, and it is this one.
 */
export default function ClubScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const loyalty = useMyLoyalty(member);
  // The name embossed on the points card, as Profile has it (the email fallback stays hidden).
  const profile = useOwnProfile(member);
  const name = nameFieldsOf(profile.data, session?.user.email ?? null);
  const holder = `${name.first} ${name.last}`.trim();
  // Signed out, the card view is still offered (it is how a guest learns there is one); signed
  // in, only while the owner has loyalty on.
  const offersCard = !member || loyalty.isPending || loyaltyOn(loyalty.data);
  const [picked, setPicked] = useState<ClubView | null>(null);
  // A `show` the tab is sent with re-applies when it changes, during render as Play's does. The
  // guest's own switch clears it, so the next "show my card" is a change and lands again.
  const { show } = useLocalSearchParams<{ show?: string }>();
  const [showSeen, setShowSeen] = useState<string | undefined>(undefined);
  if (show !== showSeen) {
    setShowSeen(show);
    if (show === 'card' || show === 'menu') setPicked(show);
  }
  const pick = (v: ClubView) => {
    setPicked(v);
    if (show) router.setParams({ show: undefined });
  };
  const view: ClubView = !offersCard ? 'menu' : (picked ?? (member ? 'card' : 'menu'));
  const bottomPad = tabBarHeight + 24;

  const card = () => {
    if (!member) {
      return (
        <EmptyState
          testID="club.signed-out"
          title={t('loyalty.guest.card.title')}
          message={t('loyalty.guest.card.signInPitch')}
          actionLabel={t('auth.signIn')}
          onAction={() => router.push('/sign-in')}
          actionTestID="club.sign-in"
        />
      );
    }
    if (loyalty.isPending) return <SkeletonList rows={1} height={300} />;
    return (
      <MemberCardPanel testID="club.card" bottomPad={bottomPad}>
        {/* The points this card has earned, as a card of their own, and the way to what they buy. */}
        {loyalty.data ? (
          <PointsCard
            testID="club.loyalty"
            loyalty={loyalty.data}
            holder={holder}
            onPress={() => router.push({ pathname: '/loyalty', params: { from: 'club' } })}
          />
        ) : null}
      </MemberCardPanel>
    );
  };

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
          <Title fit>{t('tabs.club')}</Title>
        </View>
        <AccountButton testID="club.account" />
      </View>
      {offersCard ? (
        <SegmentedControl
          testID="club.view"
          options={[
            { value: 'card', label: t('loyalty.guest.card.title') },
            { value: 'menu', label: t('profile.cafeMenu') },
          ]}
          value={view}
          onChange={pick}
        />
      ) : null}
      <View style={{ flex: 1, marginTop: offersCard ? space.s : 0 }}>
        {view === 'card' ? card() : <CafeMenuView testID="club.menu" bottomPad={bottomPad} />}
      </View>
    </Screen>
  );
}
