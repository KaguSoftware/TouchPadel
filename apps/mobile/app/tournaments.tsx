import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatIQD, isolate, isolateLtr } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useTournamentsPublic } from '../src/features/tournaments/hooks';
import { tournamentErrorText } from '../src/features/tournaments/errors';
import {
  filterFromParam,
  timezoneOf,
  tournamentName,
  tournamentRows,
  tourPlacesOf,
  type TourFilter,
  type TourListItem,
} from '../src/features/tournaments/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { space, useTheme } from '../src/theme';
import { Screen, SegmentedControl } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice } from '../src/components/match';
import { TournamentRow } from '../src/components/tournament';

/**
 * Tournaments (tournaments plan §5.2): Upcoming and Mine over one `tournaments_public(null)` read,
 * every live branch's tournaments soonest first. Public: a signed-out guest browses, and the
 * detail sends Register to the welcome. Profile's "My tournaments" opens it on Mine
 * (`?filter=mine`). Every branch switched off: no rows, and the notice.
 */
export default function TournamentsScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<TourFilter>(() => filterFromParam(params.filter));
  const pub = useTournamentsPublic();
  const pull = usePullRefresh(pub.refetch);

  const rows = useMemo(
    () => (pub.data && !pub.data.off ? tournamentRows(pub.data, filter) : []),
    [pub.data, filter],
  );
  const multiBranch = (pub.data?.branches.length ?? 0) > 1;

  const whenOf = (r: TourListItem): string => {
    const tz = pub.data ? timezoneOf(pub.data, r.venueId) : undefined;
    const when = formatDateTime(new Date(r.startsAt), locale, tz);
    if (!multiBranch || !pub.data) return when;
    const b = pub.data.branches.find((x) => x.venueId === r.venueId);
    const name = b ? (locale === 'ar' ? (b.nameAr ?? b.nameEn) : (b.nameEn ?? b.nameAr)) : null;
    return name ? `${when} · ${name}` : when;
  };

  const placesOf = (r: TourListItem): string => {
    const p = tourPlacesOf(r);
    switch (p.kind) {
      case 'left':
        return t('tournaments.guest.list.placesLeft', { count: isolateLtr(String(p.count)) });
      case 'waitlist':
        return t('tournaments.guest.list.waitlistOnly');
      case 'full':
        return t('tournaments.guest.list.full');
      case 'status':
        return t(`tournaments.common.status.${p.status}`);
    }
  };

  const mineOf = (r: TourListItem): string | null => {
    switch (r.mine?.status) {
      case 'registered':
        return t('tournaments.common.entryStatus.registered');
      case 'waitlisted':
        return r.mine.waitlistPosition !== null
          ? t('tournaments.guest.detail.waitlistPosition', {
              position: isolateLtr(String(r.mine.waitlistPosition)),
            })
          : t('tournaments.common.entryStatus.waitlisted');
      case 'no_show':
        return t('tournaments.common.entryStatus.no_show');
      default:
        return null;
    }
  };

  const header = (
    <View style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
      <SegmentedControl<TourFilter>
        testID="tournaments.filter"
        options={[
          { value: 'upcoming', label: t('tournaments.guest.list.upcoming') },
          { value: 'mine', label: t('tournaments.guest.list.mine') },
        ]}
        value={filter}
        onChange={setFilter}
        activeColor={colors.gstrong}
      />
    </View>
  );

  const body = (() => {
    if (!pub.data) {
      if (pub.isError) {
        return (
          <ErrorState
            testID="tournaments.error"
            title={t('errors.loadFailedTitle')}
            message={tournamentErrorText(pub.error, t)}
            retryLabel={t('common.retry')}
            onRetry={() => void pub.refetch()}
            busy={pub.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={96} />;
    }
    if (pub.data.off) {
      return (
        <View testID="tournaments.off" style={{ paddingTop: space.sm }}>
          <MatchNotice text={t('tournaments.guest.list.off')} />
        </View>
      );
    }
    return (
      <FlatList
        testID="tournaments.list"
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            testID="tournaments.empty"
            title={t('tournaments.guest.list.emptyTitle')}
            message={
              filter === 'mine'
                ? t('tournaments.guest.list.emptyMine')
                : t('tournaments.guest.list.empty')
            }
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
        renderItem={({ item: r }) => (
          <TournamentRow
            testID={`tournaments.row.${r.id}`}
            category={r.category}
            title={tournamentName(r, locale)}
            when={whenOf(r)}
            places={placesOf(r)}
            fee={
              r.entryFeeIqd > 0
                ? isolate(formatIQD(r.entryFeeIqd, locale))
                : t('tournaments.common.free')
            }
            mine={mineOf(r)}
            onPress={() => router.push({ pathname: '/tournament/[id]', params: { id: r.id } })}
          />
        )}
      />
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('tournaments.guest.list.title') }} />
      {body}
    </Screen>
  );
}
