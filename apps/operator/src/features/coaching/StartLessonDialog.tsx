/**
 * New lesson at the desk (docs/design/coaching/operator.md §5.9): opened from
 * the booking dialog's Lesson kind, the calendar in `kind=lesson` mode (the
 * record's "Book a lesson"), and the Today group's New lesson. The pressed
 * court, start, picked customer and typed name carry over from where it was
 * opened.
 *
 * Three kinds, each its own create RPC (a direct `appRpc('<name>', …)` with
 * the literal name, CD-6), each with its own idempotency keys: one per draft
 * (`draftFingerprint`), sent again on a retry of that same draft, a new one
 * once the draft is edited, all cleared on a success (OP-11). A failure with
 * no answer re-reads the desk lessons and says the last attempt may have gone
 * through; a `duplicate` answer at another start says it was booked earlier:
 *  - a private lesson (`desk_book_lesson`): only the starts `coach_slots`
 *    offers for that coach, type and local day; the court is picked by the
 *    server from the free ones (C-2, C-10). When it is not the court pressed,
 *    the toast names the one it took;
 *  - a group session (`desk_create_group`): any grid start, checked against
 *    its cut-off (R47) here first;
 *  - a course (`desk_create_course`): one start per session, the same local
 *    time each week, each row editable; a refusal for one session marks it.
 *
 * The catalogue (kinds, types, coaches, prices), the coaching switch and the
 * server's clock all come from the night's desk_lessons envelope (R20). With
 * coaching off at the branch the desk can still stage a lesson (R51): the
 * staging line says guests cannot see it yet. Every write is online only:
 * offline, Create stays on screen, disabled, with the reason (CD-6). Pure
 * rules live in startLessonLogic.ts.
 *
 * A stepped wizard (components/StepWizard.tsx, Sait 2026-10-22): Kind → Type
 * & coach → When → Course title (a course) or Student (a private lesson),
 * then Review, which holds Create lesson. Every element is the approved
 * preview's (operator-wizards.html, `lesson`): notes are WizardNote, a
 * course's sessions are rows ("Session n" · its day and time), each opened to
 * move it on its own.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  formatDate,
  formatIQD,
  formatNumber,
  formatTime,
  formatWeekdayLong,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import type { CourtRow } from '../../lib/queries';
import { pickName, useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { ErrorText, Field, Select, Skeleton, inputStyle } from '../../components/ui';
import { ReviewList, StepWizard, WizardChips, WizardChoice, WizardChoices, WizardNote, WizardPrice, type WizardAt, type WizardStep } from '../../components/StepWizard';
import { BilingualFields, DateField } from '../../components/inputs';
import { CustomerPicker, type PickedCustomer } from '../desk/customers/CustomerPicker';
import { PickerHint } from '../desk/wizardParts';
import { nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone } from '../desk/deskLogic';
import {
  coachingErrorText,
  countOf,
  courtNameOf,
  kindKey,
  nowOf,
  refusedSessionNo,
} from './lessonLogic';
import {
  firstSessionId,
  readBookedLesson,
  readCreatedCourse,
  readCreatedGroup,
  type DeskCoach,
  type DeskLessonType,
  type DeskLessons,
  type LessonKind,
} from './lessonPayloads';
import { invalidateLessonBooking, useCoachSlots, useDraftIdemKeys } from './useCoaching';
import {
  COURSE_TITLE_MAX,
  coachesFor,
  cutoffAtOf,
  draftFingerprint,
  duplicateElsewhere,
  gridStarts,
  initialStart,
  kindsOnSale,
  localDayWindow,
  localStartOf,
  mayHaveLanded,
  priceFor,
  slotChoice,
  startArgs,
  startDraftErrors,
  startOf,
  startsErrors,
  typesOfKind,
  weeklyStarts,
  type LocalStart,
  type StartBlock,
  type StartDraft,
  type StartRowError,
} from './startLessonLogic';

/** A typed student's name: the bound the desk's other typed-guest boxes use. */
const STUDENT_NAME_MAX = 80;

export interface StartLessonDialogProps {
  /**
   * The court pressed, compared with the one the server picks (C-10); null
   * when opened with no court in hand (the Today group's New lesson).
   */
  courtId: string | null;
  /** The pressed start: the private start pre-selected when it is free, the group and course start. */
  startAt: Date;
  courts: readonly CourtRow[];
  tz: string;
  /** A customer carried over (the booking dialog's pick, the record's customer). */
  customer?: PickedCustomer | null;
  /** A typed walk-in carried over from the booking dialog. */
  guestName?: string;
  guestPhone?: string;
  /**
   * The coach and lesson type picked where it was opened (the Coaches tab's
   * free time): the kind follows the type. Ignored when not on sale here.
   */
  coachId?: string | null;
  lessonTypeId?: string | null;
  /**
   * The night's desk_lessons envelope: kinds, types, coaches and prices, the
   * coaching switch and `server_now`. Undefined while it loads; null when it
   * could not be read (the dialog then says so, and Create stays off).
   */
  lessons: DeskLessons | null | undefined;
  /** When that envelope was read (the query's dataUpdatedAt), so the clock mirror moves. */
  lessonsAt?: number;
  onClose: () => void;
}

