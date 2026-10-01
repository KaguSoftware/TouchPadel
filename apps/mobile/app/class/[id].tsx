import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { needsTermsAcceptance } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatDateTime,
  formatIQD,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { bookingGateState } from '../../src/features/auth/social';
import { useOwnConsent, useOwnProfile } from '../../src/features/profile/hooks';
import { rpcErrorDetail } from '../../src/features/booking/errors';
import { useJoinCourse, useJoinLesson, useLessonOffer } from '../../src/features/coaching/hooks';
import { useStartLessonPayment } from '../../src/features/coaching/payment';
import { setPendingLesson } from '../../src/features/coaching/pendingLesson';
import {
  joinRefusalOf,
  lessonErrorCode,
  lessonErrorText,
} from '../../src/features/coaching/errors';
import { parsePriceChanged } from '../../src/features/matches/errors';
import {
  displayCoachName,
  effectiveChoice,
  paymentChoices,
  pick,
  type LessonWrite,
  type PaymentChoice,
} from '../../src/features/coaching/logic';
import type { ClassKind } from '../../src/features/coaching/keys';
import { callPhone } from '../../src/lib/phone';
import { space, useTheme } from '../../src/theme';
import { Button, Card, ErrorText, Hint, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice, MatchSectionTitle } from '../../src/components/match';
import { CoachAvatar, LessonPoster, PaymentModeChoice } from '../../src/components/coaching';
import { ChevronIcon } from '../../src/components/icons';
import { useToast } from '../../src/components/overlays';

/**
 * A group session or a course (docs/design/coaching/guest.md §4.8.5, §4.9.2):
 * what it is, who teaches it, when, the places, the caller's price (a late
 * course join's share, C-15: the server's figures), the payment choice and
 * Join. Public to read; Join is behind the booking gate (the coach must be
 * able to call the student, C-16), and a signed-out Join keeps the intent and
 * opens the welcome.
 *
 * Desk mode joins and opens the lesson; Qi holds the place and opens the
 * payment (`lesson-begin`). Refusals follow §4.9.2: a full or closed offer is
 * read again and its status line replaces Join.
 */
