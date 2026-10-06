/**
 * Coach mode's pieces (docs/design/coaching/guest.md §4.13): the banners, a
 * schedule row, a roster row, a weekday's hours, a time-off row, a statement
 * card and the inline reason card. Coach-mode only; the guest lane's
 * `components/coaching.tsx` holds the guest's cards.
 *
 * Every interactive piece takes a REQUIRED `testID` and forwards
 * `${testID}.<child>` explicitly (the testID lint lists them in
 * packages/config/src/eslint.js). Names go through `isolate`; counts, phones
 * and "3/8" through `isolateLtr`; times through `formatTime`; money through
 * `formatIQD`. Colours come from the theme tokens only.
 */
import { Image, Pressable, Switch, View } from 'react-native';
import {
  countPhrase,
  formatDate,
  formatIQD,
  formatTime,
  formatTimeRange,
  isolate,
  isolateLtr,
  type Locale,
  type MessageKey,
} from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { Button, Field, LinkText, SegmentedControl } from './ui';
import { ChevronIcon, PhoneIcon, TrashIcon } from './icons';
import { DateTimeField } from './DateTimeField';
import {
  belowMinimum,
  branchesOff,
  canMarkNow,
  hhmmOf,
  minutesOf,
  pickName,
  sharePercent,
  type Attendance,
  type CancelReasonCode,
  type CoachMe,
  type CoachStatement,
  type HoursWindow,
  type RosterEntry,
  type ScheduleLesson,
  type TimeOffEntry,
} from '../features/coach/logic';

// ── The coach's card ────────────────────────────────────────────────────────

/** The coach's photo, or their initial on a tint when there is none. */
export function CoachAvatar({
  name,
  photoUrl,
  size = 44,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const { colors, fonts } = useTheme();
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.sub }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.display800, fontSize: size * 0.42, color: colors.blue }}>
        {name.trim().charAt(0).toUpperCase() || '·'}
      </Text>
    </View>
  );
}

// ── Banners (guest.md §4.13.1) ──────────────────────────────────────────────

/**
 * Paused (R16), switched off at a branch (R45, one line per branch), and not
 * public yet (R61, with Review when the screen can open the accept sheet).
 * `testID` is `<route>.banner`.
 */
