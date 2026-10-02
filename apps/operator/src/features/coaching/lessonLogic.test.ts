import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import {
  COACHING_CANCEL_CODES,
  LESSON_RESERVATION_NAME,
  coachingErrorKey,
  coachingErrorText,
  cutoffState,
  blockedRefundDue,
  deskRefundDue,
  enrolmentActionsOf,
  enrolmentLine,
  eventKey,
  eventSentence,
  isLessonLiteral,
  isLessonRow,
  isWalkIn,
  lessonBannerKey,
  lessonBannerText,
  lessonLabel,
  lessonOfRow,
  lessonPayState,
  lessonPlacesChip,
  lessonTags,
  lessonsByReservation,
  nowOf,
  reasonForm,
  refundsForLesson,
  rosterGroups,
  rosterName,
  rosterOwing,
} from './lessonLogic';
import type { DeskLesson, Enrolment, LessonInfo } from './lessonPayloads';

const en = makeT('en');
const ar = makeT('ar');
/** The text without its bidi isolates and marks (isolate / isolateLtr wrap names and counts). */
const plain = (s: string) => s.replace(/[⁦-⁩‎‏]/g, '');

const T0 = Date.parse('2026-10-01T18:00:00Z');
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function desk(over: Partial<DeskLesson> = {}): DeskLesson {
  return {
    lesson_id: 'l1',
    reservation_id: 'r1',
    court_id: 'c1',
    court_name_en: 'Court 2',
    court_name_ar: 'الملعب 2',
    kind: 'private',
    status: 'scheduled',
    start_at: iso(0),
    end_at: iso(60),
    hold_expires_at: null,
    booked_by_kind: 'staff',
    coach_id: 'coach-1',
    coach_name_en: 'Coach Sara',
    coach_name_ar: 'المدرّبة سارة',
    lesson_type_id: 't1',
    type_name_en: 'Private 60',
    type_name_ar: 'خاصة 60',
    course: null,
    label: 'Ali Hasan',
    party_size: 1,
    places_taken: 1,
    max_places: 4,
    min_places: 1,
    cutoff_at: null,
    enrolments: 1,
    owing: 0,
    owing_iqd: 0,
    paid_online: 0,
    awaiting: 0,
    paid_places: 0,
    ...over,
  };
}

function enrolment(over: Partial<Enrolment> = {}): Enrolment {
  return {
    enrolment_id: 'e1',
    scope: 'lesson',
    status: 'booked',
    cancel_kind: null,
    cancelled_at: null,
    customer_id: 'cust-1',
    full_name: 'Ali Hasan',
    phone: '+9647700000000',
    typed: false,
    flags: [],
    party_size: 1,
    friend_names: [],
    first_session_no: null,
    sessions_covered: null,
    booked_by_kind: 'guest',
    booked_by_name: null,
    payment_mode: 'desk',
    created_at: iso(-600),
    attendance: null,
    money: {
      price_iqd: 30000,
      owed_iqd: 30000,
      desk_paid_iqd: 0,
      online_paid_iqd: 0,
      refunded_iqd: 0,
      kept_iqd: 0,
      refund_due_iqd: 0,
      refund_due_desk_iqd: 0,
      refund_blocked_iqd: 0,
      take_iqd: 30000,
    },
    can: {
      take_payment: true,
      cancel: true,
      mark_attended: true,
      mark_no_show: false,
      unmark: false,
    },
    ...over,
  };
}

function info(over: Partial<LessonInfo> = {}): LessonInfo {
  return {
    id: 'l1',
    venue_id: 'v1',
    kind: 'group',
    status: 'scheduled',
    cancel_reason: null,
    start_at: iso(0),
    end_at: iso(60),
    duration_min: 60,
    rescheduled_at: null,
    booked_by_kind: 'staff',
    coach: {
      coach_id: 'coach-1',
      display_name_en: 'Coach Sara',
      display_name_ar: 'سارة',
      status: 'active',
    },
    lesson_type: { lesson_type_id: 't1', name_en: 'Group 90', name_ar: 'جماعية 90' },
    course: null,
    reservation_id: 'r1',
    reservation_status: 'confirmed',
    court_id: 'c1',
    court_name_en: 'Court 2',
    court_name_ar: 'الملعب 2',
    price_iqd: 20000,
    court_share_iqd: 5000,
    max_places: 6,
    min_places: 3,
    places_taken: 4,
    cutoff_at: iso(-120),
    hold_expires_at: null,
    created_by_name: 'Desk Dana',
    server_now: iso(-180),
    day_open: true,
    can: {
      add_student: true,
      cancel: true,
      cancel_course: false,
      reschedule: true,
      move_court: true,
    },
    ...over,
  };
}

