/**
 * send-push — the guest kinds' copy and message shape: open matches and
 * coaching. PURE: no imports, no `Deno.*`, no fetch, so it runs unchanged under
 * Deno (index.ts) and under vitest (tests/send-push-guest.test.ts), as
 * staffStrings.ts does.
 *
 * A guest row (`match_update`, `match_reminder`, `match_message`, queued only
 * by app.match_notify, 0261) names its copy by `payload.title_key`, with
 * `payload` = `{route, id, title_key, params, dedupe?}` and `params` closed to
 * `{seats_taken, seats_total, minutes}` (build contracts §1.9). The one list of
 * kinds, title keys (each with its kind) and routes is _shared/guest-push.json;
 * the test holds GUEST_STRINGS to it.
 *
 * Coaching (docs/design/coaching/guest.md §4.6; build contracts §1.9, R18): a
 * lesson row (`lesson_update`, `lesson_reminder`, `coach_update`, queued only
 * by app.lesson_notify from lesson_booking) has the same payload with `params` closed to
 * `{lesson_id, places_taken, places_total}`. A coach is a guest, so a coach's
 * pushes ride this family. Every lesson key is form 'none': no third person on
 * these lock screens has a known gender, and the role nouns are the generic
 * forms.
 *
 * Tournaments (docs/design/tournaments/build-contracts-2026-10-03.md §1.10): one kind,
 * `tournament_update`, queued only by app.tournament_notify (tournaments_lifecycle), with
 * route `tournament`, id = the tournament and `params` empty. Both keys are form 'none'.
 *
 * No body names a person or carries an amount (OM-31, CD-7): a lock screen
 * shows "a player" or "a booking", never who or how much. The time and branch
 * come from the match or lesson row and a statement's month from the statement
 * row, read by index.ts, never from the payload.
 *
 * SOURCE OF TRUTH for the wording is docs/design/open-matches/guest.md §4.7.4
 * and docs/design/coaching/guest.md §4.6.4 (the lesson is «حصة» everywhere,
 * C-30). The Arabic is a DRAFT for the client's review (DRAFT-AR). Where Arabic
 * needs a gender, a third person ("a player") follows the match's category
 * (feminine in a women's match), and a line addressed to the reader follows
 * the reader's own profiles.gender (NULL reads as masculine).
 */

export type Lang = 'en' | 'ar';

/**
 * Which title a key shows: the match line, the 3-hour match reminder, the
 * ticket refund; the lesson line, the 3-hour lesson reminder, the coach's
 * line, the coach's statement, or the tournament line.
 */
export type GuestTitle =
  | 'match'
  | 'reminder'
  | 'tickets'
  | 'lesson'
  | 'lessonReminder'
  | 'coach'
  | 'statement'
  | 'tournament';

/**
 * How the Arabic body picks its form: 'category' uses `bodyF` in a women's
 * match, 'reader' uses `bodyF` when the recipient is a woman, 'none' has one.
 */
export type GuestForm = 'none' | 'category' | 'reader';

/**
 * What a body may interpolate, each already a string and bidi-isolated, ''
 * when absent. `seats` and `places` are "taken/total" left-to-right isolated
 * as one unit (a slash between two numbers must never flip in Arabic);
 * `minutes` is a counted phrase ("12 minutes", «12 دقيقة»); `when`, `time`,
 * `branch` and `month` (a statement's month and year in the reader's language)
 * are FSI-isolated.
 */
export interface GuestVars {
  seats: string;
  minutes: string;
  when: string;
  time: string;
  branch: string;
  places: string;
  month: string;
}

export interface GuestCopy {
  title: GuestTitle;
  form: GuestForm;
  /** '' = send the title alone (a value the sentence needs is missing). */
  body: (v: GuestVars) => string;
  /** The feminine form, for 'category' and 'reader' keys (Arabic only). */
  bodyF?: (v: GuestVars) => string;
}

/** FSI … PDI, as @touch/i18n `isolate`. */
const isolate = (s: string): string => `⁨${s}⁩`;
/** LRI … PDI, as @touch/i18n `isolateLtr`. */
const isolateLtr = (s: string): string => `⁦${s}⁩`;