export function CoachBanners({
  testID,
  coach,
  onReview,
}: {
  testID: string;
  coach: CoachMe;
  onReview?: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const off = branchesOff(coach);
  const body = { fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 18 } as const;
  const amber = { backgroundColor: colors.amb, borderColor: colors.ambline } as const;
  const box = {
    borderWidth: 1,
    borderRadius: radius.cell,
    paddingStart: space.m,
    paddingEnd: space.m,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 6,
  } as const;
  if (coach.status !== 'paused' && off.length === 0 && coach.publicAccepted) return null;
  return (
    <View style={{ gap: space.s }}>
      {coach.status === 'paused' ? (
        <View testID={`${testID}.paused`} style={[box, amber]}>
          <Text style={[body, { color: colors.ambtext }]}>{t('coaching.coach.banner.paused')}</Text>
        </View>
      ) : null}
      {off.length > 0 ? (
        <View testID={`${testID}.off`} style={[box, amber]}>
          {off.map((b) => (
            <Text
              key={b.venueId}
              testID={`${testID}.off.${b.venueId}`}
              style={[body, { color: colors.ambtext }]}
            >
              {t('coaching.coach.banner.off', {
                branch: isolate(pickName(b.nameEn, b.nameAr, locale)),
              })}
            </Text>
          ))}
        </View>
      ) : null}
      {!coach.publicAccepted ? (
        <View
          testID={`${testID}.not-public`}
          style={[box, { backgroundColor: colors.tint, borderColor: colors.line }]}
        >
          <Text style={[body, { color: colors.mut2 }]}>{t('coaching.coach.banner.notPublic')}</Text>
          {onReview ? (
            <LinkText
              testID={`${testID}.accept`}
              label={t('coaching.coach.banner.review')}
              onPress={onReview}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── A small tag ─────────────────────────────────────────────────────────────

function Tag({
  label,
  tone,
}: {
  label: string;
  tone: 'amber' | 'blue' | 'red' | 'muted' | 'green';
}) {
  const { colors, fonts } = useTheme();
  const palette = {
    amber: { bg: colors.amb, fg: colors.ambtext },
    blue: { bg: colors.tint, fg: colors.blue },
    red: { bg: colors.redtint, fg: colors.redtext },
    muted: { bg: colors.sub, fg: colors.mut },
    green: { bg: colors.gtint, fg: colors.gtext },
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingStart: 8,
        paddingEnd: 8,
        paddingTop: 3,
        paddingBottom: 3,
        borderRadius: radius.pill,
        backgroundColor: palette.bg,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 11, color: palette.fg }}>{label}</Text>
    </View>
  );
}

// ── The schedule (guest.md §4.13.2) ─────────────────────────────────────────

/** A trading night's heading: "Today", "Tomorrow", "Thu 9 Oct". */
export function NightHeader({ label }: { label: string }) {
  const { colors, fonts, tracking } = useTheme();
  return (
    <View
      style={{ paddingTop: space.m, paddingBottom: 6, paddingStart: 4, backgroundColor: colors.bg }}
    >
      <Text
        style={{
          fontFamily: fonts.display800,
          fontSize: 11,
          letterSpacing: tracking(0.6),
          textTransform: 'uppercase',
          color: colors.fnt,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The kind line of a lesson: "Private · 2 people", "Group · 5/8", "Course · session 3 of 8". */
export function kindLine(
  l: Pick<ScheduleLesson, 'kind' | 'placesTaken' | 'maxPlaces' | 'sessionNo' | 'sessionsCount'>,
  t: ReturnType<typeof useLocale>['t'],
  locale: Locale,
): string {
  if (l.kind === 'private') {
    return t('coaching.coach.row.private', {
      people: countPhrase('coaching.coach.count.people', Math.max(1, l.placesTaken), locale),
    });
  }
  if (l.kind === 'group') {
    return t('coaching.coach.row.group', {
      taken: isolateLtr(String(l.placesTaken)),
      max: isolateLtr(String(l.maxPlaces)),
    });
  }
  return t('coaching.coach.row.course', {
    n: isolateLtr(String(l.sessionNo ?? 1)),
    total: isolateLtr(String(l.sessionsCount ?? 1)),
  });
}

/** One lesson in the schedule, the coach's variant of LessonRow. Opens its roster. */
export function CoachLessonRow({
  testID,
  lesson,
  tz,
  now,
  onPress,
}: {
  testID: string;
  lesson: ScheduleLesson;
  tz: string;
  now: Date;
  onPress: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const cancelled = lesson.status === 'cancelled' || lesson.status === 'expired';
  const type = pickName(lesson.typeNameEn, lesson.typeNameAr, locale);
  const title = pickName(lesson.titleEn, lesson.titleAr, locale);
  const court = pickName(lesson.courtNameEn, lesson.courtNameAr, locale);
  const toMark =
    lesson.unmarked > 0 && canMarkNow({ startAt: lesson.startAt }, now) && !cancelled
      ? lesson.unmarked
      : 0;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 12,
        paddingBottom: 12,
        marginBottom: space.s,
        opacity: cancelled ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.body800,
            fontSize: 14,
            color: colors.ink,
            textDecorationLine: cancelled ? 'line-through' : 'none',
          }}
        >
          {`${formatTimeRange(new Date(lesson.startAt), new Date(lesson.endAt), locale, tz)} · ${isolate(title || type)}`}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut2 }}
        >
          {kindLine(lesson, t, locale)}
          {court ? ` · ${isolate(court)}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {cancelled ? <Tag label={t('coaching.coach.row.cancelled')} tone="red" /> : null}
          {lesson.status === 'held' ? (
            <Tag label={t('coaching.coach.row.awaitingPayment')} tone="muted" />
          ) : null}
          {belowMinimum(lesson, now) ? (
            <Tag label={t('coaching.coach.row.belowMinimum')} tone="amber" />
          ) : null}
          {toMark > 0 ? (
            <Tag
              label={t('coaching.coach.row.toMark', { count: isolateLtr(String(toMark)) })}
              tone="blue"
            />
          ) : null}
        </View>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

/** Time off as a band in the schedule (not pressable: it is edited under Hours and time off). */
export function TimeOffBand({
  testID,
  startsAt,
  endsAt,
  tz,
}: {
  testID: string;
  startsAt: string;
  endsAt: string;
  tz: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const from = new Date(startsAt);
  const to = new Date(endsAt);
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius.cell,
        backgroundColor: colors.sub,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.line2,
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: 8,
        paddingBottom: 8,
        marginBottom: space.s,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut }}>
        {t('coaching.coach.row.timeOffBand', {
          from: isolate(`${formatDate(from, locale, tz)} ${formatTime(from, locale, tz)}`),
          to: isolate(`${formatDate(to, locale, tz)} ${formatTime(to, locale, tz)}`),
        })}
      </Text>
    </View>
  );
}

// ── The roster (guest.md §4.13.4) ───────────────────────────────────────────

type MarkValue = Attendance | 'none';

/**
 * One student. The name and phone are the server's (R44: typed for a coach-
 * or desk-booked row); the phone shows while the server sends it (R54, P13).
 * The attendance control is editable from the start until `mark_until`
 * (CD-11), read-only after, hidden before.
 */
export function RosterRow({
  testID,
  entry,
  markMode,
  marking,
  showMenu,
  onCall,
  onMark,
  onMenu,
}: {
  testID: string;
  entry: RosterEntry;
  markMode: 'hidden' | 'edit' | 'readonly';
  marking: boolean;
  showMenu: boolean;
  onCall: (phone: string) => void;
  onMark: (value: Attendance | 'clear') => void;
  onMenu: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const friends = entry.partySize > 1 ? entry.partySize - 1 : 0;
  const bookedBy =
    entry.bookedBy === 'coach'
      ? t('coaching.coach.roster.bookedByCoach')
      : entry.bookedBy === 'staff'
        ? t('coaching.coach.roster.bookedByStaff')
        : t('coaching.coach.roster.bookedByGuest');
  const pay =
    entry.status === 'held'
      ? t('coaching.coach.roster.held')
      : entry.paymentMode === 'online'
        ? t('coaching.coach.roster.paidOnline')
        : t('coaching.coach.roster.payDesk');
  const mark: MarkValue = entry.attendance ?? 'none';
  const markLabel =
    mark === 'attended'
      ? t('coaching.coach.roster.attended')
      : mark === 'no_show'
        ? t('coaching.coach.roster.noShow')
        : t('coaching.coach.roster.notMarked');
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 12,
        paddingBottom: 12,
        marginBottom: space.s,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}
          >
            {isolate(entry.name)}
            {friends > 0
              ? ` ${t('coaching.coach.roster.friends', { count: isolateLtr(String(friends)) })}`
              : ''}
          </Text>
          {entry.friendNames.length > 0 ? (
            <Text
              numberOfLines={2}
              style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}
            >
              {t('coaching.coach.roster.friendNames', {
                names: entry.friendNames.map((n) => isolate(n)).join(locale === 'ar' ? '، ' : ', '),
              })}
            </Text>
          ) : null}
          <Text
            style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.mut2 }}
          >{`${bookedBy} · ${pay}`}</Text>
        </View>
        {showMenu ? (
          <Pressable
            testID={`${testID}.menu`}
            accessibilityRole="button"
            accessibilityLabel={t('coaching.coach.roster.menu')}
            onPress={onMenu}
            hitSlop={8}
            style={({ pressed }) => ({
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: radius.cell,
              backgroundColor: pressed ? colors.sub : 'transparent',
            })}
          >
            <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.mut }}>
              {'···'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {entry.phone ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}>
            {isolateLtr(entry.phone)}
          </Text>
          <Pressable
            testID={`${testID}.call`}
            accessibilityRole="button"
            accessibilityLabel={t('coaching.coach.roster.call')}
            onPress={() => onCall(entry.phone!)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingStart: 12,
              paddingEnd: 12,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.gline : colors.gtint,
            })}
          >
            <PhoneIcon size={13} color={colors.gstrong} />
            <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.gtext }}>
              {t('coaching.coach.roster.call')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {markMode === 'edit' && entry.status === 'booked' ? (
        <View style={{ opacity: marking ? 0.6 : 1 }}>
          <SegmentedControl<MarkValue>
            testID={`${testID}.mark`}
            options={[
              { value: 'none', label: t('coaching.coach.roster.notMarked') },
              { value: 'attended', label: t('coaching.coach.roster.attended') },
              { value: 'no_show', label: t('coaching.coach.roster.noShow') },
            ]}
            value={mark}
            onChange={(next) => {
              if (marking || next === mark) return;
              onMark(next === 'none' ? 'clear' : next);
            }}
          />
        </View>
      ) : markMode === 'readonly' && entry.status === 'booked' ? (
        <Tag
          label={markLabel}
          tone={mark === 'attended' ? 'green' : mark === 'no_show' ? 'red' : 'muted'}
        />
      ) : null}
    </View>
  );
}

// ── Reasons (guest.md §4.13.4, U4) ──────────────────────────────────────────

const REASON_LABEL: Record<CancelReasonCode, MessageKey> = {
  customer_request: 'coaching.coach.reasons.customerRequest',
  duplicate: 'coaching.coach.reasons.duplicate',
  coach_unavailable: 'coaching.coach.reasons.coachUnavailable',
  other: 'coaching.coach.reasons.other',
  court_needed: 'coaching.coach.reasons.other',
  staff_error: 'coaching.coach.reasons.other',
};

/**
 * The inline reason card for a removal or a cancel: Android's `Alert` holds
 * three buttons and no field, so the reason and its note are picked here,
 * then the action's own confirmation follows.
 */
export function ReasonCard({
  testID,
  title,
  codes,
  code,
  onCode,
  note,
  onNote,
  onContinue,
  onBack,
  busy,
}: {
  testID: string;
  title: string;
  codes: readonly CancelReasonCode[];
  code: CancelReasonCode;
  onCode: (code: CancelReasonCode) => void;
  note: string;
  onNote: (note: string) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.l,
        gap: space.sm,
      }}
    >
      <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>{title}</Text>
      <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
        {t('coaching.coach.reasons.title')}
      </Text>
      <SegmentedControl<CancelReasonCode>
        testID={`${testID}.code`}
        options={codes.map((c) => ({ value: c, label: t(REASON_LABEL[c]) }))}
        value={code}
        onChange={onCode}
      />
      <Field
        testID={`${testID}.note`}
        label={t('coaching.coach.reasons.note')}
        value={note}
        onChangeText={onNote}
        maxLength={200}
        dense
      />
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.back`}
          label={t('coaching.coach.reasons.back')}
          variant="secondary"
          size="compact"
          onPress={onBack}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.continue`}
          label={t('coaching.coach.reasons.continue')}
          variant="danger"
          size="compact"
          busy={busy}
          onPress={onContinue}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// ── Hours (guest.md §4.13.3) ────────────────────────────────────────────────

/** A window being edited, with the key React lists it by and its pre-check error. */
export interface EditableWindow extends HoursWindow {
  key: string;
  error?: string | null;
}

/** A wall-clock 'HH:MM' as a Date the time picker shows in UTC (the zone does not matter for a weekly time). */
export function timeAsDate(hhmm: string): Date {
  const m = minutesOf(hhmm);
  const mins = Number.isFinite(m) ? Math.min(m, 1439) : 9 * 60;
  return new Date(Date.UTC(2000, 0, 1, Math.floor(mins / 60), mins % 60));
}

/** A picked time back to 'HH:MM' on the half-hour grid (Android's clock has no 30-minute step). */
export function dateAsTime(d: Date): string {
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return hhmmOf(Math.min(1410, Math.round(mins / 30) * 30));
}

/** One weekday's windows, each with its two time pickers, "Until midnight", and remove (CD-10). */
export function HoursDayEditor({
  testID,
  dayLabel,
  windows,
  onStart,
  onEnd,
  onMidnight,
  onRemove,
  onAdd,
}: {
  testID: string;
  dayLabel: string;
  windows: readonly EditableWindow[];
  onStart: (key: string, hhmm: string) => void;
  onEnd: (key: string, hhmm: string) => void;
  onMidnight: (key: string, on: boolean) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        padding: space.m,
        gap: space.s,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
          {dayLabel}
        </Text>
        {windows.length === 0 ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.fnt }}>
            {t('coaching.coach.hours.none')}
          </Text>
        ) : null}
      </View>
      {windows.map((w, i) => {
        const id = `${testID}.window.${i}`;
        const midnight = w.end === '24:00';
        return (
          <View
            key={w.key}
            style={{
              gap: 4,
              paddingTop: space.s,
              borderTopWidth: 1,
              borderTopColor: colors.sub,
            }}
          >
            <DateTimeField
              testID={`${id}.start`}
              label={t('coaching.coach.hours.from')}
              mode="time"
              timeZone="UTC"
              minuteInterval={30}
              value={timeAsDate(w.start)}
              onChange={(d) => onStart(w.key, dateAsTime(d))}
            />
            {midnight ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  minHeight: 36,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut2 }}>
                  {t('coaching.coach.hours.until')}
                </Text>
                <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                  {isolateLtr('24:00')}
                </Text>
              </View>
            ) : (
              <DateTimeField
                testID={`${id}.end`}
                label={t('coaching.coach.hours.until')}
                mode="time"
                timeZone="UTC"
                minuteInterval={30}
                value={timeAsDate(w.end)}
                onChange={(d) => onEnd(w.key, dateAsTime(d))}
              />
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 }}>
                {t('coaching.coach.hours.midnight')}
              </Text>
              <Switch
                testID={`${id}.midnight`}
                value={midnight}
                onValueChange={(on) => onMidnight(w.key, on)}
                trackColor={{ true: brand.green }}
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {w.setBy === 'staff' ? (
                <Tag label={t('coaching.coach.hours.setByVenue')} tone="muted" />
              ) : (
                <View />
              )}
              <Pressable
                testID={`${id}.remove`}
                accessibilityRole="button"
                accessibilityLabel={t('coaching.coach.hours.remove')}
                onPress={() => onRemove(w.key)}
                hitSlop={8}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingTop: 4,
                  paddingBottom: 4,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <TrashIcon size={13} color={colors.redtext} />
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.redtext }}>
                  {t('coaching.coach.hours.remove')}
                </Text>
              </Pressable>
            </View>
            {w.error ? (
              <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.redtext }}>
                {w.error}
              </Text>
            ) : null}
          </View>
        );
      })}
      <LinkText testID={`${testID}.add`} label={t('coaching.coach.hours.add')} onPress={onAdd} />
    </View>
  );
}

/** One time off: "{from} – {to} · {reason}", "Set by the venue", and Cancel. */
export function TimeOffRow({
  testID,
  entry,
  tz,
  busy,
  onCancel,
}: {
  testID: string;
  entry: TimeOffEntry;
  tz: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const from = new Date(entry.startsAt);
  const to = new Date(entry.endsAt);
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.button,
        paddingStart: space.m,
        paddingEnd: space.sm,
        paddingTop: 10,
        paddingBottom: 10,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
          {t('coaching.coach.timeOff.row', {
            from: isolate(`${formatDate(from, locale, tz)} ${formatTime(from, locale, tz)}`),
            to: isolate(`${formatDate(to, locale, tz)} ${formatTime(to, locale, tz)}`),
          })}
        </Text>
        {entry.reason ? (
          <Text
            numberOfLines={2}
            style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}
          >
            {isolate(entry.reason)}
          </Text>
        ) : null}
        {entry.setBy === 'staff' ? (
          <Tag label={t('coaching.coach.timeOff.setByVenue')} tone="muted" />
        ) : null}
      </View>
      <Button
        testID={`${testID}.cancel`}
        label={t('coaching.coach.timeOff.cancel')}
        variant="secondary"
        size="compact"
        busy={busy}
        onPress={onCancel}
      />
    </View>
  );
}

// ── Statements (guest.md §4.13.7) ───────────────────────────────────────────

function MoneyLine({ label, strong }: { label: string; strong?: boolean }) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      style={{
        fontFamily: strong ? fonts.body800 : fonts.body600,
        fontSize: strong ? 14 : 13,
        color: strong ? colors.ink : colors.mut2,
      }}
    >
      {label}
    </Text>
  );
}

/** One approved or paid statement for one branch (C-12, read-only), with its lines when read for a month. */
export function StatementCard({
  testID,
  linesTestID,
  statement,
  showBranch,
}: {
  testID: string;
  /** `<route>.line`: each line takes `${linesTestID}.<lessonId>`. */
  linesTestID: string;
  statement: CoachStatement;
  showBranch: boolean;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const s = statement;
  const money = (n: number) => isolateLtr(formatIQD(n, locale));
  const paidAt = s.paidAt ? formatDate(new Date(s.paidAt), locale) : null;
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: space.l,
        gap: 6,
      }}
    >
      {showBranch ? (
        <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
          {isolate(pickName(s.venueNameEn, s.venueNameAr, locale))}
        </Text>
      ) : null}
      <Tag
        tone={s.status === 'paid' ? 'green' : 'blue'}
        label={
          s.status === 'paid' && paidAt
            ? s.paidReference
              ? t('coaching.coach.statements.paid', {
                  date: paidAt,
                  reference: isolateLtr(s.paidReference),
                })
              : t('coaching.coach.statements.paidNoRef', { date: paidAt })
            : t('coaching.coach.statements.approved')
        }
      />
      <MoneyLine label={countPhrase('coaching.coach.count.lessons', s.lessonsCount, locale)} />
      <MoneyLine
        label={t('coaching.coach.statements.collected', { amount: money(s.collectedIqd) })}
      />
      <MoneyLine
        label={t('coaching.coach.statements.courtShare', { amount: money(s.courtShareIqd) })}
      />
      <MoneyLine
        strong
        label={
          // No rate sent (mixed rates, adjustments only): the share without a
          // percentage, never a made-up one (MB-02).
          s.shareBp !== null
            ? t('coaching.coach.statements.coachShare', {
                pct: isolateLtr(`${sharePercent(s.shareBp)}%`),
                amount: money(s.coachIqd),
              })
            : t('coaching.coach.statements.estimateShare', { amount: money(s.coachIqd) })
        }
      />
      {s.adjustmentsIqd !== 0 ? (
        <MoneyLine
          label={t('coaching.coach.statements.adjustments', { amount: money(s.adjustmentsIqd) })}
        />
      ) : null}
      {s.totalIqd !== null && s.totalIqd !== s.coachIqd ? (
        <MoneyLine
          strong
          label={t('coaching.coach.statements.total', { amount: money(s.totalIqd) })}
        />
      ) : null}
      {s.lines && s.lines.length > 0 ? (
        <View
          style={{
            marginTop: space.s,
            gap: space.s,
            borderTopWidth: 1,
            borderTopColor: colors.sub,
            paddingTop: space.s,
          }}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut }}>
            {t('coaching.coach.statements.lines')}
          </Text>
          {s.lines.map((l) => (
            <View
              key={`${l.lessonId}.${l.isAdjustment ? 'adj' : 'line'}`}
              testID={`${linesTestID}.${l.lessonId}`}
              style={{ gap: 2 }}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ink }}>
                {t('coaching.coach.statements.line', {
                  date: l.startAt ? formatDate(new Date(l.startAt), locale) : '',
                  type: isolate(pickName(l.typeNameEn, l.typeNameAr, locale)),
                })}
                {l.isAdjustment ? ` · ${t('coaching.coach.statements.adjustment')}` : ''}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                {l.shareBp !== null
                  ? t('coaching.coach.statements.lineMoneyPct', {
                      collected: money(l.collectedIqd),
                      court: money(l.courtShareIqd),
                      pct: isolateLtr(`${sharePercent(l.shareBp)}%`),
                      coach: money(l.coachIqd),
                    })
                  : t('coaching.coach.statements.lineMoney', {
                      collected: money(l.collectedIqd),
                      court: money(l.courtShareIqd),
                      coach: money(l.coachIqd),
                    })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
