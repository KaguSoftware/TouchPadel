import { useRef, useState } from 'react';
import { Pressable, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wallTimeToUtc } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatDayNumber,
  formatIQD,
  formatTime,
  formatWeekdayShort,
  isolate,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import {
  useGuestVenue,
  useIsDegraded,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { venuePhoneOf, type MergedCell } from '../../src/features/availability/assemble';
import { useCoachProfile } from '../../src/features/coaching/hooks';
import { useLessonBooking } from '../../src/features/coaching/useLessonBooking';
import { lessonErrorCode, lessonErrorText } from '../../src/features/coaching/errors';
import { coachShareUrl, isCoachId } from '../../src/features/coaching/links';
import { setPendingLesson } from '../../src/features/coaching/pendingLesson';
import {
  classTarget,
  coachBranch,
  displayCoachName,
  pick,
  type ProfileOffer,
} from '../../src/features/coaching/logic';
import { useCoachStatus } from '../../src/features/coach/useCoachStatus';
import { callPhone } from '../../src/lib/phone';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Hint, Screen, SegmentedControl } from '../../src/components/ui';
import { DayChip, DegradedBanner, SlotCell, slotTestID } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice, MatchSectionTitle, ShareGlyph } from '../../src/components/match';
import { ClassRow, CoachAvatar, OfferRow } from '../../src/components/coaching';
import { useToast } from '../../src/components/overlays';

const GRID_COLUMNS = 3;

/**
 * A coach's page (docs/design/coaching/guest.md §4.8.3): the card, the
 * lessons they offer at a branch, the private-lesson grid, their group
 * sessions and courses with places, and the branch's phone.
 *
 * The branch is the `venueId` param, else the guest's when the coach teaches
 * there, else the coach's first (R17: the `/c/<id>` link names none, so the
 * first read is the card with its branches, and the second the branch). The
 * choice is this screen's only: it never writes the stored branch.
 *
 * Browsing is public: a signed-out tap on a time keeps the intent
 * (`pendingLesson`) and opens the welcome. The grid is `useLessonBooking`'s;
 * only the server's free starts are cells, so nothing is greyed out. A paused
 * coach, the switch off, and the coach looking at their own page (R56) show a
 * line instead of the grid.
 */