const ALL = { runLessons: true, takeLessonPayment: true };

describe('the court row literal (§5.8)', () => {
  it("is the DB's word, byte for byte", () => {
    expect(LESSON_RESERVATION_NAME).toBe('Lesson');
  });

  it('recognises a lesson row by its kind, or by the literal off a booking', () => {
    expect(isLessonLiteral({ kind: 'lesson', guest_name: 'Lesson', guest_id: null })).toBe(true);
    expect(isLessonLiteral({ kind: 'hold', guest_name: 'Lesson', guest_id: null })).toBe(true);
    expect(isLessonLiteral({ kind: 'booking', guest_name: 'Lesson', guest_id: null })).toBe(false);
    expect(isLessonLiteral({ kind: 'hold', guest_name: 'Lesson', guest_id: 'g' })).toBe(false);
    expect(isLessonLiteral(null)).toBe(false);
  });

  it("maps desk_lessons rows by reservation, and draws a held lesson's hold row as that lesson", () => {
    const held = desk({ lesson_id: 'held', reservation_id: 'hold-1', status: 'held' });
    const map = lessonsByReservation({
      coaching_enabled: true,
      lesson_payment_mode: 'desk',
      server_now: null,
      coaches: [],
      lesson_types: [],
      lessons: [desk(), held, desk({ lesson_id: 'x', reservation_id: null })],
    });
    expect([...map.keys()].sort()).toEqual(['hold-1', 'r1']);
    expect(lessonOfRow({ id: 'hold-1', kind: 'hold' }, map)?.lesson_id).toBe('held');
    expect(lessonOfRow({ id: 'r1', kind: 'booking' }, map)).toBeNull();
    expect(isLessonRow({ id: 'hold-1', kind: 'hold' }, map)).toBe(true);
    expect(isLessonRow({ id: 'other', kind: 'hold' }, map)).toBe(false);
    expect(isLessonRow({ id: 'any', kind: 'lesson' })).toBe(true);
    // OP-19: offline, no desk_lessons row: a hold with no guest named 'Lesson' is still a lesson's.
    expect(
      isLessonRow({ id: 'h2', kind: 'hold', guest_id: null, guest_name: 'Lesson' }, null),
    ).toBe(true);
    expect(
      isLessonRow({ id: 'h3', kind: 'hold', guest_id: 'g1', guest_name: 'Lesson' }, null),
    ).toBe(false);
  });
});

describe('lessonLabel (§5.8, R44)', () => {
  it('names a private lesson by coach and the booker as recorded', () => {
    expect(plain(lessonLabel(desk(), 'en', en))).toBe('Coach Sara · Ali Hasan');
  });

  it("keeps the coach-booked student's recorded name", () => {
    expect(
      plain(lessonLabel(desk({ booked_by_kind: 'coach', label: 'Typed By Coach' }), 'en', en)),
    ).toBe('Coach Sara · Typed By Coach');
  });

  it('names a group session by coach and type', () => {
    expect(plain(lessonLabel(desk({ kind: 'group', label: null }), 'en', en))).toBe(
      'Coach Sara · Private 60',
    );
  });

  it('names a course session by coach, title (else type) and session number', () => {
    const course = {
      course_id: 'c',
      title_en: 'Beginners',
      title_ar: 'المبتدئون',
      session_no: 2,
      sessions_count: 8,
    };
    expect(plain(lessonLabel(desk({ kind: 'course', label: null, course }), 'en', en))).toBe(
      'Coach Sara · Beginners · Session 2',
    );
    expect(
      plain(
        lessonLabel(
          desk({ kind: 'course', label: null, course: { ...course, title_en: '' } }),
          'en',
          en,
        ),
      ),
    ).toBe('Coach Sara · Private 60 · Session 2');
  });

  it('reads "Lesson" with no lesson row (offline), in both languages', () => {
    expect(lessonLabel(null, 'en', en)).toBe('Lesson');
    expect(lessonLabel(undefined, 'ar', ar)).toBe('حصة');
  });

  it('names a course session in Arabic with «الحصة»', () => {
    const course = {
      course_id: 'c',
      title_en: 'Beginners',
      title_ar: 'المبتدئون',
      session_no: 3,
      sessions_count: 8,
    };
    expect(plain(lessonLabel(desk({ kind: 'course', label: null, course }), 'ar', ar))).toBe(
      'المدرّبة سارة · المبتدئون · الحصة 3',
    );
  });
});

