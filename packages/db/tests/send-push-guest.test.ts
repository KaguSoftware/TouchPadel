/**
 * send-push, guest kinds of open matches (build contracts §1.9, R3;
 * docs/design/open-matches/guest.md §4.7) and of coaching (coaching build
 * contracts §1.9, R18; docs/design/coaching/guest.md §4.6) and of tournaments
 * (docs/design/tournaments/build-contracts-2026-10-03.md §1.10, S12). Pure: no stack, no
 * network. The copy and the message shape live in
 * supabase/functions/send-push/guestStrings.ts so they run here unchanged; the
 * one list of kinds, title keys (each with its kind) and routes is
 * _shared/guest-push.json, which app.match_notify (0261), app.lesson_notify
 * (lesson_booking) and the phone's pushRoutes.ts are held to as well.
 *
 * This file ships in the send-push commit, which deploys before 0255 (and
 * outbox_lesson_kinds) lets the outbox hold a guest kind, so nothing here may need a
 * migration.
 *
 * The plural copy is compared with Node's CLDR data (Intl.PluralRules). The
 * workspace's own pluralForm (packages/i18n/src/plural.ts) is hand-coded to the
 * same CLDR rules and gets the same comparison in its own test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import guestPush from '../supabase/functions/_shared/guest-push.json';
import staffPush from '../supabase/functions/_shared/staff-push.json';
import {
  GUEST_STRINGS,
  guestMessage,
  guestMonth,
  guestTime,
  guestWhen,
  minutesPhrase,
  pluralForm,
  type GuestContext,
  type GuestTitleKey,
  type GuestVars,
  type Lang,
} from '../supabase/functions/send-push/guestStrings.ts';
import {
  REMINDER_LEAD_MS,
  REMINDER_SLACK_MS,
  reminderStale,
} from '../supabase/functions/send-push/lessonReminder.ts';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(resolve(here, '../supabase/functions/send-push/index.ts'), 'utf8');

const FSI = '⁨';
const LRI = '⁦';
const PDI = '⁩';
const iso = (s: string) => `${FSI}${s}${PDI}`;
const ltr = (s: string) => `${LRI}${s}${PDI}`;

const ROUTES = new Set(guestPush.routes);
const KEYS = Object.keys(guestPush.title_keys) as GuestTitleKey[];
const MATCH_ID = '11111111-2222-4333-8444-555555555555';
const ENROLMENT_ID = '22222222-3333-4444-8555-666666666666';
const LESSON_ID = '33333333-4444-4555-8666-777777777777';
const STATEMENT_ID = '44444444-5555-4666-8777-888888888888';
const TOURNAMENT_ID = '55555555-6666-4777-8888-999999999999';
const LANGS: Lang[] = ['en', 'ar'];

const MATCH_KINDS = ['match_update', 'match_reminder', 'match_message'];
const LESSON_KINDS = ['lesson_update', 'lesson_reminder', 'coach_update'];
const MATCH_KEYS = KEYS.filter((k) => MATCH_KINDS.includes(kindOf(k)));
const LESSON_KEYS = KEYS.filter((k) => LESSON_KINDS.includes(kindOf(k)));
const TOURNAMENT_KINDS = ['tournament_update'];
const TOURNAMENT_KEYS = KEYS.filter((k) => TOURNAMENT_KINDS.includes(kindOf(k)));
/** The keys whose body is the time and branch alone, the same in both languages. */
const REMINDER_KEYS = ['reminder_3h', 'lesson.reminder'];

/** The route a key is queued with (guest.md §4.6.1 and open-matches §4.7). */
function routeOf(key: string): string {
  if (key === 'tickets_refunded') return 'tickets';
  if (key.startsWith('tournament.')) return 'tournament';
  if (key.startsWith('lesson.')) return 'lesson';
  if (key === 'coach.statement_ready' || key === 'coach.statement_paid') return 'coach_statements';
  if (key.startsWith('coach.')) return 'coach_lesson';
  return 'match';
}
const ID_OF: Record<string, string | null> = {
  match: MATCH_ID,
  tickets: null,
  lesson: ENROLMENT_ID,
  coach_lesson: LESSON_ID,
  coach_statements: STATEMENT_ID,
  tournament: TOURNAMENT_ID,
};

const CATEGORY_KEYS = [
  'request_new',
  'player_joined',
  'player_left',
  'request_approved',
  'seat_refilled',
  'msg_on_my_way',
  'msg_running_late',
  'msg_cant_make_it',
  'msg_bring_balls',
];
const READER_KEYS = ['organiser_handover'];

const ctx = (over: Partial<GuestContext> = {}): GuestContext => ({
  keyKinds: guestPush.title_keys,
  category: 'open',
  readerGender: null,
  when: 'Tue 29 Sep, 18:00',
  time: '18:00',
  branch: '',
  month: 'September 2026',
  ...over,
});
const payloadOf = (key: string, params: Record<string, unknown> = {}, route = 'match') => ({
  route,
  id: ID_OF[route] ?? null,
  title_key: key,
  params,
});
function kindOf(key: string): string {
  return (guestPush.title_keys as Record<string, string>)[key]!;
}