export default function ClassDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const kind: ClassKind | null =
    params.kind === 'session' || params.kind === 'course' ? params.kind : null;
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const offer = useLessonOffer(kind, id);
  const profile = useOwnProfile(!!session);
  const uid = session && !session.user.is_anonymous ? session.user.id : null;
  const consent = useOwnConsent(uid);
  const needsTerms = consent.data === undefined || needsTermsAcceptance(consent.data);
  const joinLesson = useJoinLesson();
  const joinCourse = useJoinCourse();
  const payment = useStartLessonPayment();
  const [picked, setPicked] = useState<PaymentChoice>('desk');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  // The clock the cut-off is judged on when the answer carries no server_now.
  const [openedAt] = useState(() => Date.now());

  const o = offer.data ?? null;
  const tz = o?.timezone ?? 'Asia/Baghdad';
  const phone = o?.phone ?? null;
  const mode = effectiveChoice(o?.paymentMode ?? 'desk', picked);
  const money = (n: number | null) => (n === null ? '' : isolate(formatIQD(n, locale)));
  const busy = joinLesson.isPending || joinCourse.isPending || payment.busy;
  const errorCtx = { locale, phone, termsCurrent: !needsTerms };

  const header = <Stack.Screen options={{ title: t('coaching.guest.class.title') }} />;

  if (!kind || !id) {
    return (
      <Screen edges={[]}>
        {header}
        <EmptyState
          testID="class-detail.not-found"
          fill
          title={t('coaching.guest.class.notFound')}
        />
      </Screen>
    );
  }

  if (!o) {
    const code = lessonErrorCode(offer.error);
    return (
      <Screen edges={[]}>
        {header}
        {offer.isError && code === 'LESSON_NOT_FOUND' ? (
          <EmptyState
            testID="class-detail.not-found"
            fill
            title={t('coaching.guest.class.notFound')}
          />
        ) : offer.isError ? (
          <ErrorState
            testID="class-detail.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(offer.error, t, { locale })}
            retryLabel={t('common.retry')}
            onRetry={() => void offer.refetch()}
            busy={offer.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={96} />
        )}
      </Screen>
    );
  }

  const title =
    pick(o.titleEn, o.titleAr, locale) ||
    (o.type ? pick(o.type.nameEn, o.type.nameAr, locale) : '');
  const coachName = displayCoachName(o.coach, locale);
  const start = o.startAt ? new Date(o.startAt) : null;
  const nowMs = o.serverNow ? Date.parse(o.serverNow) : openedAt;
  const cutoffMs = o.cutoffAt ? Date.parse(o.cutoffAt) : NaN;
  const belowMinimum = o.placesTaken < o.minPlaces && Number.isFinite(cutoffMs) && nowMs < cutoffMs;
  const hours = o.cancellationWindowHours ?? 0;

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
    switch (joinRefusalOf(code, detail)) {
      case 'phone':
        router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
        return;
      case 'terms':
        if (needsTerms) router.push('/accept-terms');
        else setError(t('coaching.common.errors.updateApp'));
        return;
      case 'priceChanged': {
        const current = parsePriceChanged(detail)?.currentIqd ?? null;
        void offer.refetch();
        if (current !== null)
          setPriceNote(t('coaching.common.errors.priceChangedTo', { price: money(current) }));
        return;
      }
      case 'mode':
      case 'refetch':
        void offer.refetch();
        setError(lessonErrorText(err, t, errorCtx));
        return;
      case 'notFound':
        void offer.refetch();
        return;
      case 'banner':
        setBanner(lessonErrorText(err, t, errorCtx));
        return;
      default:
        setError(lessonErrorText(err, t, errorCtx));
    }
  };

  const onJoin = () => {
    if (o.priceIqd === null) return;
    setError(null);
    setPriceNote(null);
    if (!session) {
      setPendingLesson({ kind: 'class', classKind: kind, id });
      router.push('/welcome');
      return;
    }
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
    const vars = { id, mode, expectedPriceIqd: o.priceIqd };
    if (kind === 'course') joinCourse.mutate(vars, { onSuccess: opened, onError });
    else joinLesson.mutate(vars, { onSuccess: opened, onError });
  };

  const statusLine =
    o.status === 'full'
      ? t('coaching.guest.class.full')
      : o.status === 'closed'
        ? t('coaching.guest.class.closed')
        : o.status === 'cancelled'
          ? t('coaching.guest.class.cancelled')
          : null;

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  return (
    <Screen edges={[]}>
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        <LessonPoster
          kind={t(`coaching.common.kindsLong.${o.kind}`)}
          title={title}
          lines={[
            start
              ? `${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)} · ${formatTime(start, locale, tz)}`
              : null,
            o.type ? t('coaching.common.durationMin', { minutes: o.type.durationMin }) : null,
          ]}
        />
        {o.coach ? (
          <Pressable
            testID="class-detail.coach"
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/coach/[id]',
                params: { id: o.coach!.id, ...(o.venueId ? { venueId: o.venueId } : {}) },
              })
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              padding: space.sm,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.sub : colors.card,
            })}
          >
            <CoachAvatar photoPath={o.coach.photoPath} name={coachName} size={36} />
            <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
              {coachName}
            </Text>
            <ChevronIcon size={16} color={colors.fnt2} />
          </Pressable>
        ) : null}

        {o.kind === 'course' && o.sessions.length > 0 ? (
          <View style={{ gap: 6 }}>
            <MatchSectionTitle>{t('coaching.guest.class.sessions')}</MatchSectionTitle>
            {o.sessions.map((s) => (
              <View
                key={s.lessonId}
                testID={`class-detail.session.${s.sessionNo}`}
                style={{ flexDirection: 'row', gap: 8 }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.body600,
                    fontSize: 13,
                    color: s.started ? colors.fnt : colors.ink,
                  }}
                >
                  {`${t('coaching.common.sessionOf', {
                    n: isolateLtr(String(s.sessionNo)),
                    total: isolateLtr(String(o.sessions.length)),
                  })} · ${formatDateTime(new Date(s.startAt), locale, tz)}`}
                </Text>
                {s.started ? (
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>
                    {t('coaching.common.sessionDone')}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <Card>
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.gtext }}>
              {countPhrase('coaching.common.count.placesLeft', o.placesLeft, locale)}
            </Text>
            {belowMinimum && o.cutoffAt ? (
              <Hint>
                {t('coaching.guest.class.runsIf', {
                  people: countPhrase('coaching.common.count.people', o.minPlaces, locale),
                  time: formatDateTime(new Date(o.cutoffAt), locale, tz),
                })}
              </Hint>
            ) : null}
            {o.priceIqd !== null ? (
              <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
                {money(o.priceIqd)}
              </Text>
            ) : null}
            {o.lateJoin && o.priceIqd !== null ? (
              <Hint>
                {t('coaching.guest.class.lateJoin', {
                  sessionsLeft: isolateLtr(String(o.lateJoin.sessionsLeft)),
                  sessions: isolateLtr(String(o.lateJoin.sessionsCount)),
                  price: money(o.priceIqd),
                  full: money(o.fullPriceIqd),
                })}
              </Hint>
            ) : null}
            {priceNote ? <Hint>{priceNote}</Hint> : null}
          </View>
        </Card>

        {banner ? <MatchNotice text={banner} /> : null}

        {o.mine ? (
          <View style={{ gap: space.s }}>
            <MatchNotice text={t('coaching.guest.class.mine')} />
            <Button
              testID="class-detail.mine"
              label={t('coaching.guest.class.seeBooking')}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/lesson/[id]', params: { id: o.mine!.enrolmentId } })
              }
            />
          </View>
        ) : statusLine ? (
          <MatchNotice text={statusLine} />
        ) : !banner ? (
          <View style={{ gap: space.sm }}>
            <MatchSectionTitle>{t('coaching.guest.review.payment')}</MatchSectionTitle>
            <PaymentModeChoice
              testID="class-detail.mode"
              choices={paymentChoices(o.paymentMode)}
              value={mode}
              onChange={setPicked}
              labels={{
                desk: t('coaching.guest.review.payDesk'),
                online: t('coaching.guest.review.payOnline'),
              }}
            />
            <ErrorText>{error}</ErrorText>
            {error && !needsTerms && o.paymentMode === 'online_optional' && mode === 'online' ? (
              <Button
                testID="class-detail.pay-desk-instead"
                label={t('coaching.guest.review.payDeskInstead')}
                variant="ghost"
                onPress={() => {
                  setPicked('desk');
                  setError(null);
                }}
              />
            ) : null}
            <Button
              testID="class-detail.join"
              label={t(
                mode === 'online' ? 'coaching.guest.class.joinAndPay' : 'coaching.guest.class.join',
              )}
              variant="cta"
              busy={busy}
              disabled={o.priceIqd === null}
              onPress={onJoin}
            />
          </View>
        ) : null}

        <Hint>
          {t(
            o.kind === 'course'
              ? 'coaching.guest.class.cancelCourse'
              : 'coaching.guest.class.cancelGroup',
            {
              hours: countPhrase('coaching.common.count.hours', hours, locale),
            },
          )}
        </Hint>

        {phone ? (
          <Button
            testID="class-detail.call-venue"
            label={t('coaching.common.callVenue')}
            variant="ghost"
            onPress={callBranch}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
