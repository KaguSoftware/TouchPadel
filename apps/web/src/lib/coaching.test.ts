import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys } from '@touch/core/coaching';
import { countPhrase, formatIQD, t } from '@touch/i18n';
import {
  ALI_PHOTO,
  BRANCH_A,
  BRANCH_B,
  COACH_ALI,
  COACH_HIDDEN,
  COACH_OMAR,
  COACH_SARA,
  COURSE_ID,
  GROUP_LESSON,
  PRICES,
  TYPE_COURSE,
  TYPE_GROUP,
  TYPE_PRIVATE,
  coachingAnswer,
  coachingRead,
} from '@/test/coachingFixtures';
import {
  coachById,
  coachFromPrice,
  coachInitial,
  coachName,
  coachPhotoUrl,
  coachTypes,
  coachesAt,
  coachingBranches,
  coachingStatus,
  lessonPrice,
  lessonTypeLine,
  localText,
  parseCoachingPublic,
  sessionPrice,
  sessionTitle,
  sessionWhen,
  type PublicCoaching,
} from './coaching';

/**
 * The website's coaching parser (docs/design/coaching/guest.md §4.14.1): it keeps only the read
 * contract's fields (R41, the `@touch/core` shapes list), drops every price of a branch whose
 * `prices_public` is off (C-11), lists only the coaches the server sends and their sessions
 * (R61, R76), and never throws.
 */
const shape = COACHING_SHAPES.coaching_public;
const nested = (path: string) => [...(shape.nested?.[path] ?? [])].sort();

function parsed(raw: unknown = coachingAnswer()): PublicCoaching {
  const coaching = parseCoachingPublic(raw);
  if (!coaching) throw new Error('fixture did not parse');
  return coaching;
}

describe('the fixture', () => {
  it('carries every key of the read contract (a fixture missing one fails here)', () => {
    expect(missingKeys(coachingAnswer(), shape)).toEqual([]);
    expect(missingKeys(coachingAnswer({ pricesPublic: true, secondBranch: true }), shape)).toEqual(
      [],
    );
  });
});

