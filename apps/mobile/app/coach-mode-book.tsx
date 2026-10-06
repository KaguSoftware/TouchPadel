import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, localParts, wallTimeToUtc } from '@touch/core';
import {
  formatDayNumber,
  formatIQD,
  formatMonthShort,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
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
import { FilterChip } from '../src/components/booking';
import { SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { CalendarIcon, CheckIcon, ClockIcon } from '../src/components/icons';
import { PhoneField } from '../src/components/phone';
import { DateTimeField } from '../src/components/DateTimeField';
import { CoachBanners } from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import { useCoachBook, useCoachSlots } from '../src/features/coach/hooks';
import { coachErrorText, isSlotRefusal } from '../src/features/coach/errors';
import {
  DEFAULT_TZ,
  STUDENT_NAME_MAX,
  atPrivateCap,
  bookableBranches,
  canBookOrCreate,
  cleanName,
  coachBookIntent,
  defaultStart,
  nightOf,
  pickName,
  privateCapAt,
  slotsByNight,
  slotsWindow,
  snapToGrid,
  startProblem,
  typesFor,
  type CoachMe,
} from '../src/features/coach/logic';
import { DEFAULT_ISO, composePhone, validatePhone } from '../src/features/profile/phone';
import { useBack } from '../src/navigation/back';

/**
 * Book a private lesson for a student (docs/design/coaching/guest.md §4.13.6;
 * C-8, CD-1, R56): the branch (coaching on only), the private lesson type, a
 * free time from `coach_slots` (as the guest grid), the student's name and,
 * when they have one, their phone. Always paid at the desk. The answer is the
 * same whether the phone matched an account (C-21). The coach holds at most
 * its branch's `open_private_cap` upcoming lessons booked this way at that
 * branch (R56; the server counts per branch, MB-01).
 *
 * When the free times cannot be read (a coach not public yet is not listed by
 * `coach_slots`, R61), the start is picked on the platform's date-and-time
 * picker instead, and the server checks it.
 */
function CoachBookScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach') return null;
  return <CoachBookBody coach={status.coach} />;
}

function CoachBookBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const back = useBack('/coach-mode');
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const book = useCoachBook();

  const branches = bookableBranches(coach);
  const allowed = canBookOrCreate(coach);
  const [pickedVenue, setPickedVenue] = useState<string | null>(null);
  const venueId = pickedVenue ?? branches[0]?.venueId ?? null;
  // R56 is per branch: the count and cap of the branch picked (MB-01).
  const capAt = privateCapAt(coach, venueId);
  const atCap = atPrivateCap(coach, venueId);
  const tz = branches.find((b) => b.venueId === venueId)?.timezone ?? DEFAULT_TZ;
  const types = venueId ? typesFor(coach, venueId, ['private']) : [];
  const [pickedType, setPickedType] = useState<string | null>(null);
  const type = types.find((x) => x.id === pickedType) ?? types[0] ?? null;

  const [openedAt] = useState(() => new Date());
  const window = slotsWindow(openedAt, tz);
  const slots = useCoachSlots(
    allowed && type
      ? { coachId: coach.id, typeId: type.id, from: window.from, to: window.to }
      : null,
  );
  const nights = slots.data ? slotsByNight(slots.data, tz) : [];
  const usePicker = slots.isError || slots.data?.off === true;

  const [pickedNight, setPickedNight] = useState<string | null>(null);
  const night = nights.find((n) => n.night === pickedNight) ?? nights[0] ?? null;
  const [pickedStart, setPickedStart] = useState<string | null>(null);
  const [pickerStart, setPickerStart] = useState<Date>(() => defaultStart(openedAt, 0, tz));

  const [name, setName] = useState('');
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [party, setParty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const maxParty = Math.max(1, Math.min(4, type?.maxPlaces ?? 1));
  const tonight = nightOf(openedAt, tz);
  const dayLabel = (n: string) => {
    if (n === tonight) return t('coaching.coach.home.tonight');
    if (n === addDays(tonight, 1)) return t('coaching.coach.home.tomorrow');
    const noon = wallTimeToUtc(n, 12 * 60, tz);
    return t('coaching.coach.home.day', {
      weekday: formatWeekdayShort(noon, locale, tz),
      day: formatDayNumber(noon, locale, tz),
      month: formatMonthShort(noon, locale, tz),
    });
  };

  const onBook = () => {
    if (!type || !venueId || !allowed || atCap) return;
    const clean = cleanName(name);
    if (!clean) {
      setError(t('coaching.coach.add.nameRequired'));
      return;
    }
    let phone: string | null = null;
    if (national.trim()) {
      if (validatePhone(iso, national) !== null) {
        setError(t('coaching.coach.add.phoneInvalid'));
        return;
      }
      phone = composePhone(iso, national);
    }
    const startAt = usePicker ? pickerStart.toISOString() : pickedStart;
    if (!startAt) {
      setError(t('coaching.coach.book.pickTime'));
      return;
    }
    if (usePicker) {
      const p = startProblem(pickerStart, { tz, now: new Date() });
      if (p) {
        setError(t(p === 'grid' ? 'coaching.coach.new.notOnGrid' : 'coaching.coach.new.past'));
        return;
      }
    }
    setError(null);
    const partySize = Math.min(party, maxParty);
    book.mutate(
      {
        typeId: type.id,
        venueId,
        startAt,
        name: clean,
        phone,
        partySize,
        intent: coachBookIntent({
          typeId: type.id,
          venueId,
          startAt,
          party: partySize,
          name: clean,
          phone,
        }),
      },
      {
        onSuccess: (r) => {
          toast(t('coaching.coach.book.done', { name: isolate(clean) }), 'success');
          if (r.lessonId)
            router.replace({ pathname: '/coach-mode-lesson', params: { id: r.lessonId } });
          else back();
        },
        onError: (err) => {
          // The start was taken first: the free times are re-read (useAfterWrite)
          // and the pick goes, so the next tap cannot send it again (MB-08).
          if (isSlotRefusal(err)) setPickedStart(null);
          setError(coachErrorText(err, t, { locale, privateCap: capAt?.cap ?? null }));
        },
      },
    );
  };

  const label = { fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 } as const;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.book.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <CoachBanners testID="coach-mode-book.banner" coach={coach} />
        {!allowed ? <Hint>{t('coaching.coach.book.unavailable')}</Hint> : null}

        {branches.length > 1 ? (
          <Card style={{ padding: space.m, gap: 8 }}>
            <Text style={label}>{t('coaching.coach.book.branch')}</Text>
            <SegmentedControl<string>
              testID="coach-mode-book.branch"
              options={branches.map((b) => ({
                value: b.venueId,
                label: pickName(b.nameEn, b.nameAr, locale),
              }))}
              value={venueId ?? branches[0]!.venueId}
              onChange={(v) => {
                setPickedVenue(v);
                setPickedType(null);
                setPickedNight(null);
                setPickedStart(null);
              }}
            />
          </Card>
        ) : null}

        <Text style={[label, { paddingStart: 4 }]}>{t('coaching.coach.book.type')}</Text>
        {types.length === 0 ? <Hint>{t('coaching.coach.book.noTypes')}</Hint> : null}
        <View testID="coach-mode-book.type" style={{ gap: space.s }}>
          {types.map((lt) => {
            const selected = lt.id === type?.id;
            return (
              <Pressable
                key={lt.id}
                testID={`coach-mode-book.type.${lt.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setPickedType(lt.id);
                  setPickedNight(null);
                  setPickedStart(null);
                  setParty(1);
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
        </View>

        {type && allowed ? (
          <Card style={{ gap: space.sm, marginTop: space.s }}>
            {usePicker ? (
              <>
                <Hint>{t('coaching.coach.book.slotsUnavailable')}</Hint>
                <DateTimeField
                  testID="coach-mode-book.start"
                  label={t('coaching.coach.book.start')}
                  mode="datetime"
                  timeZone={tz}
                  minuteInterval={30}
                  snap={(d) => snapToGrid(d, tz)}
                  minimumDate={new Date()}
                  value={pickerStart}
                  onChange={setPickerStart}
                />
              </>
            ) : !slots.data ? (
              <SkeletonList rows={2} height={44} />
            ) : (
              <>
                <Text style={label}>{t('coaching.coach.book.day')}</Text>
                {nights.length === 0 ? (
                  <Hint>{t('coaching.coach.book.noTimes')}</Hint>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 7 }}
                  >
                    {nights.map((n) => (
                      <FilterChip
                        key={n.night}
                        testID={`coach-mode-book.day.${n.night}`}
                        icon={CalendarIcon}
                        label={dayLabel(n.night)}
                        selected={n.night === night?.night}
                        onPress={() => {
                          setPickedNight(n.night);
                          setPickedStart(null);
                        }}
                      />
                    ))}
                  </ScrollView>
                )}
                {night ? (
                  <>
                    <Text style={[label, { marginTop: space.s }]}>
                      {t('coaching.coach.book.time')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                      {night.starts.map((s) => {
                        const at = new Date(s);
                        const p = localParts(at, tz);
                        const hhmm = `${String(Math.floor(p.minutesOfDay / 60)).padStart(2, '0')}${String(p.minutesOfDay % 60).padStart(2, '0')}`;
                        return (
                          <FilterChip
                            key={s}
                            testID={`coach-mode-book.slot.${night.night}.${hhmm}`}
                            icon={ClockIcon}
                            label={formatTime(at, locale, tz)}
                            selected={s === pickedStart}
                            onPress={() => setPickedStart(s)}
                          />
                        );
                      })}
                    </View>
                  </>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <Card style={{ gap: space.sm }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
            {t('coaching.coach.book.student')}
          </Text>
          <Field
            testID="coach-mode-book.name"
            label={t('coaching.coach.book.name')}
            value={name}
            onChangeText={setName}
            maxLength={STUDENT_NAME_MAX}
            autoCapitalize="words"
            dense
          />
          <PhoneField
            testID="coach-mode-book.phone"
            label={t('coaching.coach.book.phone')}
            iso={iso}
            onChangeIso={setIso}
            national={national}
            onChangeNational={setNational}
            dense
          />
          {maxParty > 1 ? (
            <>
              <Text style={label}>{t('coaching.coach.book.party')}</Text>
              <SegmentedControl<number>
                testID="coach-mode-book.party"
                options={Array.from({ length: maxParty }, (_, i) => ({
                  value: i + 1,
                  label: String(i + 1),
                }))}
                value={Math.min(party, maxParty)}
                onChange={setParty}
              />
            </>
          ) : null}
          <Hint>{t('coaching.coach.book.payNote')}</Hint>
        </Card>

        {capAt ? (
          <Hint>
            {t('coaching.coach.book.cap', {
              open: isolateLtr(String(capAt.open)),
              cap: isolateLtr(String(capAt.cap)),
            })}
          </Hint>
        ) : null}
        {atCap && capAt ? (
          <ErrorText>
            {t('coaching.coach.errors.addLimitLive', { cap: isolateLtr(String(capAt.cap)) })}
          </ErrorText>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button
          testID="coach-mode-book.book"
          label={t('coaching.coach.book.book')}
          variant="cta"
          busy={book.isPending}
          disabled={!type || !allowed || atCap}
          onPress={onBook}
          style={{ marginTop: space.s }}
        />
      </ScrollView>
    </Screen>
  );
}

export default function CoachModeBookRoute() {
  return (
    <RequireCoach>
      <CoachBookScreen />
    </RequireCoach>
  );
}
