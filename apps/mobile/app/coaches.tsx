import { useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { BranchPicker } from '../src/features/availability/BranchPicker';
import { branchName } from '../src/features/availability/branch';
import { venuePhoneOf } from '../src/features/availability/assemble';
import { useCoachingBranch, useCoachingPublic } from '../src/features/coaching/hooks';
import {
  coachesAt,
  displayCoachName,
  kindsTaught,
  lowestOfferPrice,
} from '../src/features/coaching/logic';
import { lessonErrorText } from '../src/features/coaching/errors';
import { callPhone } from '../src/lib/phone';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { space, useTheme } from '../src/theme';
import { Button, Hint, Screen } from '../src/components/ui';
import { MenuRow } from '../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice } from '../src/components/match';
import { CoachCard } from '../src/components/coaching';
import { CalendarIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';

/**
 * Coaches (docs/design/coaching/guest.md §4.8.2): the guest's branch's coaches
 * who accepted a public profile, each with the kinds they teach and the
 * lowest price (the app always shows prices, C-11), and the way to the group
 * sessions and courses with places.
 *
 * Browsing is public: no session guard. Switched off at the branch, the
 * screen does no work and says so, with the branch's phone.
 */
export default function CoachesScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { guest, settings, on } = useCoachingBranch();
  const venueId = guest.venueId;
  // Switch off means no work: the read waits for the branch to say on.
  const pub = useCoachingPublic(on ? venueId : null);
  const pull = usePullRefresh(pub.refetch);
  const phone = venuePhoneOf(settings.data);
  const branch = guest.branch ? branchName(guest.branch, locale) : '';

  const coaches = useMemo(
    () => (pub.data && venueId && !pub.data.off ? coachesAt(pub.data, venueId) : []),
    [pub.data, venueId],
  );
  const withPlaces = (pub.data?.sessions ?? []).filter(
    (s) => s.venueId === venueId && s.placesLeft > 0,
  ).length;

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const picker = (
    <BranchPicker testID="coaches.branch" style={{ marginTop: space.s, marginBottom: space.sm }} />
  );
  const offNotice = (
    <View style={{ paddingTop: space.sm, gap: space.m }}>
      {picker}
      <View testID="coaches.off">
        <MatchNotice text={t('coaching.common.errors.off')} />
      </View>
      {phone ? (
        <Button
          testID="coaches.call-venue"
          label={t('coaching.common.callBranch', { branch: isolate(branch) })}
          variant="secondary"
          onPress={callBranch}
        />
      ) : null}
    </View>
  );

  const body = (() => {
    if (!venueId || !settings.data) {
      if (guest.query.isError || settings.isError) {
        return (
          <ErrorState
            testID="coaches.error"
            title={t('errors.loadFailedTitle')}
            message={t('coaching.guest.coaches.error')}
            retryLabel={t('common.retry')}
            onRetry={() => {
              void guest.query.refetch();
              void settings.refetch();
            }}
          />
        );
      }
      return <SkeletonList rows={3} height={84} />;
    }
    if (!on || pub.data?.off) return offNotice;
    if (!pub.data) {
      if (pub.isError) {
        return (
          <ErrorState
            testID="coaches.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(pub.error, t, { locale, phone })}
            retryLabel={t('common.retry')}
            onRetry={() => void pub.refetch()}
            busy={pub.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={84} />;
    }
    const header = (
      <View style={{ paddingTop: space.sm, gap: space.sm, marginBottom: space.sm }}>
        {picker}
        {withPlaces > 0 ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <MenuRow
              testID="coaches.classes"
              icon={<CalendarIcon size={15} color={colors.gstrong} />}
              label={t('coaching.guest.coaches.classes')}
              onPress={() => router.push('/classes')}
              last
            />
          </View>
        ) : null}
        {withPlaces > 0 ? (
          <Hint>{countPhrase('coaching.common.count.withPlaces', withPlaces, locale)}</Hint>
        ) : null}
      </View>
    );
    return (
      <FlatList
        testID="coaches.list"
        data={coaches}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            testID="coaches.empty"
            title={t('coaching.guest.coaches.emptyTitle')}
            message={t('coaching.guest.coaches.empty')}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
        renderItem={({ item: c }) => {
          const name = displayCoachName(c, locale);
          const kinds = kindsTaught(c, pub.data?.lessonTypes ?? [], venueId)
            .map((k) => t(`coaching.common.kindsTaught.${k}`))
            .join(' · ');
          const low = lowestOfferPrice(c, venueId);
          return (
            <CoachCard
              testID={`coaches.row.${c.id}`}
              name={name}
              photoPath={c.photoPath}
              kinds={kinds}
              from={
                low !== null
                  ? t('coaching.common.from', { price: isolate(formatIQD(low, locale)) })
                  : null
              }
              onPress={() =>
                router.push({ pathname: '/coach/[id]', params: { id: c.id, venueId } })
              }
            />
          );
        }}
      />
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.guest.coaches.title') }} />
      {body}
    </Screen>
  );
}
