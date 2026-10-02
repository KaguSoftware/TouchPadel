import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ceilToLessonGrid } from '@touch/core';
import { isolate, isolateLtr, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Hint,
  LinkText,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { ListHeading } from '../src/components/booking';
import { ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';
import { CalendarIcon, ClockIcon } from '../src/components/icons';
import { DateTimeField } from '../src/components/DateTimeField';
import {
  CoachBanners,
  HoursDayEditor,
  TimeOffRow,
  type EditableWindow,
} from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import {
  useAddTimeOff,
  useCancelTimeOff,
  useCoachHours,
  useSetMyHours,
} from '../src/features/coach/hooks';
import { coachErrorCode, coachErrorText } from '../src/features/coach/errors';
import { rpcErrorDetail } from '../src/features/booking/errors';
import {
  DEFAULT_TZ,
  TIME_OFF_REASON_MAX,
  checkWindows,
  hhmmOf,
  minutesOf,
  pickName,
  sameWindows,
  splitAcrossMidnight,
  timeOffProblem,
  windowIndexOf,
  windowsByWeekday,
  type CoachMe,
  type HoursBranch,
  type HoursWindow,
  type TimeOffEntry,
} from '../src/features/coach/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { useBackGuard } from '../src/navigation/back';

/**
 * Hours and time off (docs/design/coaching/guest.md §4.13.3; C-4, CD-10).
 *
 * One branch's weekly windows at a time (Sunday first, the stored numbering),
 * each with the platform's time pickers on the half-hour grid and "Until
 * midnight" (24:00, which no time picker can show). An end before the start
 * is offered as two windows across midnight. The pre-checks run before the
 * call; the server's HOURS_INVALID / HOURS_OVERLAP still decide, and their
 * detail marks the window. Leaving with unsaved hours asks first.
 *
 * Time off is the coach's at every branch: a list with Cancel, and a form
 * with two date-and-time pickers and an optional reason only the coach and
 * the venue see.
 */
const WEEKDAY_KEYS: readonly MessageKey[] = [
  'coaching.coach.weekdays.sun',
  'coaching.coach.weekdays.mon',
  'coaching.coach.weekdays.tue',
  'coaching.coach.weekdays.wed',
  'coaching.coach.weekdays.thu',
  'coaching.coach.weekdays.fri',
  'coaching.coach.weekdays.sat',
];

let nextKey = 0;
const freshKey = () => `new-${++nextKey}`;

function editable(windows: readonly HoursWindow[]): EditableWindow[] {
  return windows.map((w) => ({ ...w, key: w.id ?? freshKey() }));
}

/** The order the windows are sent in, which is the order a server detail's index names. */
function sendOrder(windows: readonly EditableWindow[]): EditableWindow[] {
  return [...windows].sort(
    (a, b) => a.weekday - b.weekday || minutesOf(a.start) - minutesOf(b.start),
  );
}

function CoachHoursScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach') return null;
  return <CoachHoursBody coach={status.coach} />;
}

function CoachHoursBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const hours = useCoachHours();
  const save = useSetMyHours();
  const pull = usePullRefresh(hours.refetch);

  const branches: HoursBranch[] = useMemo(() => hours.data?.branches ?? [], [hours.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const venueId = picked ?? branches[0]?.venueId ?? null;
  const branch = branches.find((b) => b.venueId === venueId) ?? null;

  // Unsaved edits per branch; a branch with no entry shows what the server holds.
  const [drafts, setDrafts] = useState<Record<string, EditableWindow[]>>({});
  const saved = useMemo(() => (branch ? editable(branch.windows) : []), [branch]);
  const windows = (venueId ? drafts[venueId] : undefined) ?? saved;
  const dirty = Object.entries(drafts).some(
    ([v, ws]) => !sameWindows(ws, branches.find((b) => b.venueId === v)?.windows ?? []),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (next: EditableWindow[]) => {
    if (!venueId) return;
    setDrafts((d) => ({ ...d, [venueId]: next }));
    setErrors({});
  };
  const patch = (key: string, p: Partial<HoursWindow>) =>
    update(windows.map((w) => (w.key === key ? { ...w, ...p, setBy: 'coach' } : w)));

  const onStart = (key: string, start: string) => patch(key, { start });
  const onEnd = (key: string, end: string) => {
    const w = windows.find((x) => x.key === key);
    if (!w) return;
    if (minutesOf(end) >= minutesOf(w.start)) {
      patch(key, { end });
      return;
    }
    // CD-10: an end before the start runs past midnight; offered as two windows.
    const parts = splitAcrossMidnight(w.weekday, w.start, end);
    const day = t(WEEKDAY_KEYS[w.weekday]!);
    const nextDay = t(WEEKDAY_KEYS[(w.weekday + 1) % 7]!);
    Alert.alert(
      t('coaching.coach.hours.pastMidnightTitle'),
      t('coaching.coach.hours.pastMidnight', {
        start: isolateLtr(w.start),
        end: isolateLtr(end),
        day,
        nextDay,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('coaching.coach.hours.pastMidnightAdd'),
          onPress: () =>
            update([
              ...windows.map((x) =>
                x.key === key ? { ...x, end: '24:00', setBy: 'coach' as const } : x,
              ),
              ...parts
                .slice(1)
                .map((p) => ({ ...p, key: freshKey(), id: null, setBy: 'coach' as const })),
            ]),
        },
      ],
    );
  };
  const onMidnight = (key: string, on: boolean) => {
    const w = windows.find((x) => x.key === key);
    if (!w) return;
    patch(key, { end: on ? '24:00' : hhmmOf(Math.min(minutesOf(w.start) + 60, 1410)) });
  };
  const onRemove = (key: string) => update(windows.filter((w) => w.key !== key));
  const onAdd = (weekday: number) => {
    const day = windows.filter((w) => w.weekday === weekday);
    const lastEnd = day.reduce((m, w) => Math.max(m, minutesOf(w.end)), 0);
    const start = day.length === 0 ? 9 * 60 : Math.min(lastEnd, 23 * 60);
    update([
      ...windows,
      {
        key: freshKey(),
        id: null,
        weekday,
        start: hhmmOf(start),
        end: hhmmOf(Math.min(start + (day.length === 0 ? 180 : 60), 1440)),
        setBy: 'coach',
      },
    ]);
  };

  const onSave = () => {
    if (!venueId || save.isPending) return;
    const list = sendOrder(windows);
    const elsewhere = branches
      .filter((b) => b.venueId !== venueId)
      .map((b) => ({ venueId: b.venueId, windows: drafts[b.venueId] ?? b.windows }));
    const problem = checkWindows(list, elsewhere);
    if (problem) {
      const w = list[problem.index]!;
      const other =
        problem.kind === 'overlapElsewhere'
          ? branches.find((b) => b.venueId === problem.venueId)
          : null;
      setErrors({
        [w.key]:
          problem.kind === 'invalid'
            ? t('coaching.coach.hours.endBeforeStart')
            : other
              ? t('coaching.coach.hours.overlapElsewhere', {
                  branch: isolate(pickName(other.nameEn, other.nameAr, locale)),
                })
              : t('coaching.coach.hours.overlap'),
      });
      return;
    }
    save.mutate(
      { venueId, windows: list },
      {
        onSuccess: () => {
          setDrafts((d) => {
            const next = { ...d };
            delete next[venueId];
            return next;
          });
          toast(t('coaching.coach.hours.saved'), 'success');
        },
        onError: (err) => {
          const text = coachErrorText(err, t, { locale });
          const code = coachErrorCode(err);
          const index =
            code === 'HOURS_INVALID' || code === 'HOURS_OVERLAP'
              ? windowIndexOf(rpcErrorDetail(err))
              : null;
          const w = index !== null ? list[index] : undefined;
          if (w) setErrors({ [w.key]: text });
          else toast(text, 'error');
        },
      },
    );
  };

  // Leaving with unsaved hours asks first (the native `beforeRemove` confirm,
  // through the one back guard, src/navigation/back.ts).
  useBackGuard({
    when: dirty,
    onBlocked: (leave) =>
      Alert.alert(t('coaching.coach.hours.discardTitle'), t('coaching.coach.hours.discardBody'), [
        { text: t('coaching.coach.hours.keepEditing'), style: 'cancel' },
        { text: t('coaching.coach.hours.discard'), style: 'destructive', onPress: () => leave() },
      ]),
  });

  const days = windowsByWeekday(windows) as EditableWindow[][];
  const tz = coach.branches[0]?.timezone ?? branch?.timezone ?? DEFAULT_TZ;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.hours.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
      >
        <CoachBanners testID="coach-mode-hours.banner" coach={coach} />
        {!hours.data ? (
          hours.isError ? (
            <ErrorState
              testID="coach-mode-hours.error"
              title={t('errors.loadFailedTitle')}
              message={coachErrorText(hours.error, t, { locale })}
              retryLabel={t('common.retry')}
              onRetry={() => void hours.refetch()}
              busy={hours.isRefetching}
            />
          ) : (
            <SkeletonList rows={4} height={72} />
          )
        ) : null}

        {hours.data ? (
          <>
            {branches.length > 1 ? (
              <Card style={{ padding: space.m, gap: 8 }}>
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
                  {t('coaching.coach.hours.branch')}
                </Text>
                <SegmentedControl<string>
                  testID="coach-mode-hours.branch"
                  options={branches.map((b) => ({
                    value: b.venueId,
                    label: pickName(b.nameEn, b.nameAr, locale),
                  }))}
                  value={venueId ?? branches[0]!.venueId}
                  onChange={setPicked}
                />
              </Card>
            ) : null}
            <ListHeading
              icon={ClockIcon}
              label={t('coaching.coach.hours.weekly')}
              style={{ marginTop: space.s }}
            />
            {branch ? (
              <>
                <Hint>{t('coaching.coach.hours.weeklyNote')}</Hint>
                {days.map((dayWindows, weekday) => (
                  <HoursDayEditor
                    key={weekday}
                    testID={`coach-mode-hours.day.${weekday}`}
                    dayLabel={t(WEEKDAY_KEYS[weekday]!)}
                    windows={dayWindows.map((w) => ({ ...w, error: errors[w.key] ?? null }))}
                    onStart={onStart}
                    onEnd={onEnd}
                    onMidnight={onMidnight}
                    onRemove={onRemove}
                    onAdd={() => onAdd(weekday)}
                  />
                ))}
              </>
            ) : (
              <Hint>{t('coaching.coach.hours.noBranches')}</Hint>
            )}
          </>
        ) : null}
        <Button
          testID="coach-mode-hours.save"
          label={t('coaching.coach.hours.save')}
          variant="cta"
          busy={save.isPending}
          disabled={!branch}
          onPress={onSave}
          style={{ marginTop: space.s }}
        />

        {hours.data ? (
          <TimeOffSection
            timeOff={hours.data.timeOff}
            tz={tz}
            onGone={() => void hours.refetch()}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** Time off (guest.md §4.13.3): the list with Cancel, and the add form. */
function TimeOffSection({
  timeOff,
  tz,
  onGone,
}: {
  timeOff: readonly TimeOffEntry[];
  tz: string;
  onGone: () => void;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const add = useAddTimeOff();
  const cancel = useCancelTimeOff();
  const [asking, setAsking] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => ceilToLessonGrid(new Date(), tz));
  const [end, setEnd] = useState(
    () => new Date(ceilToLessonGrid(new Date(), tz).getTime() + 2 * 3_600_000),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ text: string; lessons: boolean } | null>(null);
  const sorted = [...timeOff].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const onSubmit = () => {
    const problem = timeOffProblem(start, end, new Date());
    if (problem) {
      setError({ text: t(`coaching.coach.timeOff.${problem}`), lessons: false });
      return;
    }
    setError(null);
    add.mutate(
      { startsAt: start.toISOString(), endsAt: end.toISOString(), reason },
      {
        onSuccess: () => {
          toast(t('coaching.coach.timeOff.added'), 'success');
          setOpen(false);
          setReason('');
        },
        onError: (err) =>
          setError({
            text: coachErrorText(err, t, { locale }),
            lessons: coachErrorCode(err) === 'TIME_OFF_HAS_LESSONS',
          }),
      },
    );
  };

  const onCancel = () => {
    const id = asking;
    setAsking(null);
    if (!id) return;
    cancel.mutate(id, {
      onSuccess: () => toast(t('coaching.coach.timeOff.cancelled'), 'info'),
      onError: (err) => {
        toast(coachErrorText(err, t, { locale }), 'error');
        if (coachErrorCode(err) === 'INVALID_ARGUMENT') onGone();
      },
    });
  };

  return (
    <View style={{ gap: space.sm, marginTop: space.l }}>
      <ListHeading
        icon={CalendarIcon}
        label={t('coaching.coach.timeOff.title')}
        count={sorted.length}
      />
      <Hint>{t('coaching.coach.timeOff.note')}</Hint>
      {sorted.length === 0 ? <Hint>{t('coaching.coach.timeOff.empty')}</Hint> : null}
      {sorted.map((entry) => (
        <TimeOffRow
          key={entry.id}
          testID={`coach-mode-hours.time-off.${entry.id}`}
          entry={entry}
          tz={tz}
          busy={cancel.isPending && cancel.variables === entry.id}
          onCancel={() => setAsking(entry.id)}
        />
      ))}
      {open ? (
        <Card style={{ gap: space.sm }}>
          <DateTimeField
            testID="coach-mode-hours.time-off.start"
            label={t('coaching.coach.timeOff.from')}
            mode="datetime"
            timeZone={tz}
            minuteInterval={30}
            value={start}
            onChange={(d) => {
              setStart(d);
              if (end.getTime() <= d.getTime()) setEnd(new Date(d.getTime() + 2 * 3_600_000));
            }}
          />
          <DateTimeField
            testID="coach-mode-hours.time-off.end"
            label={t('coaching.coach.timeOff.until')}
            mode="datetime"
            timeZone={tz}
            minuteInterval={30}
            value={end}
            minimumDate={start}
            onChange={setEnd}
          />
          <Field
            testID="coach-mode-hours.time-off.reason"
            label={t('coaching.coach.timeOff.reason')}
            value={reason}
            onChangeText={setReason}
            maxLength={TIME_OFF_REASON_MAX}
            dense
          />
          <Hint>{t('coaching.coach.timeOff.reasonNote')}</Hint>
          {error ? <ErrorText>{error.text}</ErrorText> : null}
          {error?.lessons ? (
            <LinkText
              testID="coach-mode-hours.time-off.see-schedule"
              label={t('coaching.coach.timeOff.seeSchedule')}
              onPress={() => router.navigate('/coach-mode')}
            />
          ) : null}
          <Button
            testID="coach-mode-hours.time-off.submit"
            label={t('coaching.coach.timeOff.submit')}
            variant="primary"
            size="medium"
            busy={add.isPending}
            onPress={onSubmit}
          />
        </Card>
      ) : (
        <LinkText
          testID="coach-mode-hours.time-off.add"
          label={t('coaching.coach.timeOff.add')}
          onPress={() => setOpen(true)}
        />
      )}
      <ConfirmAlert
        visible={asking !== null}
        title={t('coaching.coach.timeOff.cancelTitle')}
        body={t('coaching.coach.timeOff.cancelBody')}
        confirmLabel={t('coaching.coach.timeOff.cancelConfirm')}
        cancelLabel={t('coaching.coach.timeOff.keep')}
        destructive
        onConfirm={onCancel}
        onDismiss={() => setAsking(null)}
      />
    </View>
  );
}

export default function CoachModeHoursRoute() {
  return (
    <RequireCoach>
      <CoachHoursScreen />
    </RequireCoach>
  );
}
