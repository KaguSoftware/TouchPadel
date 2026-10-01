import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { needsTermsAcceptance } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatIQD,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { bookingGateState } from '../src/features/auth/social';
import { useOwnConsent, useOwnProfile } from '../src/features/profile/hooks';
import { useIsDegraded, useVenueSettings } from '../src/features/availability/hooks';
import { venuePhoneOf } from '../src/features/availability/assemble';
import { rpcErrorDetail } from '../src/features/booking/errors';
import { coachingKeys, useBookPrivate, useCoachProfile } from '../src/features/coaching/hooks';
import { useStartLessonPayment } from '../src/features/coaching/payment';
import { bookRefusalOf, lessonErrorCode, lessonErrorText } from '../src/features/coaching/errors';
import { parsePriceChanged } from '../src/features/matches/errors';
import {
  displayCoachName,
  effectiveChoice,
  friendNamesFor,
  paymentChoices,
  pick,
  type LessonWrite,
  type PaymentChoice,
} from '../src/features/coaching/logic';
import { useBack } from '../src/navigation/back';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, FormScreen, Hint, Screen } from '../src/components/ui';
import { DegradedBanner, SummaryGrid, type SummaryRow } from '../src/components/booking';
import { ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice, MatchSectionTitle } from '../src/components/match';
import { PartyStepper, PaymentModeChoice } from '../src/components/coaching';
import { CalendarIcon, ClockIcon, TagIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';

/**
 * The private lesson's review (docs/design/coaching/guest.md §4.8.6, §4.9.1):
 * the coach, the lesson, the time, the party (1..the type's largest), the
 * friends' names, the payment choice and Book.
 *
 * The profile read decides the price (the `priceIqd` param is a hint); the
 * phone sends it as `p_expected_price_iqd` and the server answers
 * PRICE_CHANGED when it moved. The booking gate stands first (a private
 * lesson takes a court): no phone → /complete-profile, a phone nobody
 * verified → /phone-sign-in, both in back mode. The key is the intent's
 * (`lessonIntentKey(privateIntent(…))`), kept across the refusals the guest
 * fixes. Desk: booked, the lesson opens. Qi: held, the payment opens.
 */
function LessonReviewScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Back to the coach's grid; a review opened with no history lands on the coaches.
  const back = useBack('/coaches');
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    coachId?: string;
    lessonTypeId?: string;
    venueId?: string;
    startAt?: string;
  }>();
  const coachId = typeof params.coachId === 'string' && params.coachId ? params.coachId : null;
  const lessonTypeId = typeof params.lessonTypeId === 'string' ? params.lessonTypeId : '';
  const venueId = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const startAt =
    typeof params.startAt === 'string' && Number.isFinite(Date.parse(params.startAt))
      ? params.startAt
      : null;

  const coachRead = useCoachProfile(coachId, venueId);
  const settings = useVenueSettings(venueId);
  const degraded = useIsDegraded(venueId);
  const profile = useOwnProfile(!!session);
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);
  // Unread consent sends TERMS_REQUIRED to /accept-terms, which reads it itself.
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const book = useBookPrivate();
  const payment = useStartLessonPayment();

  const [party, setParty] = useState(1);
  const [friends, setFriends] = useState<string[]>(['', '', '']);
  const [picked, setPicked] = useState<PaymentChoice>('desk');
  const [error, setError] = useState<string | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);

  const data = coachRead.data ?? null;
  const offer =
    data?.offers.find((o) => o.lessonTypeId === lessonTypeId && o.kind === 'private') ?? null;
  const venue = data?.venue ?? null;
  const tz = venue?.timezone ?? settings.data?.timezone ?? 'Asia/Baghdad';
  const phone = venue?.phone ?? venuePhoneOf(settings.data);
  const mode = effectiveChoice(venue?.paymentMode ?? 'desk', picked);
  const maxParty = offer?.maxPlaces ?? 1;
  const partySize = Math.min(party, maxParty);
  const money = (n: number | null | undefined) =>
    typeof n === 'number' ? isolate(formatIQD(n, locale)) : '';
  const errorCtx = { locale, phone, termsCurrent: !needsTerms };
  const busy = book.isPending || payment.busy;

  const header = <Stack.Screen options={{ title: t('coaching.guest.review.title') }} />;

  if (!coachId || !venueId || !startAt || !lessonTypeId) {
    return (
      <Screen edges={[]}>
        {header}
        <View style={{ paddingTop: space.m }}>
          <MatchNotice text={t('coaching.common.errors.typeNotFound')} />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen edges={[]}>
        {header}
        {coachRead.isError ? (
          <ErrorState
            testID="lesson-review.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(coachRead.error, t, { locale, phone })}
            retryLabel={t('common.retry')}
            onRetry={() => void coachRead.refetch()}
            busy={coachRead.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={96} />
        )}
      </Screen>
    );
  }

  const start = new Date(startAt);
  const rows: SummaryRow[] = [
    {
      icon: CalendarIcon,
      label: t('booking.date'),
      value: `${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)}`,
    },
    { icon: ClockIcon, label: t('booking.time'), value: formatTime(start, locale, tz) },
  ];
  if (offer) {
    rows.push({
      icon: ClockIcon,
      label: t('coaching.common.duration'),
      value: t('coaching.common.durationMin', { minutes: offer.durationMin }),
    });
  }
  if (venue)
    rows.push({
      icon: TagIcon,
      label: t('coaching.common.branch'),
      value: pick(venue.nameEn, venue.nameAr, locale),
    });

  const opened = (result: LessonWrite) => {
    if (result.status === 'held') {
      payment.start(result.enrolmentId, {
        onError: (err) => {
          toast(lessonErrorText(err, t, errorCtx), 'error');
          router.replace({ pathname: '/lesson/[id]', params: { id: result.enrolmentId } });
        },
      });
      return;
    }
    toast(t('coaching.guest.review.booked'), 'success');
    router.replace({ pathname: '/lesson/[id]', params: { id: result.enrolmentId } });
  };

  const onError = (err: Error) => {
    const code = lessonErrorCode(err);
    const detail = rpcErrorDetail(err);
    switch (bookRefusalOf(code, detail)) {
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setError(t('coaching.common.errors.updateApp'));
        return;
      case 'priceChanged': {
        const current = parsePriceChanged(detail)?.currentIqd ?? null;
        void coachRead.refetch();
        setPriceNote(
          current !== null
            ? t('coaching.common.errors.priceChangedTo', { price: money(current) })
            : lessonErrorText(err, t, errorCtx),
        );
        return;
      }
      case 'backToGrid':
        toast(lessonErrorText(err, t, errorCtx), 'error');
        void queryClient.invalidateQueries({ queryKey: coachingKeys.slotsAll });
        back();
        return;
      case 'party': {
        const max = detail && /^\d+$/.test(detail) ? Number(detail) : null;
        if (max !== null) setParty(Math.max(1, max));
        setPartyError(lessonErrorText(err, t, errorCtx));
        return;
      }
      case 'mode':
        void coachRead.refetch();
        void settings.refetch();
        setError(lessonErrorText(err, t, errorCtx));
        return;
      case 'banner':
        setBanner(lessonErrorText(err, t, errorCtx));
        return;
      default:
        setError(lessonErrorText(err, t, errorCtx));
    }
  };

  const onBook = () => {
    if (!offer || offer.priceIqd === null || !session) return;
    setError(null);
    setPartyError(null);
    setPriceNote(null);
    const gate = bookingGateState(profile, session.user);
    if (gate === 'incomplete') {
      router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
      return;
    }
    if (gate === 'unverified') {
      router.push({
        pathname: '/phone-sign-in',
        params: { returnTo: 'back', phone: profile.data?.phone ?? '' },
      });
      return;
    }
    book.mutate(
      {
        coachId,
        lessonTypeId,
        startAt,
        partySize,
        friendNames: friendNamesFor(friends, partySize),
        mode,
        expectedPriceIqd: offer.priceIqd,
      },
      { onSuccess: opened, onError },
    );
  };

  const partyLabel =
    partySize <= 1
      ? t('coaching.guest.review.justMe')
      : t('coaching.guest.review.mePlus', { count: isolateLtr(String(partySize - 1)) });
  const hours = venue?.cancellationWindowHours ?? settings.data?.cancellation_window_hours ?? 0;

  return (
    <Screen edges={[]}>
      {header}
      <FormScreen contentStyle={{ gap: space.sm, paddingTop: space.m }}>
        {degraded && phone ? (
          <DegradedBanner
            testID="lesson-review.degraded"
            tight
            message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
            phone={phone}
          />
        ) : null}
        <Card>
          <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
            {offer ? pick(offer.nameEn, offer.nameAr, locale) : t('coaching.common.lesson')}
          </Text>
          <Text
            style={{
              marginTop: 2,
              marginBottom: space.sm,
              fontFamily: fonts.body600,
              fontSize: 13,
              color: colors.mut,
            }}
          >
            {displayCoachName(data.coach, locale)}
          </Text>
          <SummaryGrid rows={rows} />
        </Card>

        {offer && offer.maxPlaces > 1 ? (
          <View style={{ gap: space.s }}>
            <MatchSectionTitle>{t('coaching.guest.review.party')}</MatchSectionTitle>
            <PartyStepper
              testID="lesson-review.party"
              value={partySize}
              max={maxParty}
              label={partyLabel}
              onChange={(n) => {
                setParty(n);
                setPartyError(null);
              }}
            />
            <ErrorText>{partyError}</ErrorText>
            {partySize > 1 ? (
              <View style={{ gap: space.s }}>
                <Hint>{t('coaching.guest.review.friends')}</Hint>
                {Array.from({ length: partySize - 1 }, (_, i) => (
                  <Field
                    key={i}
                    testID={`lesson-review.friend.${i + 1}`}
                    placeholder={t('coaching.guest.review.friend', {
                      n: isolateLtr(String(i + 1)),
                    })}
                    value={friends[i] ?? ''}
                    maxLength={40}
                    onChangeText={(v) =>
                      setFriends((prev) => prev.map((f, j) => (j === i ? v : f)))
                    }
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: space.s }}>
          <MatchSectionTitle>{t('coaching.guest.review.payment')}</MatchSectionTitle>
          <PaymentModeChoice
            testID="lesson-review.mode"
            choices={paymentChoices(venue?.paymentMode ?? 'desk')}
            value={mode}
            onChange={setPicked}
            labels={{
              desk: t('coaching.guest.review.payDesk'),
              online: t('coaching.guest.review.payOnline'),
            }}
          />
        </View>

        <Card>
          <Text style={{ fontFamily: fonts.display900, fontSize: 17, color: colors.ink }}>
            {offer?.priceIqd != null
              ? t('coaching.common.forTheLesson', { price: money(offer.priceIqd) })
              : ''}
          </Text>
          <Hint style={{ marginTop: 4 }}>
            {t(
              mode === 'online'
                ? 'coaching.guest.review.onlineLine'
                : 'coaching.guest.review.deskLine',
            )}
          </Hint>
          {priceNote ? <Hint style={{ marginTop: 4 }}>{priceNote}</Hint> : null}
        </Card>

        <Hint>
          {t('coaching.guest.class.cancelGroup', {
            hours: countPhrase('coaching.common.count.hours', hours, locale),
          })}
        </Hint>

        {banner ? (
          <View testID="lesson-review.refusal">
            <MatchNotice text={banner} />
          </View>
        ) : (
          <View style={{ gap: space.s }}>
            <ErrorText>{error}</ErrorText>
            {error &&
            !needsTerms &&
            venue?.paymentMode === 'online_optional' &&
            mode === 'online' ? (
              <Button
                testID="lesson-review.pay-desk-instead"
                label={t('coaching.guest.review.payDeskInstead')}
                variant="ghost"
                onPress={() => {
                  setPicked('desk');
                  setError(null);
                }}
              />
            ) : null}
            <Button
              testID="lesson-review.book"
              label={t(
                mode === 'online'
                  ? 'coaching.guest.review.bookAndPay'
                  : 'coaching.guest.review.book',
              )}
              variant="cta"
              busy={busy}
              disabled={!offer || offer.priceIqd === null}
              onPress={onBook}
            />
          </View>
        )}
      </FormScreen>
    </Screen>
  );
}

/** Session-gated like the rest of the booking flow (RequireSession). */
export default function GuardedLessonReviewScreen() {
  return (
    <RequireSession>
      <LessonReviewScreen />
    </RequireSession>
  );
}