describe('places, pay and tags (§5.8, §5.11, C-14, C-24)', () => {
  it('shows 4/6 for a group or course, +2 for a private party, nothing otherwise', () => {
    expect(lessonPlacesChip(desk({ kind: 'group', places_taken: 4, max_places: 6 }))).toEqual({
      kind: 'places',
      taken: 4,
      total: 6,
    });
    expect(lessonPlacesChip(desk({ party_size: 3 }))).toEqual({ kind: 'party', extra: 2 });
    expect(lessonPlacesChip(desk({ party_size: 1 }))).toBeNull();
    expect(lessonPlacesChip(desk({ kind: 'group', places_taken: null }))).toBeNull();
  });

  it('says To pay (warn once started), All paid, or Paid online', () => {
    expect(lessonPayState(desk({ owing: 2, owing_iqd: 60000 }), T0 - 1).warn).toBe(false);
    const started = lessonPayState(desk({ owing: 2, owing_iqd: 60000 }), T0 + 1);
    expect(started).toMatchObject({ pay: 'owing', owing: 2, owingIqd: 60000, warn: true });
    expect(
      lessonPayState(desk({ owing: 0, enrolments: 3, paid_online: 1, paid_places: 3 }), T0).pay,
    ).toBe('allPaid');
    expect(lessonPayState(desk({ owing: 0, enrolments: 2, paid_online: 2 }), T0).pay).toBe(
      'online',
    );
    expect(lessonPayState(desk({ owing: 0, enrolments: 0 }), T0).pay).toBe('none');
  });

  it('OP-13 (DB-32): held, held plus paid, an unpaid no-show, a cancelled online place', () => {
    // A held private lesson waits on Qi: never "All paid".
    expect(lessonPayState(desk({ status: 'held', enrolments: 1, awaiting: 1 }), T0).pay).toBe(
      'awaiting',
    );
    // A group with one place paid and one still held: awaiting, not all paid.
    expect(
      lessonPayState(
        desk({ kind: 'group', enrolments: 2, awaiting: 1, paid_places: 1, paid_online: 1 }),
        T0,
      ).pay,
    ).toBe('awaiting');
    // A no-show who never paid: owing 0 (the server stops asking), not all paid.
    expect(
      lessonPayState(desk({ kind: 'group', enrolments: 2, owing: 0, paid_places: 1 }), T0 + 1).pay,
    ).toBe('none');
    // An online place refunded after a cancel: no live online payer, nothing paid.
    expect(
      lessonPayState(desk({ enrolments: 1, owing: 0, paid_online: 0, paid_places: 0 }), T0).pay,
    ).toBe('none');
    // Every place paid at the desk.
    expect(lessonPayState(desk({ enrolments: 2, paid_places: 2 }), T0).pay).toBe('allPaid');
  });

  it('flags a coach-booked private lesson that still owes, from the moment it is booked (C-24)', () => {
    expect(
      lessonPayState(desk({ booked_by_kind: 'coach', owing: 1 }), T0 - 600_000).coachUnpaid,
    ).toBe(true);
    expect(lessonPayState(desk({ booked_by_kind: 'coach', owing: 0 }), T0).coachUnpaid).toBe(false);
    expect(lessonPayState(desk({ booked_by_kind: 'staff', owing: 1 }), T0).coachUnpaid).toBe(false);
    expect(
      lessonPayState(desk({ kind: 'group', booked_by_kind: 'coach', owing: 1 }), T0).coachUnpaid,
    ).toBe(false);
  });

  it('cutoffState: under the minimum before the cut-off, nothing at or after it', () => {
    const l = {
      kind: 'group' as const,
      status: 'scheduled',
      min_places: 4,
      places_taken: 2,
      cutoff_at: iso(-120),
    };
    expect(cutoffState(l, T0 - 121 * 60_000)).toEqual({ short: 2, cutoffAt: iso(-120) });
    expect(cutoffState(l, T0 - 120 * 60_000)).toBeNull();
    expect(cutoffState(l, T0)).toBeNull();
    expect(cutoffState({ ...l, places_taken: 4 }, T0 - 200 * 60_000)).toBeNull();
    expect(cutoffState({ ...l, kind: 'private' }, T0 - 200 * 60_000)).toBeNull();
    expect(cutoffState({ ...l, status: 'cancelled' }, T0 - 200 * 60_000)).toBeNull();
  });

  it('tags a Today row: needs more, awaiting online, starts soon, coach-booked unpaid', () => {
    const tags = lessonTags(
      desk({ kind: 'group', min_places: 3, places_taken: 1, cutoff_at: iso(-30), owing: 0 }),
      T0 - 40 * 60_000,
    );
    expect(tags.map((t) => t.id)).toEqual(['needsMore', 'startsIn']);
    expect(lessonTags(desk({ status: 'held' }), T0 - 120 * 60_000).map((t) => t.id)).toEqual([
      'awaitingOnline',
    ]);
    expect(
      lessonTags(desk({ booked_by_kind: 'coach', owing: 1 }), T0 - 120 * 60_000).map((t) => t.id),
    ).toEqual(['coachUnpaid']);
  });

  it('reads now from server_now plus the time since the fetch, the station clock only as a fallback', () => {
    expect(nowOf(iso(0), 5000, 1)).toBe(T0 + 5000);
    expect(nowOf(null, 5000, 42)).toBe(42);
  });
});