export default function CoachDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
  const me = useCoachStatus();

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
  const tz = venue?.timezone ?? settings.data?.timezone ?? 'Asia/Baghdad';

  const booking = useLessonBooking({
    coachId: id,
    settings: settings.data,
    timezone: venue?.timezone,
    offers: data?.offers ?? [],
    preselectTypeId: typeof params.typeId === 'string' ? params.typeId : null,
    preselectDate: typeof params.date === 'string' ? params.date : null,
  });

  const [bioOpen, setBioOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sessionsY = useRef(0);

  const coach = data?.coach ?? first.data?.coach ?? null;
  const name = displayCoachName(coach, locale);
  const self = !!coach && me.coach?.id === coach.id;
  const paused = coach?.status === 'paused' || booking.status === 'paused';
  const otherBranch = !!branchId && !!guest.venueId && branchId !== guest.venueId;
  const money = (n: number | null) => (n === null ? null : isolate(formatIQD(n, locale)));

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const onShare = () => {
    if (!coach) return;
    void Share.share({
      message: t('coaching.guest.coach.shareMessage', {
        name: isolate(name),
        url: coachShareUrl(coach.id),
      }),
    }).catch(() => {});
  };

  const onTime = (cell: MergedCell) => {
    if (!id || !branchId || !booking.typeId) return;
    const startAt = cell.startAt.toISOString();
    const priceIqd = booking.offer?.priceIqd ?? null;
    if (!session) {
      setPendingLesson({
        kind: 'private',
        coachId: id,
        lessonTypeId: booking.typeId,
        venueId: branchId,
        startAt,
        priceIqd,
      });
      router.push('/welcome');
      return;
    }
    router.push({
      pathname: '/lesson-review',
      params: {
        coachId: id,
        lessonTypeId: booking.typeId,
        venueId: branchId,
        startAt,
        ...(priceIqd !== null ? { priceIqd: String(priceIqd) } : {}),
      },
    });
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

  const header = (
    <Stack.Screen
      options={{
        title: name || t('coaching.guest.coach.title'),
        headerRight: coach
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
                <ShareGlyph color={colors.blue} />
              </Pressable>
            )
          : undefined,
      }}
    />
  );

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
      <Screen edges={[]}>
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
        <Screen edges={[]}>
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
        <Screen edges={[]}>
          {header}
          <View testID="coach-detail.off" style={{ paddingTop: space.m }}>
            <MatchNotice text={t('coaching.common.errors.off')} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen edges={[]}>
        {header}
        <SkeletonList rows={3} height={96} />
      </Screen>
    );
  }

  const bio = coach ? pick(coach.bioEn, coach.bioAr, locale) : '';
  const cellWidth = Math.floor((width - space.l * 2 - space.s * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const showGrid = !data.off && !paused && !self && booking.types.length > 0;

  const grid = (() => {
    if (!showGrid) return null;
    const offer = booking.offer;
    return (
      <View style={{ gap: space.sm }}>
        <MatchSectionTitle>{t('coaching.guest.coach.grid')}</MatchSectionTitle>
        {booking.types.length > 1 ? (
          <SegmentedControl<string>
            testID="coach-detail.type"
            options={booking.types.map((o) => ({
              value: o.lessonTypeId,
              label: pick(o.nameEn, o.nameAr, locale),
            }))}
            value={booking.typeId ?? ''}
            onChange={booking.setTypeId}
            activeColor={colors.gstrong}
          />
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {booking.dates.map((d) => {
            const noon = wallTimeToUtc(d, 12 * 60, booking.tz);
            return (
              <DayChip
                key={d}
                testID={`coach-detail.day.${d}`}
                compact
                dow={formatWeekdayShort(noon, locale, booking.tz)}
                dayNum={formatDayNumber(noon, locale, booking.tz)}
                selected={d === booking.night}
                closed={booking.status === 'ready' && !booking.openNights.has(d)}
                closedLabel={t('coaching.guest.coach.dayFull')}
                onPress={() => booking.setNight(d)}
              />
            );
          })}
        </ScrollView>
        {booking.status === 'loading' ? <SkeletonList rows={1} height={60} /> : null}
        {booking.status === 'error' ? (
          <ErrorState
            testID="coach-detail.slots-error"
            title={t('errors.loadFailedTitle')}
            message={t('coaching.guest.coach.error')}
            retryLabel={t('common.retry')}
            onRetry={booking.refetch}
          />
        ) : null}
        {booking.status === 'empty' ? (
          <Hint>
            {phone
              ? t('coaching.guest.coach.noTimes', { branch: isolate(branchLabel) })
              : t('coaching.guest.coach.noTimesNoPhone')}
          </Hint>
        ) : null}
        {booking.status === 'ready' && booking.cells.length === 0 ? (
          <Hint>{t('coaching.guest.coach.noTimesNight')}</Hint>
        ) : null}
        {booking.cells.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {booking.cells.map((cell) => (
              <SlotCell
                key={cell.startAt.getTime()}
                testID={slotTestID('coach-detail.slot', cell)}
                compact
                width={cellWidth}
                cell={cell}
                time={formatTime(cell.startAt, locale, booking.tz)}
                sub={money(cell.priceIqd) ?? ''}
                capacityLine=""
                onPress={onTime}
              />
            ))}
          </View>
        ) : null}
        {offer ? (
          <Hint>
            {[
              offer.priceIqd !== null
                ? t('coaching.common.forTheLesson', { price: money(offer.priceIqd) ?? '' })
                : null,
              t('coaching.common.upTo', {
                people: countPhrase('coaching.common.count.people', offer.maxPlaces, locale),
              }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Hint>
        ) : null}
      </View>
    );
  })();

  return (
    <Screen edges={[]}>
      {header}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        {degraded && phone ? (
          <DegradedBanner
            testID="coach-detail.degraded"
            tight
            message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
            phone={phone}
          />
        ) : null}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <CoachAvatar photoPath={coach?.photoPath ?? null} name={name} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontFamily: fonts.display900, fontSize: 20, color: colors.ink }}>
                {name}
              </Text>
              {otherBranch && branchLabel ? (
                <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
                  {t('coaching.common.atBranch', { branch: isolate(branchLabel) })}
                </Text>
              ) : null}
            </View>
          </View>
          {bio ? (
            <View style={{ marginTop: space.sm, gap: 4 }}>
              <Text
                numberOfLines={bioOpen ? undefined : 3}
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  lineHeight: 19,
                  color: colors.mut2,
                }}
              >
                {bio}
              </Text>
              <Pressable
                testID="coach-detail.bio-more"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setBioOpen((v) => !v)}
              >
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue }}>
                  {t(bioOpen ? 'coaching.guest.coach.less' : 'coaching.guest.coach.more')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </Card>

        {data.off ? <MatchNotice text={t('coaching.common.errors.off')} /> : null}
        {paused ? <MatchNotice text={t('coaching.guest.coach.paused')} /> : null}
        {self ? <MatchNotice text={t('coaching.guest.coach.self')} /> : null}

        <View testID="coach-detail.offers" style={{ gap: space.s }}>
          <MatchSectionTitle>{t('coaching.guest.coach.offers')}</MatchSectionTitle>
          {data.offers
            .filter((o) => o.kind !== null)
            .map((o) => (
              <OfferRow
                key={o.lessonTypeId}
                testID={`coach-detail.offer.${o.lessonTypeId}`}
                name={pick(o.nameEn, o.nameAr, locale)}
                kind={t(`coaching.common.kinds.${o.kind!}`)}
                meta={offerMeta(o)}
                price={money(o.priceIqd)}
                selected={o.kind === 'private' && o.lessonTypeId === booking.typeId && showGrid}
                onPress={() => {
                  if (o.kind === 'private') booking.setTypeId(o.lessonTypeId);
                  else scrollRef.current?.scrollTo({ y: sessionsY.current, animated: true });
                }}
              />
            ))}
        </View>

        {grid}

        {data.sessions.length > 0 ? (
          <View
            style={{ gap: space.s }}
            onLayout={(e) => {
              sessionsY.current = e.nativeEvent.layout.y;
            }}
          >
            <MatchSectionTitle>{t('coaching.guest.coach.sessions')}</MatchSectionTitle>
            {data.sessions.map((s) => {
              const target = classTarget(s);
              if (!target) return null;
              const type = data.offers.find((o) => o.lessonTypeId === s.lessonTypeId);
              const start = new Date(s.startAt);
              return (
                <ClassRow
                  key={target.id}
                  testID={`coach-detail.session.${target.id}`}
                  kind={t(`coaching.common.kinds.${s.kind}`)}
                  title={
                    pick(s.titleEn, s.titleAr, locale) ||
                    (type ? pick(type.nameEn, type.nameAr, locale) : '')
                  }
                  coach={name}
                  when={`${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)} · ${formatTime(start, locale, tz)}`}
                  places={countPhrase('coaching.common.count.placesLeft', s.placesLeft, locale)}
                  price={type ? money(type.priceIqd) : null}
                  onPress={() => router.push({ pathname: '/class/[id]', params: target })}
                />
              );
            })}
          </View>
        ) : null}

        {phone && branchLabel ? (
          <Button
            testID="coach-detail.call-venue"
            label={t('coaching.guest.coach.questions', { branch: isolate(branchLabel) })}
            variant="ghost"
            onPress={callBranch}
            style={{ marginTop: space.m }}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
