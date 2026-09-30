import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, SectionList, View, type SectionListData } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, formatTime, isolate } from '@touch/i18n';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useGuestVenue, useVenueSettings } from '../src/features/availability/hooks';
import { BranchPicker } from '../src/features/availability/BranchPicker';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import { requestBookingSheet } from '../src/features/courtTransition/openIntent';
import { useOpenMatches } from '../src/features/matches/hooks';
import {
  byCategory,
  matchesEnabled,
  tradingNightOf,
  type OpenMatch,
} from '../src/features/matches/logic';
import { matchErrorText } from '../src/features/matches/errors';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { space, useTheme } from '../src/theme';
import { Button, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice, MatchRow, MatchSectionTitle, nightLabel } from '../src/components/match';

/**
 * Open matches (docs/design/open-matches/guest.md §4.12): the branch's
 * listable matches over the guest window (start of today, venue-local, + 16
 * days), in sections by trading night ("Tonight", "Tomorrow", "Thu 3 Oct"),
 * so a 00:30 match sits under the night before.
 *
 * No names anywhere on this screen (GD-5): a row is its time, category, seat
 * dots, the share at the desk and the tags the server sent. `at` (from a Book
 * tab chip or a pending intent) scrolls to that time and outlines its rows;
 * `date` scrolls to that night. Switched off at the branch, or a banned
 * account: the notice, no rows and no footer.
 */
function MatchesScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; at?: string }>();
  const guest = useGuestVenue();
  const settings = useVenueSettings(guest.venueId);
  const knobs = settings.data ?? null;
  const tz = knobs?.timezone ?? DEFAULT_TZ;
  const switchedOn = matchesEnabled(knobs);
  // Switch off means no work: the list is not read until the branch says on.
  const open = useOpenMatches(switchedOn ? guest.venueId : null, tz);
  const pull = usePullRefresh(open.refetch);
  const listRef = useRef<SectionList<OpenMatch, { key: string; title: string }>>(null);

  // "Tonight" moves at the trading night's turn, not at midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const atMs = typeof params.at === 'string' ? Date.parse(params.at) : NaN;
  const sections = useMemo(() => {
    const byNight = new Map<string, OpenMatch[]>();
    for (const m of [...(open.data?.matches ?? [])].sort(
      (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt),
    )) {
      const night = tradingNightOf(m.startAt, knobs ?? {});
      const list = byNight.get(night);
      if (list) list.push(m);
      else byNight.set(night, [m]);
    }
    return [...byNight.entries()].map(([key, data]) => ({
      key,
      title: nightLabel(data[0]!.startAt, knobs, nowMs, t, locale),
      data,
    }));
  }, [open.data, knobs, nowMs, t, locale]);

  // The time or night the guest came for, once, after the rows exist.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || sections.length === 0) return;
    let sectionIndex = -1;
    let itemIndex = 0;
    if (Number.isFinite(atMs)) {
      sectionIndex = sections.findIndex((s) => {
        const i = s.data.findIndex((m) => Date.parse(m.startAt) === atMs);
        if (i >= 0) itemIndex = i;
        return i >= 0;
      });
    } else if (typeof params.date === 'string') {
      sectionIndex = sections.findIndex((s) => s.key === params.date);
    }
    scrolled.current = true;
    if (sectionIndex <= 0 && itemIndex === 0) return;
    const id = setTimeout(() => {
      listRef.current?.scrollToLocation({
        sectionIndex,
        itemIndex,
        animated: false,
        viewPosition: 0,
      });
    }, 0);
    return () => clearTimeout(id);
  }, [sections, atMs, params.date]);

  const startOne = useCallback(() => {
    requestBookingSheet();
    router.navigate('/(tabs)');
  }, [router]);

  const openMatch = useCallback(
    (matchId: string) => router.push({ pathname: '/match/[id]', params: { id: matchId } }),
    [router],
  );

  const footer = (
    <Button
      testID="matches.start-one"
      label={t('matches.list.startOne')}
      variant="cta"
      onPress={startOne}
      style={{ marginTop: space.l }}
    />
  );
  const bottomPad = { paddingBottom: 40 + insets.bottom };
  const picker = (
    <BranchPicker testID="matches.branch" style={{ marginTop: space.s, marginBottom: space.sm }} />
  );

  const body = (() => {
    if (!guest.venueId || !settings.data) {
      if (guest.query.isError || settings.isError) {
        return (
          <ErrorState
            testID="matches.error"
            title={t('errors.loadFailedTitle')}
            message={t('matches.link.error')}
            retryLabel={t('common.retry')}
            onRetry={() => {
              void guest.query.refetch();
              void settings.refetch();
            }}
          />
        );
      }
      return <SkeletonList rows={3} height={96} />;
    }
    if (!switchedOn) {
      return (
        <View style={{ paddingTop: space.sm }}>
          {picker}
          <MatchNotice text={t('matches.errors.off')} />
        </View>
      );
    }
    if (open.data?.banned) {
      return (
        <View style={{ paddingTop: space.sm }}>
          {picker}
          <MatchNotice text={t('matches.errors.banned')} tone="red" />
        </View>
      );
    }
    if (!open.data) {
      if (open.isError) {
        return (
          <ErrorState
            testID="matches.error"
            title={t('errors.loadFailedTitle')}
            message={matchErrorText(open.error, t, { locale })}
            retryLabel={t('common.retry')}
            onRetry={() => void open.refetch()}
            busy={open.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={96} />;
    }
    if (sections.length === 0) {
      return (
        <View style={[{ flex: 1 }, bottomPad]}>
          {picker}
          <EmptyState
            testID="matches.empty"
            fill
            title={t('matches.list.emptyTitle')}
            message={t('matches.list.emptyBody')}
          />
          {footer}
        </View>
      );
    }
    return (
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(m) => m.matchId}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[{ paddingTop: space.sm }, bottomPad]}
        ListHeaderComponent={picker}
        ListFooterComponent={footer}
        onScrollToIndexFailed={() => {}}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
        renderSectionHeader={({
          section,
        }: {
          section: SectionListData<OpenMatch, { key: string; title: string }>;
        }) => <MatchSectionTitle>{section.title}</MatchSectionTitle>}
        ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
        renderItem={({ item: m }) => {
          const start = new Date(m.startAt);
          return (
            <MatchRow
              testID={`matches.row.${m.matchId}`}
              time={formatTime(start, locale, tz)}
              day={t('booking.durationMinutes', { minutes: m.durationMin })}
              category={m.category}
              seatsTaken={m.seatsTaken}
              seatsLeft={countPhrase('matches.count.seatsLeft', m.seatsLeft, locale)}
              line={
                m.shareIqd !== null
                  ? t('matches.list.perPlayer', { share: isolate(formatIQD(m.shareIqd, locale)) })
                  : null
              }
              approve={
                m.joinPolicy === 'approve'
                  ? t(byCategory(m.category, 'matches.common.approves'))
                  : null
              }
              refill={m.refill ? t('matches.list.refill') : null}
              tag={
                m.mine === 'seated'
                  ? t('matches.list.mine')
                  : m.mine === 'requested'
                    ? t('matches.list.asked')
                    : null
              }
              highlight={Number.isFinite(atMs) && start.getTime() === atMs}
              onPress={() => openMatch(m.matchId)}
            />
          );
        }}
      />
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('matches.list.title') }} />
      {body}
    </Screen>
  );
}

/** On the root stack with its own session guard, like every screen pushed over the tabs. */
export default function GuardedMatchesScreen() {
  return (
    <RequireSession>
      <MatchesScreen />
    </RequireSession>
  );
}