describe('the banner (§5.10.2)', () => {
  it('picks every status and cancel reason', () => {
    expect(lessonBannerKey(info({ status: 'held' }), T0).id).toBe('held');
    expect(lessonBannerKey(info({ places_taken: 2 }), T0 - 200 * 60_000)).toMatchObject({
      id: 'underMin',
      short: 1,
    });
    expect(lessonBannerKey(info(), T0).id).toBe('scheduled');
    expect(lessonBannerKey(info({ status: 'completed' }), T0).id).toBe('completed');
    expect(lessonBannerKey(info({ status: 'expired' }), T0).id).toBe('expired');
    for (const reason of [
      'guest_cancel',
      'coach_cancel',
      'staff_cancel',
      'under_filled',
      'payment_expired',
      'account_deleted',
      'coach_retired',
    ]) {
      const b = lessonBannerKey(info({ status: 'cancelled', cancel_reason: reason }), T0);
      expect(b.id === 'cancelled' && b.key).toBe(`ws.coaching.banner.cancelled.${reason}`);
    }
    const unknownReason = lessonBannerKey(
      info({ status: 'cancelled', cancel_reason: 'meteor' }),
      T0,
    );
    expect(unknownReason.id === 'cancelled' && unknownReason.key).toBe(
      'ws.coaching.banner.cancelled.other',
    );
    expect(lessonBannerKey(info({ status: 'warped' }), T0)).toEqual({
      id: 'unknown',
      tone: 'neutral',
      status: 'warped',
    });
  });

  it('words the retired-coach banner and the court line', () => {
    const b = lessonBannerKey(info({ status: 'cancelled', cancel_reason: 'coach_retired' }), T0);
    expect(lessonBannerText(b, info(), { tr: en, locale: 'en', tz: 'UTC' })).toBe(
      'Cancelled because the coach was retired. Everyone was told and online money refunded.',
    );
    const s = lessonBannerKey(info(), T0);
    expect(plain(lessonBannerText(s, info(), { tr: en, locale: 'en', tz: 'UTC' }))).toBe(
      'Booked on Court 2',
    );
  });

  it('adds up desk money waiting to go back', () => {
    const due = (n: number) =>
      enrolment({
        money: { ...enrolment().money, refund_due_iqd: n, refund_due_desk_iqd: n },
      });
    expect(deskRefundDue([due(10000), due(5000), due(0)])).toBe(15000);
  });

  it('desk 0 and blocked 10,000: no desk line, a blocked line (OP-14, DB-31)', () => {
    const blocked = enrolment({
      money: {
        ...enrolment().money,
        refund_due_iqd: 10000,
        refund_due_desk_iqd: 0,
        refund_blocked_iqd: 10000,
      },
    });
    expect(deskRefundDue([blocked])).toBe(0);
    expect(blockedRefundDue([blocked])).toBe(10000);
  });
});

describe('history (§5.10.11)', () => {
  it('turns a late under_filled into "nothing was cancelled" (R26)', () => {
    expect(eventKey('under_filled')).toBe('ws.coaching.events.under_filled');
    expect(eventKey('under_filled', true)).toBe('ws.coaching.events.under_filled_late');
    expect(eventKey('teleported')).toBeNull();
  });

  it('words a cancel with its code and the actor, and an automatic one', () => {
    expect(
      plain(
        eventSentence(
          {
            at: iso(0),
            type: 'cancelled',
            actor: 'staff',
            actor_name: 'Dana',
            enrolment_id: null,
            code: 'coach_unavailable: sick',
            late: false,
          },
          en,
        ),
      ),
    ).toBe('Lesson cancelled (Coach unavailable) · Dana');
    expect(
      eventSentence(
        {
          at: iso(0),
          type: 'completed',
          actor: 'system',
          actor_name: null,
          enrolment_id: null,
          code: null,
          late: false,
        },
        en,
      ),
    ).toBe('Done · automatic');
    expect(
      eventSentence(
        {
          at: iso(0),
          type: 'weird',
          actor: 'staff',
          actor_name: null,
          enrolment_id: null,
          code: null,
          late: false,
        },
        en,
      ),
    ).toBe('weird');
  });
});