function msg(lang: Lang, key: string, params: Record<string, unknown> = {}, over: Partial<GuestContext> = {}) {
  const m = guestMessage(lang, kindOf(key), payloadOf(key, params, routeOf(key)), ctx(over), ROUTES);
  if (!m.ok) throw new Error(m.error);
  return m;
}

/** Every var present, so every body renders its whole sentence. */
const FULL: GuestVars = {
  seats: ltr('2/4'),
  minutes: ltr('30') + ' minutes',
  when: iso('Tue 29 Sep, 18:00'),
  time: iso('18:00'),
  branch: iso('Karrada'),
  places: ltr('3/8'),
  // No year: the "no money" scan below refuses any run of three digits.
  month: iso('September'),
};

describe('guest-push.json', () => {
  it('lists the seven guest kinds, the six routes and the six params', () => {
    expect(guestPush.kinds).toEqual([...MATCH_KINDS, ...LESSON_KINDS, ...TOURNAMENT_KINDS]);
    expect(guestPush.routes).toEqual(['match', 'tickets', 'lesson', 'coach_lesson', 'coach_statements', 'tournament']);
    expect(guestPush.params).toEqual(['seats_taken', 'seats_total', 'minutes', 'lesson_id', 'places_taken', 'places_total']);
  });

  it('maps the 18 lesson title keys of §1.9 (with R18) to their kind', () => {
    expect(LESSON_KEYS).toEqual([
      'lesson.booked',
      'lesson.cancelled_by_coach',
      'lesson.cancelled_by_staff',
      'lesson.under_filled',
      'lesson.rescheduled',
      'lesson.court_moved',
      'lesson.payment_expired',
      'lesson.added_by_coach',
      'lesson.reminder',
      'coach.new_student',
      'coach.student_cancelled',
      'coach.lesson_cancelled_by_staff',
      'coach.under_filled',
      'coach.statement_ready',
      'coach.statement_paid',
      'coach.session_added',
      'coach.rescheduled_by_staff',
      'coach.court_moved',
    ]);
    for (const key of LESSON_KEYS) {
      const want = key === 'lesson.reminder' ? 'lesson_reminder' : key.startsWith('coach.') ? 'coach_update' : 'lesson_update';
      expect(kindOf(key), key).toBe(want);
    }
    expect(KEYS).toEqual([...MATCH_KEYS, ...LESSON_KEYS, ...TOURNAMENT_KEYS]);
  });

  it('maps the two tournament title keys of §1.10 to tournament_update', () => {
    expect(TOURNAMENT_KEYS).toEqual(['tournament.cancelled', 'tournament.promoted']);
    for (const key of TOURNAMENT_KEYS) expect(kindOf(key), key).toBe('tournament_update');
  });

  it('maps the 23 match title keys of §1.9 to their kind (R3)', () => {
    expect(MATCH_KEYS).toEqual([
      'request_new',
      'request_expired',
      'player_joined',
      'player_left',
      'request_approved',
      'request_declined',
      'match_booked',
      'match_waiting_court',
      'deadline_warning',
      'match_cancelled',
      'match_bumped',
      'match_expired',
      'match_moved',
      'reminder_3h',
      'organiser_handover',
      'seat_removed',
      'seat_refilled',
      'ticket_forfeited',
      'tickets_refunded',
      'msg_on_my_way',
      'msg_running_late',
      'msg_cant_make_it',
      'msg_bring_balls',
    ]);
    for (const key of MATCH_KEYS) {
      const want =
        key === 'reminder_3h' ? 'match_reminder' : key.startsWith('msg_') ? 'match_message' : 'match_update';
      expect(kindOf(key), key).toBe(want);
    }
  });

  it('shares no kind with the staff family or the booking copy', () => {
    for (const kind of guestPush.kinds) {
      expect(staffPush.kinds).not.toContain(kind);
      expect(INDEX).not.toMatch(new RegExp(`^\\s+${kind}: \\{`, 'm'));
    }
  });
});