/** " · 2/4", or '' without the counts. */
const seatsAfter = (v: GuestVars): string => (v.seats ? ` · ${v.seats}` : '');
/** " · 3/8", or '' without the counts (a private lesson sends neither). */
const placesAfter = (v: GuestVars): string => (v.places ? ` · ${v.places}` : '');
/** " · Karrada", or '' with one branch. */
const branchAfter = (v: GuestVars): string => (v.branch ? ` · ${v.branch}` : '');

const EN = {
  request_new: { title: 'match', form: 'category', body: () => 'A player asked to join your match.' },
  request_expired: {
    title: 'match',
    form: 'none',
    body: () => 'Your request to join closed. Your tickets are back in your wallet.',
  },
  player_joined: { title: 'match', form: 'category', body: (v) => `A player joined${seatsAfter(v)}` },
  player_left: { title: 'match', form: 'category', body: (v) => `A player left${seatsAfter(v)}` },
  request_approved: {
    title: 'match',
    form: 'category',
    body: () => "You're in. The organiser approved your request.",
  },
  request_declined: {
    title: 'match',
    form: 'none',
    body: () => "Your request wasn't accepted. Your tickets are back in your wallet.",
  },
  match_booked: {
    title: 'match',
    form: 'none',
    body: () => 'Four players are in and the court is booked. See you there!',
  },
  match_waiting_court: {
    title: 'match',
    form: 'none',
    body: () => "Four players are in. We'll book the court as soon as one is free.",
  },
  deadline_warning: {
    title: 'match',
    form: 'none',
    body: (v) => (v.minutes ? `${v.minutes} left to fill${seatsAfter(v)}` : ''),
  },
  match_cancelled: {
    title: 'match',
    form: 'none',
    body: () => 'The match was cancelled. Your tickets are back in your wallet.',
  },
  match_bumped: {
    title: 'match',
    form: 'none',
    body: () =>
      'A group booked the last free court, so the match was cancelled. Your tickets are back in your wallet.',
  },
  match_expired: {
    title: 'match',
    form: 'none',
    body: () =>
      "The match didn't fill in time and was cancelled. Your tickets are back in your wallet.",
  },
  match_moved: {
    title: 'match',
    form: 'none',
    body: (v) => (v.when ? `The venue moved your match to ${v.when}.` : ''),
  },
  reminder_3h: {
    title: 'reminder',
    form: 'none',
    body: (v) => (v.time ? `${v.time}${v.branch ? ` · ${v.branch}` : ''}` : ''),
  },
  organiser_handover: {
    title: 'match',
    form: 'reader',
    body: () => "You're now the organiser of this match.",
  },
  seat_removed: {
    title: 'match',
    form: 'none',
    body: () => "You're no longer in this match. Open the app for details.",
  },
  seat_refilled: {
    title: 'match',
    form: 'category',
    body: () => 'Another player took your seat. Your ticket is back in your wallet.',
  },
  ticket_forfeited: {
    title: 'match',
    form: 'none',
    body: () => "Your ticket for this match is lost because you didn't play in it.",
  },
  tickets_refunded: {
    title: 'tickets',
    form: 'none',
    body: () => 'Your ticket refund was sent to your card. When it shows depends on your bank.',
  },
  msg_on_my_way: { title: 'match', form: 'category', body: () => 'A player is on the way.' },
  msg_running_late: { title: 'match', form: 'category', body: () => 'A player is running late.' },
  msg_cant_make_it: { title: 'match', form: 'category', body: () => "A player can't make it." },
  msg_bring_balls: {
    title: 'match',
    form: 'category',
    body: () => "A player asks: who's bringing balls?",
  },
  // ── coaching (docs/design/coaching/guest.md §4.6.4) ──────────────────────
  'lesson.booked': {
    title: 'lesson',
    form: 'none',
    body: () => "You're booked in. The details are in the app.",
  },
  'lesson.cancelled_by_coach': {
    title: 'lesson',
    form: 'none',
    body: () =>
      'The coach cancelled your place in this lesson. Anything you paid online is refunded to your card.',
  },
  'lesson.cancelled_by_staff': {
    title: 'lesson',
    form: 'none',
    body: () =>
      'The venue cancelled your place in this lesson. Anything you paid online is refunded to your card.',
  },
  'lesson.under_filled': {
    title: 'lesson',
    form: 'none',
    body: () =>
      'Not enough people signed up, so it was cancelled. Anything you paid online is refunded to your card.',
  },
  'lesson.rescheduled': {
    title: 'lesson',
    form: 'none',
    body: (v) => (v.when ? `Your lesson moved to ${v.when}. You can cancel free until it starts.` : ''),
  },
  'lesson.court_moved': {
    title: 'lesson',
    form: 'none',
    body: () => 'Your lesson moved to another court, at the same time.',
  },
  'lesson.payment_expired': {
    title: 'lesson',
    form: 'none',
    body: () => "The payment wasn't completed in time, so your place was released. No money was taken.",
  },
  'lesson.added_by_coach': {
    title: 'lesson',
    form: 'none',
    body: () => "You've been added to a lesson. Open the app to confirm it's you.",
  },
  'lesson.reminder': {
    title: 'lessonReminder',
    form: 'none',
    body: (v) => (v.time ? `${v.time}${branchAfter(v)}` : ''),
  },
  'coach.new_student': {
    title: 'coach',
    form: 'none',
    body: (v) => `New booking in your lesson${placesAfter(v)}`,
  },
  'coach.student_cancelled': {
    title: 'coach',
    form: 'none',
    body: (v) => `A booking in your lesson was cancelled${placesAfter(v)}`,
  },
  'coach.lesson_cancelled_by_staff': {
    title: 'coach',
    form: 'none',
    body: () => 'The venue cancelled this lesson. Your students have been told.',
  },
  'coach.under_filled': {
    title: 'coach',
    form: 'none',
    body: () => 'Not enough people signed up, so it was cancelled. Your students have been told.',
  },
  'coach.statement_ready': {
    title: 'statement',
    form: 'none',
    body: (v) => (v.month ? `Your statement for ${v.month} is ready to view.` : ''),
  },
  'coach.statement_paid': {
    title: 'statement',
    form: 'none',
    body: (v) => (v.month ? `Your statement for ${v.month} is marked as paid.` : ''),
  },
  'coach.session_added': {
    title: 'coach',
    form: 'none',
    body: () => 'The venue scheduled a session for you.',
  },
  'coach.rescheduled_by_staff': {
    title: 'coach',
    form: 'none',
    body: (v) => (v.when ? `The venue moved this session to ${v.when}.` : ''),
  },
  'coach.court_moved': {
    title: 'coach',
    form: 'none',
    body: () => 'This lesson moved to another court, at the same time.',
  },
  // ── tournaments (docs/design/tournaments/build-contracts-2026-10-03.md §1.10) ─
  'tournament.cancelled': {
    title: 'tournament',
    form: 'none',
    body: () => 'This tournament was cancelled. If you paid at the desk, the venue refunds you there.',
  },
  'tournament.promoted': {
    title: 'tournament',
    form: 'none',
    body: () => "A place opened up: you're now registered for this tournament.",
  },
} satisfies Record<string, GuestCopy>;