describe('the roster (§5.10.4, R44, C-21)', () => {
  it('shows the recorded name, else Walk-in', () => {
    expect(rosterName(enrolment({ full_name: 'Typed Name', typed: true }), en)).toBe('Typed Name');
    expect(rosterName(enrolment({ full_name: null }), en)).toBe('Walk-in');
    expect(rosterName(enrolment({ full_name: '  ' }), ar)).toBe('زبون عابر');
  });

  it('offers Open customer for a guest-booked row, a desk pick and a confirmed match only', () => {
    const lesson = info();
    const guest = enrolment({ booked_by_kind: 'guest', customer_id: 'g' });
    const deskTyped = enrolment({ booked_by_kind: 'staff', typed: true, customer_id: null });
    const confirmed = enrolment({ booked_by_kind: 'coach', typed: true, customer_id: 'g2' });
    const unconfirmed = enrolment({
      booked_by_kind: 'coach',
      typed: true,
      customer_id: null,
      full_name: 'As Typed',
    });
    expect(enrolmentActionsOf(guest, lesson, true, ALL).openCustomer).toBe(true);
    expect(enrolmentActionsOf(deskTyped, lesson, true, ALL).openCustomer).toBe(false);
    expect(enrolmentActionsOf(confirmed, lesson, true, ALL).openCustomer).toBe(true);
    expect(enrolmentActionsOf(unconfirmed, lesson, true, ALL).openCustomer).toBe(false);
    expect(isWalkIn(unconfirmed)).toBe(true);
    expect(rosterName(unconfirmed, en)).toBe('As Typed');
  });

  it('follows the row`s can, the capability and the reach', () => {
    const e = enrolment();
    const a = enrolmentActionsOf(e, info(), true, ALL);
    expect(a.takePayment).toEqual({ enabled: true, reason: null });
    expect(a.cancel).toEqual({ enabled: true, reason: null });
    expect(a.markAttended).toEqual({ enabled: true, reason: null });
    // Offline: every coaching write disabled with its reason (CD-6).
    const off = enrolmentActionsOf(e, info(), false, ALL);
    expect(off.takePayment).toEqual({ enabled: false, reason: 'offline' });
    expect(off.cancel).toEqual({ enabled: false, reason: 'offline' });
    // Without each capability.
    expect(
      enrolmentActionsOf(e, info(), true, { runLessons: false, takeLessonPayment: true }).cancel,
    ).toBeNull();
    expect(
      enrolmentActionsOf(e, info(), true, { runLessons: false, takeLessonPayment: true })
        .takePayment,
    ).not.toBeNull();
    expect(
      enrolmentActionsOf(e, info(), true, { runLessons: true, takeLessonPayment: false })
        .takePayment,
    ).toBeNull();
  });

  it('never offers Take payment on an online sign-up, nor anything the server refuses on a cancelled one', () => {
    const online = enrolment({
      payment_mode: 'online',
      can: { ...enrolment().can, take_payment: true },
    });
    expect(enrolmentActionsOf(online, info(), true, ALL).takePayment).toBeNull();
    const cancelled = enrolment({
      status: 'cancelled',
      can: {
        take_payment: false,
        cancel: false,
        mark_attended: false,
        mark_no_show: false,
        unmark: false,
      },
    });
    const a = enrolmentActionsOf(cancelled, info(), true, ALL);
    expect([a.takePayment, a.cancel, a.markAttended, a.markNoShow, a.unmark]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('shows No-show disabled before the start and after 24 hours, enabled in between (CD-11)', () => {
    const e = enrolment({ can: { ...enrolment().can, mark_no_show: false } });
    const before = enrolmentActionsOf(e, info({ server_now: iso(-5) }), true, ALL);
    expect(before.markNoShow).toEqual({ enabled: false, reason: 'notStarted' });
    const late = enrolmentActionsOf(e, info({ server_now: iso(24 * 60 + 5) }), true, ALL);
    expect(late.markNoShow).toEqual({ enabled: false, reason: 'marksClosed' });
    const open = enrolmentActionsOf(
      enrolment({ can: { ...enrolment().can, mark_no_show: true } }),
      info({ server_now: iso(10) }),
      true,
      ALL,
    );
    expect(open.markNoShow).toEqual({ enabled: true, reason: null });
    // A row already marked shows Undo, not a disabled No-show.
    const marked = enrolment({
      attendance: { status: 'attended', marked_at: iso(1), marked_by_name: 'Dana' },
    });
    expect(
      enrolmentActionsOf(marked, info({ server_now: iso(-5) }), true, ALL).markNoShow,
    ).toBeNull();
  });

  it('lists live sign-ups first and sums what is still to take', () => {
    const rows = [
      enrolment({ enrolment_id: 'a', status: 'cancelled' }),
      enrolment({ enrolment_id: 'b' }),
      enrolment({ enrolment_id: 'c', status: 'held' }),
    ];
    const g = rosterGroups(rows);
    expect(g.live.map((e) => e.enrolment_id)).toEqual(['b', 'c']);
    expect(g.earlier.map((e) => e.enrolment_id)).toEqual(['a']);
    expect(rosterOwing(rows)).toEqual({ count: 1, amount: 30000 });
  });
});

describe('the money line (§5.10.4)', () => {
  const m = enrolment().money;
  it('says what is owed at the desk', () => {
    expect(enrolmentLine(enrolment()).map((l) => l.id)).toEqual(['toPayAtDesk']);
  });
  it('says what was paid, refunded, kept and is due back', () => {
    const e = enrolment({
      status: 'cancelled',
      money: {
        ...m,
        desk_paid_iqd: 30000,
        refunded_iqd: 10000,
        refund_due_iqd: 20000,
        take_iqd: 0,
      },
    });
    expect(enrolmentLine(e).map((l) => l.id)).toEqual(['paidAtDesk', 'refunded', 'refundDue']);
  });
  it('says a held sign-up awaits its online payment, and a paid one was paid online', () => {
    expect(
      enrolmentLine(enrolment({ status: 'held', money: { ...m, take_iqd: 0 } })).map((l) => l.id),
    ).toEqual(['awaitingOnline']);
    expect(
      enrolmentLine(
        enrolment({ payment_mode: 'online', money: { ...m, online_paid_iqd: 30000, take_iqd: 0 } }),
      ).map((l) => l.id),
    ).toEqual(['paidOnline']);
  });
  it('names a course leave`s kept share (C-23) apart from a late cancel', () => {
    const leave = enrolment({
      status: 'cancelled',
      scope: 'course',
      cancel_kind: 'guest_late',
      money: { ...m, kept_iqd: 5000, take_iqd: 0 },
    });
    expect(enrolmentLine(leave).map((l) => l.id)).toEqual(['keptCourseLeave']);
    const late = enrolment({
      status: 'cancelled',
      scope: 'lesson',
      cancel_kind: 'guest_late',
      money: { ...m, kept_iqd: 5000, take_iqd: 0 },
    });
    expect(enrolmentLine(late).map((l) => l.id)).toEqual(['keptLate']);
  });
});

describe('refunds due for this lesson', () => {
  it('keeps the items of this lesson or its course', () => {
    const items = [
      { lesson_id: 'l1', course_id: null },
      { lesson_id: 'other', course_id: 'c1' },
      { lesson_id: 'other', course_id: 'c2' },
    ].map((x, i) => ({
      enrolment_id: `e${i}`,
      kind: null,
      coach_id: null,
      coach_name_en: null,
      coach_name_ar: null,
      type_name_en: null,
      type_name_ar: null,
      start_at: null,
      label: null,
      phone: null,
      cancel_kind: null,
      cancelled_at: null,
      refund_due_iqd: 1,
      refund_due_desk_iqd: 1,
      online_blocked_iqd: 0,
      payments: [],
      ...x,
    }));
    const course = {
      course_id: 'c1',
      title_en: '',
      title_ar: '',
      status: 'running',
      cancel_reason: null,
      session_no: 1,
      sessions_count: 4,
      signup_closes_at: null,
      places_taken: 2,
      max_places: 6,
      sessions: [],
    };
    expect(
      refundsForLesson({ venue_id: null, total_iqd: 2, items }, info({ course })).map(
        (i) => i.enrolment_id,
      ),
    ).toEqual(['e0', 'e1']);
    expect(refundsForLesson(null, info())).toEqual([]);
  });
});

describe('cancels (§5.10.8)', () => {
  it('offers the six desk cancel codes', () => {
    expect(COACHING_CANCEL_CODES).toEqual([
      'customer_request',
      'coach_unavailable',
      'court_needed',
      'staff_error',
      'duplicate',
      'other',
    ]);
  });
  it('sends `<code>` or `<code>: <note>`, the note capped at 200', () => {
    expect(reasonForm('customer_request')).toBe('customer_request');
    expect(reasonForm('other', '  rain ')).toBe('other: rain');
    expect(reasonForm('other', 'x'.repeat(250))).toBe(`other: ${'x'.repeat(200)}`);
  });
});

describe('coachingErrorKey (§5.19 details)', () => {
  const err = (code: string, details?: string, hint?: string) =>
    new AppRpcError(code, code, hint, details);
  const key = (code: string, details?: string, scope?: 'statement' | 'admin') =>
    coachingErrorKey(err(code, details), { scope }).key;

  it('keeps the base line and the session number for a course-create refusal', () => {
    for (const code of [
      'NO_COURT_FREE',
      'COACH_BUSY',
      'COACH_UNAVAILABLE',
      'SLOT_NOT_ON_GRID',
      'SLOT_IN_PAST',
      'CLOSED_DATE',
      'OUTSIDE_HOURS',
    ]) {
      expect(coachingErrorKey(err(code, '3')).sessionNo, code).toBe(3);
    }
    expect(coachingErrorKey(err('NO_COURT_FREE')).sessionNo).toBeNull();
  });

  it('maps every detail row of §5.19', () => {
    const rows: [string, string | undefined, string, ('statement' | 'admin')?][] = [
      ['COURSE_STARTS_INVALID', 'count', 'ws.coaching.errors.courseStarts.count'],
      ['COURSE_STARTS_INVALID', 'order', 'ws.coaching.errors.courseStarts.order'],
      ['COURSE_STARTS_INVALID', 'span', 'ws.coaching.errors.courseStarts.span'],
      ['LESSON_CLOSED', 'cutoff', 'ws.coaching.errors.cutoffPassed'],
      ['LESSON_NOT_CANCELLABLE', 'status', 'ws.coaching.errors.notCancellable.status'],
      ['LESSON_NOT_CANCELLABLE', 'started', 'ws.coaching.errors.notCancellable.started'],
      ['LESSON_NOT_CANCELLABLE', 'ended', 'ws.coaching.errors.notCancellable.ended'],
      [
        'LESSON_NOT_CANCELLABLE',
        'course_session',
        'ws.coaching.errors.notCancellable.course_session',
      ],
      ['LESSON_NOT_CANCELLABLE', 'private', 'ws.coaching.errors.notCancellable.private'],
      ['SESSION_NOT_MOVABLE', 'ended', 'ws.coaching.errors.notMovable.ended'],
      ['SESSION_NOT_MOVABLE', 'started', 'ws.coaching.errors.notMovable.started'],
      ['SESSION_NOT_MOVABLE', 'order', 'ws.coaching.errors.notMovable.order'],
      ['INVALID_TRANSITION', 'held', 'ws.coaching.errors.heldWaiting'],
      ['INVALID_TRANSITION', 'ended', 'ws.coaching.errors.courtEnded'],
      ['INVALID_TRANSITION', 'not_started', 'ws.coaching.errors.attendance.not_started'],
      ['INVALID_TRANSITION', 'marks_closed', 'ws.coaching.errors.attendance.marks_closed'],
      ['INVALID_TRANSITION', 'not_booked', 'ws.coaching.errors.attendance.not_booked'],
      ['INVALID_TRANSITION', 'cancelled', 'ws.coaching.errors.attendance.cancelled'],
      ['INVALID_TRANSITION', 'paid', 'ws.coaching.errors.voidPaid'],
      ['LESSON_NOT_PAYABLE', 'held', 'ws.coaching.errors.notPayable.held'],
      ['LESSON_NOT_PAYABLE', 'expired', 'ws.coaching.errors.notPayable.expired'],
      ['LESSON_NOT_PAYABLE', 'cancelled', 'ws.coaching.errors.notPayable.cancelled'],
      ['LESSON_NOT_PAYABLE', 'lesson_cancelled', 'ws.coaching.errors.notPayable.lesson_cancelled'],
      ['LESSON_NOT_PAYABLE', 'no_show', 'ws.coaching.errors.notPayable.no_show'],
      ['LESSON_NOT_PAYABLE', 'nothing_owed', 'ws.coaching.errors.notPayable.nothing_owed'],
      ['HOURS_INVALID', '2', 'ws.coaching.errors.hoursInvalid'],
      ['HOURS_OVERLAP', '1', 'ws.coaching.errors.hoursOverlap'],
      ['HOURS_OVERLAP', '1:3', 'ws.coaching.errors.hoursOverlap'],
      ['HOURS_OVERLAP', 'time_off', 'ws.coaching.errors.hoursOverlapTimeOff'],
      ['TIME_OFF_HAS_LESSONS', '2', 'ws.coaching.errors.timeOffHasLessons'],
      ['PRICE_VIA_PROTOCOL', 'price', 'ws.coaching.errors.lessonPriceViaProtocol'],
      ['PRICE_VIA_PROTOCOL', 'shape', 'ws.coaching.errors.lessonShapeViaProtocol'],
      ['LAUNCH_VIA_PROTOCOL', undefined, 'ws.coaching.errors.lessonPriceViaProtocol', 'admin'],
      ['PRICE_TARGET_CHANGED', 'lesson_type', 'ws.coaching.errors.priceTargetChanged.lesson_type'],
      ['PRICE_TARGET_CHANGED', 'coach_price', 'ws.coaching.errors.priceTargetChanged.coach_price'],
      ['ONLINE_PAYMENT_OFF', 'provider', 'ws.coaching.errors.onlineOff.provider'],
      ['ONLINE_PAYMENT_OFF', 'terms', 'ws.coaching.errors.onlineOff.terms'],
      [
        'BRANCH_HAS_BOOKINGS',
        '11111111-2222-4333-8444-555555555555',
        'ws.coaching.errors.branchHasLessons',
      ],
      ['BRANCH_HAS_BOOKINGS', 'coach_lessons', 'ws.coaching.errors.branchHasLessons'],
      ['BRANCH_HAS_BOOKINGS', 'coaching_money', 'ws.coaching.errors.coachingMoney'],
      ['FORBIDDEN', 'own_statement', 'ws.coaching.errors.ownStatement'],
      ['FORBIDDEN', 'own_statement_pin', 'ws.coaching.errors.ownStatementPin'],
      ['STATEMENT_NOT_DRAFT', 'live_draft', 'ws.coaching.errors.liveDraft'],
      ['STATEMENT_NOT_APPROVED', 'negative', 'ws.coaching.errors.negativeStatement'],
      ['INVALID_ARGUMENT', 'p_reference', 'ws.coaching.errors.cardNumber'],
      ['INVALID_ARGUMENT', 'p_reason', 'ws.coaching.errors.cardNumber', 'statement'],
      ['PAYMENT_STATE', 'lesson_live', 'ws.coaching.errors.lessonLive'],
      ['LESSON_VIA_COACHING', 'cancel', 'ws.coaching.errors.viaCoaching.cancel'],
      ['LESSON_VIA_COACHING', 'mark', 'ws.coaching.errors.viaCoaching.mark'],
      ['LESSON_VIA_COACHING', 'extend', 'ws.coaching.errors.viaCoaching.extend'],
      ['LESSON_VIA_COACHING', 'move', 'ws.coaching.errors.viaCoaching.move'],
      ['LESSON_VIA_COACHING', 'court_only', 'ws.coaching.errors.viaCoaching.move'],
      ['LESSON_VIA_COACHING', 'create', 'ws.coaching.errors.viaCoaching.create'],
      ['LESSON_VIA_COACHING', 'tab', 'ws.coaching.errors.viaCoaching.tab'],
      ['LESSON_VIA_COACHING', 'held', 'ws.coaching.errors.viaCoaching.held'],
      ['LESSON_VIA_COACHING', 'confirm', 'ws.coaching.errors.viaCoaching.held'],
      ['ALREADY_ENROLLED', 'coach', 'ws.coaching.errors.coachEnrolled'],
    ];
    for (const [code, detail, expected, scope] of rows) {
      expect(key(code, detail, scope), `${code} · ${detail}`).toBe(expected);
    }
  });

  it('reads the detail from the hint when the server sends it there', () => {
    expect(coachingErrorKey(err('LESSON_CLOSED', undefined, 'cutoff')).key).toBe(
      'ws.coaching.errors.cutoffPassed',
    );
  });

  it('falls back to the shared catalogue for a code or detail it does not know', () => {
    expect(key('INVALID_ARGUMENT', 'p_reason')).not.toBe('ws.coaching.errors.cardNumber');
    expect(key('LESSON_CLOSED', 'whatever')).not.toMatch(/^ws\.coaching/);
    expect(coachingErrorKey(new TypeError('fetch failed')).code).toBeNull();
  });

  it('prefixes the session for a per-session refusal and fills the holes', () => {
    const text = coachingErrorText(err('NO_COURT_FREE', '3'), en);
    expect(text.startsWith('Session 3: ')).toBe(true);
    expect(
      coachingErrorText(err('STATEMENT_NOT_APPROVED', 'negative'), en, { amount: '-5,000' }),
    ).toContain('-5,000');
    expect(
      coachingErrorText(err('COURSE_STARTS_INVALID', 'count'), en, { sessions: '8 sessions' }),
    ).toBe('One date is needed for each of the 8 sessions.');
  });
});