describe('GUEST_STRINGS', () => {
  it('has copy in both languages for exactly the title keys of the JSON', () => {
    for (const lang of LANGS) {
      expect(Object.keys(GUEST_STRINGS[lang]).sort()).toEqual([...KEYS].sort());
    }
  });

  it('gives every key the same title and form in both languages, and the forms of §4.7.4', () => {
    for (const key of KEYS) {
      const en = GUEST_STRINGS.en[key];
      const ar = GUEST_STRINGS.ar[key];
      expect(ar.title, key).toBe(en.title);
      expect(ar.form, key).toBe(en.form);
      const want = CATEGORY_KEYS.includes(key) ? 'category' : READER_KEYS.includes(key) ? 'reader' : 'none';
      expect(en.form, key).toBe(want);
      // Arabic needs a feminine body exactly where the form asks for one.
      expect(ar.bodyF !== undefined, key).toBe(want !== 'none');
    }
    expect(GUEST_STRINGS.en.reminder_3h.title).toBe('reminder');
    expect(GUEST_STRINGS.en.tickets_refunded.title).toBe('tickets');
    // Coaching (guest.md §4.6.4): four titles, every lesson key form 'none'.
    for (const key of LESSON_KEYS) {
      const want = key === 'lesson.reminder'
        ? 'lessonReminder'
        : key === 'coach.statement_ready' || key === 'coach.statement_paid'
          ? 'statement'
          : key.startsWith('coach.') ? 'coach' : 'lesson';
      expect(GUEST_STRINGS.en[key].title, key).toBe(want);
      expect(GUEST_STRINGS.en[key].form, key).toBe('none');
    }
    // Tournaments (§1.10): one title, both keys form 'none'.
    for (const key of TOURNAMENT_KEYS) {
      expect(GUEST_STRINGS.en[key].title, key).toBe('tournament');
      expect(GUEST_STRINGS.en[key].form, key).toBe('none');
    }
  });

  it('writes a non-empty body for every key, Arabic in Arabic and different from English', () => {
    for (const key of KEYS) {
      const en = GUEST_STRINGS.en[key].body(FULL);
      const ar = GUEST_STRINGS.ar[key].body(FULL);
      expect(en.trim(), key).not.toBe('');
      expect(ar.trim(), key).not.toBe('');
      if (!REMINDER_KEYS.includes(key)) {
        // reminder_3h and lesson.reminder are "{time} · {branch}" in both languages.
        expect(ar, key).toMatch(/[؀-ۿ]/);
        expect(ar, key).not.toBe(en);
      }
      const f = GUEST_STRINGS.ar[key].bodyF;
      if (f) {
        expect(f(FULL), key).toMatch(/[؀-ۿ]/);
        expect(f(FULL), key).not.toBe(ar);
      }
    }
  });

  it('names nobody and carries no money in any body', () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const c = GUEST_STRINGS[lang][key];
        for (const text of [c.body(FULL), c.bodyF?.(FULL) ?? '']) {
          expect(text, key).not.toMatch(/IQD|د\.ع|دينار|\d{3,}/);
        }
      }
    }
  });
});

