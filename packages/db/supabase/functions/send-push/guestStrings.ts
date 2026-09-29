/**
 * send-push — the guest (open matches) kinds' copy and message shape. PURE: no
 * imports, no `Deno.*`, no fetch, so it runs unchanged under Deno (index.ts)
 * and under vitest (tests/send-push-guest.test.ts), as staffStrings.ts does.
 *
 * A guest row (`match_update`, `match_reminder`, `match_message`, queued only
 * by app.match_notify, 0261) names its copy by `payload.title_key`, with
 * `payload` = `{route, id, title_key, params, dedupe?}` and `params` closed to
 * `{seats_taken, seats_total, minutes}` (build contracts §1.9). The one list of
 * kinds, title keys (each with its kind) and routes is _shared/guest-push.json;
 * the test holds GUEST_STRINGS to it.
 *
 * No body names a person or carries an amount (OM-31): a lock screen shows
 * "a player", never who. The match's time and branch come from the match row,
 * read by index.ts, never from the payload.
 *
 * SOURCE OF TRUTH for the wording is docs/design/open-matches/guest.md §4.7.4.
 * The Arabic is a DRAFT for the client's review (DRAFT-AR). Where Arabic needs a
 * gender, a third person ("a player") follows the match's category (feminine
 * in a women's match), and a line addressed to the reader follows the reader's
 * own profiles.gender (NULL reads as masculine).
 */

export type Lang = 'en' | 'ar';

/** Which title a key shows: the match line, the 3-hour reminder, or the refund. */
export type GuestTitle = 'match' | 'reminder' | 'tickets';

/**
 * How the Arabic body picks its form: 'category' uses `bodyF` in a women's
 * match, 'reader' uses `bodyF` when the recipient is a woman, 'none' has one.
 */
export type GuestForm = 'none' | 'category' | 'reader';

/**
 * What a body may interpolate, each already a string and bidi-isolated, ''
 * when absent. `seats` is "taken/total" left-to-right isolated as one unit (a
 * slash between two numbers must never flip in Arabic); `minutes` is a counted
 * phrase ("12 minutes", «12 دقيقة»); `when`, `time` and `branch` are
 * FSI-isolated.
 */
export interface GuestVars {
  seats: string;
  minutes: string;
  when: string;
  time: string;
  branch: string;
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
};

export const GUEST_STRINGS: Record<Lang, Record<GuestTitleKey, GuestCopy>> = { en: EN, ar: AR };

/** The three titles. `{when}` and `{branch}` arrive isolated; either may be ''. */
const TITLES: Record<Lang, Record<GuestTitle, (when: string, branch: string) => string>> = {
  en: {
    match: (when, branch) => ['Open match', when, branch].filter(Boolean).join(' · '),
    reminder: () => 'Your match is in 3 hours',
    tickets: () => 'Ticket refund sent',
  },
  ar: {
    match: (when, branch) => ['مباراة مفتوحة', when, branch].filter(Boolean).join(' · '),
    reminder: () => 'مباراتك بعد 3 ساعات',
    tickets: () => 'استرداد ثمن التذاكر',
  },
};

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

// ── the message ─────────────────────────────────────────────────────────────

/** What index.ts knows about the row beyond its payload. Raw strings; isolated here. */
export interface GuestContext {
  /** title_key → kind, _shared/guest-push.json `title_keys`. */
  keyKinds: Readonly<Record<string, string>>;
  /** The match's category (open, women, men); null without a match. */
  category: string | null;
  /** The recipient's profiles.gender; NULL counts as masculine. */
  readerGender: string | null;
  /** guestWhen of the match start, '' without a match. */
  when: string;
  /** guestTime of the match start, '' without a match. */
  time: string;
  /** The branch name in the reader's language when more than one venue is active, else ''. */
  branch: string;
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
 * the phone does not know, or a 'match' route without a match id). `data` is
 * `{kind, route, title_key}` plus `id` when it is a string: never a name or an
 * amount.
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
  if (!routes.has(route) || (route === 'match' && !id)) return { ok: false, error: 'BAD_ROUTE' };

  const p = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as {
    seats_taken?: unknown;
    seats_total?: unknown;
    minutes?: unknown;
  };
  const taken = count(p.seats_taken);
  const total = count(p.seats_total);
  const minutes = count(p.minutes);
  const wrap = (s: string) => (s ? isolate(s) : '');
  const vars: GuestVars = {
    seats: taken !== null && total !== null ? isolateLtr(`${taken}/${total}`) : '',
    minutes: minutes !== null ? minutesPhrase(minutes, lang) : '',
    when: wrap(ctx.when),
    time: wrap(ctx.time),
    branch: wrap(ctx.branch),
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