export type GuestTitleKey = keyof typeof EN;

// Typed by EN's keys, so a missing or extra Arabic entry fails typecheck.
// DRAFT-AR: every line below is on the client's review list.
const AR: Record<GuestTitleKey, GuestCopy> = {
  request_new: {
    title: 'match',
    form: 'category',
    body: () => 'طلب لاعب الانضمام إلى مباراتك.',
    bodyF: () => 'طلبت لاعبة الانضمام إلى مباراتك.',
  },
  request_expired: {
    title: 'match',
    form: 'none',
    body: () => 'أُغلق طلب انضمامك، وعادت تذاكرك إلى محفظتك.',
  },
  player_joined: {
    title: 'match',
    form: 'category',
    body: (v) => `انضم لاعب${seatsAfter(v)}`,
    bodyF: (v) => `انضمت لاعبة${seatsAfter(v)}`,
  },
  player_left: {
    title: 'match',
    form: 'category',
    body: (v) => `غادر لاعب${seatsAfter(v)}`,
    bodyF: (v) => `غادرت لاعبة${seatsAfter(v)}`,
  },
  request_approved: {
    title: 'match',
    form: 'category',
    body: () => 'وافق المنظّم على طلبك، ولك مقعد في المباراة.',
    bodyF: () => 'وافقت المنظّمة على طلبك، ولك مقعد في المباراة.',
  },
  request_declined: {
    title: 'match',
    form: 'none',
    body: () => 'لم يُقبل طلبك، وعادت تذاكرك إلى محفظتك.',
  },
  match_booked: { title: 'match', form: 'none', body: () => 'اكتمل العدد وحُجز الملعب. نراك هناك!' },
  match_waiting_court: {
    title: 'match',
    form: 'none',
    body: () => 'اكتمل العدد، وسنحجز الملعب فور توفّره.',
  },
  deadline_warning: {
    title: 'match',
    form: 'none',
    body: (v) => (v.minutes ? `بقيت ${v.minutes} لاكتمال العدد${seatsAfter(v)}` : ''),
  },
  match_cancelled: {
    title: 'match',
    form: 'none',
    body: () => 'أُلغيت المباراة، وعادت تذاكرك إلى محفظتك.',
  },
  match_bumped: {
    title: 'match',
    form: 'none',
    body: () => 'حجزت مجموعة آخر ملعب متاح، فأُلغيت المباراة وعادت تذاكرك إلى محفظتك.',
  },
  match_expired: {
    title: 'match',
    form: 'none',
    body: () => 'لم يكتمل العدد في الوقت المحدد، فأُلغيت المباراة وعادت تذاكرك إلى محفظتك.',
  },
  match_moved: {
    title: 'match',
    form: 'none',
    body: (v) => (v.when ? `نقل النادي مباراتك إلى ${v.when}.` : ''),
  },
  reminder_3h: {
    title: 'reminder',
    form: 'none',
    body: (v) => (v.time ? `${v.time}${v.branch ? ` · ${v.branch}` : ''}` : ''),
  },
  organiser_handover: {
    title: 'match',
    form: 'reader',
    body: () => 'أصبحت منظّم هذه المباراة.',
    bodyF: () => 'أصبحت منظّمة هذه المباراة.',
  },
  seat_removed: {
    title: 'match',
    form: 'none',
    body: () => 'لم يعد لك مقعد في هذه المباراة، والتفاصيل في التطبيق.',
  },
  seat_refilled: {
    title: 'match',
    form: 'category',
    body: () => 'أخذ لاعب آخر مقعدك، وعادت تذكرتك إلى محفظتك.',
    bodyF: () => 'أخذت لاعبة أخرى مقعدك، وعادت تذكرتك إلى محفظتك.',
  },
  ticket_forfeited: {
    title: 'match',
    form: 'none',
    body: () => 'فُقدت تذكرة هذه المباراة لعدم اللعب فيها.',
  },
  tickets_refunded: {
    title: 'tickets',
    form: 'none',
    body: () => 'أُرسل المبلغ المستردّ إلى بطاقتك، ويعتمد موعد ظهوره على مصرفك.',
  },
  msg_on_my_way: {
    title: 'match',
    form: 'category',
    body: () => 'لاعب في الطريق.',
    bodyF: () => 'لاعبة في الطريق.',
  },
  msg_running_late: {
    title: 'match',
    form: 'category',
    body: () => 'لاعب سيتأخر قليلًا.',
    bodyF: () => 'لاعبة ستتأخر قليلًا.',
  },
  msg_cant_make_it: {
    title: 'match',
    form: 'category',
    body: () => 'لاعب لن يتمكن من الحضور.',
    bodyF: () => 'لاعبة لن تتمكن من الحضور.',
  },
  msg_bring_balls: {
    title: 'match',
    form: 'category',
    body: () => 'لاعب يسأل: من سيحضر الكرات؟',
    bodyF: () => 'لاعبة تسأل: من ستحضر الكرات؟',
  },
  // ── coaching: «حصة» is the lesson (C-30); every line DRAFT-AR ─────────────
  'lesson.booked': {
    title: 'lesson',
    form: 'none',
    body: () => 'تم حجز مكانك، والتفاصيل في التطبيق.',
  },
  'lesson.cancelled_by_coach': {
    title: 'lesson',
    form: 'none',
    body: () => 'أُلغي مكانك في هذه الحصة من قِبل المدرّب، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك.',
  },
  'lesson.cancelled_by_staff': {
    title: 'lesson',
    form: 'none',
    body: () => 'ألغى النادي مكانك في هذه الحصة، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك.',
  },
  'lesson.under_filled': {
    title: 'lesson',
    form: 'none',
    body: () => 'لم يكتمل الحد الأدنى من المشتركين فأُلغيت، ويُعاد ما دُفع إلكترونيًا إلى بطاقتك.',
  },
  'lesson.rescheduled': {
    title: 'lesson',
    form: 'none',
    body: (v) => (v.when ? `نُقلت حصتك إلى ${v.when}، ويمكن إلغاؤها مجانًا حتى موعد بدئها.` : ''),
  },
  'lesson.court_moved': {
    title: 'lesson',
    form: 'none',
    body: () => 'نُقلت حصتك إلى ملعب آخر في الوقت نفسه.',
  },
  'lesson.payment_expired': {
    title: 'lesson',
    form: 'none',
    body: () => 'لم يكتمل الدفع في الوقت المحدد، فأُلغي حجز مكانك ولم يُخصم أي مبلغ.',
  },
  'lesson.added_by_coach': {
    title: 'lesson',
    form: 'none',
    body: () => 'تمت إضافتك إلى حصة. يُرجى فتح التطبيق لتأكيد أن الحجز لك.',
  },
  'lesson.reminder': {
    title: 'lessonReminder',
    form: 'none',
    body: (v) => (v.time ? `${v.time}${branchAfter(v)}` : ''),
  },
  'coach.new_student': {
    title: 'coach',
    form: 'none',
    body: (v) => `حجز جديد في حصتك${placesAfter(v)}`,
  },
  'coach.student_cancelled': {
    title: 'coach',
    form: 'none',
    body: (v) => `أُلغي حجز في حصتك${placesAfter(v)}`,
  },
  'coach.lesson_cancelled_by_staff': {
    title: 'coach',
    form: 'none',
    body: () => 'ألغى النادي هذه الحصة، وأُبلغ المتدرّبون.',
  },
  'coach.under_filled': {
    title: 'coach',
    form: 'none',
    body: () => 'لم يكتمل الحد الأدنى من المشتركين فأُلغيت، وأُبلغ المتدرّبون.',
  },
  'coach.statement_ready': {
    title: 'statement',
    form: 'none',
    body: (v) => (v.month ? `كشف حسابك لشهر ${v.month} جاهز للاطلاع.` : ''),
  },
  'coach.statement_paid': {
    title: 'statement',
    form: 'none',
    body: (v) => (v.month ? `سُجّل كشف حسابك لشهر ${v.month} مدفوعًا.` : ''),
  },
  'coach.session_added': {
    title: 'coach',
    form: 'none',
    body: () => 'جدول النادي حصة لك.',
  },
  'coach.rescheduled_by_staff': {
    title: 'coach',
    form: 'none',
    body: (v) => (v.when ? `نقل النادي هذه الحصة إلى ${v.when}.` : ''),
  },
  'coach.court_moved': {
    title: 'coach',
    form: 'none',
    body: () => 'نُقلت هذه الحصة إلى ملعب آخر في الوقت نفسه.',
  },
  // ── tournaments: «بطولة»; every line DRAFT-AR ───────────────────────────────
  'tournament.cancelled': {
    title: 'tournament',
    form: 'none',
    body: () => 'أُلغيت هذه البطولة، ومن دفع في النادي يُعاد إليه المبلغ هناك.',
  },
  'tournament.promoted': {
    title: 'tournament',
    form: 'none',
    body: () => 'توفّر مكان، وتمّ تسجيلك في هذه البطولة.',
  },
};

