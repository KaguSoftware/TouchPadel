/**
 * send-push, guest kinds of open matches (build contracts §1.9, R3;
 * docs/design/open-matches/guest.md §4.7). Pure: no stack, no network. The
 * copy and the message shape live in supabase/functions/send-push/guestStrings.ts
 * so they run here unchanged; the one list of kinds, title keys (each with its
 * kind) and routes is _shared/guest-push.json, which app.match_notify (0261)
 * and the phone's pushRoutes.ts are held to as well.
 *
 * This file ships in the send-push commit, which deploys before 0255 lets the
 * outbox hold a guest kind (landing order push A, then push B), so nothing here
 * may need a migration.
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
  guestTime,
  guestWhen,
  minutesPhrase,
  pluralForm,
  type GuestContext,
  type GuestTitleKey,
  type GuestVars,
  type Lang,
} from '../supabase/functions/send-push/guestStrings.ts';

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
const LANGS: Lang[] = ['en', 'ar'];

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
  ...over,
});
const payloadOf = (key: string, params: Record<string, unknown> = {}, route = 'match') => ({
  route,
  id: route === 'match' ? MATCH_ID : null,
  title_key: key,
  params,
});
const kindOf = (key: string) => (guestPush.title_keys as Record<string, string>)[key]!;

function msg(lang: Lang, key: string, params: Record<string, unknown> = {}, over: Partial<GuestContext> = {}) {
  const route = key === 'tickets_refunded' ? 'tickets' : 'match';
  const m = guestMessage(lang, kindOf(key), payloadOf(key, params, route), ctx(over), ROUTES);
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
};

describe('guest-push.json', () => {
  it('lists the three guest kinds, the two routes and the three params', () => {
    expect(guestPush.kinds).toEqual(['match_update', 'match_reminder', 'match_message']);
    expect(guestPush.routes).toEqual(['match', 'tickets']);
    expect(guestPush.params).toEqual(['seats_taken', 'seats_total', 'minutes']);
  });

  it('maps the 23 title keys of §1.9 to their kind (R3)', () => {
    expect(KEYS).toEqual([
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
    for (const key of KEYS) {
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
  });

  it('writes a non-empty body for every key, Arabic in Arabic and different from English', () => {
    for (const key of KEYS) {
      const en = GUEST_STRINGS.en[key].body(FULL);
      const ar = GUEST_STRINGS.ar[key].body(FULL);
      expect(en.trim(), key).not.toBe('');
      expect(ar.trim(), key).not.toBe('');
      if (key !== 'reminder_3h') {
        // reminder_3h is "{time} · {branch}" in both languages.
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
    expect(INDEX).toMatch(/import \{ guestMessage, guestTime, guestWhen \} from '\.\/guestStrings\.ts';/);
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
});
