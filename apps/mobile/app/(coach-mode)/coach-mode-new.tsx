import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, ErrorText, Field, Hint, Screen } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';
import {
  CheckIcon,
  ChevronDownIcon,
  CourseIcon,
  PeopleIcon,
  PinIcon,
} from '../../src/components/icons';
import { WheelSheet } from '../../src/components/WheelSheet';
import { DateTimeField } from '../../src/components/DateTimeField';
import { CoachBanners, SHEET_RADIUS, StepBadge } from '../../src/components/coachMode';
import { RequireCoach } from '../../src/features/coach/RequireCoach';
import { useCoachStatus } from '../../src/features/coach/CoachStatusProvider';
import { useCreateCourse, useCreateGroup } from '../../src/features/coach/hooks';
import { coachErrorCode, coachErrorText } from '../../src/features/coach/errors';
import { rpcErrorDetail } from '../../src/features/booking/errors';
import { useBack } from '../../src/navigation/back';
import { useBlueHeaderOptions } from '../../src/navigation/blueHeader';
import {
  COURSE_TITLE_MAX,
  DEFAULT_TZ,
  bookableBranches,
  canBookOrCreate,
  courseIntent,
  defaultStart,
  groupIntent,
  pickName,
  privateCapAt,
  snapToGrid,
  startIndexOf,
  startProblem,
  typesFor,
  weeklyStarts,
  type CoachLessonType,
  type CoachMe,
} from '../../src/features/coach/logic';