export const GUEST_STRINGS: Record<Lang, Record<GuestTitleKey, GuestCopy>> = { en: EN, ar: AR };

/** The eight titles. `{when}` and `{branch}` arrive isolated; either may be ''. */
const TITLES: Record<Lang, Record<GuestTitle, (when: string, branch: string) => string>> = {
  en: {
    match: (when, branch) => ['Open match', when, branch].filter(Boolean).join(' · '),
    reminder: () => 'Your match is in 3 hours',
    tickets: () => 'Ticket refund sent',
    lesson: (when, branch) => ['Lesson', when, branch].filter(Boolean).join(' · '),
    lessonReminder: () => 'Your lesson is in 3 hours',
    coach: (when, branch) => ['Coaching', when, branch].filter(Boolean).join(' · '),
    statement: () => 'Your coach statement',
    tournament: (when, branch) => ['Tournament', when, branch].filter(Boolean).join(' · '),
  },
  // DRAFT-AR
  ar: {
    match: (when, branch) => ['مباراة مفتوحة', when, branch].filter(Boolean).join(' · '),
    reminder: () => 'مباراتك بعد 3 ساعات',
    tickets: () => 'استرداد ثمن التذاكر',
    lesson: (when, branch) => ['حصة', when, branch].filter(Boolean).join(' · '),
    lessonReminder: () => 'حصتك بعد 3 ساعات',
    coach: (when, branch) => ['تدريب', when, branch].filter(Boolean).join(' · '),
    statement: () => 'كشف حساب المدرّب',
    tournament: (when, branch) => ['بطولة', when, branch].filter(Boolean).join(' · '),
  },
};