export function StartLessonDialog({
  courtId: pressedCourtId,
  startAt: pressedStart,
  courts,
  tz,
  customer: initialCustomer = null,
  guestName: initialName = '',
  guestPhone: initialPhone = '',
  coachId: initialCoachId = null,
  lessonTypeId: initialTypeId = null,
  lessons,
  lessonsAt,
  onClose,
}: StartLessonDialogProps) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  // Keys per create RPC and per draft (OP-11): switching kind never replays another RPC's key,
  // and an edited draft never replays the key of what was sent before.
  const bookKey = useDraftIdemKeys('book');
  const groupKey = useDraftIdemKeys('group');
  const courseKey = useDraftIdemKeys('course');
  // OP-11: the last attempt got no answer, so it may have gone through.
  const [maybeLanded, setMaybeLanded] = useState(false);

  const pressedIso = pressedStart.toISOString();
  const opening = useMemo(() => initialStart(pressedStart, tz), [pressedStart, tz]);

  const types: readonly DeskLessonType[] = lessons?.lesson_types ?? [];
  const coaches: readonly DeskCoach[] = lessons?.coaches ?? [];
  const offered = kindsOnSale(types);

  const [kindPick, setKindPick] = useState<LessonKind | null>(
    () => types.find((t) => t.lesson_type_id === initialTypeId)?.kind ?? null,
  );
  const kind = kindPick && offered.includes(kindPick) ? kindPick : (offered[0] ?? null);
  const typesHere = typesOfKind(types, kind);
  const [typePick, setTypePick] = useState<string | null>(initialTypeId);
  const type = typesHere.find((t) => t.lesson_type_id === typePick) ?? typesHere[0] ?? null;
  const choices = coachesFor(type?.lesson_type_id, coaches);
  const [coachPick, setCoachPick] = useState<string | null>(initialCoachId);
  const coach =
    choices.find((c) => c.coach.coach_id === coachPick && !c.paused)?.coach ??
    choices.find((c) => !c.paused)?.coach ??
    null;
  const coachName = coach
    ? pickName(locale, { name_en: coach.display_name_en, name_ar: coach.display_name_ar })
    : '';

  // Private and group: one local date; group picks a grid time, private a free start.
  const [date, setDate] = useState(opening.date);
  const [groupTime, setGroupTime] = useState(opening.time);
  const [slotPick, setSlotPick] = useState<string | null>(null);
  // Course: the first session, then one row per session (generated until a row is edited).
  const [firstDate, setFirstDate] = useState(opening.date);
  const [firstTime, setFirstTime] = useState(opening.time);
  const [rowsEdited, setRowsEdited] = useState<LocalStart[] | null>(null);
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  // Private: the student.
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const [guestName, setGuestName] = useState(() =>
    sanitizeName(initialCustomer?.name ?? initialName),
  );
  const [guestPhone, setGuestPhone] = useState(() =>
    sanitizePhone(initialCustomer?.phone ?? initialPhone),
  );
  const [nameTouched, setNameTouched] = useState(initialName !== '');
  const [phoneTouched, setPhoneTouched] = useState(initialPhone !== '');
  const [extra, setExtra] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [at, setAt] = useState<WizardAt>(0);

  // The server's clock (§5.1): its server_now plus the time since it was read.
  const nowMs = nowOf(lessons?.server_now, lessonsAt ? Math.max(0, Date.now() - lessonsAt) : 0);
  const today = localStartOf(new Date(nowMs).toISOString(), tz).date;

  // The coach's free starts for the private lesson's local day (coach_slots, R51: answered on or off).
  const day = localDayWindow(date, tz);
  const slotsQ = useCoachSlots(
    coach?.coach_id,
    type?.lesson_type_id,
    day?.fromIso,
    day?.toIso,
    kind === 'private',
  );
  const starts = slotsQ.data?.starts ?? [];
  const choice = slotChoice(starts, date === opening.date ? pressedIso : null);
  const picked =
    slotPick && starts.some((s) => Date.parse(s.start_at) === Date.parse(slotPick))
      ? slotPick
      : null;
  const privateStart = picked ?? (choice.state === 'pressed' ? choice.startAt : null);

  const generated = useMemo(
    () => weeklyStarts(firstDate, firstTime, type?.sessions_count ?? 1, tz),
    [firstDate, firstTime, type?.sessions_count, tz],
  );
  const rows = rowsEdited ?? generated;
  const maxParty = Math.max(1, type?.max_places ?? 1);
  const partySize = Math.min(1 + extra, maxParty);

  const draft: StartDraft = {
    kind,
    typeId: type?.lesson_type_id ?? null,
    coachId: coach?.coach_id ?? null,
    startAt:
      kind === 'private' ? privateStart : kind === 'group' ? startOf(date, groupTime, tz) : null,
    rows,
    titleEn,
    titleAr,
    customerId: customer?.id ?? null,
    guestName,
    guestPhone,
    partySize,
  };
  const blocks = startDraftErrors(draft, { types, coaches, tz, nowMs });
  const startsCheck =
    kind === 'course' && type
      ? startsErrors(rows, {
          count: type.sessions_count,
          durationMin: type.duration_min,
          cutoffHours: type.cutoff_hours,
          tz,
          nowMs,
        })
      : null;
  const sessionsPhrase = countOf('sessions', type?.sessions_count ?? rows.length, locale);
  const timeText = (iso: string | null) => (iso ? formatTime(new Date(iso), locale, tz) : '—');

  const blockText = (b: StartBlock): string => {
    switch (b) {
      case 'kind':
      case 'type':
        return tr('ws.coaching.start.noKinds');
      case 'coach':
        return choices.length === 0
          ? tr('ws.coaching.start.noCoach')
          : tr('ws.coaching.start.pickCoach');
      case 'coachPaused':
        return tr('ws.coaching.start.coachPaused', { name: isolate(coachName) });
      case 'start':
        return tr('ws.coaching.start.pickTime');
      case 'grid':
        return tr('ws.coaching.start.rowErrors.grid');
      case 'past':
        return tr('ws.coaching.start.inPast');
      case 'cutoff':
        return tr('ws.coaching.start.cutoffPassed', {
          time: timeText(cutoffAtOf(draft.startAt, type?.cutoff_hours)),
        });
      case 'starts': {
        if (startsCheck?.form)
          return tr(`ws.coaching.errors.courseStarts.${startsCheck.form}`, {
            sessions: sessionsPhrase,
          });
        const at = startsCheck ? startsCheck.rows.findIndex((r) => r !== null) : -1;
        return rowErrorText(startsCheck?.rows[at] ?? 'missing', Math.max(0, at));
      }
      case 'student':
        return tr('ws.coaching.start.studentRequired');
      case 'party':
        return tr('ws.coaching.start.comingWith', { max: formatNumber(maxParty - 1, locale) });
      case 'title':
        return tr('ws.coaching.start.titleHint');
    }
  };
  function rowErrorText(e: StartRowError, index: number): string {
    if (e === 'cutoff')
      return tr('ws.coaching.start.cutoffPassed', {
        time: timeText(
          cutoffAtOf(
            startOf(rows[index]?.date ?? '', rows[index]?.time ?? '', tz),
            type?.cutoff_hours,
          ),
        ),
      });
    return tr(`ws.coaching.start.rowErrors.${e}`);
  }

  const refusedRow = refusedSessionNo(error);

  /** A duplicate answer whose start is not the draft's: booked earlier, at that time (OP-11). */
  function sayAlreadyBooked(
    answer: { duplicate: boolean; start_at: string | null },
    at: string | null,
  ) {
    if (!duplicateElsewhere(answer, at) || !answer.start_at) return false;
    toast.info(tr('ws.coaching.start.alreadyBooked', { time: timeText(answer.start_at) }));
    return true;
  }

  /** `onRefusedRow`: a refusal naming a course session opens When, where that row is marked. */
  async function submit(onRefusedRow: () => void) {
    if (!kind || !type) return;
    setBusy(true);
    setError(null);
    setMaybeLanded(false);
    const fingerprint = draftFingerprint(kind, draft, tz);
    try {
      // No type argument on the calls: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      if (kind === 'private') {
        const r = readBookedLesson(
          await appRpc(
            'desk_book_lesson',
            startArgs('private', draft, bookKey.keyFor(fingerprint), tz),
          ),
        );
        bookKey.reset();
        invalidateLessonBooking(queryClient);
        if (sayAlreadyBooked(r, draft.startAt)) return landOn(r.lesson_id);
        const court = courtNameOf(r, locale);
        const pressed = pressedCourtId
          ? pickName(
              locale,
              courts.find((c) => c.id === pressedCourtId),
            )
          : '';
        if (pressedCourtId && r.court_id && r.court_id !== pressedCourtId && court && pressed) {
          toast.ok(
            tr('ws.coaching.start.bookedElsewhere', {
              court: isolate(court),
              pressed: isolate(pressed),
            }),
          );
        } else {
          toast.ok(
            court
              ? tr('ws.coaching.start.booked', { court: isolate(court) })
              : tr('ws.coaching.start.created'),
          );
        }
        landOn(r.lesson_id);
      } else if (kind === 'group') {
        const r = readCreatedGroup(
          await appRpc(
            'desk_create_group',
            startArgs('group', draft, groupKey.keyFor(fingerprint), tz),
          ),
        );
        groupKey.reset();
        invalidateLessonBooking(queryClient);
        if (sayAlreadyBooked(r, draft.startAt)) return landOn(r.lesson_id);
        toast.ok(tr('ws.coaching.start.groupCreated'));
        landOn(r.lesson_id);
      } else {
        const r = readCreatedCourse(
          await appRpc(
            'desk_create_course',
            startArgs('course', draft, courseKey.keyFor(fingerprint), tz),
          ),
        );
        courseKey.reset();
        invalidateLessonBooking(queryClient);
        const first = [...r.sessions].sort((a, b) => (a.session_no ?? 0) - (b.session_no ?? 0))[0];
        const firstRow = draft.rows[0];
        if (
          sayAlreadyBooked(
            { duplicate: r.duplicate, start_at: first?.start_at ?? null },
            firstRow ? startOf(firstRow.date, firstRow.time, tz) : null,
          )
        )
          return landOn(firstSessionId(r));
        const booked = r.lesson_ids.length || r.sessions.length || rows.length;
        toast.ok(
          tr('ws.coaching.start.courseCreated', { sessions: countOf('sessions', booked, locale) }),
        );
        landOn(firstSessionId(r));
      }
    } catch (e) {
      setError(e);
      if (refusedSessionNo(e) !== null) onRefusedRow();
      // No answer: it may have landed. Read the desk lessons again and say so (OP-11).
      if (mayHaveLanded(e)) {
        setMaybeLanded(true);
        invalidateLessonBooking(queryClient);
      }
      // A private refusal (the coach or the courts changed) re-reads the coach's free starts (§5.7).
      if (kind === 'private')
        void queryClient.invalidateQueries({ queryKey: ['coaching', 'slots'] });
    } finally {
      setBusy(false);
    }
  }

  function landOn(lessonId: string | null) {
    onClose();
    if (lessonId) void navigate({ to: '/desk/lessons/$id', params: { id: lessonId } });
  }

  const price = priceFor(type, coach);
  const priceText = price === null ? '—' : formatIQD(price, locale);
  const typeLabel = (t: DeskLessonType) => {
    const name = pickName(locale, { name_en: t.name_en, name_ar: t.name_ar }).trim();
    const fallback = tr('ws.coaching.start.typeName', {
      kind: tr(`ws.coaching.common.kindShort.${t.kind}`),
      minutes: tr('ws.coaching.common.minutes', {
        minutes: t.duration_min === null ? '—' : formatNumber(t.duration_min, locale),
      }),
    });
    const p = priceFor(t, coach);
    return tr('ws.coaching.start.typeOption', {
      name: name || fallback,
      price: p === null ? '—' : formatIQD(p, locale),
    });
  };
  const shownDate = kind === 'course' ? firstDate : date;
  const dayNoon = /^\d{4}-\d{2}-\d{2}$/.test(shownDate) ? new Date(`${shownDate}T12:00:00Z`) : null;

  const textsOf = (keys: readonly StartBlock[]) => blocks.filter((b) => keys.includes(b)).map(blockText);
  const loadProblem =
    lessons === undefined
      ? [tr('ws.kit.async.loading')]
      : lessons === null
        ? [tr('ws.coaching.offline.readFailed')]
        : offered.length === 0
          ? [tr('ws.coaching.start.noKinds')]
          : [];
  const whenStart = kind === 'private' ? privateStart : kind === 'group' ? startOf(date, groupTime, tz) : null;
  const firstRow = rows[0];
  const firstStart = firstRow ? startOf(firstRow.date, firstRow.time, tz) : null;
  const dayOf = (iso: string) => `${formatWeekdayShort(new Date(iso), locale, tz)} ${formatDate(new Date(iso), locale, tz)}`;
  // Every session on one weekday at one time: "6 Thursdays from Oct 23, 2026 · 6:00 PM".
  const weekly = rows.length > 1 && rows.every((r) => r.time === rows[0]!.time && weekdayOf(r.date) !== null && weekdayOf(r.date) === weekdayOf(rows[0]!.date));
  const whenValue =
    kind === 'course'
      ? firstStart
        ? weekly
          ? tr('ws.coaching.start.wizard.courseWhenWeekly', {
              count: formatNumber(rows.length, locale),
              weekdays: tr(`ws.coaching.start.wizard.weekdays.${weekdayOf(rows[0]!.date)!}`),
              date: formatDate(new Date(firstStart), locale, tz),
              time: timeText(firstStart),
            })
          : tr('ws.coaching.start.wizard.courseWhen', { sessions: sessionsPhrase, date: dayOf(firstStart), time: timeText(firstStart) })
        : '—'
      : whenStart
        ? tr('ws.coaching.start.wizard.dayTime', { date: dayOf(whenStart), time: timeText(whenStart) })
        : '—';
  const courseTitle = (locale === 'ar' ? titleAr : titleEn).trim() || (locale === 'ar' ? titleEn : titleAr).trim();
  const studentName = customer?.name ?? guestName.trim();
  const studentValue = studentName ? (partySize > 1 ? `${isolate(studentName)} ${isolateLtr(`+${formatNumber(partySize - 1, locale)}`)}` : studentName) : '—';
  const figure =
    kind === 'course'
      ? tr('ws.coaching.start.wizard.priceFigure.course', { price: priceText, sessions: sessionsPhrase })
      : kind
        ? tr(`ws.coaching.start.wizard.priceFigure.${kind}`, { price: priceText })
        : '—';

  const steps: WizardStep[] = [
    {
      key: 'kind',
      label: tr('ws.coaching.start.wizard.stepKind'),
      note: kind ? tr(`ws.coaching.common.kindShort.${kind}`) : null,
      problems: loadProblem.length > 0 ? loadProblem : textsOf(['kind']),
      content:
        lessons === undefined ? (
          <Skeleton lines={4} blockSize="2.4rem" />
        ) : lessons === null ? (
          // The night's desk_lessons could not be read: nothing to offer until it can (§5.5).
          <WizardNote tone="refused">{tr('ws.coaching.offline.readFailed')}</WizardNote>
        ) : (
          <>
            {!lessons.coaching_enabled && (
              // R51: the desk stages lessons while coaching is off; guests cannot see them yet.
              <WizardNote>{tr('ws.coaching.common.stagingOff')}</WizardNote>
            )}
            {offered.length === 0 ? (
              <WizardNote tone="refused">{tr('ws.coaching.start.noKinds')}</WizardNote>
            ) : (
              <WizardChoices label={tr('ws.coaching.start.kind')}>
                {offered.map((k) => (
                  <WizardChoice
                    key={k}
                    on={kind === k}
                    tag={tr(`ws.coaching.common.kindShort.${k}`)}
                    title={tr(kindKey(k))}
                    body={tr(`ws.coaching.start.wizard.kindBody.${k}`)}
                    disabled={busy}
                    testId={`lesson.kind.${k}`}
                    onPick={() => {
                      if (k === kind) return;
                      setKindPick(k);
                      setTypePick(null);
                      setCoachPick(null);
                      setSlotPick(null);
                      setRowsEdited(null);
                      setError(null);
                    }}
                  />
                ))}
              </WizardChoices>
            )}
          </>
        ),
    },
    {
      key: 'type',
      label: tr('ws.coaching.start.wizard.stepType'),
      note: coach ? coachName : null,
      problems: textsOf(['type', 'coach', 'coachPaused']),
      content: (
        <>
          <Field label={tr('ws.coaching.start.type')} style={{ marginBlockEnd: 0 }}>
            <Select
              value={type?.lesson_type_id ?? ''}
              disabled={busy}
              onChange={(id) => {
                setTypePick(id);
                setSlotPick(null);
                setRowsEdited(null);
              }}
              options={typesHere.map((t) => ({ value: t.lesson_type_id, label: typeLabel(t) }))}
            />
          </Field>
          <Field label={tr('ws.coaching.start.coach')} group error={choices.length === 0 ? tr('ws.coaching.start.noCoach') : undefined} style={{ marginBlockEnd: 0 }}>
            <WizardChips<string>
              label={tr('ws.coaching.start.coach')}
              value={coach?.coach_id ?? ''}
              onChange={(id) => {
                setCoachPick(id);
                setSlotPick(null);
              }}
              options={choices.map((c) => {
                const name = pickName(locale, { name_en: c.coach.display_name_en, name_ar: c.coach.display_name_ar });
                return {
                  value: c.coach.coach_id,
                  label: c.paused ? tr('ws.coaching.start.wizard.coachPausedChip', { name }) : name,
                  disabled: busy || c.paused,
                };
              })}
            />
          </Field>
          <div data-testid="lesson-price">
            <WizardPrice figure={figure} line={kind ? tr(`ws.coaching.start.wizard.priceLine.${kind}`) : undefined} />
          </div>
        </>
      ),
    },
    {
      key: 'when',
      label: tr('ws.coaching.start.wizard.stepWhen'),
      note: kind === 'course' ? sessionsPhrase : whenStart ? timeText(whenStart) : null,
      problems: textsOf(['start', 'grid', 'past', 'cutoff', 'starts']),
      flagged: refusedRow !== null,
      content: (
        <>
          {kind === 'private' && (
            <PrivateStarts
              date={date}
              minDate={today}
              onDate={(d) => {
                setDate(d);
                setSlotPick(null);
              }}
              coachName={coach ? coachName : null}
              loading={slotsQ.isPending && Boolean(coach)}
              failed={slotsQ.isError}
              starts={starts}
              selected={privateStart}
              notFreeAt={choice.state === 'notFree' && !picked ? pressedIso : null}
              tz={tz}
              busy={busy}
              onPick={setSlotPick}
            />
          )}
          {kind === 'group' && (
            <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
              <Field label={tr('ws.coaching.start.date')} style={{ marginBlockEnd: 0 }}>
                <DateField value={date} min={today} disabled={busy} onChange={setDate} />
              </Field>
              <Field
                style={{ marginBlockEnd: 0 }}
                label={tr('ws.coaching.start.start')}
                error={
                  blocks.includes('cutoff') || blocks.includes('past') || blocks.includes('grid')
                    ? blockText(blocks.find((b) => b === 'cutoff' || b === 'past' || b === 'grid')!)
                    : undefined
                }
              >
                <Select
                  value={groupTime}
                  disabled={busy}
                  onChange={setGroupTime}
                  options={gridStarts(date, tz).map((g) => ({ value: g.time, label: formatTime(new Date(g.startAt), locale, tz) }))}
                />
              </Field>
            </div>
          )}
          {kind === 'course' && (
            <CourseStarts
              firstDate={firstDate}
              firstTime={firstTime}
              minDate={today}
              rows={rows}
              check={startsCheck}
              refusedRow={refusedRow}
              tz={tz}
              busy={busy}
              rowErrorText={rowErrorText}
              formError={startsCheck?.form ? tr(`ws.coaching.errors.courseStarts.${startsCheck.form}`, { sessions: sessionsPhrase }) : null}
              onFirst={(d, t) => {
                setFirstDate(d);
                setFirstTime(t);
                setRowsEdited(null);
              }}
              onRow={(i, next) => setRowsEdited(rows.map((r, j) => (j === i ? next : r)))}
            />
          )}
        </>
      ),
    },
  ];
  if (kind === 'course') {
    steps.push({
      key: 'title',
      label: tr('ws.coaching.start.wizard.stepTitle'),
      note: courseTitle || null,
      problems: textsOf(['title']),
      content: (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <BilingualFields
            labelEn={tr('ws.coaching.start.titleEn')}
            labelAr={tr('ws.coaching.start.titleAr')}
            en={titleEn}
            ar={titleAr}
            onEn={setTitleEn}
            onAr={setTitleAr}
            maxLength={COURSE_TITLE_MAX}
            disabled={busy}
          />
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.coaching.start.titleHint')}</p>
        </div>
      ),
    });
  }
  if (kind === 'private') {
    steps.push({
      key: 'student',
      label: tr('ws.coaching.start.wizard.stepStudent'),
      note: studentName || null,
      problems: textsOf(['student', 'party']),
      content: (
        <>
          <div>
          <CustomerPicker
            label={tr('ws.coaching.start.student')}
            value={customer}
            disabled={busy}
            autoFocus={initialCustomer === null}
            onQueryChange={(q) => {
              if (!nameTouched) setGuestName(nameFromQuery(q));
              if (!phoneTouched) setGuestPhone(phoneFromQuery(q));
            }}
            onChange={(next) => {
              setCustomer(next);
              if (next) {
                if (!nameTouched || guestName.trim() === '') setGuestName(sanitizeName(next.name));
                if (next.phone && (!phoneTouched || guestPhone.trim() === '')) setGuestPhone(sanitizePhone(next.phone));
              }
            }}
          />
          {!customer && <PickerHint />}
          </div>
          {!customer && (
            <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
              <Field label={tr('op.desk.guestName')} style={{ marginBlockEnd: 0 }}>
                <input
                  style={inputStyle}
                  aria-required="true"
                  value={guestName}
                  disabled={busy}
                  maxLength={STUDENT_NAME_MAX}
                  onChange={(e) => {
                    setNameTouched(true);
                    setGuestName(sanitizeName(e.target.value));
                  }}
                />
              </Field>
              <Field label={tr('op.desk.guestPhone')} optional style={{ marginBlockEnd: 0 }}>
                <input
                  style={inputStyle}
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={30}
                  value={guestPhone}
                  disabled={busy}
                  onChange={(e) => {
                    setPhoneTouched(true);
                    setGuestPhone(sanitizePhone(e.target.value));
                  }}
                />
              </Field>
            </div>
          )}
          {maxParty > 1 && (
            <Field label={tr('ws.coaching.start.wizard.comingWith')} group hint={tr('ws.coaching.start.wizard.takesUpTo', { n: formatNumber(maxParty, locale) })} style={{ marginBlockEnd: 0 }}>
              <WizardChips<string>
                label={tr('ws.coaching.start.wizard.comingWith')}
                value={String(partySize - 1)}
                onChange={(v) => setExtra(Number(v))}
                options={Array.from({ length: maxParty }, (_, n) => ({
                  value: String(n),
                  label: n === 0 ? formatNumber(0, locale) : isolateLtr(`+${formatNumber(n, locale)}`),
                  disabled: busy,
                }))}
              />
            </Field>
          )}
        </>
      ),
    });
  }
  const whenIndex = 2;

  return (
    <StepWizard
      title={tr('ws.coaching.common.newLesson')}
      lead={dayNoon ? <bdi>{`${formatWeekdayLong(dayNoon, locale, 'UTC')} · ${formatDate(dayNoon, locale, 'UTC')}`}</bdi> : undefined}
      steps={steps}
      at={at}
      onAtChange={setAt}
      busy={busy}
      submitBlocked={!reachable ? tr('ws.coaching.offline.needsConnection') : lessons === null ? tr('ws.coaching.offline.readFailed') : null}
      onClose={onClose}
      submitLabel={tr('ws.coaching.start.submit')}
      onSubmit={() => void submit(() => setAt(whenIndex))}
      testId="lesson"
      notice={
        error || maybeLanded ? (
          <>
            <ErrorText error={error} message={error ? coachingErrorText(error, tr, { sessions: sessionsPhrase }) : null} />
            {maybeLanded && <WizardNote>{tr('ws.coaching.start.maybeLanded')}</WizardNote>}
          </>
        ) : undefined
      }
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr('ws.coaching.start.wizard.reviewKind'), value: kind ? tr(kindKey(kind)) : '—', step: 'kind' },
            { label: tr('ws.coaching.start.wizard.reviewCoach'), value: <bdi>{coachName || '—'}</bdi>, step: 'type' },
            {
              label: tr('ws.coaching.start.wizard.reviewPrice'),
              value:
                kind === 'course'
                  ? tr('ws.coaching.start.wizard.reviewPriceValue.course', { price: priceText, sessions: sessionsPhrase })
                  : kind
                    ? tr(`ws.coaching.start.wizard.reviewPriceValue.${kind}`, { price: priceText })
                    : '—',
              step: 'type',
            },
            { label: tr('ws.coaching.start.wizard.reviewWhen'), value: <bdi>{whenValue}</bdi>, step: 'when' },
            ...(kind === 'private'
              ? [{ label: tr('ws.coaching.start.wizard.reviewStudent'), value: <bdi>{studentValue}</bdi>, step: 'student' }]
              : kind === 'course'
                ? [{ label: tr('ws.coaching.start.wizard.reviewTitle'), value: <bdi>{courseTitle || '—'}</bdi>, step: 'title' }]
                : []),
          ]}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Private: the coach's free starts as chips
