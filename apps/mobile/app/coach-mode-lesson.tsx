import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeRange,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, Screen } from '../src/components/ui';
import { ListHeading } from '../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';
import { ChevronIcon, TableIcon } from '../src/components/icons';
import { PhoneField } from '../src/components/phone';
import { DateTimeField } from '../src/components/DateTimeField';
import { nativeChoice } from '../src/components/nativeChoice';
import { CoachBanners, ReasonCard, RosterRow, kindLine } from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import {
  useAddStudent,
  useCancelCourse,
  useCancelLesson,
  useCoachLesson,
  useMarkAttendance,
  useRefetchOnFocus,
  useRemoveStudent,
  useReschedule,
} from '../src/features/coach/hooks';
import { coachErrorCode, coachErrorText } from '../src/features/coach/errors';
import {
  CANCEL_REASONS,
  REMOVE_REASONS,
  STUDENT_NAME_MAX,
  addIntent,
  addsLeftToShow,
  belowMinimum,
  cleanName,
  judgesCutoff,
  markMode,
  pickName,
  reasonValue,
  snapToGrid,
  startProblem,
  tzOf,
  type Attendance,
  type CancelReasonCode,
  type CoachLessonDetail,
  type CoachMe,
  type RosterEntry,
} from '../src/features/coach/logic';
import { DEFAULT_ISO, composePhone, validatePhone } from '../src/features/profile/phone';
import { callPhone } from '../src/lib/phone';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * One lesson's roster (docs/design/coaching/guest.md §4.13.4; C-16, CD-3,
 * CD-11, R44, R54): the lesson, its course's sessions, and the students with
 * their names and phones as the server sends them (typed for a coach- or
 * desk-booked row, never whether a typed phone matched an account). The
 * coach marks attendance from the start until `mark_until`, adds a walk-in or
 * a student by name and phone (C-8), removes one, cancels, or moves the
 * lesson (any kind, R8). Every action follows the server's `can.*`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReasonFor =
  { kind: 'remove'; entry: RosterEntry } | { kind: 'cancel' } | { kind: 'cancelCourse' };

function CoachLessonScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach') return null;
  return <CoachLessonBody coach={status.coach} />;
}

function CoachLessonBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const lessonId = typeof params.id === 'string' && UUID_RE.test(params.id) ? params.id : null;
  const lesson = useCoachLesson(lessonId);
  useRefetchOnFocus(lesson);
  const pull = usePullRefresh(lesson.refetch);

  const notFound =
    lessonId === null ||
    (lesson.isSuccess && lesson.data === null) ||
    (lesson.isError && !lesson.data && coachErrorCode(lesson.error) === 'LESSON_NOT_FOUND');

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.lesson.title') }} />
      {notFound ? (
        <EmptyState
          testID="coach-mode-lesson.not-found"
          fill
          title={t('coaching.coach.lesson.notFoundTitle')}
          message={t('coaching.coach.lesson.notFound')}
          actionLabel={t('coaching.coach.lesson.back')}
          actionTestID="coach-mode-lesson.back"
          onAction={() => router.navigate('/coach-mode')}
        />
      ) : lesson.data ? (
        <LessonDetail coach={coach} detail={lesson.data} pull={pull} />
      ) : lesson.isError ? (
        <ErrorState
          testID="coach-mode-lesson.error"
          title={t('errors.loadFailedTitle')}
          message={coachErrorText(lesson.error, t, { locale })}
          retryLabel={t('common.retry')}
          onRetry={() => void lesson.refetch()}
          busy={lesson.isRefetching}
        />
      ) : (
        <View style={{ paddingTop: space.sm, paddingBottom: insets.bottom }}>
          <SkeletonList rows={4} height={80} />
        </View>
      )}
    </Screen>
  );
}