/** The routes whose payload must name an id (`tickets` and `coach_statements` need none). */
const ROUTES_WITH_ID: ReadonlySet<string> = new Set(['match', 'lesson', 'coach_lesson', 'tournament']);

// ── plurals ─────────────────────────────────────────────────────────────────
// A copy of packages/i18n's pluralForm (Deno cannot import a workspace
// package), hand-coded to CLDR rather than Intl.PluralRules, whose support in
// every runtime is not a given. The test compares it with Node's CLDR data for
// 0..300 in both languages.
export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export function pluralForm(n: number, lang: Lang): PluralForm {
  if (lang === 'en') return n === 1 ? 'one' : 'other';
  if (n === 0) return 'zero';
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const r = n % 100;
  if (r >= 3 && r <= 10) return 'few';
  if (r >= 11 && r <= 99) return 'many';
  return 'other';
}

/** "{count} minutes" in the reader's language; {count} is LTR-isolated Latin digits. */
const MINUTES: Record<Lang, Record<PluralForm, (count: string) => string>> = {
  en: {
    zero: (c) => `${c} minutes`,
    one: (c) => `${c} minute`,
    two: (c) => `${c} minutes`,
    few: (c) => `${c} minutes`,
    many: (c) => `${c} minutes`,
    other: (c) => `${c} minutes`,
  },
  ar: {
    zero: (c) => `${c} دقيقة`,
    one: () => 'دقيقة واحدة',
    two: () => 'دقيقتان',
    few: (c) => `${c} دقائق`,
    many: (c) => `${c} دقيقة`,
    other: (c) => `${c} دقيقة`,
  },
};

