import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDateTime,
  formatIQD,
  formatTime,
  formatTimeRange,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { RequireSession } from '../../src/features/auth/RequireSession';
import { useBranches, useVenueSettings } from '../../src/features/availability/hooks';
import { branchName } from '../../src/features/availability/branch';
import {
  useCancelMyLesson,
  useConfirmLessonLink,
  useMyLesson,
} from '../../src/features/coaching/hooks';
import { useStartLessonPayment } from '../../src/features/coaching/payment';
import {
  lessonBeginErrorText,
  lessonBeginRefusalOf,
  lessonErrorCode,
  lessonErrorText,
} from '../../src/features/coaching/errors';
import { cancelCopy, cancelledToast, windowHoursOf } from '../../src/features/coaching/cancel';
import { lessonStateOf, moneyLineOf, stateLine } from '../../src/features/coaching/state';
import {
  displayCoachName,
  lessonTitle,
  pick,
  type MyLesson,
} from '../../src/features/coaching/logic';
import { callPhone } from '../../src/lib/phone';
import { useBack } from '../../src/navigation/back';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Hint, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice, MatchSectionTitle } from '../../src/components/match';
import { CoachAvatar, LessonPoster, LinkConfirmCard } from '../../src/components/coaching';
import { ChevronIcon } from '../../src/components/icons';
import { ConfirmAlert, useToast } from '../../src/components/overlays';

/**
 * One of the guest's lessons, by enrolment (docs/design/coaching/guest.md
 * §4.8.7): the state line, when and where, the coach, the party or the
 * course's sessions, the money, and what can be done (`can.*`, the server's).
 *
 * An enrolment a coach or the desk linked by a typed phone asks "Is this
 * you?" first (C-21, R44): the confirm card is the whole screen until "Yes".
 * The cancel dialog's words are the server's preview (`cancel.*`: free or
 * late, a lesson moved after booking (R8), a course left part-way (C-23,
 * R62)); the server decides again at the call, and the toast follows its
 * answer. A held enrolment offers "Finish payment", which reopens its Qi
 * attempt (`reused`).
 */
function LessonDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  // After "Not me" the lesson is gone: back, or My lessons when opened from a push.
  const back = useBack('/my-lessons');
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const lesson = useMyLesson(id);
  const branches = useBranches();
  const settings = useVenueSettings(lesson.data?.venueId ?? null);
  const cancel = useCancelMyLesson();
  const confirm = useConfirmLessonLink();
  const payment = useStartLessonPayment();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read on a visit once the answer is stale: a push, the desk or the sweep
  // may have moved it on (a lesson push also invalidates it directly).
  const { refetch, isStale } = lesson;
  useFocusEffect(
    useCallback(() => {
      if (isStale) void refetch();
    }, [refetch, isStale]),
  );

  const header = <Stack.Screen options={{ title: t('coaching.guest.lesson.title') }} />;
  const data: MyLesson | null = lesson.data ?? null;
  const tz = data?.timezone ?? 'Asia/Baghdad';
  const phone = data?.branchPhone ?? null;
  const errorCtx = { locale, phone };

  const notFound = (
    <EmptyState testID="lesson-detail.not-found" fill title={t('coaching.guest.lesson.notFound')} />
  );

  if (!id) {
    return (
      <Screen edges={[]}>
        {header}
        {notFound}
      </Screen>
    );
  }

  if (!data) {
    const code = lessonErrorCode(lesson.error);
    return (
      <Screen edges={[]}>
        {header}
        {lesson.isError && (code === 'ENROLMENT_NOT_FOUND' || code === 'INVALID_ARGUMENT') ? (
          notFound
        ) : lesson.isError ? (
          <ErrorState
            testID="lesson-detail.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(lesson.error, t, errorCtx)}
            retryLabel={t('common.retry')}
            onRetry={() => void lesson.refetch()}
            busy={lesson.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={96} />
        )}
      </Screen>
    );
  }

  const now = data.serverNow ? new Date(data.serverNow) : new Date();
  const title = lessonTitle(data, locale);
  const coachName = displayCoachName(data.coach, locale);
  const start = new Date(data.startAt);
  const end = new Date(data.endAt);
  const branch = branches.data?.find((b) => b.venue_id === data.venueId);
  const branchLabel = branch ? branchName(branch, locale) : '';
  const money = (n: number) => isolate(formatIQD(n, locale));
  const when = `${formatDateTime(start, locale, tz)}`;
  const linkBody = t(
    data.bookedBy === 'staff' ? 'coaching.guest.confirm.byStaff' : 'coaching.guest.confirm.byCoach',
  );

  const onConfirm = (yes: boolean) => {
    confirm.mutate(
      { enrolmentId: data.enrolmentId, yes },
      {
        onSuccess: () => {
          toast(
            t(yes ? 'coaching.guest.confirm.added' : 'coaching.guest.confirm.removed'),
            'success',
          );
          if (!yes) back();
        },
        onError: (err) => {
          // A repeated "Not me" answers ENROLMENT_NOT_FOUND: it is done either way.
          if (!yes && lessonErrorCode(err) === 'ENROLMENT_NOT_FOUND') {
            toast(t('coaching.guest.confirm.removed'), 'success');
            back();
            return;
          }
          toast(lessonErrorText(err, t, errorCtx), 'error');
        },
      },
    );
  };

  // ── C-21: the confirm card is the whole screen until "Yes" ─────────────────
  if (data.confirmNeeded) {
    return (
      <Screen edges={[]}>
        {header}
        <View style={{ paddingTop: space.m }}>
          <LinkConfirmCard
            testID="lesson-detail.confirm"
            body={linkBody}
            details={[coachName, title, when, branchLabel]}
            yesLabel={t('coaching.guest.confirm.yes')}
            noLabel={t('coaching.guest.confirm.no')}
            busy={confirm.isPending ? (confirm.variables?.yes ? 'yes' : 'no') : null}
            onYes={() => onConfirm(true)}
            onNo={() => setRemoveOpen(true)}
          />
        </View>
        <ConfirmAlert
          visible={removeOpen}
          title={t('coaching.guest.confirm.removeTitle')}
          body={t('coaching.guest.confirm.removeBody')}
          confirmLabel={t('coaching.guest.confirm.remove')}
          destructive
          onConfirm={() => {
            setRemoveOpen(false);
            onConfirm(false);
          }}
          onDismiss={() => setRemoveOpen(false)}
        />
      </Screen>
    );
  }

  const state = lessonStateOf(data, now);
  const line = stateLine(state, { t, locale, tz, now });
  const moneyLine = moneyLineOf(data, state, { t, locale });
  const court = pick(data.courtNameEn, data.courtNameAr, locale);
  const moved = data.rescheduled && now.getTime() < start.getTime();
  const windowHours = windowHoursOf(
    settings.data?.cancellation_window_hours,
    data.startAt,
    data.cancel.freeUntil,
  );
  const held = data.status === 'held';
  const copy = cancelCopy(data.cancel, data.kind, { t, locale, tz, windowHours, held });

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const onPay = () => {
    setError(null);
    payment.start(data.enrolmentId, {
      onError: (err) => {
        if (lessonBeginRefusalOf(err) === 'phone') {
          router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
          return;
        }
        void lesson.refetch();
        setError(lessonBeginErrorText(err, t, { ...errorCtx, held }));
        // MB-11: a held place that can no longer be paid online is offered
        // its free cancel, not "pay at the desk".
        if (held && data.can.cancel && lessonBeginRefusalOf(err) === 'off') setCancelOpen(true);
      },
    });
  };

  const onCancel = () => {
    setCancelOpen(false);
    setError(null);
    cancel.mutate(data.enrolmentId, {
      onSuccess: (result) => toast(cancelledToast(result.refundIqd, { t, locale }), 'success'),
      onError: (err) => {
        void lesson.refetch();
        if (lessonErrorCode(err) === 'ENROLMENT_NOT_FOUND') return;
        setError(lessonErrorText(err, t, errorCtx));
      },
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
          kind={
            data.kind ? t(`coaching.common.kindsLong.${data.kind}`) : t('coaching.common.lesson')
          }
          title={title}
          lines={[
            line,
            `${formatDateTime(start, locale, tz)} · ${formatTimeRange(start, end, locale, tz)}`,
            branchLabel || null,
            court ? `${t('coaching.guest.lesson.court')} · ${court}` : null,
            state.state === 'awaitingPayment' && data.holdExpiresAt
              ? t('coaching.guest.lesson.payBy', {
                  time: formatTime(new Date(data.holdExpiresAt), locale, tz),
                })
              : null,
          ]}
        />

        {data.coach ? (
          <Pressable
            testID="lesson-detail.coach"
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/coach/[id]',
                params: { id: data.coach!.id, ...(data.venueId ? { venueId: data.venueId } : {}) },
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
            <CoachAvatar photoPath={data.coach.photoPath} name={coachName} size={36} />
            <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
              {coachName}
            </Text>
            <ChevronIcon size={16} color={colors.fnt2} />
          </Pressable>
        ) : null}

        {data.kind === 'private' ? (
          <Card>
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
              {`${t('coaching.guest.lesson.party')} · ${countPhrase('coaching.common.count.people', data.partySize, locale)}`}
            </Text>
            {data.friendNames.length > 0 ? (
              <Hint style={{ marginTop: 4 }}>
                {t('coaching.guest.lesson.friends', {
                  // MB-17: the list separator of the reader's language (no Intl.ListFormat on Hermes).
                  names: data.friendNames
                    .map((n) => isolate(n))
                    .join(locale === 'ar' ? '، ' : ', '),
                })}
              </Hint>
            ) : null}
          </Card>
        ) : null}

        {data.kind === 'course' && data.sessions.length > 0 ? (
          <View style={{ gap: 6 }}>
            <MatchSectionTitle>{t('coaching.guest.lesson.sessions')}</MatchSectionTitle>
            {data.sessions.map((s) => (
              <View
                key={s.lessonId}
                testID={`lesson-detail.session.${s.sessionNo}`}
                style={{ flexDirection: 'row', gap: 8 }}
              >
                <Text
                  style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}
                >
                  {`${t('coaching.common.sessionOf', {
                    n: isolateLtr(String(s.sessionNo)),
                    total: isolateLtr(String(data.sessionsCount ?? data.sessions.length)),
                  })} · ${formatDateTime(new Date(s.startAt), locale, tz)}`}
                </Text>
                {s.rescheduled ? (
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ambtext }}>
                    {t('coaching.common.sessionMoved')}
                  </Text>
                ) : null}
                {s.attendance ? (
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>
                    {t(
                      s.attendance === 'attended'
                        ? 'coaching.common.attended'
                        : 'coaching.common.noShow',
                    )}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {moved ? <MatchNotice text={t('coaching.guest.lesson.moved')} /> : null}

        <Card>
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: fonts.display800, fontSize: 12, color: colors.fnt }}>
              {t('coaching.guest.lesson.money')}
            </Text>
            {data.priceIqd !== null ? (
              <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
                {money(data.priceIqd)}
              </Text>
            ) : null}
            {data.paidOnlineIqd > 0 ? (
              <Hint>
                {t('coaching.guest.lesson.paidOnline', { paid: money(data.paidOnlineIqd) })}
              </Hint>
            ) : null}
            {data.owedIqd > 0 && data.status === 'booked' ? (
              <Hint>{t('coaching.guest.lesson.toPay', { owed: money(data.owedIqd) })}</Hint>
            ) : null}
            {data.refund && data.refund.amountIqd > 0 ? (
              <Hint>
                {t(
                  data.refund.status === 'refunded'
                    ? 'coaching.guest.lesson.refunded'
                    : 'coaching.guest.lesson.refundOnWay',
                  {
                    amount: money(data.refund.amountIqd),
                  },
                )}
              </Hint>
            ) : null}
            {moneyLine && !data.refund ? <Hint>{moneyLine}</Hint> : null}
          </View>
        </Card>

        {error ? <MatchNotice text={error} /> : null}

        {data.can.pay ? (
          <Button
            testID="lesson-detail.pay"
            label={t('coaching.guest.lesson.pay')}
            variant="cta"
            busy={payment.busy}
            onPress={onPay}
          />
        ) : null}
        {data.can.cancel ? (
          <Button
            testID="lesson-detail.cancel"
            label={t(
              data.kind === 'course'
                ? 'coaching.guest.lesson.leave'
                : 'coaching.guest.lesson.cancel',
            )}
            variant="dangerOutline"
            size="compact"
            busy={cancel.isPending}
            onPress={() => setCancelOpen(true)}
          />
        ) : null}
        {phone ? (
          <Button
            testID="lesson-detail.call-venue"
            label={
              branchLabel
                ? t('coaching.common.callBranch', { branch: isolate(branchLabel) })
                : t('coaching.common.callVenue')
            }
            variant="secondary"
            size="compact"
            onPress={callBranch}
          />
        ) : null}
      </ScrollView>
      <ConfirmAlert
        visible={cancelOpen}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirm}
        cancelLabel={copy.keep}
        destructive
        onConfirm={onCancel}
        onDismiss={() => setCancelOpen(false)}
      />
    </Screen>
  );
}

/** Session-gated: a lesson is the guest's own (RequireSession). */
export default function GuardedLessonDetailScreen() {
  return (
    <RequireSession>
      <LessonDetailScreen />
    </RequireSession>
  );
}
