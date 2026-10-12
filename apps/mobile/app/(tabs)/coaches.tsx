import { useMemo, useState } from 'react';
import {
  Animated,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { formatIQD, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { BranchPicker } from '../../src/features/availability/BranchPicker';
import { branchName } from '../../src/features/availability/branch';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { useCoachingBranch, useCoachingPublic } from '../../src/features/coaching/hooks';
import { usePlayProfile } from '../../src/features/playProfile/hooks';
import {
  coachesAt,
  coachesForLevel,
  displayCoachName,
  kindsTaught,
  lowestOfferPrice,
  showcaseLevelFor,
  showcaseOrder,
  showcaseSeed,
  type PublicCoach,
  type ShowcaseLevel,
} from '../../src/features/coaching/logic';
import { lessonErrorText } from '../../src/features/coaching/errors';
import { callPhone } from '../../src/lib/phone';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { space, useTheme } from '../../src/theme';
import { Button, Screen, TAB_TITLE_TOP, Title } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice } from '../../src/components/match';
import { BrandPattern } from '../../src/components/BrandPattern';
import { CalendarIcon, WhistleIcon } from '../../src/components/icons';
import { Rise, useScrollY } from '../../src/components/motion';
import { CourtStage, topStageFor } from '../../src/components/CourtStage';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { useToast } from '../../src/components/overlays';
import { GlassPlate, ShowcaseCard, ShowcaseLink } from '../../src/components/coachShowcase';

/** The gap between the two columns and between rows. */
const GAP = space.sm;
/** How far the glass plate rides up over the court's foot (the Book card over its court). */
const PLATE_OVERLAP = 34;
/** Air between the court's near sideline and the plate's top edge. */
const COURT_AIR = 10;

/**
 * Coaches, a tab of its own (play-coaches contracts §6; Majed, 2026-10-11):
 * the branch's coaches who accepted a public profile, shown as a showcase.
 *
 * NO HIERARCHY. Every card is the same size and weight (no featured coach, no
 * ranking, no "top"), and the order is `showcaseOrder` seeded by the
 * venue-local date: it holds all day and changes at midnight, so nobody is
 * always first. It is never the venue's `sortOrder`. The page shows the
 * coaches who teach a player at the guest's own level, the one saved in the
 * player questionnaire (app/play-survey.tsx). The tab neither shows nor asks
 * the level (2026-10-12): it lives in Edit profile's Personal details ("Your
 * game"). With no level saved (or signed out) every coach shows. A coach who lists no levels teaches every
 * level and shows under each one. The levels name the PLAYER ("Your level"),
 * never a coach's rank.
 *
 * Everything the old stack screen did stays (docs/design/coaching/guest.md
 * §4.8.2): the branch picker, the switched-off notice with the branch's
 * phone, error / empty / loading, pull to refresh, the cards to `/coach/[id]`,
 * plus the ways to the group sessions (`/classes`) and My lessons.
 *
 * Browsing is public: no session guard. Switched off at the branch, the
 * screen does no work and says so, with the branch's phone.
 *
 * Motion (the Book tab's energy, motion.tsx): the court tips
 * back as the page scrolls (the Book tab's 3D court, `CourtStage`, fixed
 * behind the page, set up as a coaching drill), the glass plate rides over its
 * foot, the cards rise in staggered (and again when the level changes), lean into
 * the finger (`TiltPress`), and their photos drift against the frame as they
 * cross the screen. All of it holds still under Reduce Motion.
 */
export default function CoachesScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const tabBarHeight = useTabBarHeight();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { y: scrollY, onScroll } = useScrollY();

  const { guest, settings, on } = useCoachingBranch();
  const venueId = guest.venueId;
  // Switch off means no work: the read waits for the branch to say on.
  const pub = useCoachingPublic(on ? venueId : null);
  const pull = usePullRefresh(pub.refetch);
  const phone = venuePhoneOf(settings.data);
  const branch = guest.branch ? branchName(guest.branch, locale) : '';

  // The guest's own level from the questionnaire (`new` reads as Beginner),
  // else All (signed out, not loaded, or never answered).
  const playLevel = usePlayProfile()?.level ?? null;
  // "Show all coaches" from an empty level holds for the level it was pressed
  // on: a new answer in the questionnaire filters again.
  const [showAllFor, setShowAllFor] = useState<{ level: typeof playLevel } | null>(null);
  const showAll = showAllFor !== null && showAllFor.level === playLevel;
  const level: ShowcaseLevel = showAll ? 'all' : showcaseLevelFor(playLevel);

  const tz = pub.data?.branches.find((b) => b.venueId === venueId)?.timezone ?? null;
  const seed = showcaseSeed(new Date(), tz);
  const all = useMemo(
    () =>
      pub.data && venueId && !pub.data.off ? showcaseOrder(coachesAt(pub.data, venueId), seed) : [],
    [pub.data, venueId, seed],
  );
  const shown = useMemo(() => coachesForLevel(all, level), [all, level]);

  // One column width for every card: the cards never size to their content.
  const gutter = space.l;
  const colW = Math.floor((screenW - gutter * 2 - GAP) / 2);
  // The 3D court behind the page (CourtStage): its slot in the scroll content
  // at scroll 0, in the scroll view's own frame, and the pattern's box.
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const [patternRect, setPatternRect] = useState<LayoutRectangle | null>(null);
  const [heroY, setHeroY] = useState<number | null>(null);
  // Sized to the court itself (topStageFor): the court sits just under the
  // title and the plate starts right under the court (Majed, 2026-10-11).
  const stage = topStageFor(frame?.width ?? screenW);
  const heroH = stage.courtBottom + COURT_AIR + PLATE_OVERLAP;

  // Where the grid and each row sit in the scroll content, for the photo drift:
  // the body's top in the content, the grid's in the body, each row's in the grid.
  const [bodyY, setBodyY] = useState<number | null>(null);
  const [gridY, setGridY] = useState<number | null>(null);
  const [rowY, setRowY] = useState<Record<number, number>>({});
  const onRow = (i: number) => (e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setRowY((prev) => (prev[i] === y ? prev : { ...prev, [i]: y }));
  };

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const header = (
    <View>
      <View style={{ paddingTop: TAB_TITLE_TOP }}>
        <Title>{t('coaching.guest.coaches.title')}</Title>
      </View>
      {/* The court's slot: the 3D court is drawn BEHIND the scroll view, fixed,
          and this transparent block is the window onto it until the plate rises. */}
      <View
        pointerEvents="none"
        onLayout={(e) => setHeroY(e.nativeEvent.layout.y)}
        style={{ height: heroH }}
      />
    </View>
  );

  const picker = <BranchPicker testID="coaches.branch" />;

  // The plate over the court's foot: the branch picker whenever there is a
  // choice (it is how a guest leaves a switched-off branch). Without one there
  // is no plate, not an empty one.
  const plate = () =>
    !guest.showPicker ? (
      <View style={{ height: space.l }} />
    ) : (
      <GlassPlate style={{ marginTop: -PLATE_OVERLAP, marginBottom: space.l }}>
        <View style={{ padding: space.l, gap: space.m }}>{picker}</View>
      </GlassPlate>
    );

  const links = (
    <View style={{ flexDirection: 'row', gap: GAP, marginBottom: space.xl }}>
      <View style={{ flex: 1 }}>
        <ShowcaseLink
          testID="coaches.classes"
          icon={<WhistleIcon size={16} color={colors.gstrong} />}
          title={t('coachShowcase.classesTitle')}
          sub={t('coachShowcase.classesSub')}
          onPress={() => router.push('/classes')}
        />
      </View>
      <View style={{ flex: 1 }}>
        <ShowcaseLink
          testID="coaches.my-lessons"
          icon={<CalendarIcon size={16} color={colors.gstrong} />}
          title={t('coaching.guest.mine.title')}
          sub={t('coachShowcase.myLessonsSub')}
          onPress={() => router.push('/my-lessons')}
        />
      </View>
    </View>
  );

  const card = (c: PublicCoach, i: number, y: number | null) => {
    const name = displayCoachName(c, locale);
    const kinds = kindsTaught(c, pub.data?.lessonTypes ?? [], venueId ?? '')
      .map((k) => t(`coaching.common.kindsTaught.${k}`))
      .join(' · ');
    const low = venueId ? lowestOfferPrice(c, venueId) : null;
    return (
      <Rise key={c.id} index={i}>
        <ShowcaseCard
          testID={`coaches.row.${c.id}`}
          width={colW}
          name={name}
          photoPath={c.photoPath}
          kinds={kinds}
          from={
            low !== null
              ? t('coaching.common.from', { price: isolate(formatIQD(low, locale)) })
              : null
          }
          parallax={{ scrollY, y, viewport: screenH }}
          onPress={() =>
            router.push({ pathname: '/coach/[id]', params: { id: c.id, venueId: venueId ?? '' } })
          }
        />
      </Rise>
    );
  };

  const grid = () => {
    if (all.length === 0) {
      return (
        <EmptyState
          testID="coaches.empty"
          title={t('coaching.guest.coaches.emptyTitle')}
          message={t('coaching.guest.coaches.empty')}
        />
      );
    }
    if (shown.length === 0) {
      return (
        <EmptyState
          testID="coaches.empty-level"
          actionTestID="coaches.show-all"
          title={t('coachShowcase.emptyLevel.title')}
          message={t('coachShowcase.emptyLevel.message')}
          actionLabel={t('coachShowcase.emptyLevel.action')}
          onAction={() => setShowAllFor({ level: playLevel })}
        />
      );
    }
    const rows: PublicCoach[][] = [];
    for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));
    return (
      <View onLayout={(e) => setGridY(e.nativeEvent.layout.y)}>
        {/* Keyed by the level, so a change replays the rise: the new set
            arrives rather than the old one silently changing. */}
        <View key={level} testID="coaches.list" style={{ gap: GAP }}>
          {rows.map((row, r) => {
            const y =
              bodyY !== null && gridY !== null && rowY[r] !== undefined
                ? bodyY + gridY + rowY[r]
                : null;
            return (
              <View key={row[0]!.id} onLayout={onRow(r)} style={{ flexDirection: 'row', gap: GAP }}>
                {row.map((c, j) => card(c, r * 2 + j, y))}
              </View>
            );
          })}
        </View>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12,
            color: colors.fnt,
            textAlign: 'center',
            marginTop: space.l,
          }}
        >
          {t('coachShowcase.fairOrder')}
        </Text>
      </View>
    );
  };

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
      return <SkeletonList rows={2} height={200} />;
    }
    if (!on || pub.data?.off) {
      return (
        <View>
          {plate()}
          <View style={{ gap: space.m }}>
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
        </View>
      );
    }
    if (!pub.data) {
      if (pub.isError) {
        return (
          <View>
            {plate()}
            <ErrorState
              testID="coaches.error"
              title={t('errors.loadFailedTitle')}
              message={lessonErrorText(pub.error, t, { locale, phone })}
              retryLabel={t('common.retry')}
              onRetry={() => void pub.refetch()}
              busy={pub.isRefetching}
            />
          </View>
        );
      }
      return (
        <View>
          {plate()}
          <SkeletonList rows={2} height={200} />
        </View>
      );
    }
    return (
      <View onLayout={(e) => setBodyY(e.nativeEvent.layout.y)}>
        {plate()}
        {links}
        {grid()}
      </View>
    );
  })();

  return (
    <Screen padded={false} style={{ backgroundColor: colors.page }}>
      {/* The Book tab's ground: the brand lines, full bleed and still while the
          page scrolls over them; the court draws the same crop behind its scene. */}
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
            scene="drill"
            top={heroY}
            height={stage.height}
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
        <Animated.ScrollView
          testID="coaches.scroll"
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingStart: gutter,
            paddingEnd: gutter,
            paddingBottom: tabBarHeight + 24,
          }}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.blue}
            />
          }
        >
          {header}
          {body}
        </Animated.ScrollView>
      </View>
    </Screen>
  );
}