export function minutesPhrase(n: number, lang: Lang): string {
  return MINUTES[lang][pluralForm(n, lang)](isolateLtr(String(n)));
}

// ── times ───────────────────────────────────────────────────────────────────
// In the match's branch timezone, Latin digits in both languages (the app pins
// them the same way, packages/i18n/src/formatting.ts). The booking kinds keep
// index.ts formatWhen as it is.
function timeFormat(lang: Lang, timeZone: string, withDay: boolean): Intl.DateTimeFormat {
  const locale = lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB';
  const options: Intl.DateTimeFormatOptions = {
    ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    // A timezone the runtime does not know must not fail the whole claim: the
    // venue's default zone, as the booking kinds use.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Baghdad' });
  }
}

/** `{when}`: weekday, day, month, hour and minute. */
export function guestWhen(iso: string, lang: Lang, timeZone: string): string {
  return timeFormat(lang, timeZone, true).format(new Date(iso));
}

/** `{time}`: hour and minute only. */
export function guestTime(iso: string, lang: Lang, timeZone: string): string {
  return timeFormat(lang, timeZone, false).format(new Date(iso));
}

/**
 * `{month}`: a coach statement's month and year in the reader's language,
 * Latin digits. coach_statements.month is a date (the first of the month), so
 * it is read in UTC and never shifts a day.
 */
