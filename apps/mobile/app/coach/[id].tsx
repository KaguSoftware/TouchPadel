import { useContext, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import {
  useGuestVenue,
  useIsDegraded,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { useCoachProfile } from '../../src/features/coaching/hooks';
import { lessonErrorCode, lessonErrorText } from '../../src/features/coaching/errors';
import { coachShareUrl, isCoachId } from '../../src/features/coaching/links';
import {
  coachBranch,
  displayCoachName,
  pick,
  type ProfileOffer,
} from '../../src/features/coaching/logic';
import { useCoachStatus } from '../../src/features/coach/useCoachStatus';
import { callPhone } from '../../src/lib/phone';
import { brand, radius, shadows, space, useTheme } from '../../src/theme';
import { Button, Screen } from '../../src/components/ui';
import { DegradedBanner } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice, MatchSectionTitle, ShareGlyph } from '../../src/components/match';
import {
  COACH_DOCK,
  CoachDockBar,
  coachDockAt,
  CoachHero,
  OfferCard,
} from '../../src/components/coaching';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useToast } from '../../src/components/overlays';

/** How far the name card rides up over the hero (Figma "D · Profile": the card overlaps the band). */
const CARD_OVERLAP = 56;
/** The hero's height below the status bar (Figma "D · Profile": 340 with the bar). */
const HERO_HEIGHT = 290;
/**
 * A coach's page (docs/design/coaching/guest.md §4.8.3): the card, the
 * lessons they offer at a branch, and the branch's phone.
 *
 * The branch is the `venueId` param, else the guest's when the coach teaches
 * there, else the coach's first (R17: the `/c/<id>` link names none, so the
 * first read is the card with its branches, and the second the branch). The
 * choice is this screen's only: it never writes the stored branch.
 *
 * Layout is the Figma "D · Profile" frame: the photo full width under a
 * transparent native header, the name card over it, the lessons as a sideways
 * rows of cards (private, then group). Every lesson's card opens its own
 * page (`app/lesson-times.tsx`): a private lesson's free times, which books
 * it, or a group or course lesson's upcoming dates. A `typeId` param (and
 * `date`) opens that page for the lesson once the profile is in.
 *
 * Browsing is public. A paused coach, the switch off, and the coach looking
 * at their own page (R56) show a line, and the private cards open nothing.
 */