describe('parseCoachingPublic', () => {
  it('keeps exactly the read contract’s keys on every row, and nothing a server adds', () => {
    const c = parsed();
    expect(Object.keys(c).sort()).toEqual([...shape.keys].sort());
    for (const b of c.branches) expect(Object.keys(b).sort()).toEqual(nested('branches[]'));
    for (const coach of c.coaches) {
      expect(Object.keys(coach).sort()).toEqual(nested('coaches[]'));
      for (const offer of coach.offers)
        expect(Object.keys(offer).sort()).toEqual(nested('coaches[].offers[]'));
    }
    for (const type of c.lesson_types)
      expect(Object.keys(type).sort()).toEqual(nested('lesson_types[]'));
    for (const session of c.sessions)
      expect(Object.keys(session).sort()).toEqual(nested('sessions[]'));
    // The profile id, phone and full name the fixture slips in are gone.
    const text = JSON.stringify(c);
    for (const secret of [
      'profile_id',
      'phone',
      'full_name',
      'students',
      'Zainab',
      'Kareem',
      '7701234567',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('drops every price of a branch whose prices are not public, even though the answer carries them', () => {
    const c = parsed(coachingAnswer({ pricesPublic: false }));
    expect(c.lesson_types.map((t) => t.price_iqd)).toEqual([null, null, null]);
    expect(c.coaches.flatMap((coach) => coach.offers.map((o) => o.price_iqd))).toEqual([
      null,
      null,
      null,
    ]);
    const text = JSON.stringify(c);
    for (const p of Object.values(PRICES)) expect(text).not.toContain(String(p));
  });

  it('keeps the prices of a branch that shows them, per branch', () => {
    const c = parsed(coachingAnswer({ pricesPublic: true }));
    expect(c.lesson_types.map((t) => t.price_iqd)).toEqual([
      PRICES.private,
      PRICES.group,
      PRICES.course,
    ]);
    expect(coachById(c, COACH_ALI)?.offers.map((o) => o.price_iqd)).toEqual([
      PRICES.aliPrivate,
      PRICES.group,
    ]);

    // Branch A hides, branch B shows: each keeps its own.
    const mixed = parsed(coachingAnswer({ pricesPublic: false, secondBranch: true }));
    expect(
      mixed.lesson_types.filter((t) => t.venue_id === BRANCH_A).every((t) => t.price_iqd === null),
    ).toBe(true);
    expect(mixed.lesson_types.find((t) => t.venue_id === BRANCH_B)?.price_iqd).toBe(40000);
    expect(coachById(mixed, COACH_OMAR)?.offers[0]?.price_iqd).toBe(40000);
  });

  it('hides a price whose branch it cannot find, and any switch value but true', () => {
    const raw = coachingAnswer({ pricesPublic: true });
    (raw.branches as Record<string, unknown>[])[0]!.prices_public = 'true';
    expect(parsed(raw).lesson_types.every((t) => t.price_iqd === null)).toBe(true);

    const orphan = coachingAnswer({ pricesPublic: true });
    orphan.branches = [];
    expect(parsed(orphan).lesson_types.every((t) => t.price_iqd === null)).toBe(true);
  });

  it('lists only the coaches it was sent, and drops a session of any other coach', () => {
    const c = parsed();
    expect(c.coaches.map((coach) => coach.id)).toEqual([COACH_ALI, COACH_SARA]);
    expect(c.sessions.map((s) => s.lesson_id ?? s.course_id)).toEqual([GROUP_LESSON, COURSE_ID]);
    expect(c.sessions.some((s) => s.coach_id === COACH_HIDDEN)).toBe(false);
  });

  it('sorts coaches and types by their order, sessions soonest first', () => {
    const raw = coachingAnswer();
    (raw.coaches as unknown[]).reverse();
    (raw.lesson_types as unknown[]).reverse();
    (raw.sessions as unknown[]).reverse();
    const c = parsed(raw);
    expect(c.coaches.map((coach) => coach.id)).toEqual([COACH_ALI, COACH_SARA]);
    expect(c.lesson_types.map((type) => type.id)).toEqual([TYPE_PRIVATE, TYPE_GROUP, TYPE_COURSE]);
    expect(c.sessions[0]?.lesson_id).toBe(GROUP_LESSON);
  });

  it('reads {off: true} as off with nothing in it', () => {
    const c = parsed({ off: true });
    expect(c.off).toBe(true);
    expect(c.coaches).toEqual([]);
    expect(coachingStatus(c)).toBe('off');
  });

  it('falls back instead of throwing: unknown kinds, bad ids, empty places, missing fields', () => {
    const raw = coachingAnswer();
    const coaches = raw.coaches as Record<string, unknown>[];
    coaches.push({ id: 'not-a-uuid', display_name_en: 'Bad Id' });
    coaches.push({ id: 'A1B2C3D4-0000-4000-8000-0000000000C7', display_name_en: 'Upper Case' });
    const types = raw.lesson_types as Record<string, unknown>[];
    types.push({ id: 'x', venue_id: BRANCH_A, kind: 'camp', duration_min: 60 });
    const sessions = raw.sessions as Record<string, unknown>[];
    sessions.push({ ...sessions[0], lesson_id: 'full', places_left: 0 });
    sessions.push({ ...sessions[0], lesson_id: 'odd', kind: 'clinic' });
    sessions.push({ ...sessions[0], lesson_id: 'nodate', start_at: 'soon' });
    (raw.branches as Record<string, unknown>[])[0]!.payment_mode = 'bitcoin';

    const c = parsed(raw);
    // The upper-case id is read lower-case; with no sort order it sorts first (0).
    expect(c.coaches.map((coach) => coach.id)).toEqual([
      'a1b2c3d4-0000-4000-8000-0000000000c7',
      COACH_ALI,
      COACH_SARA,
    ]);
    expect(c.coaches[0]?.offers).toEqual([]);
    expect(c.coaches[0]?.venue_ids).toEqual([]);
    expect(c.lesson_types).toHaveLength(3);
    expect(c.sessions.map((s) => s.lesson_id ?? s.course_id)).toEqual([GROUP_LESSON, COURSE_ID]);
    expect(c.branches[0]?.payment_mode).toBe('desk');
  });

  it('is null only for an answer that is not an object', () => {
    for (const raw of [null, undefined, 'off', 3, []]) expect(parseCoachingPublic(raw)).toBeNull();
    expect(parseCoachingPublic({})).toEqual({
      off: false,
      branches: [],
      coaches: [],
      lesson_types: [],
      sessions: [],
      server_now: null,
    });
  });
});

describe('coachingStatus and the read', () => {
  it('is ok with a coach, empty with none, off when off, error when unreadable', () => {
    expect(coachingRead(coachingAnswer()).status).toBe('ok');
    expect(coachingRead({ ...coachingAnswer(), coaches: [] }).status).toBe('empty');
    expect(coachingRead({ off: true })).toEqual({ status: 'off', coaching: null });
    expect(coachingRead('nope')).toEqual({ status: 'error', coaching: null });
  });
});

describe('joins', () => {
  it('puts each coach under the branches they teach at, with their own types and prices', () => {
    const c = parsed(coachingAnswer({ pricesPublic: true, secondBranch: true }));
    expect(coachingBranches(c).map((b) => b.venue_id)).toEqual([BRANCH_A, BRANCH_B]);
    expect(coachesAt(c, BRANCH_B).map((coach) => coach.id)).toEqual([COACH_OMAR]);
    const ali = coachById(c, COACH_ALI)!;
    expect(coachTypes(c, ali, BRANCH_A).map(({ type, price_iqd }) => [type.id, price_iqd])).toEqual(
      [
        [TYPE_PRIVATE, PRICES.aliPrivate],
        [TYPE_GROUP, PRICES.group],
      ],
    );
    expect(coachTypes(c, ali, BRANCH_B)).toEqual([]);
    expect(coachFromPrice(c, ali, BRANCH_A)).toBe(PRICES.group);
    expect(coachById(c, COACH_HIDDEN)).toBeNull();
  });

  it('has no "from" price while the branch hides its prices', () => {
    const c = parsed(coachingAnswer({ pricesPublic: false }));
    expect(coachFromPrice(c, coachById(c, COACH_ALI)!, BRANCH_A)).toBeNull();
  });
});

describe('words', () => {
  const c = parsed(coachingAnswer({ pricesPublic: true }));
  const type = (id: string) => c.lesson_types.find((t) => t.id === id)!;

  it('names each kind of lesson by its shape, in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      const minutes = (n: number) => countPhrase('coaching.web.count.minutes', n, locale);
      expect(lessonTypeLine(type(TYPE_PRIVATE), locale)).toBe(
        t(locale, 'coaching.web.privateLine', {
          duration: minutes(60),
          people: countPhrase('coaching.web.count.people', 4, locale),
        }),
      );
      expect(lessonTypeLine(type(TYPE_GROUP), locale)).toBe(
        t(locale, 'coaching.web.groupLine', {
          duration: minutes(90),
          places: countPhrase('coaching.web.count.places', 8, locale),
        }),
      );
      expect(lessonTypeLine(type(TYPE_COURSE), locale)).toBe(
        t(locale, 'coaching.web.courseLine', {
          duration: minutes(60),
          sessions: countPhrase('coaching.web.count.sessions', 8, locale),
        }),
      );
    }
    // Arabic picks its plural by the count, Latin digits isolated.
    expect(countPhrase('coaching.web.count.minutes', 210, 'ar')).toContain('دقائق');
    expect(countPhrase('coaching.web.count.minutes', 60, 'ar')).toContain('دقيقة');
  });

  it('prices a lesson, a place and a course; nothing when hidden', () => {
    expect(lessonPrice('private', 30000, 'en')).toBe(
      t('en', 'coaching.web.pricePrivate', { price: formatIQD(30000, 'en') }),
    );
    expect(lessonPrice('group', 15000, 'ar')).toBe(
      t('ar', 'coaching.web.pricePlace', { price: formatIQD(15000, 'ar') }),
    );
    expect(lessonPrice('course', 120000, 'en')).toContain(formatIQD(120000, 'en'));
    expect(lessonPrice('course', null, 'en')).toBeNull();
  });

  it('dates a group session and a course in the branch’s timezone', () => {
    const [group, course] = c.sessions;
    // 16:30 UTC is 19:30 in Baghdad.
    expect(sessionWhen(group!, 'Asia/Baghdad', 'en')).toMatch(/7:30\s?PM/);
    expect(sessionWhen(course!, 'Asia/Baghdad', 'en')).toContain(
      countPhrase('coaching.web.count.sessions', 8, 'en'),
    );
    expect(sessionWhen(course!, 'Asia/Baghdad', 'en')!.startsWith('Starts')).toBe(true);
    // A course under way shows its next session and what is left, and no price (C-15).
    const running = { ...course!, sessions_left: 5 };
    expect(sessionWhen(running, 'Asia/Baghdad', 'en')).toContain(
      countPhrase('coaching.web.count.sessionsLeft', 5, 'en'),
    );
    expect(sessionPrice(running, type(TYPE_COURSE), 'en')).toBeNull();
    expect(sessionPrice(course!, type(TYPE_COURSE), 'en')).toContain(
      formatIQD(PRICES.course, 'en'),
    );
    // An unknown zone falls back to the venue's, never a thrown render.
    expect(sessionWhen(group!, 'Mars/Olympus', 'en')).toMatch(/7:30\s?PM/);
  });

  it('titles a session by its own title, else its type', () => {
    const [group, course] = c.sessions;
    expect(sessionTitle(group!, type(TYPE_GROUP), 'en')).toBe('Group clinic');
    expect(sessionTitle(course!, type(TYPE_COURSE), 'ar')).toBe('مبتدئو أكتوبر');
    expect(sessionTitle(group!, null, 'en')).toBe('');
  });

  it('reads Arabic on an Arabic page, English when the Arabic is blank', () => {
    expect(localText('ar', 'Name', 'اسم')).toBe('اسم');
    expect(localText('ar', 'Name', '  ')).toBe('Name');
    expect(localText('en', '', 'اسم')).toBe('اسم');
    const ali = coachById(c, COACH_ALI)!;
    expect(coachName(ali, 'ar')).toBe('علي التجربة');
    expect(coachInitial(ali, 'en')).toBe('A');
  });
});

describe('coachPhotoUrl', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('serves only menu-media/coaches/<uuid>/<file> (R43)', () => {
    expect(coachPhotoUrl(ALI_PHOTO)).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/menu-media/${ALI_PHOTO}`,
    );
    for (const path of [
      null,
      '',
      'items/0f0e0d0c-0b0a-4908-8706-050403020100/a.jpg',
      'coaches/not-a-folder/a.jpg',
      'coaches/0f0e0d0c-0b0a-4908-8706-050403020100/../../items/a.jpg',
      'coaches/0f0e0d0c-0b0a-4908-8706-050403020100/sub/a.jpg',
      'https://evil.example/coaches/0f0e0d0c-0b0a-4908-8706-050403020100/a.jpg',
    ]) {
      expect(coachPhotoUrl(path), String(path)).toBeNull();
    }
  });

  it('is null without the env (never a thrown render)', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(coachPhotoUrl(ALI_PHOTO)).toBeNull();
  });
});
