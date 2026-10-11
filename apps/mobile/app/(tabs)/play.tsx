import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutRectangle,
  type SectionList,
  type SectionListData,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { wallTimeToUtc } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatIQD,
  formatTime,
  formatTimeRange,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { useGuestVenue, useVenueSettings } from '../../src/features/availability/hooks';
import { BranchPicker } from '../../src/features/availability/BranchPicker';
import { DEFAULT_TZ } from '../../src/features/availability/assemble';
import { requestBookingSheet } from '../../src/features/courtTransition/openIntent';
import { setOnlyPendingJoin } from '../../src/features/booking/pendingIntent';
import { useMatchSlots, useOpenMatches } from '../../src/features/matches/hooks';
import {
  SEATS_TOTAL,
  byCategory,
  categoryKey,
  matchesEnabled,
  tradingNightOf,
  type MatchCategory,
  type OpenMatch,
  type SlotMatch,
} from '../../src/features/matches/logic';
import { matchErrorText } from '../../src/features/matches/errors';
import { useTournamentsPublic } from '../../src/features/tournaments/hooks';
import { tournamentErrorText } from '../../src/features/tournaments/errors';
import {
  timezoneOf,
  tournamentName,
  tournamentRows,
  tourFillPercent,
  tourPlacesOf,
  tourToneOf,
  type TourListItem,
} from '../../src/features/tournaments/logic';
import {
  isAtEntry,
  playNights,
  playScrollTarget,
  showFromParam,
  type PlayCategory,
  type PlayEntry,
  type PlayKind,
} from '../../src/features/play/timeline';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { space, useTheme } from '../../src/theme';
import { Screen, SegmentedControl, TAB_TITLE_TOP, Title } from '../../src/components/ui';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { BrandPattern } from '../../src/components/BrandPattern';
import { FilterChip } from '../../src/components/booking';
import { MatchNotice, nightLabel } from '../../src/components/match';
import { Rise, useScrollY } from '../../src/components/motion';
import { CourtStage, courtHeroHeight } from '../../src/components/CourtStage';

import { ForYouStrip } from '../../src/components/forYou';
import {
  NightHeader,
  PLAY_SHEET_OVERLAP,
  PlayInlineNotice,
  PlayMatchCard,
  PlayTournamentCard,
  StartMatchButton,
  TimeRail,
} from '../../src/components/play';

type CategoryFilter = PlayCategory;
const CATEGORIES: {
  value: CategoryFilter;
  key:
    | 'matches.list.filterAll'
    | 'matches.list.filterOpen'
    | 'matches.list.filterWomen'
    | 'matches.list.filterMen';
}[] = [
  { value: 'all', key: 'matches.list.filterAll' },
  { value: 'open', key: 'matches.list.filterOpen' },
  { value: 'women', key: 'matches.list.filterWomen' },
  { value: 'men', key: 'matches.list.filterMen' },
];

/** Where one source stands. `off`: switched off (or banned, for matches): no rows, no work. */
type SourceState = 'loading' | 'error' | 'off' | 'ready';

interface NightSection {
  key: string;
  title: string;
  line: string;
  data: PlayEntry[];
}

/** How far the court's box runs on under the sheet, so its near baseline is never the box's edge. */
const PLAY_COURT_FOOT = 48;

const NO_MATCHES: readonly OpenMatch[] = [];
const NO_SLOTS: readonly SlotMatch[] = [];
const NO_TOURS: readonly TourListItem[] = [];

/**
 * Play (docs/design/play-coaches/contracts-2026-10-11.md §7; Majed, 2026-10-11:
 * open matches and tournaments "mixed together in a nice way", with the Book
 * page's 3D and motion). One timeline by trading night ("Tonight", "Tomorrow",
 * "Thu 3 Oct"), open matches and tournaments interleaved by start time
 * (`features/play/timeline.ts`), under the Book tab's court pitched back on the
 * brand pattern. The list is a sheet that rides up over the court as the page
 * scrolls, and the Book tab's 3D court (`CourtStage`, fixed behind the list)
 * pitches back under it on the scroll, as it does under the booking card.
 *
 * Ported from the two screens it replaces: the open-matches list (§4.12: the
 * branch's listable matches over the guest window, the category chips, `at`
 * scrolls to that time and outlines it, `date` to that night; switched off or
 * banned, its notice) and the tournaments list (plan §5.2: every live branch's
 * upcoming tournaments, the branch named on each when there are several; every
 * branch off, its notice). "Mine" moved to My reservations (contracts §1).
 *
 * Signed out, the guest browses: tournaments are public, and the matches come
 * from `match_slots` (no ids, names or money), whose card sends the guest to
 * the welcome with the time kept (`pendingJoin` `slot`), so after sign-in they
 * land back here at that time. "Start a match" opens the Book sheet, where a
 * free time starts one, as the list's "+" did.
 *
 * Params (contracts §1): `at` (an ISO start) and `date` (a trading night) as
 * before; `show` (`matches` | `tournaments`) opens on that kind. A new set of
 * params while the tab is mounted is honoured again.
 */