function LessonDetail({
  coach,
  detail,
  pull,
}: {
  coach: CoachMe;
  detail: CoachLessonDetail;
  pull: { refreshing: boolean; onRefresh: () => void };
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const mark = useMarkAttendance();
  const remove = useRemoveStudent();
  const cancelLesson = useCancelLesson();
  const cancelCourse = useCancelCourse();
  const reschedule = useReschedule();
  const add = useAddStudent();

  const l = detail.lesson;
  const tz = tzOf(coach, l.venueId);
  const now = new Date();
  const mode = markMode(detail, now);
  const start = new Date(l.startAt);
  const end = new Date(l.endAt);
  const errText = (err: unknown) =>
    coachErrorText(err, t, { locale, privateCap: coach.privateCap });

  // ── Reasons, then the confirm (U4) ────────────────────────────────────────
  const [reasonFor, setReasonFor] = useState<ReasonFor | null>(null);
  const [reasonCode, setReasonCode] = useState<CancelReasonCode>('customer_request');
  const [reasonNote, setReasonNote] = useState('');
  const [confirming, setConfirming] = useState<ReasonFor | null>(null);
  const openReason = (r: ReasonFor) => {
    setReasonFor(r);
    setReasonCode(r.kind === 'remove' ? REMOVE_REASONS[0] : CANCEL_REASONS[0]);
    setReasonNote('');
  };
  const busyWrite = remove.isPending || cancelLesson.isPending || cancelCourse.isPending;

  const runConfirmed = () => {
    const r = confirming;
    setConfirming(null);
    if (!r) return;
    const reason = reasonValue(reasonCode, reasonNote);
    const finish = () => setReasonFor(null);
    if (r.kind === 'remove') {
      remove.mutate(
        { enrolmentId: r.entry.enrolmentId, reason },
        {
          onSuccess: () => {
            finish();
            toast(t('coaching.coach.remove.done', { name: isolate(r.entry.name) }), 'info');
          },
          onError: (err) => toast(errText(err), 'error'),
        },
      );
    } else if (r.kind === 'cancel') {
      cancelLesson.mutate(
        { lessonId: l.id, reason },
        {
          onSuccess: () => {
            finish();
            toast(t('coaching.coach.cancel.done'), 'info');
          },
          onError: (err) => toast(errText(err), 'error'),
        },
      );
    } else {
      const courseId = detail.course?.id ?? l.courseId;
      if (!courseId) return;
      cancelCourse.mutate(
        { courseId, reason },
        {
          onSuccess: () => {
            finish();
            toast(t('coaching.coach.cancel.courseDone'), 'info');
          },
          onError: (err) => toast(errText(err), 'error'),
        },
      );
    }
  };

  const confirmCopy =
    confirming?.kind === 'remove'
      ? {
          title: t('coaching.coach.remove.title', { name: isolate(confirming.entry.name) }),
          body: t('coaching.coach.remove.body'),
          confirm: t('coaching.coach.remove.confirm'),
        }
      : confirming?.kind === 'cancelCourse'
        ? {
            title: t('coaching.coach.cancel.courseTitle'),
            body: t('coaching.coach.cancel.courseBody'),
            confirm: t('coaching.coach.cancel.courseConfirm'),
          }
        : {
            title: t('coaching.coach.cancel.lessonTitle'),
            body: t('coaching.coach.cancel.lessonBody'),
            confirm: t('coaching.coach.cancel.lessonConfirm'),
          };

  // ── Attendance and the row menu ───────────────────────────────────────────
  const onMark = (entry: RosterEntry, value: Attendance | 'clear') =>
    mark.mutate(
      { lessonId: l.id, enrolmentId: entry.enrolmentId, status: value },
      {
        onSuccess: () => toast(t('coaching.coach.roster.marked'), 'success'),
        onError: (err) => toast(errText(err), 'error'),
      },
    );
  const onMenu = async (entry: RosterEntry) => {
    const choice = await nativeChoice<'remove' | 'clear'>({
      title: entry.name,
      options: [
        ...(mode === 'edit' && entry.attendance
          ? [{ value: 'clear' as const, label: t('coaching.coach.roster.clear') }]
          : []),
        ...(detail.can.remove
          ? [
              {
                value: 'remove' as const,
                label: t('coaching.coach.roster.remove'),
                destructive: true,
              },
            ]
          : []),
      ],
      cancelLabel: t('common.cancel'),
    });
    if (choice === 'clear') onMark(entry, 'clear');
    if (choice === 'remove') openReason({ kind: 'remove', entry });
  };

  // ── Add a student (C-8; the same answer whether the phone matched) ───────
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const targetLesson = l.kind === 'group' ? l.id : null;
  const targetCourse = l.kind === 'course' ? (detail.course?.id ?? l.courseId) : null;
  const addsLeft = addsLeftToShow(coach);
  const onAdd = () => {
    const clean = cleanName(name);
    if (!clean) {
      setAddError(t('coaching.coach.add.nameRequired'));
      return;
    }
    let phone: string | null = null;
    if (national.trim()) {
      if (validatePhone(iso, national) !== null) {
        setAddError(t('coaching.coach.add.phoneInvalid'));
        return;
      }
      phone = composePhone(iso, national);
    }
    setAddError(null);
    add.mutate(
      {
        lessonId: targetLesson,
        courseId: targetCourse,
        name: clean,
        phone,
        intent: addIntent({ targetId: targetLesson ?? targetCourse ?? '', name: clean, phone }),
      },
      {
        onSuccess: () => {
          toast(t('coaching.coach.add.done', { name: isolate(clean) }), 'success');
          setName('');
          setNational('');
          setAdding(false);
        },
        onError: (err) => setAddError(errText(err)),
      },
    );
  };

  // ── Reschedule (any kind, R8, R32, R47) ───────────────────────────────────
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(start);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState(false);
  const onMove = () => {
    const cutoffAt = l.cutoffAt ? Date.parse(l.cutoffAt) : NaN;
    // R66: only a cut-off not judged yet (still ahead) refuses the new time.
    const cutoffHours =
      judgesCutoff(l) && Number.isFinite(cutoffAt) && cutoffAt > now.getTime()
        ? (start.getTime() - cutoffAt) / 3_600_000
        : null;
    const problem = startProblem(when, { tz, now: new Date(), cutoffHours });
    if (problem) {
      setMoveError(
        t(
          problem === 'grid'
            ? 'coaching.coach.new.notOnGrid'
            : problem === 'past'
              ? 'coaching.coach.new.past'
              : 'coaching.coach.new.cutoff',
        ),
      );
      return;
    }
    setMoveError(null);
    setConfirmMove(true);
  };
  const runMove = () => {
    setConfirmMove(false);
    reschedule.mutate(
      { lessonId: l.id, startAt: when.toISOString() },
      {
        onSuccess: () => {
          setMoving(false);
          toast(t('coaching.coach.reschedule.done'), 'success');
        },
        onError: (err) => setMoveError(errText(err)),
      },
    );
  };

  // ── The card ──────────────────────────────────────────────────────────────
  const type = pickName(l.typeNameEn, l.typeNameAr, locale);
  const title = pickName(l.titleEn, l.titleAr, locale);
  const court = pickName(l.courtNameEn, l.courtNameAr, locale);
  const statusLine =
    l.status === 'cancelled'
      ? t('coaching.coach.lesson.cancelled')
      : l.status === 'completed'
        ? t('coaching.coach.lesson.completed')
        : l.status === 'expired'
          ? t('coaching.coach.lesson.expired')
          : l.status === 'held'
            ? t('coaching.coach.lesson.held')
            : null;
  const body = { fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 } as const;

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      <CoachBanners testID="coach-mode-lesson.banner" coach={coach} />
      <Card style={{ gap: 6 }}>
        <Text style={{ fontFamily: fonts.display800, fontSize: 18, color: colors.ink }}>
          {isolate(title || type)}
        </Text>
        <Text style={body}>
          {`${t(`coaching.coach.kinds.${l.kind}`)}${title ? ` · ${isolate(type)}` : ''}`}
        </Text>
        <Text style={[body, { color: colors.ink }]}>
          {`${formatDate(start, locale, tz)} · ${formatTimeRange(start, end, locale, tz)}`}
        </Text>
        <Text style={body}>{kindLine(l, t, locale)}</Text>
        {court ? (
          <Text style={body}>{t('coaching.coach.lesson.court', { court: isolate(court) })}</Text>
        ) : null}
        {l.kind !== 'private' ? (
          <Text style={body}>
            {t('coaching.coach.lesson.places', {
              taken: isolateLtr(String(l.placesTaken)),
              max: isolateLtr(String(l.maxPlaces)),
            })}
          </Text>
        ) : null}
        {belowMinimum(l, now) && l.cutoffAt ? (
          <Text style={[body, { color: colors.ambtext }]}>
            {t('coaching.coach.lesson.runsIf', {
              people: countPhrase('coaching.coach.count.people', l.minPlaces, locale),
              time: isolate(formatDateTime(new Date(l.cutoffAt), locale, tz)),
            })}
          </Text>
        ) : null}
        {statusLine ? <Text style={[body, { color: colors.redtext }]}>{statusLine}</Text> : null}
      </Card>
      {detail.course && detail.course.sessions.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <ListHeading icon={TableIcon} label={t('coaching.coach.lesson.sessions')} />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {detail.course.sessions.map((s, i) => {
              const current = s.lessonId === l.id;
              return (
                <Pressable
                  key={s.lessonId}
                  testID={`coach-mode-lesson.session.${s.sessionNo}`}
                  accessibilityRole="button"
                  disabled={current}
                  onPress={() =>
                    router.push({ pathname: '/coach-mode-lesson', params: { id: s.lessonId } })
                  }
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    paddingStart: space.l,
                    paddingEnd: space.l,
                    paddingTop: 11,
                    paddingBottom: 11,
                    borderBottomWidth: i === detail.course!.sessions.length - 1 ? 0 : 1,
                    borderBottomColor: colors.sub,
                    backgroundColor: pressed || current ? colors.sub : 'transparent',
                  })}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: current ? fonts.body800 : fonts.body600,
                      fontSize: 13,
                      color: colors.ink,
                    }}
                  >
                    {`${t('coaching.coach.lesson.session', { n: isolateLtr(String(s.sessionNo)) })} · ${formatDate(new Date(s.startAt), locale, tz)} ${formatTime(new Date(s.startAt), locale, tz)}`}
                    {s.status === 'cancelled' ? ` · ${t('coaching.coach.lesson.cancelled')}` : ''}
                    {current ? ` · ${t('coaching.coach.lesson.current')}` : ''}
                  </Text>
                  {current ? null : <ChevronIcon size={14} color={colors.fnt2} />}
                </Pressable>
              );
            })}
          </Card>
        </View>
      ) : null}
      <ListHeading
        icon={TableIcon}
        label={t('coaching.coach.roster.title')}
        count={detail.roster.length}
        style={{ marginTop: space.s }}
      />
    </View>
  );

  const footer = (
    <View style={{ gap: space.sm, marginTop: space.xs }}>
      {detail.roster.some((r) => r.phone) ? (
        <Hint>{t('coaching.coach.roster.phoneNote')}</Hint>
      ) : null}

      {reasonFor ? (
        <ReasonCard
          testID="coach-mode-lesson.reason"
          title={
            reasonFor.kind === 'remove'
              ? t('coaching.coach.remove.title', { name: isolate(reasonFor.entry.name) })
              : reasonFor.kind === 'cancelCourse'
                ? t('coaching.coach.cancel.course')
                : t('coaching.coach.cancel.lesson')
          }
          codes={reasonFor.kind === 'remove' ? REMOVE_REASONS : CANCEL_REASONS}
          code={reasonCode}
          onCode={setReasonCode}
          note={reasonNote}
          onNote={setReasonNote}
          busy={busyWrite}
          onBack={() => setReasonFor(null)}
          onContinue={() => setConfirming(reasonFor)}
        />
      ) : null}

      {detail.can.add && (targetLesson || targetCourse) ? (
        adding ? (
          <Card style={{ gap: space.sm }}>
            <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
              {t('coaching.coach.add.title')}
            </Text>
            {addsLeft !== null ? (
              <Hint>{countPhrase('coaching.coach.count.addsLeft', addsLeft, locale)}</Hint>
            ) : null}
            <Field
              testID="coach-mode-lesson.add.name"
              label={t('coaching.coach.add.name')}
              value={name}
              onChangeText={setName}
              maxLength={STUDENT_NAME_MAX}
              autoCapitalize="words"
              dense
            />
            <PhoneField
              testID="coach-mode-lesson.add.phone"
              label={t('coaching.coach.add.phone')}
              iso={iso}
              onChangeIso={setIso}
              national={national}
              onChangeNational={setNational}
              dense
            />
            {addError ? <ErrorText>{addError}</ErrorText> : null}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                testID="coach-mode-lesson.add.cancel"
                label={t('common.cancel')}
                variant="secondary"
                size="compact"
                onPress={() => {
                  setAdding(false);
                  setAddError(null);
                }}
                style={{ flex: 1 }}
              />
              <Button
                testID="coach-mode-lesson.add.submit"
                label={t('coaching.coach.add.submit')}
                variant="primary"
                size="compact"
                busy={add.isPending}
                onPress={onAdd}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : (
          <Button
            testID="coach-mode-lesson.add"
            label={t('coaching.coach.add.open')}
            variant="secondary"
            size="medium"
            onPress={() => setAdding(true)}
          />
        )
      ) : null}

      {detail.can.reschedule ? (
        moving ? (
          <Card style={{ gap: space.sm }}>
            <DateTimeField
              testID="coach-mode-lesson.reschedule.when"
              label={t('coaching.coach.reschedule.when')}
              mode="datetime"
              timeZone={tz}
              minuteInterval={30}
              snap={(d) => snapToGrid(d, tz)}
              minimumDate={new Date()}
              value={when}
              onChange={(d) => {
                setWhen(d);
                setMoveError(null);
              }}
            />
            {moveError ? <ErrorText>{moveError}</ErrorText> : null}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                testID="coach-mode-lesson.reschedule.cancel"
                label={t('common.cancel')}
                variant="secondary"
                size="compact"
                onPress={() => {
                  setMoving(false);
                  setMoveError(null);
                }}
                style={{ flex: 1 }}
              />
              <Button
                testID="coach-mode-lesson.reschedule.submit"
                label={t('coaching.coach.reschedule.submit')}
                variant="primary"
                size="compact"
                busy={reschedule.isPending}
                onPress={onMove}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : (
          <Button
            testID="coach-mode-lesson.reschedule"
            label={t('coaching.coach.reschedule.open')}
            variant="secondary"
            size="medium"
            onPress={() => {
              setWhen(start);
              setMoving(true);
            }}
          />
        )
      ) : null}

      {detail.can.cancel && l.kind !== 'course' && !reasonFor ? (
        <Button
          testID="coach-mode-lesson.cancel"
          label={t('coaching.coach.cancel.lesson')}
          variant="dangerOutline"
          size="medium"
          onPress={() => openReason({ kind: 'cancel' })}
        />
      ) : null}
      {detail.can.cancelCourse && l.kind === 'course' && !reasonFor ? (
        <Button
          testID="coach-mode-lesson.cancel-course"
          label={t('coaching.coach.cancel.course')}
          variant="dangerOutline"
          size="medium"
          onPress={() => openReason({ kind: 'cancelCourse' })}
        />
      ) : null}
    </View>
  );

  return (
    <>
      <FlatList
        testID="coach-mode-lesson.roster"
        data={detail.roster}
        keyExtractor={(r) => r.enrolmentId}
        renderItem={({ item }) => (
          <RosterRow
            testID={`coach-mode-lesson.student.${item.enrolmentId}`}
            entry={item}
            markMode={mode}
            marking={mark.isPending && mark.variables?.enrolmentId === item.enrolmentId}
            showMenu={detail.can.remove || (mode === 'edit' && item.attendance !== null)}
            onCall={(phone) => void callPhone(phone)}
            onMark={(value) => onMark(item, value)}
            onMenu={() => void onMenu(item)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ paddingTop: space.s, paddingBottom: space.s }}>
            <Hint>{t('coaching.coach.roster.empty')}</Hint>
          </View>
        }
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
      />
      <ConfirmAlert
        visible={confirming !== null}
        title={confirmCopy.title}
        body={confirmCopy.body}
        confirmLabel={confirmCopy.confirm}
        cancelLabel={t('coaching.coach.cancel.keep')}
        destructive
        onConfirm={runConfirmed}
        onDismiss={() => setConfirming(null)}
      />
      <ConfirmAlert
        visible={confirmMove}
        title={t('coaching.coach.reschedule.title')}
        body={
          l.kind === 'course' && l.sessionNo
            ? t('coaching.coach.reschedule.bodySession', {
                n: isolateLtr(String(l.sessionNo)),
                when: isolate(formatDateTime(when, locale, tz)),
              })
            : t('coaching.coach.reschedule.body', {
                when: isolate(formatDateTime(when, locale, tz)),
              })
        }
        confirmLabel={t('coaching.coach.reschedule.submit')}
        onConfirm={runMove}
        onDismiss={() => setConfirmMove(false)}
      />
    </>
  );
}

export default function CoachModeLessonRoute() {
  return (
    <RequireCoach>
      <CoachLessonScreen />
    </RequireCoach>
  );
}