export function guestMonth(date: string, lang: Lang): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

// ── the message ─────────────────────────────────────────────────────────────

/** What index.ts knows about the row beyond its payload. Raw strings; isolated here. */
export interface GuestContext {
  /** title_key → kind, _shared/guest-push.json `title_keys`. */
  keyKinds: Readonly<Record<string, string>>;
  /** The match's category (open, women, men); null without a match. */
  category: string | null;
  /** The recipient's profiles.gender; NULL counts as masculine. */
  readerGender: string | null;
  /** guestWhen of the match or lesson start, '' without one. */
  when: string;
  /** guestTime of the match or lesson start, '' without one. */
  time: string;
  /** The branch name in the reader's language when more than one venue is active, else ''. */
  branch: string;
  /** guestMonth of a coach statement's month, '' without a statement. */
  month: string;
}

export type GuestMessage =
  | { ok: true; title: string; body: string; data: Record<string, string> }
  | { ok: false; error: string };

/** A non-negative whole number from a param (a JSON number or digits), else null. */
function count(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000) return v;
  if (typeof v === 'string' && /^\d{1,6}$/.test(v)) return Number(v);
  return null;
}

/**
 * The Expo title, body and `data` for one guest outbox row, or the terminal
 * error to record: `UNKNOWN_TITLE_KEY:<key>`, `KIND_MISMATCH:<kind>/<key>` (the
 * row's kind is not the key's kind in guest-push.json) or `BAD_ROUTE` (a route
 * the phone does not know, or a 'match', 'lesson' or 'coach_lesson' route
 * without its id). `data` is `{kind, route, title_key}` plus `id` when it is a
 * string: never a name, an amount or a lesson_id param.
 */
export function guestMessage(
  lang: Lang,
  kind: string,
  payload: { title_key?: unknown; route?: unknown; id?: unknown; params?: unknown },
  ctx: GuestContext,
  routes: ReadonlySet<string>,
): GuestMessage {
  const key = typeof payload.title_key === 'string' ? payload.title_key : '';
  const copy = Object.hasOwn(GUEST_STRINGS[lang], key)
    ? GUEST_STRINGS[lang][key as GuestTitleKey]
    : undefined;
  if (!copy) return { ok: false, error: `UNKNOWN_TITLE_KEY:${key || String(payload.title_key)}` };
  if (!Object.hasOwn(ctx.keyKinds, key) || ctx.keyKinds[key] !== kind) {
    return { ok: false, error: `KIND_MISMATCH:${kind}/${key}` };
  }
  const route = typeof payload.route === 'string' ? payload.route : '';
  const id = typeof payload.id === 'string' && payload.id ? payload.id : null;
  if (!routes.has(route) || (ROUTES_WITH_ID.has(route) && !id)) return { ok: false, error: 'BAD_ROUTE' };

  const p = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as {
    seats_taken?: unknown;
    seats_total?: unknown;
    minutes?: unknown;
    places_taken?: unknown;
    places_total?: unknown;
  };
  const taken = count(p.seats_taken);
  const total = count(p.seats_total);
  const minutes = count(p.minutes);
  const placesTaken = count(p.places_taken);
  const placesTotal = count(p.places_total);
  const wrap = (s: string) => (s ? isolate(s) : '');
  const vars: GuestVars = {
    seats: taken !== null && total !== null ? isolateLtr(`${taken}/${total}`) : '',
    minutes: minutes !== null ? minutesPhrase(minutes, lang) : '',
    when: wrap(ctx.when),
    time: wrap(ctx.time),
    branch: wrap(ctx.branch),
    places:
      placesTaken !== null && placesTotal !== null ? isolateLtr(`${placesTaken}/${placesTotal}`) : '',
    month: wrap(ctx.month),
  };

  const feminine =
    (copy.form === 'category' && ctx.category === 'women') ||
    (copy.form === 'reader' && ctx.readerGender === 'female');
  const body = (feminine && copy.bodyF ? copy.bodyF : copy.body)(vars);
  const title = TITLES[lang][copy.title](vars.when, vars.branch);

  const data: Record<string, string> = { kind, route, title_key: key };
  if (id) data.id = id;
  return { ok: true, title, body, data };
}