export default function PlayScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = session !== null;
  const tabBarHeight = useTabBarHeight();
  const params = useLocalSearchParams<{ at?: string; date?: string; show?: string }>();

  const guest = useGuestVenue();
  const venueId = guest.venueId;
  const settings = useVenueSettings(venueId);
  const knobs = settings.data ?? null;
  const tz = knobs?.timezone ?? DEFAULT_TZ;
  const switchedOn = matchesEnabled(knobs);
  // Switch off means no work: neither match read runs until the branch says on.
  const open = useOpenMatches(switchedOn && signedIn ? venueId : null, tz);
  const slots = useMatchSlots(venueId, { enabled: switchedOn && !signedIn, timezone: tz });
  const pub = useTournamentsPublic();

  // "Tonight" moves at the trading night's turn, not at midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // Where the 3D court sits: the hero's slot in the list header (at scroll 0,
  // in the list's own frame), and the page pattern's box, so the court draws
  // the same crop of the lines behind its scene (CourtStage).
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const [patternRect, setPatternRect] = useState<LayoutRectangle | null>(null);
  const [heroY, setHeroY] = useState<number | null>(null);
  const heroH = courtHeroHeight(frame?.height ?? 0);

  const banned = open.data?.banned === true;
  const matchesState: SourceState = (() => {
    if (guest.query.isSuccess && !venueId) return 'off';
    if (!venueId || !settings.data)
      return guest.query.isError || settings.isError ? 'error' : 'loading';
    if (!switchedOn) return 'off';
    if (signedIn) {
      if (open.data) return banned ? 'off' : 'ready';
      return open.isError ? 'error' : 'loading';
    }
    if (slots.data) return 'ready';
    return slots.isError ? 'error' : 'loading';
  })();
  const toursState: SourceState = pub.data
    ? pub.data.off
      ? 'off'
      : 'ready'
    : pub.isError
      ? 'error'
      : 'loading';

  // ── Filters, and the params that move them ────────────────────────────────
  const [kindPick, setKindPick] = useState<PlayKind>(() => showFromParam(params.show));
  const [category, setCategory] = useState<CategoryFilter>('all');
  const atMs = typeof params.at === 'string' ? Date.parse(params.at) : NaN;
  const wantDate = typeof params.date === 'string' && params.date ? params.date : null;
  const ask = `${params.at ?? ''}|${wantDate ?? ''}|${params.show ?? ''}`;
  // A new set of params (a chip, a push, the For you strip) re-applies, during
  // render as React's "adjusting state on a prop change" does, not in an effect.
  const [askSeen, setAskSeen] = useState(ask);
  // The ask still to scroll to: set while the params name a time or a night.
  const [scrollAsk, setScrollAsk] = useState<string | null>(() =>
    Number.isFinite(atMs) || wantDate !== null ? ask : null,
  );
  if (askSeen !== ask) {
    setAskSeen(ask);
    const wantsTime = Number.isFinite(atMs) || wantDate !== null;
    if (params.show) setKindPick(showFromParam(params.show));
    else if (wantsTime) setKindPick((k) => (k === 'tournaments' ? 'all' : k));
    // The time the guest came for must not sit behind a chip.
    if (wantsTime) setCategory('all');
    setScrollAsk(wantsTime ? ask : null);
  }

  // A side that is off leaves the other: no switch, and no empty "Matches" view.
  const kind: PlayKind =
    matchesState === 'off' ? 'tournaments' : toursState === 'off' ? 'matches' : kindPick;
  const bothOn = matchesState !== 'off' && toursState !== 'off';

  // ── The timeline ──────────────────────────────────────────────────────────
  const tours = useMemo(
    () => (pub.data && !pub.data.off ? tournamentRows(pub.data, 'upcoming') : NO_TOURS),
    [pub.data],
  );
  const slotList = useMemo(() => {
    if (signedIn || !slots.data) return NO_SLOTS;
    // A time that has started is gone for a guest who has not even signed in yet.
    return [...slots.data.values()].flat().filter((s) => Date.parse(s.startAt) > nowMs);
  }, [signedIn, slots.data, nowMs]);
  const matchList = signedIn && open.data && !banned ? open.data.matches : NO_MATCHES;
  const today = tradingNightOf(new Date(nowMs), knobs ?? {});
  const nightsFor = useCallback(
    (cat: CategoryFilter) =>
      playNights({
        matches: matchesState === 'ready' ? matchList : NO_MATCHES,
        slots: matchesState === 'ready' ? slotList : NO_SLOTS,
        tournaments: tours,
        kind,
        category: cat,
        nightOf: (startAt) => tradingNightOf(startAt, knobs ?? {}),
        today,
      }),
    [matchesState, matchList, slotList, tours, kind, knobs, today],
  );
  const nights = useMemo(() => nightsFor(category), [nightsFor, category]);
  // The chips show while there is anything to narrow, whichever chip is on.
  const anyRows = useMemo(
    () => (category === 'all' ? nights.length > 0 : nightsFor('all').length > 0),
    [category, nights, nightsFor],
  );

  const sections: NightSection[] = useMemo(
    () =>
      nights.map((n) => ({
        key: n.key,
        // From the night's own noon, so a tournament filed under tonight reads "Tonight".
        title: nightLabel(wallTimeToUtc(n.key, 12 * 60, tz).toISOString(), knobs, nowMs, t, locale),
        line: [
          n.matches > 0 ? countPhrase('matches.count.openMatches', n.matches, locale) : null,
          n.tournaments > 0 ? countPhrase('play.count.tournaments', n.tournaments, locale) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        data: n.entries,
      })),
    [nights, tz, knobs, nowMs, t, locale],
  );
  /** Each entry's place in the whole page, for its entrance's stagger. */
  const order = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const n of nights) for (const e of n.entries) m.set(`${e.kind}:${e.key}`, i++);
    return m;
  }, [nights]);

  // ── Scrolling to the time or night the guest came for ─────────────────────
  const listRef = useRef<SectionList<PlayEntry, NightSection>>(null);
  const target = useRef<{ sectionIndex: number; itemIndex: number } | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settled = matchesState !== 'loading' && toursState !== 'loading';
  /** The ask already scrolled to (or given up on), so a refetch never scrolls again. */
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (scrollAsk === null || scrolledFor.current === scrollAsk) return;
    const found = playScrollTarget(nights, { atMs, date: wantDate });
    if (!found) {
      // Wait for the matches before giving up on a time that may be among them.
      if (settled) scrolledFor.current = scrollAsk;
      return;
    }
    scrolledFor.current = scrollAsk;
    target.current = found;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      listRef.current?.scrollToLocation({
        ...found,
        animated: true,
        viewPosition: 0,
        viewOffset: 8,
      });
    }, 80);
  }, [scrollAsk, nights, atMs, wantDate, settled]);
  useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const canStart = switchedOn && !banned;
  const startOne = useCallback(() => {
    // A free time on the Book sheet starts it (match-new needs the court and the time).
    requestBookingSheet();
    router.navigate('/(tabs)');
  }, [router]);
  const openMatch = useCallback(
    (id: string) => router.push({ pathname: '/match/[id]', params: { id } }),
    [router],
  );
  const signInFor = useCallback(
    (startAt: string) => {
      if (!venueId) return;
      // Signed out: the time waits for the auth flow, which lands back here at it (§4.18).
      setOnlyPendingJoin({ kind: 'slot', venueId, startAt });
      router.push('/welcome');
    },
    [venueId, router],
  );
  const openTournament = useCallback(
    (id: string) => router.push({ pathname: '/tournament/[id]', params: { id } }),
    [router],
  );

  const refetchMatches = useCallback(() => {
    if (!venueId || !settings.data) {
      void guest.query.refetch();
      return settings.refetch();
    }
    if (!switchedOn) return settings.refetch();
    return signedIn ? open.refetch() : slots.refetch();
  }, [venueId, settings, guest.query, switchedOn, signedIn, open, slots]);
  const refetchAll = useCallback(
    () => Promise.all([pub.refetch(), settings.refetch(), refetchMatches()]),
    [pub, settings, refetchMatches],
  );
  const pull = usePullRefresh(refetchAll);
  const scroll = useScrollY();

  // ── What one entry looks like ─────────────────────────────────────────────
  const multiBranch = (pub.data?.branches.length ?? 0) > 1;
  const tourTz = (r: TourListItem) => (pub.data ? timezoneOf(pub.data, r.venueId) : DEFAULT_TZ);

  const tourWhen = (r: TourListItem): string => {
    const zone = tourTz(r);
    const start = new Date(r.startsAt);
    const times = r.endsAt
      ? formatTimeRange(start, new Date(r.endsAt), locale, zone)
      : formatTime(start, locale, zone);
    const when = `${formatDate(start, locale, zone)} · ${times}`;
    if (!multiBranch || !pub.data) return when;
    const b = pub.data.branches.find((x) => x.venueId === r.venueId);
    const name = b ? (locale === 'ar' ? (b.nameAr ?? b.nameEn) : (b.nameEn ?? b.nameAr)) : null;
    return name ? `${when} · ${name}` : when;
  };
  const tourPlaces = (r: TourListItem): string | null => {
    const p = tourPlacesOf(r);
    switch (p.kind) {
      case 'left':
        return t('tournaments.guest.list.placesLeft', { count: isolateLtr(String(p.count)) });
      case 'waitlist':
        return t('tournaments.guest.list.waitlistOnly');
      case 'full':
        return t('tournaments.guest.list.full');
      case 'status':
        return null;
    }
  };
  const tourMine = (r: TourListItem): string | null => {
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

  const matchCard = (
    e: Extract<PlayEntry, { kind: 'match' | 'slot' }>,
    time: string,
    duration: string,
  ) => {
    const m = e.kind === 'match' ? e.match : null;
    const category: MatchCategory = e.kind === 'match' ? e.match.category : e.slot.category;
    const seatsLeftN = e.kind === 'match' ? e.match.seatsLeft : e.slot.seatsLeft;
    const approves = (e.kind === 'match' ? e.match.joinPolicy : e.slot.joinPolicy) === 'approve';
    const seatsLeft = countPhrase('matches.count.seatsLeft', seatsLeftN, locale);
    const line =
      m && m.shareIqd !== null
        ? t('matches.list.perPlayer', { share: isolate(formatIQD(m.shareIqd, locale)) })
        : null;
    const refill = m?.refill ? t('matches.list.refill') : null;
    const tag =
      m?.mine === 'seated'
        ? t('matches.list.mine')
        : m?.mine === 'requested'
          ? t('matches.list.asked')
          : null;
    const action = !m
      ? t('matches.link.signIn')
      : m.mine
        ? t('matches.list.view')
        : approves
          ? t('matches.detail.ask')
          : t('matches.detail.join');
    const approveA11y = approves ? t(byCategory(category, 'matches.common.approves')) : null;
    return (
      <PlayMatchCard
        testID={e.kind === 'match' ? `play.match.${e.key}` : `play.slot.${e.key}`}
        a11yLabel={[
          time,
          duration,
          t(categoryKey(category)),
          seatsLeft,
          line,
          approveA11y,
          refill,
          tag,
          action,
        ]
          .filter(Boolean)
          .join(', ')}
        category={category}
        seatsTaken={e.kind === 'match' ? e.match.seatsTaken : SEATS_TOTAL - e.slot.seatsLeft}
        seatsLeft={seatsLeft}
        line={line}
        approve={approves ? t('matches.list.approval') : null}
        refill={refill}
        tag={tag}
        action={action}
        highlight={isAtEntry(e, atMs)}
        onPress={() => (m ? openMatch(m.matchId) : signInFor(e.startAt))}
      />
    );
  };

  const renderEntry = ({
    item: e,
    index,
    section,
  }: {
    item: PlayEntry;
    index: number;
    section: SectionListData<PlayEntry, NightSection>;
  }) => {
    const last = index === section.data.length - 1;
    const place = order.get(`${e.kind}:${e.key}`) ?? 0;
    let body: ReactNode;
    let time: string;
    let sub: string | null = null;
    if (e.kind === 'tournament') {
      const r = e.tournament;
      time = formatTime(new Date(r.startsAt), locale, tourTz(r));
      body = (
        <PlayTournamentCard
          testID={`play.tournament.${r.id}`}
          tone={tourToneOf(r.status)}
          status={r.status ? t(`tournaments.common.status.${r.status}`) : null}
          category={r.category}
          format={r.format ? t(`tournaments.common.format.${r.format}`) : null}
          title={tournamentName(r, locale)}
          when={tourWhen(r)}
          places={tourPlaces(r)}
          fee={
            r.entryFeeIqd > 0
              ? isolate(formatIQD(r.entryFeeIqd, locale))
              : t('tournaments.common.free')
          }
          mine={tourMine(r)}
          fill={tourFillPercent(r)}
          onPress={() => openTournament(r.id)}
        />
      );
    } else {
      const durationMin = e.kind === 'match' ? e.match.durationMin : e.slot.durationMin;
      time = formatTime(new Date(e.startAt), locale, tz);
      sub = durationMin > 0 ? t('booking.durationMinutes', { minutes: durationMin }) : null;
      body = matchCard(e, time, sub ?? '');
    }
    return (
      <Rise
        // Rows past the first screenful mount as the list reaches them and rise at once.
        index={place < 8 ? place + 2 : 0}
        style={{ backgroundColor: colors.bg, paddingStart: space.l, paddingEnd: space.l }}
      >
        <TimeRail time={time} sub={sub} tournament={e.kind === 'tournament'} last={last}>
          {body}
        </TimeRail>
      </Rise>
    );
  };

  // ── The sheet's head: switch, chips, notices, and the states ──────────────
  const kindSwitch =
    bothOn && (matchesState === 'ready' || toursState === 'ready') ? (
      <SegmentedControl<PlayKind>
        testID="play.kind"
        options={[
          { value: 'all', label: t('matches.list.filterAll') },
          { value: 'matches', label: t('play.kindMatches') },
          { value: 'tournaments', label: t('tournaments.guest.list.title') },
        ]}
        value={kindPick}
        onChange={setKindPick}
        activeColor={colors.gstrong}
      />
    ) : null;

  const chips = anyRows ? (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: space.sm }}
    >
      {CATEGORIES.map((f) => (
        <FilterChip
          key={f.value}
          testID={`play.filter.${f.value}`}
          label={t(f.key)}
          selected={category === f.value}
          onPress={() => setCategory(f.value)}
        />
      ))}
    </View>
  ) : null;

  const notices: ReactNode[] = [];
  if (banned)
    notices.push(<MatchNotice key="banned" text={t('matches.errors.banned')} tone="red" />);
  if (matchesState === 'error' && toursState !== 'error') {
    notices.push(
      <PlayInlineNotice
        key="matches-error"
        testID="play.matches-error"
        text={
          signedIn && open.error
            ? matchErrorText(open.error, t, { locale })
            : t('play.matchesError')
        }
        retryLabel={t('common.retry')}
        onRetry={() => void refetchMatches()}
      />,
    );
  }
  if (toursState === 'error' && matchesState !== 'error') {
    notices.push(
      <PlayInlineNotice
        key="tours-error"
        testID="play.tournaments-error"
        text={tournamentErrorText(pub.error, t)}
        retryLabel={t('common.retry')}
        onRetry={() => void pub.refetch()}
      />,
    );
  }

  const emptyCopy =
    kind === 'matches'
      ? { title: t('matches.list.emptyTitle'), body: t('matches.list.emptyBody') }
      : kind === 'tournaments'
        ? { title: t('tournaments.guest.list.emptyTitle'), body: t('tournaments.guest.list.empty') }
        : { title: t('tournaments.guest.list.emptyTitle'), body: t('play.emptyBody') };

  const state = (() => {
    if (matchesState === 'error' && toursState === 'error') {
      return (
        <ErrorState
          testID="play.error"
          title={t('errors.loadFailedTitle')}
          message={t('play.loadError')}
          retryLabel={t('common.retry')}
          onRetry={() => void refetchAll()}
          busy={pull.refreshing}
        />
      );
    }
    if (matchesState === 'off' && toursState === 'off' && !banned) {
      return (
        <View testID="play.off">
          <MatchNotice text={t('play.off')} />
        </View>
      );
    }
    if (nights.length > 0) return null;
    if (matchesState === 'loading' || toursState === 'loading') {
      return <SkeletonList rows={3} height={104} />;
    }
    if (banned && toursState === 'off') return null;
    return (
      <EmptyState
        testID="play.empty"
        title={emptyCopy.title}
        message={emptyCopy.body}
        actionLabel={canStart && kind !== 'tournaments' ? t('play.start') : undefined}
        onAction={canStart && kind !== 'tournaments' ? startOne : undefined}
        actionTestID="play.empty.start"
      />
    );
  })();

  const header = (
    <View>
      <Rise index={0}>
        <View
          style={{
            paddingTop: TAB_TITLE_TOP,
            paddingStart: space.l,
            paddingEnd: space.l,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: space.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Title fit>{t('tabs.play')}</Title>
          </View>
          {canStart ? (
            <StartMatchButton testID="play.start" label={t('play.start')} onPress={startOne} />
          ) : null}
        </View>
        <View style={{ paddingStart: space.l, paddingEnd: space.l }}>
          <BranchPicker testID="play.branch" fit={false} style={{ marginBottom: space.s }} />
        </View>
      </Rise>
      {/* The court's slot: the 3D court is drawn BEHIND the list, fixed, and
          this transparent block is the window onto it until the sheet rises. */}
      <View
        pointerEvents="none"
        onLayout={(e) => setHeroY(e.nativeEvent.layout.y)}
        style={{ height: heroH }}
      />
      <Rise
        index={1}
        style={{
          marginTop: -PLAY_SHEET_OVERLAP,
          backgroundColor: colors.bg,
          borderTopStartRadius: 28,
          borderTopEndRadius: 28,
          paddingTop: space.xl,
          paddingStart: space.l,
          paddingEnd: space.l,
          gap: space.sm,
        }}
      >
        {/* For you (contracts §8): the survey's suggestions; a tap opens `/play?show=…`. */}
        <ForYouStrip testID="play.for-you" surface="play" />
        {kindSwitch}
        {chips}
        {notices}
        {state}
      </Rise>
    </View>
  );

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page }}>
      {/* The Book tab's ground: the brand lines over the page colour, full bleed
          and still while the page scrolls over it. The sheet and every row
          carry the page's own ground, so the lines show only round the court. */}
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(e) => setPatternRect(e.nativeEvent.layout)}
      >
        <BrandPattern />
      </View>
      <View style={{ flex: 1 }} onLayout={(e) => setFrame(e.nativeEvent.layout)}>
        {frame && heroY !== null ? (
          <CourtStage
            scene="rally"
            top={heroY}
            height={heroH + PLAY_SHEET_OVERLAP + PLAY_COURT_FOOT}
            patternBox={
              patternRect
                ? {
                    width: patternRect.width,
                    height: patternRect.height,
                    offsetX: frame.x - patternRect.x,
                    offsetY: frame.y + heroY - patternRect.y,
                  }
                : undefined
            }
          />
        ) : null}
        <Animated.SectionList<PlayEntry, NightSection>
          ref={listRef}
          testID="play.list"
          sections={sections}
          keyExtractor={(e) => `${e.kind}:${e.key}`}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          onScroll={scroll.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={header}
          renderSectionHeader={({ section }) => (
            <View
              style={{ backgroundColor: colors.bg, paddingStart: space.l, paddingEnd: space.l }}
            >
              <NightHeader
                title={section.title}
                line={section.line}
                highlight={wantDate === section.key}
              />
            </View>
          )}
          renderItem={renderEntry}
          contentContainerStyle={{ flexGrow: 1 }}
          ListFooterComponent={<View style={{ height: tabBarHeight + 24 }} />}
          ListFooterComponentStyle={{ flexGrow: 1, backgroundColor: colors.bg }}
          onScrollToIndexFailed={() => {
            // Rows not measured yet: try once more when they are.
            const again = target.current;
            if (!again) return;
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
              listRef.current?.scrollToLocation({
                ...again,
                animated: true,
                viewPosition: 0,
                viewOffset: 8,
              });
            }, 250);
          }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.blue}
            />
          }
        />
      </View>
    </Screen>
  );
}