describe('guestMessage — coaching (docs/design/coaching/guest.md §4.6)', () => {
  it('titles a lesson and a coach row with the lesson time and the branch only when given; the reminder and the statement alone', () => {
    expect(msg('en', 'lesson.booked').title).toBe(`Lesson · ${iso('Tue 29 Sep, 18:00')}`);
    expect(msg('ar', 'lesson.booked', {}, { when: 'الثلاثاء 29 أيلول، 18:00', branch: 'الكرادة' }).title).toBe(
      `حصة · ${iso('الثلاثاء 29 أيلول، 18:00')} · ${iso('الكرادة')}`,
    );
    expect(msg('en', 'coach.new_student', {}, { branch: 'Karrada' }).title).toBe(
      `Coaching · ${iso('Tue 29 Sep, 18:00')} · ${iso('Karrada')}`,
    );
    expect(msg('ar', 'coach.session_added').title).toBe(`تدريب · ${iso('Tue 29 Sep, 18:00')}`);
    expect(msg('en', 'lesson.booked', {}, { when: '' }).title).toBe('Lesson');
    expect(msg('en', 'lesson.reminder').title).toBe('Your lesson is in 3 hours');
    expect(msg('ar', 'lesson.reminder').title).toBe('حصتك بعد 3 ساعات');
    expect(msg('en', 'coach.statement_ready').title).toBe('Your coach statement');
    expect(msg('ar', 'coach.statement_paid').title).toBe('كشف حساب المدرّب');
  });

  it('isolates the places LTR as one unit, and drops them without both counts (a private lesson)', () => {
    expect(msg('en', 'coach.new_student', { lesson_id: LESSON_ID, places_taken: 3, places_total: 8 }).body).toBe(
      `New booking in your lesson · ${ltr('3/8')}`,
    );
    expect(msg('ar', 'coach.student_cancelled', { places_taken: 2, places_total: 8 }).body).toBe(
      `أُلغي حجز في حصتك · ${ltr('2/8')}`,
    );
    expect(msg('en', 'coach.new_student', { places_taken: 3 }).body).toBe('New booking in your lesson');
    expect(msg('en', 'coach.new_student').body).toBe('New booking in your lesson');
    // The seat counts of open matches are not places.
    expect(msg('en', 'coach.new_student', { seats_taken: 3, seats_total: 4 }).body).toBe('New booking in your lesson');
  });

  it('names the statement month FSI-isolated, and sends the title alone without it', () => {
    expect(msg('en', 'coach.statement_ready').body).toBe(`Your statement for ${iso('September 2026')} is ready to view.`);
    expect(msg('ar', 'coach.statement_paid', {}, { month: 'أيلول 2026' }).body).toBe(
      `سُجّل كشف حسابك لشهر ${iso('أيلول 2026')} مدفوعًا.`,
    );
    expect(msg('en', 'coach.statement_paid', {}, { month: '' }).body).toBe('');
  });

  it('moves a lesson to {when}, and reminds with {time} and the branch; each sends the title alone without its value', () => {
    expect(msg('en', 'lesson.rescheduled').body).toBe(
      `Your lesson moved to ${iso('Tue 29 Sep, 18:00')}. You can cancel free until it starts.`,
    );
    expect(msg('en', 'coach.rescheduled_by_staff').body).toBe(`The venue moved this session to ${iso('Tue 29 Sep, 18:00')}.`);
    expect(msg('en', 'lesson.rescheduled', {}, { when: '' }).body).toBe('');
    expect(msg('en', 'lesson.reminder', {}, { branch: 'Karrada' }).body).toBe(`${iso('18:00')} · ${iso('Karrada')}`);
    expect(msg('ar', 'lesson.reminder', {}, { time: '' }).body).toBe('');
  });

  it('formats the month in the reader’s language with Latin digits, from the date in UTC', () => {
    expect(guestMonth('2026-09-01', 'en')).toBe('September 2026');
    const ar = guestMonth('2026-09-01', 'ar');
    expect(ar).toMatch(/2026/);
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(ar).not.toMatch(/[٠-٩۰-۹]/);
    // The first of the month never slips back a day into the previous month.
    expect(guestMonth('2026-01-01', 'en')).toBe('January 2026');
  });

  it('needs an id on the lesson and coach_lesson routes, never on coach_statements', () => {
    const bad = (key: string, route: string) =>
      guestMessage('en', kindOf(key), { title_key: key, route, id: null, params: {} }, ctx(), ROUTES);
    expect(bad('lesson.booked', 'lesson')).toEqual({ ok: false, error: 'BAD_ROUTE' });
    expect(bad('coach.new_student', 'coach_lesson')).toEqual({ ok: false, error: 'BAD_ROUTE' });
    expect(bad('coach.statement_ready', 'coach_statements').ok).toBe(true);
  });

  it('carries {kind, route, title_key, id} and never the lesson_id param, a name or an amount', () => {
    const m = msg('en', 'lesson.booked', { lesson_id: LESSON_ID, name: 'Ahmed', amount_iqd: 25000 });
    expect(m.data).toEqual({ kind: 'lesson_update', route: 'lesson', title_key: 'lesson.booked', id: ENROLMENT_ID });
    expect(m.body).not.toMatch(/Ahmed|25000/);
    expect(msg('en', 'coach.statement_paid').data).toEqual({
      kind: 'coach_update',
      route: 'coach_statements',
      title_key: 'coach.statement_paid',
      id: STATEMENT_ID,
    });
  });

  it('refuses a lesson key under a match kind and the reverse (KIND_MISMATCH)', () => {
    expect(guestMessage('en', 'match_update', payloadOf('lesson.booked', {}, 'lesson'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'KIND_MISMATCH:match_update/lesson.booked',
    });
    expect(guestMessage('en', 'coach_update', payloadOf('player_joined'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'KIND_MISMATCH:coach_update/player_joined',
    });
  });
});

describe('guestMessage — tournaments (build contracts §1.10)', () => {
  it('titles a row with the tournament start and the branch only when given', () => {
    expect(msg('en', 'tournament.cancelled').title).toBe(`Tournament · ${iso('Tue 29 Sep, 18:00')}`);
    expect(msg('ar', 'tournament.promoted', {}, { when: 'الثلاثاء 29 أيلول، 18:00', branch: 'الكرادة' }).title).toBe(
      `بطولة · ${iso('الثلاثاء 29 أيلول، 18:00')} · ${iso('الكرادة')}`,
    );
    expect(msg('en', 'tournament.promoted', {}, { when: '' }).title).toBe('Tournament');
  });

  it('carries {kind, route, title_key, id} and needs the tournament id', () => {
    expect(msg('en', 'tournament.promoted').data).toEqual({
      kind: 'tournament_update',
      route: 'tournament',
      title_key: 'tournament.promoted',
      id: TOURNAMENT_ID,
    });
    expect(
      guestMessage('en', 'tournament_update', { title_key: 'tournament.cancelled', route: 'tournament', id: null }, ctx(), ROUTES),
    ).toEqual({ ok: false, error: 'BAD_ROUTE' });
    expect(guestMessage('en', 'lesson_update', payloadOf('tournament.cancelled', {}, 'tournament'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'KIND_MISMATCH:lesson_update/tournament.cancelled',
    });
  });
});

describe('guestMessage — titles and bodies', () => {
  it('titles a match row with its time, and the branch only when one is given', () => {
    expect(msg('en', 'match_booked').title).toBe(`Open match · ${iso('Tue 29 Sep, 18:00')}`);
    expect(msg('en', 'match_booked', {}, { branch: 'Karrada' }).title).toBe(
      `Open match · ${iso('Tue 29 Sep, 18:00')} · ${iso('Karrada')}`,
    );
    expect(msg('ar', 'match_booked', {}, { when: 'الثلاثاء 29 أيلول، 18:00' }).title).toBe(
      `مباراة مفتوحة · ${iso('الثلاثاء 29 أيلول، 18:00')}`,
    );
    expect(msg('en', 'match_booked', {}, { when: '' }).title).toBe('Open match');
  });

  it('titles the reminder and the refund on their own', () => {
    expect(msg('en', 'reminder_3h').title).toBe('Your match is in 3 hours');
    expect(msg('ar', 'reminder_3h').title).toBe('مباراتك بعد 3 ساعات');
    expect(msg('en', 'tickets_refunded').title).toBe('Ticket refund sent');
    expect(msg('ar', 'tickets_refunded').title).toBe('استرداد ثمن التذاكر');
  });

  it('isolates every value: the counts LTR as one unit, the rest FSI', () => {
    expect(msg('en', 'player_joined', { seats_taken: 3, seats_total: 4 }).body).toBe(
      `A player joined · ${ltr('3/4')}`,
    );
    expect(msg('ar', 'player_left', { seats_taken: 2, seats_total: 4 }).body).toBe(`غادر لاعب · ${ltr('2/4')}`);
    expect(msg('en', 'deadline_warning', { minutes: 30, seats_taken: 2, seats_total: 4 }).body).toBe(
      `${ltr('30')} minutes left to fill · ${ltr('2/4')}`,
    );
    expect(msg('en', 'match_moved').body).toBe(`The venue moved your match to ${iso('Tue 29 Sep, 18:00')}.`);
    expect(msg('ar', 'match_moved', {}, { when: 'الثلاثاء 29 أيلول، 18:00' }).body).toBe(
      `نقل النادي مباراتك إلى ${iso('الثلاثاء 29 أيلول، 18:00')}.`,
    );
    expect(msg('en', 'reminder_3h').body).toBe(iso('18:00'));
    expect(msg('en', 'reminder_3h', {}, { branch: 'Karrada' }).body).toBe(`${iso('18:00')} · ${iso('Karrada')}`);
  });

  it('drops the counts when either is missing, and the sentence when it needs a missing value', () => {
    expect(msg('en', 'player_joined', { seats_taken: 3 }).body).toBe('A player joined');
    expect(msg('en', 'player_joined', { seats_taken: 'x', seats_total: 4 }).body).toBe('A player joined');
    expect(msg('en', 'deadline_warning', { seats_taken: 2, seats_total: 4 }).body).toBe('');
    expect(msg('en', 'match_moved', {}, { when: '' }).body).toBe('');
    expect(msg('ar', 'reminder_3h', {}, { time: '' }).body).toBe('');
  });

  it('reads counts sent as digits, and never a negative or fractional one', () => {
    expect(msg('en', 'player_left', { seats_taken: '1', seats_total: '4' }).body).toBe(
      `A player left · ${ltr('1/4')}`,
    );
    expect(msg('en', 'player_left', { seats_taken: -1, seats_total: 4 }).body).toBe('A player left');
    expect(msg('en', 'player_left', { seats_taken: 1.5, seats_total: 4 }).body).toBe('A player left');
  });
});

describe('guestMessage — Arabic forms', () => {
  it('uses the feminine third person in a women’s match only', () => {
    expect(msg('ar', 'request_new', {}, { category: 'women' }).body).toBe('طلبت لاعبة الانضمام إلى مباراتك.');
    expect(msg('ar', 'request_new', {}, { category: 'men' }).body).toBe('طلب لاعب الانضمام إلى مباراتك.');
    expect(msg('ar', 'request_new', {}, { category: 'open' }).body).toBe('طلب لاعب الانضمام إلى مباراتك.');
    expect(msg('ar', 'msg_bring_balls', {}, { category: 'women' }).body).toBe('لاعبة تسأل: من ستحضر الكرات؟');
    expect(msg('ar', 'player_joined', { seats_taken: 3, seats_total: 4 }, { category: 'women' }).body).toBe(
      `انضمت لاعبة · ${ltr('3/4')}`,
    );
    // The reader's own gender never changes a third-person line.
    expect(msg('ar', 'seat_refilled', {}, { category: 'open', readerGender: 'female' }).body).toBe(
      'أخذ لاعب آخر مقعدك، وعادت تذكرتك إلى محفظتك.',
    );
  });

  it('addresses the reader by their own gender on the handover, NULL reading as masculine', () => {
    expect(msg('ar', 'organiser_handover', {}, { readerGender: 'female' }).body).toBe('أصبحت منظّمة هذه المباراة.');
    expect(msg('ar', 'organiser_handover', {}, { readerGender: 'male' }).body).toBe('أصبحت منظّم هذه المباراة.');
    expect(msg('ar', 'organiser_handover', {}, { readerGender: null }).body).toBe('أصبحت منظّم هذه المباراة.');
    // A women's match does not decide it: the reader does.
    expect(msg('ar', 'organiser_handover', {}, { category: 'women' }).body).toBe('أصبحت منظّم هذه المباراة.');
  });

  it('keeps English the same whatever the category or reader', () => {
    for (const key of [...CATEGORY_KEYS, ...READER_KEYS]) {
      expect(msg('en', key, {}, { category: 'women', readerGender: 'female' }).body).toBe(msg('en', key).body);
    }
  });
});

describe('plurals of {minutes}', () => {
  it.each([
    [1, `${ltr('1')} minute`, 'دقيقة واحدة'],
    [2, `${ltr('2')} minutes`, 'دقيقتان'],
    [3, `${ltr('3')} minutes`, `${ltr('3')} دقائق`],
    [11, `${ltr('11')} minutes`, `${ltr('11')} دقيقة`],
    [30, `${ltr('30')} minutes`, `${ltr('30')} دقيقة`],
    [100, `${ltr('100')} minutes`, `${ltr('100')} دقيقة`],
  ])('%i', (n, en, ar) => {
    expect(minutesPhrase(n, 'en')).toBe(en);
    expect(minutesPhrase(n, 'ar')).toBe(ar);
    expect(msg('ar', 'deadline_warning', { minutes: n }).body).toBe(`بقيت ${ar} لاكتمال العدد`);
  });

  it('answers as CLDR (Node’s Intl.PluralRules) for 0..300 in both languages', () => {
    for (const lang of LANGS) {
      const rules = new Intl.PluralRules(lang);
      for (let n = 0; n <= 300; n++) expect(pluralForm(n, lang), `${lang} ${n}`).toBe(rules.select(n));
    }
  });
});

describe('times', () => {
  const START = '2026-09-29T15:00:00Z'; // 18:00 in Baghdad

  it('formats in the branch timezone with Latin digits in both languages', () => {
    expect(guestTime(START, 'en', 'Asia/Baghdad')).toBe('18:00');
    expect(guestTime(START, 'en', 'UTC')).toBe('15:00');
    // ar-IQ is a 12-hour clock: "06:00 م", Latin digits.
    expect(guestTime(START, 'ar', 'Asia/Baghdad')).toMatch(/^06:00 /);
    const ar = guestWhen(START, 'ar', 'Asia/Baghdad');
    expect(ar).toMatch(/29/);
    expect(ar).toMatch(/06:00/);
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(ar).not.toMatch(/[٠-٩۰-۹]/);
    expect(guestWhen(START, 'en', 'Asia/Baghdad')).toMatch(/^Tue 29 Sept?, 18:00$/);
  });

  it('falls back to Baghdad time for a timezone the runtime does not know', () => {
    expect(guestTime(START, 'en', 'Mars/Olympus_Mons')).toBe('18:00');
    expect(guestWhen(START, 'en', '')).toMatch(/18:00$/);
  });
});

describe('guestMessage — data and refusals', () => {
  it('carries {kind, route, title_key, id} and nothing else, whatever the params hold', () => {
    const m = guestMessage(
      'en',
      'match_update',
      { ...payloadOf('player_joined', { seats_taken: 3, seats_total: 4, name: 'Ahmed', amount_iqd: 5000 }), dedupe: 'd' } as never,
      ctx(),
      ROUTES,
    );
    expect(m.ok && m.data).toEqual({
      kind: 'match_update',
      route: 'match',
      title_key: 'player_joined',
      id: MATCH_ID,
    });
    expect(m.ok && m.body).not.toMatch(/Ahmed|5000/);
  });

  it('sends the refund with route tickets and no id', () => {
    const m = msg('en', 'tickets_refunded');
    expect(m.data).toEqual({ kind: 'match_update', route: 'tickets', title_key: 'tickets_refunded' });
    expect(m.body).toBe('Your ticket refund was sent to your card. When it shows depends on your bank.');
  });

  it('refuses an unknown or missing title key with UNKNOWN_TITLE_KEY', () => {
    expect(guestMessage('en', 'match_update', payloadOf('match_exploded'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'UNKNOWN_TITLE_KEY:match_exploded',
    });
    expect(guestMessage('ar', 'match_update', { route: 'match', id: MATCH_ID }, ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'UNKNOWN_TITLE_KEY:undefined',
    });
    // Inherited names are not copy.
    expect(guestMessage('en', 'match_update', payloadOf('toString'), ctx(), ROUTES).ok).toBe(false);
  });

  it('refuses a row whose kind is not its key’s kind with KIND_MISMATCH', () => {
    expect(guestMessage('en', 'match_update', payloadOf('reminder_3h'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'KIND_MISMATCH:match_update/reminder_3h',
    });
    expect(guestMessage('en', 'match_message', payloadOf('player_joined'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'KIND_MISMATCH:match_message/player_joined',
    });
    // A key the JSON does not list is a mismatch too, even with copy.
    expect(
      guestMessage('en', 'match_update', payloadOf('player_joined'), ctx({ keyKinds: {} }), ROUTES),
    ).toEqual({ ok: false, error: 'KIND_MISMATCH:match_update/player_joined' });
  });

  it('refuses a route the phone does not know, and a match route without an id, with BAD_ROUTE', () => {
    expect(guestMessage('en', 'match_update', payloadOf('match_booked', {}, 'staff'), ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'BAD_ROUTE',
    });
    expect(
      guestMessage('en', 'match_update', { title_key: 'match_booked', route: 'match', id: null }, ctx(), ROUTES),
    ).toEqual({ ok: false, error: 'BAD_ROUTE' });
    expect(guestMessage('en', 'match_update', { title_key: 'match_booked' }, ctx(), ROUTES)).toEqual({
      ok: false,
      error: 'BAD_ROUTE',
    });
  });
});

describe('send-push/index.ts wiring', () => {
  it('reads the guest kinds, key kinds and routes from the shared list and the copy from guestStrings.ts', () => {
    expect(INDEX).toMatch(/import guestPush from '\.\.\/_shared\/guest-push\.json' with \{ type: 'json' \};/);
    expect(INDEX).toMatch(/import \{ guestMessage, guestMonth, guestTime, guestWhen \} from '\.\/guestStrings\.ts';/);
    expect(INDEX).toMatch(/new Set\(guestPush\.kinds\)/);
    expect(INDEX).toMatch(/new Set\(guestPush\.routes\)/);
    expect(INDEX).toMatch(/= guestPush\.title_keys;/);
  });

  it('caps attempts on every guest refusal, a gone match included', () => {
    const branch = INDEX.slice(
      INDEX.indexOf('if (GUEST_KINDS.has(row.kind))'),
      INDEX.indexOf('const s = STRINGS[lang]'),
    );
    expect(branch).toMatch(/last_error: 'MATCH_GONE', attempts: RETRY_CAP/);
    expect(branch).toMatch(/last_error: g\.error, attempts: RETRY_CAP/);
    expect(branch).toMatch(/priority: 'high'/);
    expect(branch).toMatch(/channelId: ANDROID_CHANNEL_ID/);
  });

  it('caps attempts on a gone lesson, a gone statement and a stale lesson reminder (guest.md §4.6.3)', () => {
    const branch = INDEX.slice(
      INDEX.indexOf('if (GUEST_KINDS.has(row.kind))'),
      INDEX.indexOf('const s = STRINGS[lang]'),
    );
    expect(branch).toMatch(/last_error: 'LESSON_GONE', attempts: RETRY_CAP/);
    expect(branch).toMatch(/last_error: 'STATEMENT_GONE', attempts: RETRY_CAP/);
    // Tournaments (§1.10): a vanished tournament is terminal too.
    expect(branch).toMatch(/last_error: 'TOURNAMENT_GONE', attempts: RETRY_CAP/);
    expect(branch).toMatch(/last_error: 'REMINDER_STALE', attempts: RETRY_CAP/);
    // EC-02: the lesson's status, the enrolment and the due time, in lessonReminder.ts.
    expect(branch).toMatch(/title_key === 'lesson\.reminder' &&\s*reminderStale\(\s*row,\s*lesson,/);
    expect(branch).toMatch(/reminderEnrolments\.get\(row\.payload\.id\)/);
    expect(branch).toMatch(/month: statement \? guestMonth\(statement\.month, lang\) : ''/);
  });

  it('never reads profiles.gender or matches for a claim without guest rows', () => {
    // The main profiles read is the pre-0256 one: this function deploys before
    // the column exists, and every booking and staff push goes through it.
    expect(INDEX).toMatch(/select\('id, expo_push_token, preferred_lang'\)/);
    const guarded = INDEX.slice(INDEX.indexOf('if (guestRows.length > 0) {'));
    const before = INDEX.slice(0, INDEX.indexOf('if (guestRows.length > 0) {'));
    expect(guarded).toMatch(/from\('matches'\)/);
    expect(guarded).toMatch(/select\('id, gender'\)/);
    expect(before).not.toMatch(/from\('matches'\)|select\('[^']*gender/);
  });

  it('never reads lessons or statements without lesson rows', () => {
    const guarded = INDEX.slice(INDEX.indexOf('if (lessonRows.length > 0) {'));
    const before = INDEX.slice(0, INDEX.indexOf('if (lessonRows.length > 0) {'));
    expect(INDEX.indexOf('if (lessonRows.length > 0) {')).toBeGreaterThan(INDEX.indexOf('if (guestRows.length > 0) {'));
    expect(guarded).toMatch(/from\('lessons'\)\.select\('id, start_at, venue_id, status'\)/);
    expect(guarded).toMatch(/from\('coach_statements'\)\.select\('id, month, venue_id'\)/);
    expect(before).not.toMatch(/from\('lessons'\)|from\('coach_statements'\)/);
  });

  it('reads the enrolments of the claimed lesson reminders only, beside the lessons (EC-02)', () => {
    const guarded = INDEX.slice(INDEX.indexOf('if (lessonRows.length > 0) {'));
    const before = INDEX.slice(0, INDEX.indexOf('if (lessonRows.length > 0) {'));
    expect(guarded).toMatch(/lessonRows\.filter\(isLessonReminder\)\.map\(\(r\) => r\.payload\.id\)\.filter\(\(id\): id is string => isUuid\(id\)\)/);
    expect(guarded).toMatch(
      /from\('lesson_enrolments'\)\s*\.select\('id, guest_id, status, booked_by_kind, link_confirmed_at'\)\s*\.in\('id', enrolmentIds\)/,
    );
    expect(guarded).toMatch(/return readFailed\('lesson_enrolments', enrolmentsRes\.error\)/);
    expect(before).not.toMatch(/from\('lesson_enrolments'\)/);
    expect(INDEX).toMatch(/import \{ reminderStale, type ReminderEnrolment \} from '\.\/lessonReminder\.ts';/);
    // The claim returns the whole outbox row (0090), scheduled_for included.
    expect(INDEX).toMatch(/\n {2}scheduled_for: string;\n/);
  });
});

describe('send-push: a lesson reminder already due after a cancel or a move (EC-02)', () => {
  const PROFILE = '55555555-6666-4777-8888-999999999999';
  const START = '2026-10-10T15:00:00+00:00';
  const DUE = '2026-10-10T12:00:00+00:00';
  const row = { profile_id: PROFILE, scheduled_for: DUE };
  const lesson = { start_at: START, status: 'scheduled' };
  const enrolment = {
    id: ENROLMENT_ID,
    guest_id: PROFILE,
    status: 'booked',
    booked_by_kind: 'guest',
    link_confirmed_at: '2026-10-01T10:00:00+00:00',
  };

  it('sends a reminder whose student is still booked on a lesson that has not moved', () => {
    expect(reminderStale(row, lesson, enrolment)).toBe(false);
    // A coach-added place whose link the guest confirmed is a student's too.
    expect(reminderStale(row, lesson, { ...enrolment, booked_by_kind: 'coach' })).toBe(false);
    // Within the 2-minute slack either way; the database's microseconds parse.
    expect(reminderStale({ ...row, scheduled_for: '2026-10-10T12:01:59.123456+00:00' }, lesson, enrolment)).toBe(false);
    expect(reminderStale({ ...row, scheduled_for: '2026-10-10T11:58:00Z' }, lesson, enrolment)).toBe(false);
    expect(REMINDER_LEAD_MS).toBe(3 * 3600 * 1000);
    expect(REMINDER_SLACK_MS).toBe(2 * 60 * 1000);
  });

  it('is stale for a cancelled, expired or held enrolment, or one gone', () => {
    for (const status of ['cancelled', 'expired', 'held', 'no_show']) {
      expect(reminderStale(row, lesson, { ...enrolment, status }), status).toBe(true);
    }
    expect(reminderStale(row, lesson, undefined)).toBe(true);
  });

  it('is stale for an enrolment that is not this account’s, or an unconfirmed link', () => {
    expect(reminderStale(row, lesson, { ...enrolment, guest_id: null })).toBe(true);
    expect(reminderStale(row, lesson, { ...enrolment, guest_id: MATCH_ID })).toBe(true);
    expect(reminderStale(row, lesson, { ...enrolment, booked_by_kind: 'staff', link_confirmed_at: null })).toBe(true);
  });

  it('is stale for a lesson moved since the reminder was queued, or no longer scheduled', () => {
    expect(reminderStale(row, { ...lesson, start_at: '2026-10-10T18:00:00+00:00' }, enrolment)).toBe(true);
    expect(reminderStale(row, { ...lesson, start_at: '2026-10-10T14:57:59+00:00' }, enrolment)).toBe(true);
    expect(reminderStale(row, { ...lesson, status: 'cancelled' }, enrolment)).toBe(true);
    expect(reminderStale(row, undefined, enrolment)).toBe(true);
    expect(reminderStale({ ...row, scheduled_for: 'not a time' }, lesson, enrolment)).toBe(true);
  });
});
