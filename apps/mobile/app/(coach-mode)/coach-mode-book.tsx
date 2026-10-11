import { useRef, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDayNumber,
  formatIQD,
  formatNumber,
  formatTimeRange,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, ErrorText, Field, Hint, LinkText, Screen } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MinusIcon,
  PersonIcon,
  PinIcon,
  PlusIcon,
} from '../../src/components/icons';
import { WheelSheet } from '../../src/components/WheelSheet';
import { PhoneField } from '../../src/components/phone';
import { DateTimeField } from '../../src/components/DateTimeField';
import { CoachBanners, SHEET_RADIUS, StepBadge } from '../../src/components/coachMode';
import { RequireCoach } from '../../src/features/coach/RequireCoach';
import { useCoachStatus } from '../../src/features/coach/CoachStatusProvider';
import { useCoachBook, useSavedStudents } from '../../src/features/coach/hooks';
import { coachErrorText, isSlotRefusal } from '../../src/features/coach/errors';
import {
  DEFAULT_TZ,
  FRIEND_NAME_MAX,
  STUDENT_NAME_MAX,
  atPrivateCap,
  bookableBranches,
  canBookOrCreate,
  cleanName,
  coachBookIntent,
  defaultStart,
  pickName,
  privateCapAt,
  snapToGrid,
  startProblem,
  typesFor,
  type CoachMe,
} from '../../src/features/coach/logic';
import { DEFAULT_ISO, composePhone, validatePhone } from '../../src/features/profile/phone';
import { useBack } from '../../src/navigation/back';
import { useBlueHeaderOptions } from '../../src/navigation/blueHeader';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { otherPersonName } from '../../src/components/fieldKeyboard';

/**
 * Book a private lesson for a student (docs/design/coaching/guest.md §4.13.6;
 * C-8, CD-1, R56): the branch (coaching on only), the private lesson type, the
 * start on the platform's date-and-time picker, the student's name and,
 * when they have one, their phone. Always paid at the desk. The answer is the
 * same whether the phone matched an account (C-21). The coach holds at most
 * its branch's `open_private_cap` upcoming lessons booked this way at that
 * branch (R56; the server counts per branch, MB-01).
 *
 * The start is any half hour on the platform's picker, as on New session
 * (owner, 2026-10-11); the server checks it when Book is tapped, and a refusal
 * shows above When.
 *
 * Laid out as coach mode is (owner, 2026-10-11, design K4): the blue bar
 * carried down into a hero holding the time being booked (and, with more than
 * one branch, the branch as a chip), then the page's ground as a
 * sheet with rounded top corners: the branch dropdown, 1 · Lesson, 2 · When
 * (the platform's date and time pills), 3 ·
 * Students (one row per person; the first student's name and phone are what is
 * booked), the cap, and a bar with the desk price and Book.
 */
/** Where a refusal shows: above When, above Students, or at the end of the form. */
type ErrorAt = 'when' | 'students' | 'form';

/** A student row's open and close, as lesson-times' rows ease. */
const EASE_MS = 220;
/** A little longer than the native animated scroll, after which the spacer goes. */
const SCROLL_MS = 340;

/** A lesson card in the Lessons carousel: wide enough for a name, narrow enough for the next to peek. */
const LESSON_CARD_W = 168;

function CoachBookScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach') return null;
  return <CoachBookBody coach={status.coach} />;
}

function CoachBookBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const headerOptions = useBlueHeaderOptions(t('coaching.coach.book.title'));
  const router = useRouter();
  const back = useBack('/coach-mode');
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const book = useCoachBook();
  // A past student picked from the saved list (0334): the name is filled in and
  // the phone stays with the server (R54); typing a phone replaces it.
  const saved = useSavedStudents(canBookOrCreate(coach));
  const savedList = saved.data ?? [];
  const [savedKey, setSavedKey] = useState<string | null>(null);

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

  // The start, on the platform's date-and-time picker as on New session
  // (owner, 2026-10-11): the server checks the coach's hours, time off, other
  // lessons and a free court when Book is tapped.
  const [openedAt] = useState(() => new Date());
  const [pickerStart, setPickerStart] = useState<Date>(() => defaultStart(openedAt, 0, tz));

  const [name, setName] = useState('');
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [party, setParty] = useState(1);
  // A refusal shows above the card it is about, and the page scrolls to it:
  // the student's name or phone over Students, the time over When, anything
  // else at the end of the form.
  const [error, setErrorState] = useState<{ text: string; at: ErrorAt } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const sheetY = useRef(0);
  const cardY = useRef<Record<ErrorAt, number>>({ when: 0, students: 0, form: 0 });
  const setError = (text: string | null, at: ErrorAt = 'form', row = 1) => {
    if (text === null) {
      setErrorState(null);
      return;
    }
    setErrorState({ text, at });
    if (at === 'students') setOpenRow(row);
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({
        y: Math.max(0, sheetY.current + cardY.current[at] - 24),
        animated: true,
      }),
    );
  };
  const errorAt = (at: ErrorAt) => (error?.at === at ? <ErrorText>{error.text}</ErrorText> : null);

  const maxParty = Math.max(1, Math.min(4, type?.maxPlaces ?? 1));
  const onBook = () => {
    if (!type || !venueId || !allowed || atCap) return;
    const clean = cleanName(name);
    if (!clean) {
      setError(t('coaching.coach.add.nameRequired'), 'students');
      return;
    }
    // The phone is required (owner, 2026-10-11): it is how the lesson reaches
    // the student's own account (a verified account with that phone is linked,
    // C-21). A saved student's is on file with the server (0334), never here.
    let phone: string | null = null;
    if (!savedKey && !national.trim()) {
      setError(t('coaching.coach.book.phoneRequired'), 'students');
      return;
    }
    if (national.trim()) {
      if (validatePhone(iso, national) !== null) {
        setError(t('coaching.coach.book.phoneInvalid'), 'students');
        return;
      }
      phone = composePhone(iso, national);
    }
    // The other students (0334): a row left empty is only a place; a phone
    // needs a name.
    const friends: { name: string; phone: string }[] = [];
    for (let n = 2; n <= Math.min(party, maxParty); n++) {
      const who = student(n);
      const friend = cleanName(who.name);
      const typed = who.national.trim();
      if (!friend && !typed) continue;
      if (!friend) {
        setError(t('coaching.coach.book.friendNameRequired'), 'students', n);
        return;
      }
      if (typed && validatePhone(who.iso, who.national) !== null) {
        setError(t('coaching.coach.book.phoneInvalid'), 'students', n);
        return;
      }
      friends.push({ name: friend, phone: typed ? composePhone(who.iso, who.national) : '' });
    }
    const startAt = pickerStart.toISOString();
    const p = startProblem(pickerStart, { tz, now: new Date() });
    if (p) {
      setError(
        t(p === 'grid' ? 'coaching.coach.new.notOnGrid' : 'coaching.coach.new.past'),
        'when',
      );
      return;
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
        friends,
        savedStudent: savedKey,
        intent: coachBookIntent({
          typeId: type.id,
          venueId,
          startAt,
          party: partySize,
          name: clean,
          phone,
          friends,
          savedStudent: savedKey,
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
          // A start the server refuses (taken, outside hours, no court) shows over When.
          setError(
            coachErrorText(err, t, { locale, privateCap: capAt?.cap ?? null }),
            isSlotRefusal(err) ? 'when' : 'form',
          );
        },
      },
    );
  };

  const branch = branches.find((b) => b.venueId === venueId) ?? null;
  const branchName = branch ? pickName(branch.nameEn, branch.nameAr, locale) : '';
  const typeName = (lt: { nameEn: string; nameAr: string }) =>
    pickName(lt.nameEn, lt.nameAr, locale);
  const minutes = (n: number) =>
    t('coaching.common.durationMin', { minutes: isolateLtr(String(n)) });

  // The start the hero shows.
  const startAt: Date | null = pickerStart;
  const endAt = startAt && type ? new Date(startAt.getTime() + type.durationMin * 60_000) : null;

  const pickBranch = (v: string) => {
    if (v === venueId) return;
    setPickedVenue(v);
    setPickedType(null);
  };
  const pickType = (id: string) => {
    setPickedType(id);
    setParty(1);
  };

  // The branch wheel's turn is staged until Done.
  const [sheet, setSheet] = useState<'branch' | 'saved' | null>(null);
  const [staged, setStaged] = useState('');
  const openSheet = (which: 'branch' | 'saved', value: string) => {
    setStaged(value);
    setSheet(which);
  };
  const confirmSheet = () => {
    if (sheet === 'branch') pickBranch(staged);
    if (sheet === 'saved') {
      const pick = savedList.find((x) => x.key === staged);
      if (pick) {
        setSavedKey(pick.key);
        setName(pick.name);
        setNational('');
        if (error?.at === 'students') setError(null);
      }
    }
    setSheet(null);
  };

  // One row per person (owner, 2026-10-11), each with a name and a phone, one
  // row open at a time. Only the first student's are booked: the others are
  // kept on the screen and count toward the party until a booking can carry
  // them.
  const people = Math.min(party, maxParty);
  const [openRow, setOpenRow] = useState<number | null>(1);
  type Extra = { name: string; iso: string; national: string };
  const [extras, setExtras] = useState<Record<number, Extra>>({});
  const student = (n: number): Extra =>
    n === 1 ? { name, iso, national } : (extras[n] ?? { name: '', iso: DEFAULT_ISO, national: '' });
  const setStudent = (n: number, patch: Partial<Extra>) => {
    if (n === 1) {
      // A new name is a new student: drop the saved one, or the lesson would
      // go to their phone under someone else's name. Re-picking restores it.
      if (patch.name !== undefined) {
        setName(patch.name);
        setSavedKey(null);
      }
      if (patch.iso !== undefined) setIso(patch.iso);
      if (patch.national !== undefined) setNational(patch.national);
      return;
    }
    setExtras((e) => ({ ...e, [n]: { ...student(n), ...e[n], ...patch } }));
  };
  // A student row opening or closing, and a row added or taken away, ease
  // (the height, the fields fading), as lesson-times' rows do; under Reduce
  // Motion they land at once.
  const reduceMotion = useReduceMotion();
  const ease = () => {
    if (reduceMotion) return;
    LayoutAnimation.configureNext(
      LayoutAnimation.create(EASE_MS, LayoutAnimation.Types.easeInEaseOut, 'opacity'),
    );
  };

  // Closing near the bottom of the page would shorten it in one go and snap
  // the scroll offset (the page jumped). So, in the same moment the row closes
  // (the native ease, as opening), a spacer of the fields' height holds the
  // page's length while the page glides up by that height; once the glide
  // ends the spacer, by then below the screen, goes. Elsewhere it just closes.
  const fieldsH = useRef(0);
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const [closing, setClosing] = useState(false);
  const [spacer, setSpacer] = useState(0);
  // The page losing `height` (a row closing, a student taken away) eases; near
  // the bottom it glides up by that height in the same moment, a spacer holding
  // its length until the glide ends.
  const shrink = (height: number, apply: () => void) => {
    ease();
    const endAfter = Math.max(0, contentH.current - height - viewportH.current);
    apply();
    if (reduceMotion || scrollY.current <= endAfter + 1) return;
    setClosing(true);
    setSpacer(height);
    scroll.current?.scrollTo({ y: endAfter, animated: true });
    setTimeout(() => {
      setSpacer(0);
      setClosing(false);
    }, SCROLL_MS);
  };
  const toggleRow = (n: number, expanded: boolean) => {
    if (!expanded) {
      ease();
      setOpenRow(n);
      return;
    }
    shrink(fieldsH.current, () => setOpenRow(null));
  };
  // Each student row's height (with its fields when open), for taking one away.
  const rowH = useRef<Record<number, number>>({});
  const removeStudent = () => {
    if (people <= 1) return;
    // The row and the card's 10 gap above it.
    shrink((rowH.current[people] ?? 48) + 10, () => {
      if (openRow === people) setOpenRow(null);
      setParty(people - 1);
    });
  };

  const card = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: 14,
    gap: 10,
  } as const;
  const stepTitle = { fontFamily: fonts.body800, fontSize: 14, color: colors.ink } as const;
  const heroChip = (selected: boolean, pressed: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    height: 34,
    paddingStart: 14,
    paddingEnd: 14,
    borderRadius: radius.pill,
    backgroundColor: selected ? colors.card : brand.navyLine,
    opacity: pressed ? 0.85 : 1,
  });

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen options={headerOptions} />
      <ScrollView
        ref={scroll}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_, h) => {
          contentH.current = h;
        }}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The hero: the bar's blue carried down, holding the time being booked. */}
        <View
          style={{
            backgroundColor: brand.blue,
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: space.s,
            paddingBottom: space.l + SHEET_RADIUS,
            gap: space.sm,
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
          <View
            testID="coach-mode-book.summary"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: brand.navyLine,
              borderRadius: 18,
              paddingStart: space.m,
              paddingEnd: space.m,
              paddingTop: 14,
              paddingBottom: 14,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: brand.green,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {startAt ? (
                <>
                  <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: brand.greenInk }}>
                    {formatWeekdayShort(startAt, locale, tz)}
                  </Text>
                  <Text
                    style={{ fontFamily: fonts.display800, fontSize: 18, color: brand.greenInk }}
                  >
                    {formatDayNumber(startAt, locale, tz)}
                  </Text>
                </>
              ) : (
                <CalendarIcon size={22} color={brand.greenInk} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: fonts.display800, fontSize: 22, color: brand.white }}
              >
                {startAt && endAt
                  ? isolateLtr(formatTimeRange(startAt, endAt, locale, tz))
                  : t('coaching.coach.book.pickTime')}
              </Text>
              {type ? (
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: fonts.body600,
                    fontSize: 12.5,
                    color: brand.white,
                    opacity: 0.8,
                  }}
                >
                  {[
                    isolate(typeName(type)),
                    minutes(type.durationMin),
                    branchName && isolate(branchName),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
          {/* The chip row keeps its height whether or not the branch chip is in it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 34, gap: 6 }}>
            <View style={{ flex: 1 }} />
            {branches.length > 1 && branch ? (
              <Pressable
                testID="coach-mode-book.branch-chip"
                accessibilityRole="button"
                accessibilityLabel={`${t('coaching.coach.book.branch')}: ${branchName}`}
                onPress={() => openSheet('branch', branch.venueId)}
                style={({ pressed }) => heroChip(false, pressed)}
              >
                <PinIcon size={14} color={brand.green} strokeWidth={2.2} />
                <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: brand.white }}>
                  {isolate(branchName)}
                </Text>
                <ChevronDownIcon size={12} color={brand.white} strokeWidth={2.6} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* The sheet: the page's own ground, rounded where it meets the blue. */}
        <View
          onLayout={(e) => {
            sheetY.current = e.nativeEvent.layout.y;
          }}
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
          <CoachBanners testID="coach-mode-book.banner" coach={coach} />
          {!allowed ? <Hint>{t('coaching.coach.book.unavailable')}</Hint> : null}

          {branches.length > 1 && branch ? (
            <Pressable
              testID="coach-mode-book.branch"
              accessibilityRole="button"
              accessibilityLabel={`${t('coaching.coach.book.branch')}: ${branchName}`}
              onPress={() => openSheet('branch', branch.venueId)}
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
                {t('coaching.coach.book.branch')}
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
                {isolate(branchName)}
              </Text>
              <ChevronDownIcon size={16} color={colors.mut} strokeWidth={2.4} />
            </Pressable>
          ) : null}

          {/* 1 · Lesson */}
          <View testID="coach-mode-book.type" style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <StepBadge n={1} />
              <Text style={stepTitle}>{t('coaching.coach.book.type')}</Text>
            </View>
            {types.length === 0 ? <Hint>{t('coaching.coach.book.noTypes')}</Hint> : null}
            {types.length > 0 ? (
              // A carousel of cards running to the card's edges, the next one
              // peeking in, each snapping into place.
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={LESSON_CARD_W + space.s}
                decelerationRate="fast"
                style={{ marginStart: -14, marginEnd: -14 }}
                contentContainerStyle={{ paddingStart: 14, paddingEnd: 14, gap: space.s }}
              >
                {types.map((lt) => {
                  const selected = lt.id === type?.id;
                  return (
                    <Pressable
                      key={lt.id}
                      testID={`coach-mode-book.type.${lt.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => pickType(lt.id)}
                      style={({ pressed }) => ({
                        width: LESSON_CARD_W,
                        minHeight: 104,
                        borderRadius: radius.button,
                        borderWidth: 2,
                        borderColor: selected ? brand.green : 'transparent',
                        padding: 12,
                        gap: 6,
                        justifyContent: 'space-between',
                        backgroundColor: selected
                          ? colors.tint
                          : pressed
                            ? colors.line
                            : colors.sub,
                      })}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: fonts.display800,
                            fontSize: 20,
                            color: colors.ink,
                          }}
                        >
                          {minutes(lt.durationMin)}
                        </Text>
                        {selected ? (
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: brand.green,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <CheckIcon size={14} color={brand.greenInk} strokeWidth={3} />
                          </View>
                        ) : (
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              borderWidth: 2,
                              borderColor: colors.line2,
                            }}
                          />
                        )}
                      </View>
                      <View style={{ gap: 2 }}>
                        <Text
                          numberOfLines={1}
                          style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}
                        >
                          {isolate(typeName(lt))}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut2 }}
                        >
                          {t('coaching.coach.book.upTo', {
                            people: countPhrase(
                              'coaching.coach.count.people',
                              lt.maxPlaces,
                              locale,
                            ),
                          })}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          {/* 2 · When: the platform's date and time, as on New session. */}
          {type && allowed ? (
            <View
              style={{ gap: space.s }}
              onLayout={(e) => {
                cardY.current.when = e.nativeEvent.layout.y;
              }}
            >
              {errorAt('when')}
              <View style={card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <StepBadge n={2} />
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      testID="coach-mode-book.start"
                      label={t('coaching.coach.new.when')}
                      mode="datetime"
                      timeZone={tz}
                      minuteInterval={30}
                      snap={(d) => snapToGrid(d, tz)}
                      minimumDate={new Date()}
                      value={pickerStart}
                      onChange={(d) => {
                        setPickerStart(d);
                        if (error?.at === 'when') setError(null);
                      }}
                    />
                  </View>
                </View>
              </View>
            </View>
          ) : null}

          {/* 3 · Students: one row per person, the counter adding and removing rows. */}
          <View
            style={{ gap: space.s }}
            onLayout={(e) => {
              cardY.current.students = e.nativeEvent.layout.y;
            }}
          >
            {errorAt('students')}
            <View style={card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <StepBadge n={type && allowed ? 3 : 2} />
                <Text style={[stepTitle, { flex: 1 }]}>{t('coaching.coach.book.students')}</Text>
                {maxParty > 1 ? (
                  <View
                    testID="coach-mode-book.party"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      backgroundColor: colors.sub,
                      borderRadius: 10,
                      padding: 3,
                    }}
                  >
                    <Pressable
                      testID="coach-mode-book.party.minus"
                      accessibilityRole="button"
                      accessibilityLabel="−"
                      disabled={people <= 1 || closing}
                      onPress={removeStudent}
                      style={({ pressed }) => ({
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        backgroundColor: colors.card,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: people <= 1 ? 0.4 : pressed ? 0.7 : 1,
                      })}
                    >
                      <MinusIcon size={14} color={colors.ink} strokeWidth={2.6} />
                    </Pressable>
                    <Text
                      // The number alone on screen; a screen reader hears "2 people".
                      accessibilityLabel={countPhrase(
                        'coaching.coach.count.people',
                        people,
                        locale,
                      )}
                      style={{
                        minWidth: 16,
                        textAlign: 'center',
                        fontFamily: fonts.body800,
                        fontSize: 14,
                        color: colors.ink,
                      }}
                    >
                      {isolateLtr(formatNumber(people, locale))}
                    </Text>
                    <Pressable
                      testID="coach-mode-book.party.plus"
                      accessibilityRole="button"
                      accessibilityLabel="+"
                      disabled={people >= maxParty}
                      onPress={() => {
                        ease();
                        setParty(Math.min(maxParty, people + 1));
                      }}
                      style={({ pressed }) => ({
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        backgroundColor: colors.card,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: people >= maxParty ? 0.4 : pressed ? 0.7 : 1,
                      })}
                    >
                      <PlusIcon size={14} color={colors.ink} strokeWidth={2.6} />
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {Array.from({ length: people }, (_, i) => i + 1).map((n) => {
                const open = openRow === n;
                const expanded = open && !closing;
                const who = student(n);
                const value = cleanName(who.name);
                return (
                  <View
                    key={n}
                    onLayout={(e) => {
                      rowH.current[n] = e.nativeEvent.layout.height;
                    }}
                    style={{
                      borderWidth: expanded ? 2 : 1,
                      borderColor: expanded ? brand.green : colors.line,
                      borderRadius: radius.button,
                      overflow: 'hidden',
                    }}
                  >
                    <Pressable
                      testID={`coach-mode-book.student.${n}`}
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      disabled={closing}
                      onPress={() => toggleRow(n, expanded)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        height: 48,
                        paddingStart: 12,
                        paddingEnd: 12,
                        backgroundColor: expanded
                          ? colors.tint
                          : pressed
                            ? colors.sub
                            : colors.card,
                      })}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 9,
                          backgroundColor: colors.gtint,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <PersonIcon size={16} color={colors.gstrong} strokeWidth={2.2} />
                      </View>
                      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut }}>
                        {t('coaching.coach.book.studentN', { n: isolateLtr(String(n)) })}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <>
                        <Text
                          numberOfLines={1}
                          style={{
                            flexShrink: 1,
                            fontFamily: value ? fonts.body800 : fonts.body700,
                            fontSize: 14,
                            color: value ? colors.ink : colors.fnt2,
                          }}
                        >
                          {value ? isolate(value) : t('coaching.coach.book.addName')}
                        </Text>
                        {expanded ? (
                          <ChevronUpIcon size={16} color={colors.mut} strokeWidth={2.4} />
                        ) : (
                          <ChevronDownIcon size={16} color={colors.mut} strokeWidth={2.4} />
                        )}
                      </>
                    </Pressable>
                    {open ? (
                      <View
                        onLayout={(e) => {
                          fieldsH.current = e.nativeEvent.layout.height;
                        }}
                        style={{ padding: 12, paddingTop: 10, gap: 8 }}
                      >
                        {n === 1 && savedList.length > 0 ? (
                          <Pressable
                            testID="coach-mode-book.saved"
                            accessibilityRole="button"
                            onPress={() => openSheet('saved', savedKey ?? savedList[0]!.key)}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 10,
                              height: 44,
                              paddingStart: 12,
                              paddingEnd: 12,
                              borderRadius: radius.cell,
                              backgroundColor: pressed ? colors.line : colors.sub,
                            })}
                          >
                            <PersonIcon size={16} color={colors.gstrong} strokeWidth={2.2} />
                            <Text
                              style={{
                                flex: 1,
                                fontFamily: fonts.body700,
                                fontSize: 13.5,
                                color: colors.ink,
                              }}
                            >
                              {t('coaching.coach.book.saved')}
                            </Text>
                            <ChevronDownIcon size={16} color={colors.mut} strokeWidth={2.4} />
                          </Pressable>
                        ) : null}
                        <Field
                          {...otherPersonName}
                          testID={n === 1 ? 'coach-mode-book.name' : `coach-mode-book.name.${n}`}
                          label={t('coaching.coach.book.name')}
                          value={who.name}
                          onChangeText={(v) => setStudent(n, { name: v })}
                          maxLength={n === 1 ? STUDENT_NAME_MAX : FRIEND_NAME_MAX}
                          autoCapitalize="words"
                          dense
                        />
                        {n === 1 && savedKey && !national ? (
                          <View
                            testID="coach-mode-book.phone-on-file"
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 10,
                              minHeight: 44,
                              paddingStart: 12,
                              paddingEnd: 12,
                              borderRadius: radius.cell,
                              backgroundColor: colors.gtint,
                            }}
                          >
                            <CheckIcon size={16} color={colors.gtext} strokeWidth={2.6} />
                            <Text
                              style={{
                                flex: 1,
                                fontFamily: fonts.body700,
                                fontSize: 13.5,
                                color: colors.gtext,
                              }}
                            >
                              {t('coaching.coach.book.phoneOnFile')}
                            </Text>
                            <LinkText
                              testID="coach-mode-book.phone-change"
                              label={t('coaching.coach.book.change')}
                              onPress={() => setSavedKey(null)}
                            />
                          </View>
                        ) : (
                          <PhoneField
                            testID={
                              n === 1 ? 'coach-mode-book.phone' : `coach-mode-book.phone.${n}`
                            }
                            label={t(
                              n === 1
                                ? 'coaching.coach.book.phone'
                                : 'coaching.coach.book.phoneOptional',
                            )}
                            iso={who.iso}
                            onChangeIso={(v) => setStudent(n, { iso: v })}
                            national={who.national}
                            onChangeNational={(v) => setStudent(n, { national: v })}
                            dense
                          />
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          {capAt ? (
            <View testID="coach-mode-book.cap" style={{ gap: 6, paddingStart: 4, paddingEnd: 4 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.mut }}>
                {t('coaching.coach.book.cap', {
                  open: isolateLtr(String(capAt.open)),
                  cap: isolateLtr(String(capAt.cap)),
                })}
              </Text>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: colors.seg,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${Math.min(100, Math.round((capAt.open / Math.max(1, capAt.cap)) * 100))}%`,
                    height: '100%',
                    backgroundColor: atCap ? colors.danger : colors.blue,
                  }}
                />
              </View>
            </View>
          ) : null}
          {atCap && capAt ? (
            <ErrorText>
              {t('coaching.coach.errors.addLimitLive', { cap: isolateLtr(String(capAt.cap)) })}
            </ErrorText>
          ) : null}
          <View
            onLayout={(e) => {
              cardY.current.form = e.nativeEvent.layout.y;
            }}
          >
            {errorAt('form')}
          </View>
          {spacer > 0 ? <View style={{ height: spacer }} /> : null}
        </View>
      </ScrollView>

      {/* The bar under the form: paid at the desk, the price, and Book. */}
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
          <View testID="coach-mode-book.price">
            <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: colors.mut }}>
              {t('coaching.coach.book.payShort')}
            </Text>
            <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.gtext }}>
              {type.priceIqd !== null
                ? isolateLtr(formatIQD(type.priceIqd, locale))
                : t('coaching.coach.new.priceNone')}
            </Text>
          </View>
        ) : null}
        <Button
          testID="coach-mode-book.book"
          label={t('coaching.coach.book.book')}
          variant="cta"
          busy={book.isPending}
          disabled={!type || !allowed || atCap}
          onPress={onBook}
          style={{ flex: 1 }}
        />
      </View>

      {branches.length > 1 ? (
        <WheelSheet<string>
          testID="coach-mode-book.branch-sheet"
          visible={sheet === 'branch'}
          title={t('coaching.coach.book.branch')}
          options={branches.map((b) => ({
            value: b.venueId,
            label: pickName(b.nameEn, b.nameAr, locale),
          }))}
          value={staged}
          onChange={setStaged}
          confirmLabel={t('common.done')}
          onConfirm={confirmSheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {savedList.length > 0 ? (
        <WheelSheet<string>
          testID="coach-mode-book.saved-sheet"
          visible={sheet === 'saved'}
          title={t('coaching.coach.book.saved')}
          options={savedList.map((x) => ({ value: x.key, label: x.name }))}
          value={staged}
          onChange={setStaged}
          confirmLabel={t('common.done')}
          onConfirm={confirmSheet}
          onClose={() => setSheet(null)}
        />
      ) : null}
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
