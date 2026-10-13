import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutRectangle,
  type SectionList,
  type SectionListData,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { wallTimeToUtc } from '@touch/core';
import { projectTop } from '@touch/court3d/camera';
import { seatSpot } from '@touch/court3d/join';
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
import { playCourt } from '../../src/features/play/court';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { Text } from '../../src/i18n/text';
import { radius, space, useTheme } from '../../src/theme';
import { usePlayProfile } from '../../src/features/playProfile/hooks';
import { showsTournament, tournamentFit } from '../../src/features/playProfile/fit';
import { Screen, SegmentedControl, TAB_TITLE_TOP, Title } from '../../src/components/ui';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { BrandPattern } from '../../src/components/BrandPattern';
import { FilterChip } from '../../src/components/booking';
import { MatchNotice, nightLabel } from '../../src/components/match';
import { Rise, useScrollY } from '../../src/components/motion';
import { CourtStage, topStageFor } from '../../src/components/CourtStage';
import { Frost, PinnedTitle } from '../../src/components/scrollFrost';
import { StickyOffset, StickyUnder } from '../../src/components/stickyUnder';
import {
  COURT_CAPTION_H,
  CourtCaption,
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

/** Air between the court's near sideline and the sheet's top edge (the Coaches tab's spacing). */
const COURT_AIR = 10;
/**
 * How far before the sheet reaches the title the title bar starts fading from
 * the frosting to the sheet's ground: long enough to read as a fade, not a
 * snap (owner, 2026-10-13).
 */
const TITLE_GROUND_FADE = 40;
/** The fade's ease-in-out, sampled for the interpolation (smoothstep). */
const EASE_STEPS = [0, 0.25, 0.5, 0.75, 1];
const EASE_OUT = EASE_STEPS.map((x) => x * x * (3 - 2 * x));
/** A finger's target over each open spot on the court (the drawn spot is about 25 pt across). */
const SPOT_TARGET = 48;

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
 * THE COURT IS THE NEXT OPEN MATCH (Majed, 2026-10-12; features/play/court.ts,
 * packages/court3d join.ts). The first match on this list with a seat open:
 * its taken seats warm up, its open ones are marked, first seats on the
 * reading start as on its card. An open spot and the caption hanging over the
 * sheet's edge ("Tonight · 9:00 PM · 2 seats left") both scroll the list to
 * that card and outline it; with no seat open anywhere, all four spots are
 * open and they start a match. Loading, it is an empty court; with matches
 * off, failed or filtered out, four rackets warm up and nothing is claimed.
 *
 * Params (contracts §1): `at` (an ISO start) and `date` (a trading night) as
 * before; `show` (`matches` | `tournaments`) opens on that kind. A new set of
 * params while the tab is mounted is honoured again.
 */
export default function PlayScreen() {
  const { t, locale, dir } = useLocale();
  const { colors, fonts } = useTheme();
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
  // The title row stays put while the page scrolls (scrollFrost): pinned over
  // the top of the screen, the clock and battery included, with the list laid
  // from its foot down. The court's slot on screen sits that much lower.
  const safeTop = useSafeAreaInsets().top;
  const [titleH, setTitleH] = useState(0);
  const heroTop = heroY === null ? null : heroY + titleH;
  // The kind switch and the chips scroll up with the sheet until they reach
  // the title's foot, then stay there over the rest of the page (owner,
  // 2026-10-13). They are laid once, over the list, and ride with the scroll
  // until then (`controlsShift`); the sheet keeps a slot their size. `controlsY`
  // is the slot's top in the sheet, null until it is measured: until then they
  // sit in the slot itself (and always do where nothing lays out, the tests).
  const [controlsY, setControlsY] = useState<number | null>(null);
  const [controlsH, setControlsH] = useState(0);
  // Jumps to a night or a match land under the pinned controls, not behind them.
  const controlsHRef = useRef(0);
  useEffect(() => {
    controlsHRef.current = controlsY === null ? 0 : controlsH;
  }, [controlsY, controlsH]);
  // Sized to the court itself, as on the Coaches tab (topStageFor): the court
  // sits just under the title and the sheet starts right under the court, so
  // the two tabs hold their court in the same place (Majed, 2026-10-12).
  const { width: screenW } = useWindowDimensions();
  const stage = topStageFor(frame?.width ?? screenW);
  const heroH = stage.courtBottom + COURT_AIR + PLAY_SHEET_OVERLAP;

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
  // 0339: only the tournaments this guest is for (their class and years bracket,
  // fit.ts, the twin of tournament_register's check), plus every one they entered.
  // An unanswered question hides nothing: the nudge below asks for it.
  const play = usePlayProfile();
  const answers = useMemo(() => (play ? { level: play.level, years: play.years } : null), [play]);
  const allTours = useMemo(
    () => (pub.data && !pub.data.off ? tournamentRows(pub.data, 'upcoming') : NO_TOURS),
    [pub.data],
  );
  const tours = useMemo(
    () => allTours.filter((r) => showsTournament(r, answers)),
    [allTours, answers],
  );
  const askFit =
    play !== null &&
    allTours.some((r) => r.mine == null && tournamentFit(r, answers).fit === 'unanswered');
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

  // ── The court: the next open match on this list (features/play/court.ts) ──
  // Its taken seats warm up and its open ones are marked (packages/court3d
  // join.ts), the first seats on the reading start, as on every match card.
  const court = useMemo(
    () => playCourt({ matches: matchesState, kind, nights, nowMs }),
    [matchesState, kind, nights, nowMs],
  );
  const mirror = dir === 'rtl';
  const courtSeats = { taken: court.taken, spots: court.spots, mirror };
  /** The card a tap on the court scrolled to: outlined, as an `at` link outlines its match. */
  const [picked, setPicked] = useState<string | null>(null);

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
        viewOffset: 8 + controlsHRef.current,
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
  const courtMatch = court.show === 'match' ? court.match : null;
  /** The court's caption or an open spot: to the match's card, or, with none, the Book sheet. */
  const goToCourt = useCallback(() => {
    if (!courtMatch) {
      startOne();
      return;
    }
    setPicked(courtMatch.key);
    const found = { sectionIndex: courtMatch.sectionIndex, itemIndex: courtMatch.itemIndex };
    target.current = found;
    listRef.current?.scrollToLocation({
      ...found,
      animated: true,
      viewPosition: 0,
      viewOffset: 8 + controlsHRef.current,
    });
  }, [courtMatch, startOne]);
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
        highlight={isAtEntry(e, atMs) || e.key === picked}
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
    let row: ReactNode;
    if (e.kind === 'tournament') {
      // A tournament leaves the time rail: its card says the day and times
      // itself, and spans the sheet, larger than the matches round it.
      const r = e.tournament;
      row = (
        <View style={{ paddingBottom: last ? 0 : space.m }}>
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
        </View>
      );
    } else {
      const durationMin = e.kind === 'match' ? e.match.durationMin : e.slot.durationMin;
      const time = formatTime(new Date(e.startAt), locale, tz);
      const sub = durationMin > 0 ? t('booking.durationMinutes', { minutes: durationMin }) : null;
      row = (
        <TimeRail time={time} sub={sub} last={last}>
          {matchCard(e, time, sub ?? '')}
        </TimeRail>
      );
    }
    // The sheet's ground stays put; only the row rises into it, so the court
    // and lines behind never show through a row still fading in.
    return (
      <View style={{ backgroundColor: colors.bg, paddingStart: space.l, paddingEnd: space.l }}>
        <Rise
          // Rows past the first screenful mount as the list reaches them and rise at once.
          index={place < 8 ? place + 2 : 0}
        >
          {row}
        </Rise>
      </View>
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
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: space.sm }}
    >
      {CATEGORIES.map((f) => (
        <FilterChip
          key={f.value}
          testID={`play.filter.${f.value}`}
          label={t(f.key)}
          selected={category === f.value}
          onPress={() => setCategory(f.value)}
          large
        />
      ))}
    </View>
  ) : null;

  // Their own strip of the sheet's ground, so the rows pass under them once pinned.
  const controls =
    kindSwitch || chips ? (
      <View
        style={{
          backgroundColor: colors.bg,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: space.sm,
        }}
      >
        {kindSwitch}
        {chips}
      </View>
    ) : null;
  // Where the slot sits in the list's content: the sheet starts at the foot of
  // the court's slot (the header's first thing), less its overlap.
  const controlsAt = heroH - PLAY_SHEET_OVERLAP + (controlsY ?? 0);
  const controlsShift = useMemo(
    () =>
      scroll.y.interpolate({
        inputRange: [controlsAt - 1, controlsAt],
        outputRange: [1, 0],
        extrapolateLeft: 'extend',
        extrapolateRight: 'clamp',
      }),
    [scroll.y, controlsAt],
  );

  const notices: ReactNode[] = [];
  if (askFit && kind !== 'matches') {
    // 0339: a signed-in guest who has not said their level or years sees every
    // tournament, and is asked; registering asks too (TOURNAMENT_PROFILE_REQUIRED).
    notices.push(
      <Pressable
        key="fit-ask"
        testID="play.fit-ask"
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/play-survey', params: { mode: 'edit' } })}
        style={({ pressed }) => ({
          padding: space.m,
          borderRadius: radius.button,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.sub : colors.tint,
        })}
      >
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.ink }}
        >
          {t('play.fitAsk')}
        </Text>
      </Pressable>,
    );
  }
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

  // ── The court's caption and its open spots' targets ─────────────────────
  const caption =
    court.show === 'match'
      ? {
          lead: [
            court.match.mine ? t('matches.list.mine') : null,
            nightLabel(court.match.startAt, knobs, nowMs, t, locale),
            formatTime(new Date(court.match.startAt), locale, tz),
          ]
            .filter(Boolean)
            .join(' · '),
          action: countPhrase('matches.count.seatsLeft', court.match.seatsLeft, locale),
          hint: t('play.court.hint'),
        }
      : court.show === 'none'
        ? { lead: t('play.court.none'), action: t('play.start'), hint: undefined }
        : null;
  // Where each seat's spot lands on the stage (the court's own camera, projectTop).
  const stageW = frame?.width ?? 0;
  const spotPoints = useMemo(() => {
    if (stageW <= 0 || stage.height <= 0) return [];
    return [0, 1, 2, 3].map((seat) => {
      const at = seatSpot(seat, mirror);
      const px = projectTop({ x: at.x, y: 0, z: at.z }, stageW, stage.height);
      // `start` is the reading start: the right edge in Arabic. The court is a picture and never flips.
      return { seat, start: mirror ? stageW - px.x : px.x, top: px.y };
    });
  }, [stageW, stage.height, mirror]);
  const spotTargets = (
    // Held over the court, which stays put while the list scrolls (CourtStage),
    // by undoing the scroll. Once the sheet rides over a spot it takes the touch.
    // Mounted even with no spots (a quiet court, the Tournaments switch): it is
    // what keeps `scroll.y` on the native side, and unmounting it dropped the
    // value's native node and the Frost's listener with it, so the page no
    // longer frosted on the scroll.
    <Animated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { transform: [{ translateY: scroll.y }] }]}
    >
      {(court.spots ? spotPoints : [])
        .filter((p) => p.seat >= court.taken)
        .map((p) => (
          <Pressable
            key={p.seat}
            testID={`play.court.spot.${p.seat}`}
            // The caption is the screen reader's way to the same place.
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              goToCourt();
            }}
            style={{
              position: 'absolute',
              top: p.top - SPOT_TARGET / 2,
              start: p.start - SPOT_TARGET / 2,
              width: SPOT_TARGET,
              height: SPOT_TARGET,
            }}
          >
            {({ pressed }) => (
              <View
                style={{
                  flex: 1,
                  borderRadius: SPOT_TARGET / 2,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.3 : 0,
                }}
              />
            )}
          </Pressable>
        ))}
    </Animated.View>
  );

  // The title bar takes the sheet's ground once the sheet reaches it (owner,
  // 2026-10-13): from there the bar, the pinned controls and the rows read as
  // one surface. An eased fade as the sheet's top edge comes up; a plain view
  // beside the frosting, never over it, so the blur under it is untouched.
  const sheetAt = heroH - PLAY_SHEET_OVERLAP;
  const titleGround = useMemo(
    () =>
      scroll.y.interpolate({
        inputRange: EASE_STEPS.map((x) => sheetAt - TITLE_GROUND_FADE * (1 - x)),
        outputRange: EASE_OUT,
        extrapolate: 'clamp',
      }),
    [scroll.y, sheetAt],
  );
  const titleRow = (
    <PinnedTitle onHeight={setTitleH}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: titleGround }]}
      />
      <Rise index={0}>
        <View
          style={{
            paddingTop: safeTop + TAB_TITLE_TOP,
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
      </Rise>
    </PinnedTitle>
  );

  const header = (
    <View>
      {/* The court's slot: the 3D court is drawn BEHIND the list, fixed, and
          this transparent block is the window onto it until the sheet rises. */}
      <View
        pointerEvents="box-none"
        onLayout={(e) => setHeroY(e.nativeEvent.layout.y)}
        style={{ height: heroH }}
      >
        {spotTargets}
      </View>
      <Rise
        index={1}
        style={{
          marginTop: -PLAY_SHEET_OVERLAP,
          backgroundColor: colors.bg,
          borderTopStartRadius: 28,
          borderTopEndRadius: 28,
          // Room under the court's caption, which hangs half over this edge;
          // kept when there is no caption, so the list never jumps.
          paddingTop: space.xl + COURT_CAPTION_H / 2,
          paddingStart: space.l,
          paddingEnd: space.l,
          gap: space.sm,
        }}
      >
        {/* The branch picker rides on the sheet, under the court, as on Coaches. */}
        <BranchPicker testID="play.branch" fit={false} />
        {controls ? (
          // The controls' slot, out to the sheet's edges and over the sheet's gap.
          <View
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              setControlsY(y);
              if (controlsY === null) setControlsH(height);
            }}
            style={{
              marginStart: -space.l,
              marginEnd: -space.l,
              marginTop: -space.sm,
              marginBottom: -space.sm,
              height: controlsY === null ? undefined : controlsH,
            }}
          >
            {controlsY === null ? controls : null}
          </View>
        ) : null}
        {notices}
        {state}
      </Rise>
      {/* The court's caption: last, so it lies over the sheet's edge it hangs
          across, and takes touches there on Android too (inside this view). */}
      {caption && heroY !== null ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: heroY + heroH - PLAY_SHEET_OVERLAP - COURT_CAPTION_H / 2,
            start: space.l,
            end: space.l,
            alignItems: 'center',
          }}
        >
          <Rise index={1} style={{ maxWidth: '100%' }}>
            <CourtCaption
              testID="play.court.caption"
              lead={caption.lead}
              action={caption.action}
              hint={caption.hint}
              green={court.show === 'none'}
              onPress={goToCourt}
            />
          </Rise>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false} edges={[]} style={{ backgroundColor: colors.page }}>
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
        {frame && heroTop !== null ? (
          <CourtStage
            scene="join"
            join={courtSeats}
            top={heroTop}
            height={stage.height}
            patternBox={
              patternRect
                ? {
                    width: patternRect.width,
                    height: patternRect.height,
                    offsetX: frame.x - patternRect.x,
                    offsetY: frame.y + heroTop - patternRect.y,
                  }
                : undefined
            }
          />
        ) : null}
        <Frost scrollY={scroll.y} span={heroH} />
        <View style={{ flex: 1, marginTop: titleH, overflow: 'hidden' }}>
          {/* The night headers stick under the pinned controls, and the next
              night pushes the one before it out (owner, 2026-10-13). */}
          <StickyOffset.Provider value={controlsY === null ? 0 : controlsH}>
            <Animated.SectionList<PlayEntry, NightSection>
              ref={listRef}
              testID="play.list"
              sections={sections}
              keyExtractor={(e) => `${e.kind}:${e.key}`}
              stickySectionHeadersEnabled
              StickyHeaderComponent={StickyUnder}
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
              // Always room to scroll the court's slot fully away, however short the
              // list (a couple of tournaments): the frosting comes up over that
              // stretch, and a page that can barely move left the court sharp.
              contentContainerStyle={{
                flexGrow: 1,
                minHeight: frame ? frame.height - titleH + heroH : undefined,
              }}
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
                    viewOffset: 8 + controlsHRef.current,
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
          </StickyOffset.Provider>
          {controls && controlsY !== null ? (
            <Animated.View
              onLayout={(e) => setControlsH(e.nativeEvent.layout.height)}
              style={{
                position: 'absolute',
                top: 0,
                start: 0,
                end: 0,
                transform: [{ translateY: controlsShift }],
              }}
            >
              <Rise index={1}>{controls}</Rise>
            </Animated.View>
          ) : null}
        </View>
        {titleRow}
      </View>
    </Screen>
  );
}