/**
 * A new group session or course (docs/design/coaching/guest.md §4.13.5; C-13,
 * R9, R47, GL-6). The coach picks the kind, the branch (coaching on only),
 * one of their active lesson types there (the venue's price, read-only, C-5)
 * and the start on the platform's date-and-time picker: `coach_slots` serves
 * private types only (R77), so the server checks hours, time off, other
 * lessons and a court. A course lists one start a week at the same local time,
 * each editable. Courts are taken at creation.
 *
 * Laid out as coach mode is (owner, 2026-10-11): the blue bar carried down into
 * a hero holding the two kinds as tiles, then the page's ground as a sheet with
 * rounded top corners: the branch as a dropdown (the wheel sheet, so any number
 * of branches fits), 1 · Lesson type, 2 · When, a course's titles, and a bar
 * under the form with what is being made, its price and Create.
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
  const headerOptions = useBlueHeaderOptions(t('coaching.coach.new.title'));
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
    const text = coachErrorText(err, t, {
      locale,
      privateCap: privateCapAt(coach, venueId)?.cap ?? null,
    });
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
        intent: courseIntent({ typeId: type.id, venueId, starts: iso, titleEn, titleAr }),
      },
      { onSuccess: (r) => done(r.lessonIds[0]), onError },
    );
  };

  const busy = createGroup.isPending || createCourse.isPending;
  const branch = branches.find((b) => b.venueId === venueId) ?? null;

  const pickKind = (k: Kind) => {
    setPickedKind(k);
    setPickedType(null);
    setEdits({});
    clearErrors();
  };

  // The branch dropdown opens the wheel sheet; the wheel's turn is staged
  // until Done, so turning past a branch reloads nothing.
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchPick, setBranchPick] = useState<string>(venueId ?? '');
  const openBranches = () => {
    setBranchPick(venueId ?? branches[0]?.venueId ?? '');
    setBranchOpen(true);
  };
  const confirmBranch = () => {
    setBranchOpen(false);
    if (branchPick === venueId) return;
    setPickedVenue(branchPick);
    setPickedType(null);
    setEdits({});
    clearErrors();
  };

  const kinds: {
    value: Kind;
    icon: typeof PeopleIcon;
    label: string;
    hint: string;
  }[] = [
    {
      value: 'group',
      icon: PeopleIcon,
      label: t('coaching.coach.new.group'),
      hint: t('coaching.coach.new.groupHint'),
    },
    {
      value: 'course',
      icon: CourseIcon,
      label: t('coaching.coach.new.course'),
      hint: t('coaching.coach.new.courseHint'),
    },
  ];

  const typeMeta = (lt: CoachLessonType) =>
    lt.kind === 'course'
      ? t('coaching.coach.new.typeMetaCourse', {
          sessions: countPhrase('coaching.coach.count.sessions', lt.sessionsCount ?? 0, locale),
          places: countPhrase('coaching.coach.count.places', lt.maxPlaces, locale),
          people: countPhrase('coaching.coach.count.people', lt.minPlaces, locale),
        })
      : t('coaching.coach.new.typeMeta', {
          places: countPhrase('coaching.coach.count.places', lt.maxPlaces, locale),
          people: countPhrase('coaching.coach.count.people', lt.minPlaces, locale),
          hours: countPhrase('coaching.coach.count.hours', lt.cutoffHours, locale),
        });

  const card = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 14,
    gap: 10,
  } as const;
  const stepTitle = { fontFamily: fonts.body800, fontSize: 14, color: colors.ink } as const;

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen options={headerOptions} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The hero: the bar's blue carried down, holding the two kinds. */}
        <View
          style={{
            backgroundColor: brand.blue,
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: space.s,
            paddingBottom: space.l + SHEET_RADIUS,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              start: 0,
              end: 0,
              top: -1000,
              height: 1000,
              backgroundColor: brand.blue,
            }}
          />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {kinds.map((k) => {
              const selected = k.value === kind;
              return (
                <Pressable
                  key={k.value}
                  testID={`coach-mode-new.kind.${k.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => pickKind(k.value)}
                  style={({ pressed }) => ({
                    flex: 1,
                    backgroundColor: selected ? colors.card : brand.navyLine,
                    borderWidth: 2,
                    borderColor: selected ? brand.green : 'transparent',
                    borderRadius: 18,
                    padding: 14,
                    gap: 10,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      backgroundColor: selected ? colors.gtint : undefined,
                    }}
                  >
                    {selected ? null : (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          start: 0,
                          end: 0,
                          backgroundColor: brand.white,
                          opacity: 0.12,
                        }}
                      />
                    )}
                    <k.icon size={20} color={selected ? colors.gstrong : brand.white} />
                  </View>
                  <View style={{ gap: 2 }}>
                    <Text
                      style={{
                        fontFamily: fonts.body800,
                        fontSize: 15,
                        color: selected ? colors.ink : brand.white,
                      }}
                    >
                      {k.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.body600,
                        fontSize: 12,
                        color: selected ? colors.mut : brand.white,
                        opacity: selected ? 1 : 0.8,
                      }}
                    >
                      {k.hint}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* The sheet: the page's own ground, rounded where it meets the blue. */}
        <View
          style={{
            flex: 1,
            marginTop: -SHEET_RADIUS,
            backgroundColor: colors.bg,
            borderTopStartRadius: SHEET_RADIUS,
            borderTopEndRadius: SHEET_RADIUS,
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: 20,
            paddingBottom: space.l,
            gap: space.sm,
          }}
        >
          <CoachBanners testID="coach-mode-new.banner" coach={coach} />
          {!allowed ? <Hint>{t('coaching.coach.new.unavailable')}</Hint> : null}

          {branches.length > 1 && branch ? (
            <Pressable
              testID="coach-mode-new.branch"
              accessibilityRole="button"
              accessibilityLabel={`${t('coaching.coach.new.branch')}: ${pickName(branch.nameEn, branch.nameAr, locale)}`}
              onPress={openBranches}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                height: 48,
                paddingStart: 14,
                paddingEnd: 14,
                backgroundColor: pressed ? colors.sub : colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.button,
              })}
            >
              <PinIcon size={18} color={colors.gstrong} />
              <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut }}>
                {t('coaching.coach.new.branch')}
              </Text>
              <View style={{ flex: 1 }} />
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontFamily: fonts.body800,
                  fontSize: 14,
                  color: colors.ink,
                }}
              >
                {isolate(pickName(branch.nameEn, branch.nameAr, locale))}
              </Text>
              <ChevronDownIcon size={16} color={colors.mut} strokeWidth={2.4} />
            </Pressable>
          ) : null}

          {/* 1 · Lesson type */}
          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <StepBadge n={1} />
              <Text style={stepTitle}>{t('coaching.coach.new.type')}</Text>
            </View>
            {types.length === 0 ? <Hint>{t('coaching.coach.new.noTypes')}</Hint> : null}
            {types.map((lt) => {
              const selected = lt.id === type?.id;
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
                    gap: 10,
                    borderRadius: radius.cell,
                    paddingStart: 12,
                    paddingEnd: 12,
                    paddingTop: 10,
                    paddingBottom: 10,
                    backgroundColor: selected ? colors.tint : pressed ? colors.sub : undefined,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}>
                      {isolate(pickName(lt.nameEn, lt.nameAr, locale))}
                    </Text>
                    <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut2 }}>
                      {typeMeta(lt)}
                    </Text>
                  </View>
                  {selected ? <CheckIcon size={18} color={colors.blue} strokeWidth={2.6} /> : null}
                </Pressable>
              );
            })}
          </View>

          {/* 2 · When: one start for a group session; for a course, "Lesson
          time" over every session, 1 to the last, the weekly note under them. */}
          {type ? (
            <View style={card}>
              {kind === 'course' ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <StepBadge n={2} />
                    <Text style={stepTitle}>{t('coaching.coach.new.lessonTime')}</Text>
                  </View>
                  {starts.map((s, i) => {
                    const n = i + 1;
                    return (
                      <DateTimeField
                        key={n}
                        testID={n === 1 ? 'coach-mode-new.start' : `coach-mode-new.start.${n}`}
                        label={t('coaching.coach.new.sessionN', { n: isolateLtr(String(n)) })}
                        mode="datetime"
                        timeZone={tz}
                        minuteInterval={30}
                        snap={(d) => snapToGrid(d, tz)}
                        minimumDate={new Date()}
                        value={s}
                        error={rowErrors[n] ?? null}
                        onChange={(d) => {
                          if (n === 1) {
                            // The first session sets the week's time for the rest.
                            setFirstStart({ typeId: type.id, at: d });
                            setEdits({});
                          } else {
                            setEdits((e) => ({ ...e, [n]: d }));
                          }
                          clearErrors();
                        }}
                      />
                    );
                  })}
                  {starts.length > 1 ? <Hint>{t('coaching.coach.new.weeklyNote')}</Hint> : null}
                </>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <StepBadge n={2} />
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      testID="coach-mode-new.start"
                      label={t('coaching.coach.new.when')}
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
                  </View>
                </View>
              )}
            </View>
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
        </View>
      </ScrollView>

      {/* The bar under the form: what is being made, its price, and Create. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: Math.max(insets.bottom, space.l),
        }}
      >
        {type ? (
          <View testID="coach-mode-new.summary">
            <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.mut }}>
              {kind === 'course'
                ? countPhrase('coaching.coach.count.sessions', type.sessionsCount ?? 0, locale)
                : t('coaching.coach.new.group')}
            </Text>
            <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.gtext }}>
              {type.priceIqd !== null
                ? isolateLtr(formatIQD(type.priceIqd, locale))
                : t('coaching.coach.new.priceNone')}
            </Text>
          </View>
        ) : null}
        <Button
          testID="coach-mode-new.create"
          label={t(
            kind === 'course'
              ? 'coaching.coach.new.createCourse'
              : 'coaching.coach.new.createSession',
          )}
          variant="cta"
          busy={busy}
          disabled={!type || !allowed}
          onPress={onCreate}
          style={{ flex: 1 }}
        />
      </View>

      {branches.length > 1 ? (
        <WheelSheet<string>
          testID="coach-mode-new.branch-sheet"
          visible={branchOpen}
          title={t('coaching.coach.new.branch')}
          options={branches.map((b) => ({
            value: b.venueId,
            label: pickName(b.nameEn, b.nameAr, locale),
          }))}
          value={branchPick}
          onChange={setBranchPick}
          confirmLabel={t('common.done')}
          onConfirm={confirmBranch}
          onClose={() => setBranchOpen(false)}
        />
      ) : null}
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