export default function CoachDetailScreen() {
  const { t, locale, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    id?: string;
    venueId?: string;
    typeId?: string;
    date?: string;
  }>();
  const id = typeof params.id === 'string' && isCoachId(params.id) ? params.id : null;
  const venueParam = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const guest = useGuestVenue();
  // A reader while signed in, so coach_me is read here too: until it answers,
  // whether the viewer is this coach (R56: they cannot book their own
  // lessons) is not known, and the private cards wait for it (MB-18).
  const me = useCoachStatus({ read: !!session });
  const meReading = !!session && me.status.kind === 'pending';

  // The first read: with the param's branch, or the link's read with none (R17).
  const first = useCoachProfile(id, venueParam);
  const firstVenue = first.data?.venue ?? null;
  const branchId =
    venueParam ??
    firstVenue?.venueId ??
    (first.data?.coach ? coachBranch(null, guest.venueId, first.data.coach.venueIds) : null);
  // The second read, only when the first named no branch.
  const second = useCoachProfile(
    !venueParam && first.data && !firstVenue && !first.data.off && branchId ? id : null,
    branchId,
  );
  const profile = firstVenue || venueParam ? first : second;
  const data = profile.data ?? null;
  const settings = useVenueSettings(branchId);
  const degraded = useIsDegraded(branchId);
  const venue = data?.venue ?? null;
  const phone = venue?.phone ?? venuePhoneOf(settings.data);
  const branchLabel = venue ? pick(venue.nameEn, venue.nameAr, locale) : '';

  // The page's scroll, on the native driver, for the dock bar (CoachDockBar).
  const [scrollY] = useState(() => new Animated.Value(0));
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
    }),
  );
  // The native bar as the navigator measured it (iOS 26's is taller than 44,
  // and its glass items hung out of a fill drawn at 44).
  const headerHeight = useContext(HeaderHeightContext);
  const barHeight = headerHeight ? headerHeight - insets.top : COACH_DOCK.bar;
  const cardTop = insets.top + HERO_HEIGHT - CARD_OVERLAP;
  const dockAt = coachDockAt(cardTop, insets.top, barHeight);
  // Whether the bar has filled in: the Android items go from white to blue.
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const sub = scrollY.addListener(({ value }) => setDocked(value >= dockAt - 20));
    return () => scrollY.removeListener(sub);
  }, [scrollY, dockAt]);

  const coach = data?.coach ?? first.data?.coach ?? null;
  const name = displayCoachName(coach, locale);
  const self = !!coach && me.coach?.id === coach.id;
  const paused = coach?.status === 'paused';
  // coach_slots answering {off: true} is the profile's off, read later (MB-12).
  const off = !!data?.off;
  const otherBranch = !!branchId && !!guest.venueId && branchId !== guest.venueId;
  const money = (n: number | null) => (n === null ? null : isolate(formatIQD(n, locale)));

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const openTimes = (typeId: string, date?: string) => {
    if (!id || !branchId) return;
    router.push({
      pathname: '/lesson-times',
      params: { coachId: id, venueId: branchId, typeId, ...(date ? { date } : {}) },
    });
  };

  // A link that names a private lesson (and maybe a night) opens its times,
  // once, as soon as the profile says the coach can be booked.
  const linkTypeId = typeof params.typeId === 'string' ? params.typeId : null;
  const linkDate = typeof params.date === 'string' ? params.date : undefined;
  const linkOpened = useRef(false);
  const linkReady =
    !!linkTypeId &&
    !!data &&
    !data.off &&
    coach?.status !== 'paused' &&
    !meReading &&
    !self &&
    data.offers.some((o) => o.kind === 'private' && o.lessonTypeId === linkTypeId);
  useEffect(() => {
    if (!linkReady || linkOpened.current || !linkTypeId) return;
    linkOpened.current = true;
    openTimes(linkTypeId, linkDate);
    // openTimes reads only the id and branch, both settled once data is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkReady]);

  const onShare = () => {
    if (!coach) return;
    void Share.share({
      message: t('coaching.guest.coach.shareMessage', {
        name: isolate(name),
        url: coachShareUrl(coach.id),
      }),
    }).catch(() => {});
  };

  const offerMeta = (o: ProfileOffer): string => {
    const parts = [t('coaching.common.durationMin', { minutes: o.durationMin })];
    if (o.kind === 'private') {
      parts.push(
        t('coaching.common.upTo', {
          people: countPhrase('coaching.common.count.people', o.maxPlaces, locale),
        }),
      );
    } else if (o.kind === 'group') {
      parts.push(countPhrase('coaching.common.count.places', o.maxPlaces, locale));
    } else if (o.kind === 'course' && o.sessionsCount !== null) {
      parts.push(countPhrase('coaching.common.count.sessions', o.sessionsCount, locale));
    }
    return parts.join(' · ');
  };

  // Over the photo the Android toolbar has no glass item, so its back arrow and
  // the share glyph go white, and back to blue once the dock bar fills in;
  // iOS 26 wraps both in Liquid Glass circles.
  const overPhoto = Platform.OS === 'android' && !docked ? brand.white : colors.blue;
  // The bar is transparent and untitled in every state, from the first frame
  // (the root layout sets the same for this route), so the page never shows a
  // titled bar that then gives way to the photo. `onPhoto` is whether the
  // items sit over the hero band (white on Android) or over the page ground.
  const headerFor = (onPhoto: boolean) => (
    <Stack.Screen
      options={{
        title: '',
        headerTransparent: true,
        // The shared options paint the bar `colors.bg`; a transparent header
        // keeps that fill unless it is cleared, and the photo sits under white.
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: onPhoto ? overPhoto : colors.blue,
        // iOS: a real UIBarButtonItem with the system share symbol, so UIKit
        // draws the button (and its Liquid Glass) itself. Android: a Pressable
        // with Material's share glyph.
        unstable_headerRightItems:
          coach && Platform.OS === 'ios'
            ? () => [
                {
                  type: 'button',
                  label: t('coaching.guest.coach.share'),
                  icon: { type: 'sfSymbol', name: 'square.and.arrow.up' },
                  accessibilityLabel: t('coaching.guest.coach.share'),
                  onPress: onShare,
                },
              ]
            : undefined,
        headerRight:
          coach && Platform.OS !== 'ios'
            ? () => (
                <Pressable
                  testID="coach-detail.share"
                  accessibilityRole="button"
                  accessibilityLabel={t('coaching.guest.coach.share')}
                  hitSlop={10}
                  onPress={onShare}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.6 : 1,
                    paddingStart: 6,
                    paddingEnd: 6,
                  })}
                >
                  <ShareGlyph color={onPhoto ? overPhoto : colors.blue} />
                </Pressable>
              )
            : undefined,
      }}
    />
  );
  const header = headerFor(false);
  // Under the transparent bar, a page without the hero starts below it.
  const belowBar = { paddingTop: insets.top + barHeight };

  const notFound = (
    <EmptyState
      testID="coach-detail.not-found"
      actionTestID="coach-detail.see-all"
      fill
      title={t('coaching.guest.coach.notFound')}
      actionLabel={t('coaching.guest.coach.seeAll')}
      onAction={() => router.replace('/coaches')}
    />
  );

  if (!id) {
    return (
      <Screen edges={[]} style={belowBar}>
        {header}
        {notFound}
      </Screen>
    );
  }

  const failed = profile.error ?? first.error;
  if (!data) {
    if (failed) {
      const code = lessonErrorCode(failed);
      return (
        <Screen edges={[]} style={belowBar}>
          {header}
          {code === 'COACH_NOT_FOUND' ||
          code === 'COACH_NOT_AT_BRANCH' ||
          code === 'INVALID_ARGUMENT' ? (
            notFound
          ) : (
            <ErrorState
              testID="coach-detail.error"
              title={t('errors.loadFailedTitle')}
              message={lessonErrorText(failed, t, { locale, phone })}
              retryLabel={t('common.retry')}
              onRetry={() => {
                void first.refetch();
                void second.refetch();
              }}
            />
          )}
        </Screen>
      );
    }
    if (first.data?.off) {
      return (
        <Screen edges={[]} style={belowBar}>
          {header}
          <View testID="coach-detail.off" style={{ paddingTop: space.m }}>
            <MatchNotice text={t('coaching.common.errors.off')} />
          </View>
        </Screen>
      );
    }
    // Loading: the hero's blue band in place already, so the photo arrives
    // into the same frame instead of after a bar.
    return (
      <Screen edges={[]} padded={false}>
        {headerFor(true)}
        <CoachHero photoPath={null} name="" height={insets.top + HERO_HEIGHT} initial={false} />
        <View style={{ paddingStart: space.l, paddingEnd: space.l, paddingTop: space.m }}>
          <SkeletonList rows={3} height={96} />
        </View>
      </Screen>
    );
  }

  const bio = coach ? pick(coach.bioEn, coach.bioAr, locale) : '';
  // Private lessons open their free times on their own page (lesson-times);
  // while the viewer could book one, the name card says so.
  const bookable =
    !off && !paused && !self && !meReading && data.offers.some((o) => o.kind === 'private');
  const datedTypes = new Set(data.sessions.map((x) => x.lessonTypeId));
  const offerRows = (
    [
      {
        key: 'private',
        title: 'coaching.guest.coach.privateLessons',
        offers: data.offers.filter((o) => o.kind === 'private'),
      },
      {
        key: 'group',
        title: 'coaching.guest.coach.groupLessons',
        offers: data.offers.filter(
          (o) => (o.kind === 'group' || o.kind === 'course') && datedTypes.has(o.lessonTypeId),
        ),
      },
    ] as const
  ).filter((row) => row.offers.length > 0);

  return (
    <Screen edges={[]} padded={false}>
      {headerFor(true)}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingBottom: 40 + insets.bottom,
        }}
      >
        <CoachHero
          testID="coach-detail.hero"
          photoPath={coach?.photoPath ?? null}
          name={name}
          height={insets.top + HERO_HEIGHT}
          initial={false}
        />
        <View style={{ paddingStart: space.l, paddingEnd: space.l, gap: space.sm }}>
          {/* The name card rides up over the hero (Figma "D · Profile"): name,
            branch, the "Taking bookings" badge while a private lesson is bookable, and the
            bio in full. Not pressable (§4.8.3 item 1). Its top leaves
            room for the avatar CoachDockBar draws on its edge, so the name,
            branch and badge are centred under it. */}
          <View
            style={{
              marginTop: -CARD_OVERLAP,
              backgroundColor: colors.card,
              borderRadius: radius.sheet,
              paddingTop: COACH_DOCK.big / 2 + space.sm,
              paddingBottom: space.l,
              paddingStart: space.l,
              paddingEnd: space.l,
              gap: space.sm,
              boxShadow: shadows.card,
            }}
          >
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text
                  style={{
                    fontFamily: fonts.display800,
                    fontSize: 22,
                    color: colors.ink,
                    textAlign: 'center',
                  }}
                >
                  {name}
                </Text>
                {branchLabel ? (
                  <Text
                    style={{
                      fontFamily: fonts.body600,
                      fontSize: 12.5,
                      color: colors.mut,
                      textAlign: 'center',
                    }}
                  >
                    {otherBranch
                      ? t('coaching.common.atBranch', { branch: isolate(branchLabel) })
                      : branchLabel}
                  </Text>
                ) : null}
              </View>
              {bookable ? (
                <View
                  style={{
                    backgroundColor: colors.gtint,
                    borderRadius: 10,
                    paddingTop: 6,
                    paddingBottom: 6,
                    paddingStart: 10,
                    paddingEnd: 10,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.gtext }}>
                    {t('coaching.guest.coach.taking')}
                  </Text>
                </View>
              ) : null}
            </View>
            {bio ? (
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 14,
                  lineHeight: 21,
                  color: colors.mut2,
                }}
              >
                {bio}
              </Text>
            ) : null}
          </View>

          {degraded && phone ? (
            <DegradedBanner
              testID="coach-detail.degraded"
              tight
              message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
              phone={phone}
            />
          ) : null}

          {off ? <MatchNotice text={t('coaching.common.errors.off')} /> : null}
          {paused ? <MatchNotice text={t('coaching.guest.coach.paused')} /> : null}
          {self ? <MatchNotice text={t('coaching.guest.coach.self')} /> : null}

          {/* Two sideways rows of lesson cards: private lessons, then group
            sessions and courses. A group or course lesson shows only while it
            has an upcoming date with places; a row with no cards is left out. */}
          <View testID="coach-detail.offers" style={{ gap: space.l }}>
            {offerRows.map((row) => (
              <View
                key={row.key}
                testID={`coach-detail.offers.${row.key}`}
                style={{ gap: space.s }}
              >
                <MatchSectionTitle>{t(row.title)}</MatchSectionTitle>
                {/* Bled to the screen's edges so cards slide off them; the
                  first lines up with the title. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginStart: -space.l, marginEnd: -space.l }}
                  contentContainerStyle={{
                    gap: space.s,
                    paddingStart: space.l,
                    paddingEnd: space.l,
                  }}
                >
                  {row.offers.map((o) => (
                    <OfferCard
                      key={o.lessonTypeId}
                      testID={`coach-detail.offer.${o.lessonTypeId}`}
                      name={pick(o.nameEn, o.nameAr, locale)}
                      kind={t(`coaching.common.kinds.${o.kind!}`)}
                      meta={offerMeta(o)}
                      price={money(o.priceIqd)}
                      // A private lesson opens its free times only while it
                      // can be booked; a group or course one always opens its dates.
                      onPress={() => {
                        if (o.kind !== 'private' || bookable) openTimes(o.lessonTypeId);
                      }}
                    />
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>

          {phone && branchLabel ? (
            <Button
              testID="coach-detail.call-venue"
              label={t('coaching.guest.coach.questions', { branch: isolate(branchLabel) })}
              variant="ghost"
              onPress={callBranch}
              style={{ marginTop: space.m }}
            />
          ) : null}
        </View>
      </Animated.ScrollView>
      <CoachDockBar
        scrollY={scrollY}
        photoPath={coach?.photoPath ?? null}
        name={name}
        cardTop={cardTop}
        topInset={insets.top}
        bar={barHeight}
        width={width}
        rtl={dir === 'rtl'}
        reduceMotion={reduceMotion}
      />
    </Screen>
  );
}