// ---------------------------------------------------------------------------

function PrivateStarts({
  date,
  minDate,
  onDate,
  coachName,
  loading,
  failed,
  starts,
  selected,
  notFreeAt,
  tz,
  busy,
  onPick,
}: {
  date: string;
  minDate: string;
  onDate: (d: string) => void;
  /** Null until a coach is picked. */
  coachName: string | null;
  loading: boolean;
  failed: boolean;
  starts: readonly { start_at: string }[];
  selected: string | null;
  /** The pressed time, when it is not one of the coach's free starts. */
  notFreeAt: string | null;
  tz: string;
  busy: boolean;
  onPick: (iso: string) => void;
}) {
  const { tr, locale } = useLocale();
  const coach = coachName ? isolate(coachName) : '';
  const line = !coachName
    ? tr('ws.coaching.start.pickCoach')
    : failed
      ? tr('ws.coaching.start.slotsFailed')
      : loading
        ? null
        : starts.length === 0
          ? tr('ws.coaching.start.noSlots', { coach })
          : notFreeAt
            ? tr('ws.coaching.start.notFree', {
                coach,
                time: formatTime(new Date(notFreeAt), locale, tz),
              })
            : null;
  return (
    <>
      <Field label={tr('ws.coaching.start.date')} style={{ marginBlockEnd: 0 }}>
        <DateField value={date} min={minDate} disabled={busy} onChange={onDate} />
      </Field>
      <Field
        label={tr('ws.coaching.start.start')}
        group
        hint={coachName && !loading && starts.length > 0 ? tr('ws.coaching.start.wizard.freeTimes', { coach }) : undefined}
        style={{ marginBlockEnd: 0 }}
      >
        {loading ? (
          <Skeleton lines={1} blockSize="2rem" />
        ) : (
          <WizardChips<string>
            label={tr('ws.coaching.start.start')}
            value={starts.find((s) => selected !== null && Date.parse(selected) === Date.parse(s.start_at))?.start_at ?? ''}
            onChange={onPick}
            options={starts.map((s) => ({ value: s.start_at, label: formatTime(new Date(s.start_at), locale, tz), disabled: busy }))}
          />
        )}
      </Field>
      {line && <WizardNote tone={notFreeAt && starts.length > 0 ? 'refused' : 'info'}>{line}</WizardNote>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Course: the first session, then one editable row per session
// ---------------------------------------------------------------------------

function CourseStarts({
  firstDate,
  firstTime,
  minDate,
  rows,
  check,
  refusedRow,
  tz,
  busy,
  rowErrorText,
  formError,
  onFirst,
  onRow,
}: {
  firstDate: string;
  firstTime: string;
  minDate: string;
  rows: readonly LocalStart[];
  check: ReturnType<typeof startsErrors> | null;
  /** A refusal naming a session number (`detail` = n): that row is marked. */
  refusedRow: number | null;
  tz: string;
  busy: boolean;
  rowErrorText: (e: StartRowError, index: number) => string;
  formError: string | null;
  onFirst: (date: string, time: string) => void;
  onRow: (index: number, next: LocalStart) => void;
}) {
  const { tr, locale } = useLocale();
  // The session whose date and start are open for moving.
  const [moving, setMoving] = useState<number | null>(null);
  const timeOptions = (date: string) =>
    gridStarts(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : firstDate, tz).map((g) => ({
      value: g.time,
      label: formatTime(new Date(g.startAt), locale, tz),
    }));
  return (
    <>
      <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.coaching.start.firstSession')} style={{ marginBlockEnd: 0 }}>
          <DateField value={firstDate} min={minDate} disabled={busy} onChange={(d) => onFirst(d, firstTime)} />
        </Field>
        <Field label={tr('ws.coaching.start.start')} style={{ marginBlockEnd: 0 }}>
          <Select value={firstTime} disabled={busy} onChange={(t) => onFirst(firstDate, t)} options={timeOptions(firstDate)} />
        </Field>
      </div>
      <Field label={tr('ws.coaching.start.wizard.sessions')} group hint={tr('ws.coaching.start.wizard.sessionsHint')} style={{ marginBlockEnd: 0 }}>
        <ol data-testid="course-starts" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {rows.map((row, i) => {
            const n = i + 1;
            const start = startOf(row.date, row.time, tz);
            const own = check?.rows[i] ?? null;
            const refused = refusedRow === n;
            const marked = own !== null || refused;
            const open = moving === i || marked;
            const when = start
              ? tr('ws.coaching.start.wizard.dayTime', {
                  date: `${formatWeekdayShort(new Date(start), locale, tz)} ${formatDate(new Date(start), locale, tz)}`,
                  time: formatTime(new Date(start), locale, tz),
                })
              : '—';
            return (
              <li key={n} data-session={n} data-refused={refused ? '' : undefined} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
                <button
                  type="button"
                  aria-expanded={open}
                  disabled={busy}
                  onClick={() => setMoving(moving === i ? null : i)}
                  style={{
                    ...sessionRow,
                    ...(marked ? { borderColor: 'var(--tp-danger-mark)', background: 'var(--tp-danger-soft)' } : null),
                  }}
                >
                  <strong>{tr('ws.coaching.common.session', { n: formatNumber(n, locale) })}</strong>
                  <bdi style={{ fontSize: 'var(--tp-fs-sm)', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>{when}</bdi>
                </button>
                {open && (
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <DateField
                      ariaLabel={tr('ws.coaching.start.sessionDate', { n: formatNumber(n, locale) })}
                      value={row.date}
                      min={minDate}
                      disabled={busy}
                      style={{ inlineSize: 'auto' }}
                      onChange={(d) => onRow(i, { ...row, date: d })}
                    />
                    <Select
                      aria-label={tr('ws.coaching.start.sessionTime', { n: formatNumber(n, locale) })}
                      value={row.time}
                      disabled={busy}
                      style={{ inlineSize: 'auto' }}
                      onChange={(t) => onRow(i, { ...row, time: t })}
                      options={timeOptions(row.date)}
                    />
                  </div>
                )}
                {own !== null && (
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)', fontWeight: 600 }}>{rowErrorText(own, i)}</span>
                )}
              </li>
            );
          })}
        </ol>
      </Field>
      {formError && <WizardNote tone="refused">{formError}</WizardNote>}
    </>
  );
}

/** A course session as the preview's `.row`: "Session n" at the start, its day and time at the end. */
const sessionRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  flexWrap: 'wrap',
  inlineSize: '100%',
  paddingBlock: 'var(--tp-sp-3)',
  paddingInline: 'calc(var(--tp-sp-3) + var(--tp-sp-0))',
  border: '1px solid var(--tp-border-strong)',
  borderRadius: 'var(--tp-radius-panel)',
  background: 'var(--tp-surface)',
  color: 'var(--tp-fg)',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** A local date's weekday as the catalog names it ("thu"), or null when the date is not whole. */
function weekdayOf(date: string): (typeof WEEKDAY_KEYS)[number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? null;
}
