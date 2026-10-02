import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Hint,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';
import { CheckIcon } from '../src/components/icons';
import { DateTimeField } from '../src/components/DateTimeField';
import { CoachBanners } from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import { useCreateCourse, useCreateGroup } from '../src/features/coach/hooks';
import { coachErrorCode, coachErrorText } from '../src/features/coach/errors';
import { rpcErrorDetail } from '../src/features/booking/errors';
import { useBack } from '../src/navigation/back';
import {
  COURSE_TITLE_MAX,
  DEFAULT_TZ,
  bookableBranches,
  canBookOrCreate,
  courseIntent,
  defaultStart,
  groupIntent,
  pickName,
  snapToGrid,
  startIndexOf,
  startProblem,
  typesFor,
  weeklyStarts,
  type CoachLessonType,
  type CoachMe,
} from '../src/features/coach/logic';

/**
 * A new group session or course (docs/design/coaching/guest.md §4.13.5; C-13,
 * R9, R47, GL-6). The coach picks the kind, the branch (coaching on only),
 * one of their active lesson types there (the venue's price, read-only, C-5)
 * and the start on the platform's date-and-time picker: `coach_slots` serves
 * private types only (R77), so the server checks hours, time off, other
 * lessons and a court. A course lists one start a week at the same local time,
 * each editable. Courts are taken at creation.
 */
type Kind = 'group' | 'course';

function CoachNewScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach') return null;
  return <CoachNewBody coach={status.coach} />;
}

function CoachNewBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const back = useBack('/coach-mode');
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const createGroup = useCreateGroup();
  const createCourse = useCreateCourse();

  const branches = bookableBranches(coach);
  const allowed = canBookOrCreate(coach);
  const [pickedVenue, setPickedVenue] = useState<string | null>(null);
  const venueId = pickedVenue ?? branches[0]?.venueId ?? null;
  const tz = branches.find((b) => b.venueId === venueId)?.timezone ?? DEFAULT_TZ;

  const hasGroup = venueId ? typesFor(coach, venueId, ['group']).length > 0 : false;
  const [pickedKind, setPickedKind] = useState<Kind | null>(null);
  const kind: Kind = pickedKind ?? (hasGroup || !venueId ? 'group' : 'course');
  const types = venueId ? typesFor(coach, venueId, [kind]) : [];
  const [pickedType, setPickedType] = useState<string | null>(null);
  const type: CoachLessonType | null = types.find((x) => x.id === pickedType) ?? types[0] ?? null;

  // The first start, defaulting to the next half hour outside the type's cut-off
  // (counted from when the screen opened, so the default holds still).
  const [openedAt] = useState(() => new Date());
  const [firstStart, setFirstStart] = useState<{ typeId: string | null; at: Date } | null>(null);
  const start =
    firstStart && firstStart.typeId === (type?.id ?? null)
      ? firstStart.at
      : defaultStart(openedAt, type?.cutoffHours ?? 0, tz);
  // A course's later starts: one a week at the first start's local time, each editable.
  const [edits, setEdits] = useState<Record<number, Date>>({});
  const weekly =
    kind === 'course' && type?.sessionsCount
      ? weeklyStarts(start, type.sessionsCount, tz)
      : [start];
  const starts = weekly.map((d, i) => (i === 0 ? start : (edits[i + 1] ?? d)));

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const clearErrors = () => {
    setRowErrors({});
    setTopError(null);
  };

  const preCheckLine = (p: 'grid' | 'past' | 'cutoff') =>
    t(
      p === 'grid'
        ? 'coaching.coach.new.notOnGrid'
        : p === 'past'
          ? 'coaching.coach.new.past'
          : 'coaching.coach.new.cutoff',
    );

  const done = (lessonId: string | null | undefined) => {
    toast(
      t(
        coach.publicAccepted ? 'coaching.coach.new.created' : 'coaching.coach.new.createdNotPublic',
      ),
      'success',
    );
    if (lessonId) router.replace({ pathname: '/coach-mode-lesson', params: { id: lessonId } });
    else back();
  };

  const onError = (err: unknown) => {
    const code = coachErrorCode(err);
    const detail = rpcErrorDetail(err);
    const n = startIndexOf(detail);
    const text = coachErrorText(err, t, { locale, privateCap: coach.privateCap });
    if (code === 'LESSON_CLOSED' && detail === 'cutoff') setRowErrors({ 1: text });
    else if (n !== null && code !== 'COURSE_STARTS_INVALID') setRowErrors({ [n]: text });
    else setTopError(text);
  };

  const onCreate = () => {
    if (!type || !venueId || !allowed) return;
    clearErrors();
    const now = new Date();
    const problems: Record<number, string> = {};
    starts.forEach((s, i) => {
      const p = startProblem(s, { tz, now, cutoffHours: i === 0 ? type.cutoffHours : null });
      if (p) problems[i + 1] = preCheckLine(p);
    });
    if (Object.keys(problems).length > 0) {
      setRowErrors(problems);
      return;
    }
    if (kind === 'group') {
      const startAt = start.toISOString();
      createGroup.mutate(
        {
          typeId: type.id,
          venueId,
          startAt,
          intent: groupIntent({ typeId: type.id, venueId, startAt }),
        },
        { onSuccess: (r) => done(r.lessonId), onError },
      );
      return;
    }
    const iso = starts.map((s) => s.toISOString());
    createCourse.mutate(
      {
        typeId: type.id,
        venueId,
        starts: iso,
        titleEn,
        titleAr,
        intent: courseIntent({ typeId: type.id, venueId, starts: iso }),
      },
      { onSuccess: (r) => done(r.lessonIds[0]), onError },
    );
  };

  const label = { fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 } as const;
  const busy = createGroup.isPending || createCourse.isPending;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.new.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CoachBanners testID="coach-mode-new.banner" coach={coach} />
        {!allowed ? <Hint>{t('coaching.coach.new.unavailable')}</Hint> : null}

        <Card style={{ padding: space.m, gap: 8 }}>
          <Text style={label}>{t('coaching.coach.new.kind')}</Text>
          <SegmentedControl<Kind>
            testID="coach-mode-new.kind"
            options={[
              { value: 'group', label: t('coaching.coach.new.group') },
              { value: 'course', label: t('coaching.coach.new.course') },
            ]}
            value={kind}
            onChange={(k) => {
              setPickedKind(k);
              setPickedType(null);
              setEdits({});
              clearErrors();
            }}
          />
          {branches.length > 1 ? (
            <>
              <Text style={[label, { marginTop: space.s }]}>{t('coaching.coach.new.branch')}</Text>
              <SegmentedControl<string>
                testID="coach-mode-new.branch"
                options={branches.map((b) => ({
                  value: b.venueId,
                  label: pickName(b.nameEn, b.nameAr, locale),
                }))}
                value={venueId ?? branches[0]!.venueId}
                onChange={(v) => {
                  setPickedVenue(v);
                  setPickedType(null);
                  setEdits({});
                  clearErrors();
                }}
              />
            </>
          ) : null}
        </Card>

        <Text style={[label, { marginTop: space.s, paddingStart: 4 }]}>
          {t('coaching.coach.new.type')}
        </Text>
        {types.length === 0 ? <Hint>{t('coaching.coach.new.noTypes')}</Hint> : null}
        {types.map((lt) => {
          const selected = lt.id === type?.id;
          const meta =
            lt.kind === 'course'
              ? t('coaching.coach.new.typeMetaCourse', {
                  sessions: countPhrase(
                    'coaching.coach.count.sessions',
                    lt.sessionsCount ?? 0,
                    locale,
                  ),
                  places: countPhrase('coaching.coach.count.places', lt.maxPlaces, locale),
                  people: countPhrase('coaching.coach.count.people', lt.minPlaces, locale),
                })
              : t('coaching.coach.new.typeMeta', {
                  places: countPhrase('coaching.coach.count.places', lt.maxPlaces, locale),
                  people: countPhrase('coaching.coach.count.people', lt.minPlaces, locale),
                  hours: countPhrase('coaching.coach.count.hours', lt.cutoffHours, locale),
                });
          return (
            <Pressable
              key={lt.id}
              testID={`coach-mode-new.type.${lt.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                setPickedType(lt.id);
                setEdits({});
                clearErrors();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                backgroundColor: pressed ? colors.sub : colors.card,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.blue : colors.line,
                borderRadius: radius.button,
                paddingStart: space.m,
                paddingEnd: space.m,
                paddingTop: 12,
                paddingBottom: 12,
              })}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
                  {isolate(pickName(lt.nameEn, lt.nameAr, locale))}
                </Text>
                <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut2 }}>
                  {meta}
                </Text>
                <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
                  {lt.priceIqd !== null
                    ? t('coaching.coach.new.price', {
                        price: isolateLtr(formatIQD(lt.priceIqd, locale)),
                      })
                    : t('coaching.coach.new.noPrice')}
                </Text>
              </View>
              {selected ? <CheckIcon size={16} color={colors.blue} /> : null}
            </Pressable>
          );
        })}

        {type ? (
          <Card style={{ gap: space.sm, marginTop: space.s }}>
            <DateTimeField
              testID="coach-mode-new.start"
              label={t(
                kind === 'course' ? 'coaching.coach.new.firstStart' : 'coaching.coach.new.start',
              )}
              mode="datetime"
              timeZone={tz}
              minuteInterval={30}
              snap={(d) => snapToGrid(d, tz)}
              minimumDate={new Date()}
              value={start}
              error={rowErrors[1] ?? null}
              onChange={(d) => {
                setFirstStart({ typeId: type.id, at: d });
                setEdits({});
                clearErrors();
              }}
            />
            {kind === 'course' && starts.length > 1 ? (
              <>
                <Hint>{t('coaching.coach.new.weeklyNote')}</Hint>
                {starts.slice(1).map((s, i) => {
                  const n = i + 2;
                  return (
                    <DateTimeField
                      key={n}
                      testID={`coach-mode-new.start.${n}`}
                      label={t('coaching.coach.new.sessionN', { n: isolateLtr(String(n)) })}
                      mode="datetime"
                      timeZone={tz}
                      minuteInterval={30}
                      snap={(d) => snapToGrid(d, tz)}
                      minimumDate={new Date()}
                      value={s}
                      error={rowErrors[n] ?? null}
                      onChange={(d) => {
                        setEdits((e) => ({ ...e, [n]: d }));
                        clearErrors();
                      }}
                    />
                  );
                })}
              </>
            ) : null}
          </Card>
        ) : null}

        {type && kind === 'course' ? (
          <Card style={{ gap: space.sm }}>
            <Field
              testID="coach-mode-new.title-en"
              label={t('coaching.coach.new.titleEn')}
              value={titleEn}
              onChangeText={setTitleEn}
              maxLength={COURSE_TITLE_MAX}
              dense
            />
            <Field
              testID="coach-mode-new.title-ar"
              label={t('coaching.coach.new.titleAr')}
              value={titleAr}
              onChangeText={setTitleAr}
              maxLength={COURSE_TITLE_MAX}
              dense
            />
          </Card>
        ) : null}

        {topError ? <ErrorText>{topError}</ErrorText> : null}
        <Button
          testID="coach-mode-new.create"
          label={t('coaching.coach.new.create')}
          variant="cta"
          busy={busy}
          disabled={!type || !allowed}
          onPress={onCreate}
          style={{ marginTop: space.s }}
        />
      </ScrollView>
    </Screen>
  );
}

export default function CoachModeNewRoute() {
  return (
    <RequireCoach>
      <CoachNewScreen />
    </RequireCoach>
  );
}
