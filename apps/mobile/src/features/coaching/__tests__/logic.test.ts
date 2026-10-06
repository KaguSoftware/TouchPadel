import { describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys, type CoachingShape } from '@touch/core';
import {
  anyCoaching,
  classRows,
  classTarget,
  coachBranch,
  coachInitial,
  coachPhotoUrl,
  coachesAt,
  coachingEnabled,
  courseJoinIntent,
  defaultPaymentChoice,
  effectiveChoice,
  friendNamesFor,
  holdLive,
  joinIntent,
  kindsTaught,
  lessonCells,
  lessonTitle,
  lessonWindow,
  nightEndsAt,
  nightsInWindow,
  lowestOfferPrice,
  parseCancelResult,
  parseCoachProfile,
  parseCoachSlots,
  parseCoachingPublic,
  parseLessonBegin,
  parseLessonOffer,
  parseLessonWrite,
  isSpentReplay,
  writeOnceMore,
  parseLinkConfirm,
  parseMyLesson,
  parseMyLessons,
  paymentChoices,
  privateIntent,
  slotsByNight,
} from '../logic';
import { parseDepositStatus } from '../../deposit/logic';
import { listBookableDates } from '../../availability/assemble';
import {
  COACH_ID,
  COACH_TZ,
  COACH_VENUE_ID,
  COURSE_ID,
  ENROLMENT_ID,
  LESSON_ID,
  PHOTO_PATH,
  TYPE_GROUP_ID,
  TYPE_PRIVATE_ID,
  coachProfileFixture,
  coachSlotsFixture,
  coachingPublicFixture,
  courseOfferFixture,
  lessonBeginFixture,
  lessonOfferFixture,
  myLessonFixture,
  myLessonRowFixture,
  venueAt,
} from '../../../test/coachingFixtures';

// ── Reading the keys of the shapes (R41, R81) ───────────────────────────────

/** Wrap a JSON value so every key read through it is recorded as a shape path (`coaches[].offers[].price_iqd`). */
function track(value: unknown, path: string, reads: Set<string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return new Proxy(value, {
      get(target, key, receiver) {
        const v = Reflect.get(target, key, receiver);
        return typeof key === 'string' && /^\d+$/.test(key) ? track(v, `${path}[]`, reads) : v;
      },
    });
  }
  return new Proxy(value as object, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key !== 'string') return v;
      const here = path ? `${path}.${key}` : key;
      reads.add(here);
      return track(v, here, reads);
    },
  });
}

/** Every path a shape names: its keys, its one-of keys, its optional keys and its nested keys. */
function shapePaths(shape: CoachingShape): string[] {
  const p = shape.array ? '[].' : '';
  const out = new Set<string>();
  for (const k of shape.keys) out.add(p + k);
  for (const g of shape.oneOf ?? []) for (const k of g) out.add(p + k);
  for (const k of shape.optional ?? []) out.add(p + k);
  for (const [nested, keys] of Object.entries(shape.nested ?? {})) {
    for (const k of keys) out.add(`${p}${nested}.${k}`);
  }
  return [...out].sort();
}

function readsOf(raw: unknown, parse: (json: unknown) => unknown): string[] {
  const reads = new Set<string>();
  parse(track(raw, '', reads));
  return [...reads].sort();
}

describe('the parsers read exactly their shapes.ts keys (R41, R81)', () => {
  const cases: [string, CoachingShape, unknown, (json: unknown) => unknown][] = [
    [
      'coaching_public',
      COACHING_SHAPES.coaching_public,
      coachingPublicFixture(),
      parseCoachingPublic,
    ],
    ['coach_profile', COACHING_SHAPES.coach_profile, coachProfileFixture(), parseCoachProfile],
    ['coach_slots', COACHING_SHAPES.coach_slots, coachSlotsFixture(), parseCoachSlots],
    ['lesson_offer (course)', COACHING_SHAPES.lesson_offer, courseOfferFixture(), parseLessonOffer],
    [
      'lesson_book_private',
      COACHING_SHAPES.lesson_book_private,
      {
        duplicate: false,
        enrolment_id: ENROLMENT_ID,
        lesson_id: LESSON_ID,
        status: 'booked',
        hold_expires_at: null,
        payment_mode: 'desk',
        price_iqd: 30000,
        start_at: 'x',
        end_at: 'y',
        court_name_en: 'C',
        court_name_ar: 'C',
        venue_id: COACH_VENUE_ID,
      },
      (j) => parseLessonWrite(j, 'lesson_book_private'),
    ],
    [
      'lesson_join',
      COACHING_SHAPES.lesson_join,
      {
        duplicate: false,
        enrolment_id: ENROLMENT_ID,
        lesson_id: LESSON_ID,
        status: 'held',
        hold_expires_at: 'z',
        payment_mode: 'online',
        price_iqd: 15000,
        places_left: 2,
      },
      (j) => parseLessonWrite(j, 'lesson_join'),
    ],
    [
      'course_join',
      COACHING_SHAPES.course_join,
      {
        duplicate: false,
        enrolment_id: ENROLMENT_ID,
        course_id: COURSE_ID,
        status: 'booked',
        hold_expires_at: null,
        payment_mode: 'desk',
        price_iqd: 40000,
        places_left: 1,
      },
      (j) => parseLessonWrite(j, 'course_join'),
    ],
    [
      'lesson_cancel_mine',
      COACHING_SHAPES.lesson_cancel_mine,
      {
        duplicate: false,
        enrolment_id: ENROLMENT_ID,
        status: 'cancelled',
        cancel_kind: 'guest_free',
        refunds_started: 1,
        strike: false,
        refund_iqd: 30000,
        kept_iqd: 0,
      },
      parseCancelResult,
    ],
    ['my_lessons', COACHING_SHAPES.my_lessons, [myLessonRowFixture()], parseMyLessons],
    ['my_lesson', COACHING_SHAPES.my_lesson, myLessonFixture(), parseMyLesson],
    ['lesson-begin', COACHING_SHAPES['lesson-begin'], lessonBeginFixture(), parseLessonBegin],
  ];

  it.each(cases)('%s', (_name, shape, raw, parse) => {
    // The fixture carries everything the shape lists, so every read is possible…
    expect(missingKeys(raw, shape)).toEqual([]);
    // …and the parser reads those keys and no other.
    expect(readsOf(raw, parse)).toEqual(shapePaths(shape));
  });

  it('deposit_status reads the lesson block of X14', () => {
    const raw = {
      request_id: 'r',
      purpose: 'lesson',
      lesson: Object.fromEntries(
        COACHING_SHAPES.deposit_status.nested!.lesson!.map((k) => [k, 'v']),
      ),
    };
    const lessonReads = readsOf(raw, parseDepositStatus).filter((p) => p.startsWith('lesson.'));
    expect(lessonReads).toEqual(
      COACHING_SHAPES.deposit_status.nested!.lesson!.map((k) => `lesson.${k}`).sort(),
    );
  });
});

// ── Defensive parsing ───────────────────────────────────────────────────────

describe('parsers never throw on what they do not know', () => {
  it('reads an empty or foreign answer as nothing', () => {
    expect(parseCoachingPublic(null)).toEqual({
      off: false,
      branches: [],
      coaches: [],
      lessonTypes: [],
      sessions: [],
      serverNow: null,
    });
    expect(parseCoachingPublic({ off: true }).off).toBe(true);
    expect(parseMyLessons('nope')).toEqual([]);
    expect(parseCoachSlots(undefined).starts).toEqual([]);
  });

  it('falls back on unknown enums', () => {
    const pub = parseCoachingPublic({
      ...coachingPublicFixture(),
      branches: [{ venue_id: COACH_VENUE_ID, payment_mode: 'bitcoin' }],
      lesson_types: [{ id: 'x', venue_id: COACH_VENUE_ID, kind: 'yoga' }],
    });
    expect(pub.branches[0]!.paymentMode).toBe('desk');
    expect(pub.lessonTypes[0]!.kind).toBeNull();

    const profile = parseCoachProfile(
      coachProfileFixture({ coach: { id: COACH_ID, status: 'sleeping' } }),
    );
    expect(profile.coach!.status).toBe('paused');

    const offer = parseLessonOffer(lessonOfferFixture({ status: 'teleported' }));
    expect(offer.status).toBe('closed');

    const row = parseMyLessons([
      myLessonRowFixture({ status: 'weird', booked_by: 'robot', payment_mode: 'gold' }),
    ])[0]!;
    expect(row.status).toBeNull();
    expect(row.bookedBy).toBe('guest');
    expect(row.paymentMode).toBe('desk');
  });

  it('drops rows it cannot identify, keeps the rest', () => {
    const rows = parseMyLessons([{ start_at: 'x' }, myLessonRowFixture()]);
    expect(rows.map((r) => r.enrolmentId)).toEqual([ENROLMENT_ID]);
  });

  it('reads amounts sent as numeric strings', () => {
    const row = parseMyLessons([myLessonRowFixture({ price_iqd: '30000', owed_iqd: '25000' })])[0]!;
    expect(row.priceIqd).toBe(30000);
    expect(row.owedIqd).toBe(25000);
  });

  it('my_lesson offers nothing but the confirm while a link waits (C-21)', () => {
    const one = parseMyLesson(
      myLessonFixture({ confirm_needed: true, can: { cancel: true, pay: true, confirm: true } }),
    );
    expect(one.can).toEqual({ cancel: false, pay: false, confirm: true });
    expect(parseMyLesson(myLessonFixture({ cancel: { policy: 'maybe' } })).cancel.policy).toBe(
      'none',
    );
  });

  it('a write answer without an enrolment is malformed', () => {
    expect(() => parseLessonWrite({}, 'lesson_join')).toThrow('MALFORMED_LESSON_WRITE');
    expect(() => parseLessonBegin({ request_id: 'r' })).toThrow('MALFORMED_LESSON_BEGIN');
    const held = parseLessonWrite(
      { enrolment_id: ENROLMENT_ID, status: 'held', payment_mode: 'online' },
      'course_join',
    );
    expect(held.status).toBe('held');
    expect(held.paymentMode).toBe('online');
  });

  it('the link confirm answer', () => {
    expect(
      parseLinkConfirm({ enrolment_id: ENROLMENT_ID, linked: true, duplicate: false }),
    ).toEqual({
      enrolmentId: ENROLMENT_ID,
      linked: true,
      duplicate: false,
    });
  });

  it('a lesson payment is told apart by its purpose', () => {
    expect(parseDepositStatus({ request_id: 'r', purpose: 'lesson' }).purpose).toBe('lesson');
    expect(parseDepositStatus({ request_id: 'r', purpose: 'ticket' }).purpose).toBe('ticket');
    expect(parseDepositStatus({ request_id: 'r', purpose: 'banana' }).purpose).toBe('deposit');
    expect(parseDepositStatus({ request_id: 'r' }).lesson).toBeNull();
  });
});

// ── Gating ──────────────────────────────────────────────────────────────────

describe('coachingEnabled and anyCoaching', () => {
  it('is on only when the branch says exactly true', () => {
    expect(coachingEnabled({ coaching_enabled: true })).toBe(true);
    expect(coachingEnabled({ coaching_enabled: false })).toBe(false);
    expect(coachingEnabled({})).toBe(false);
    expect(coachingEnabled(null)).toBe(false);
  });

  it('anyCoaching: some open branch has it on', () => {
    expect(anyCoaching([{ coaching_enabled: false }, { coaching_enabled: true }])).toBe(true);
    expect(anyCoaching([{ coaching_enabled: false }])).toBe(false);
    expect(anyCoaching(undefined)).toBe(false);
  });
});

// ── The grid ────────────────────────────────────────────────────────────────

describe('lessonWindow', () => {
  it('is exactly 14 days from the start of the first night, venue-local', () => {
    const now = new Date('2026-10-01T15:20:00Z'); // 18:20 in Baghdad
    const w = lessonWindow(now, COACH_TZ);
    expect(w.from).toBe('2026-09-30T21:00:00.000Z');
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(14 * 86_400_000);
  });

  it('is stable for a day', () => {
    const a = lessonWindow(new Date('2026-10-01T05:00:00Z'), COACH_TZ);
    const b = lessonWindow(new Date('2026-10-01T20:00:00Z'), COACH_TZ);
    expect(a).toEqual(b);
  });

  it('starts at the strip’s first night when given one (the overnight tail)', () => {
    const w = lessonWindow(new Date('2026-10-01T22:30:00Z'), COACH_TZ, '2026-10-01');
    expect(w.from).toBe('2026-09-30T21:00:00.000Z');
  });
});

describe('nightsInWindow (MB-16)', () => {
  // Every day 16:00–02:00: each calendar day carries the evening and the night before's tail.
  const late: [string, string][] = [
    ['00:00', '02:00'],
    ['16:00', '24:00'],
  ];
  const overnight = { sun: late, mon: late, tue: late, wed: late, thu: late, fri: late, sat: late };
  const days = { sun: [['09:00', '23:00']] } as const;

  it('keeps the last night only when its whole trading night fits the window', () => {
    // At 01:00 in the tail of Wednesday night: the strip starts with yesterday.
    const now = new Date('2026-09-30T22:00:00Z'); // Thursday 01:00 in Baghdad
    const strip = listBookableDates(now, COACH_TZ, 13, {
      opening_hours: overnight,
      closed_dates: [],
    });
    expect(strip[0]).toBe('2026-09-30');
    const w = lessonWindow(now, COACH_TZ, strip[0]);
    const nights = nightsInWindow(strip, w.to, COACH_TZ, overnight);
    const last = nights[nights.length - 1]!;
    // Complete: the last night's 02:00 close is inside the window.
    expect(nightEndsAt(last, COACH_TZ, overnight).getTime()).toBeLessThanOrEqual(Date.parse(w.to));
    // Absent: the next night would end after the window, so it is not shown cut short.
    const after = strip[strip.indexOf(last) + 1]!;
    expect(nightEndsAt(after, COACH_TZ, overnight).getTime()).toBeGreaterThan(Date.parse(w.to));
    expect(nights).not.toContain(after);
  });

  it('keeps every night that ends at midnight, as before', () => {
    const now = new Date('2026-10-01T15:20:00Z');
    const strip = listBookableDates(now, COACH_TZ, 13);
    const w = lessonWindow(now, COACH_TZ, strip[0]);
    expect(nightsInWindow(strip, w.to, COACH_TZ, days)).toEqual(strip);
    expect(nightEndsAt('2026-10-01', COACH_TZ, days).toISOString()).toBe(
      '2026-10-01T21:00:00.000Z',
    );
    expect(nightEndsAt('2026-10-01', COACH_TZ, overnight).toISOString()).toBe(
      '2026-10-01T23:00:00.000Z',
    );
  });
});

describe('lessonCells and slotsByNight', () => {
  // Thursday 16:00 to 02:00: Friday's list carries the 00:00–02:00 tail.
  const settings = {
    timezone: COACH_TZ,
    opening_hours: {
      thu: [['16:00', '24:00']],
      fri: [
        ['00:00', '02:00'],
        ['16:00', '24:00'],
      ],
    },
  };
  // 2026-10-01 is a Thursday; 00:30 on Friday belongs to Thursday's night.
  const starts = [
    { startAt: '2026-10-01T15:00:00Z', endAt: '2026-10-01T16:00:00Z' }, // Thu 18:00
    { startAt: '2026-10-01T21:30:00Z', endAt: '2026-10-01T22:30:00Z' }, // Fri 00:30
    { startAt: '2026-10-01T14:00:00Z', endAt: '2026-10-01T15:00:00Z' }, // Thu 17:00
  ];

  it('groups a 00:30 start into the night before', () => {
    const nights = slotsByNight(starts, settings);
    expect(nights.get('2026-10-01')?.length).toBe(3);
  });

  it('one free cell per start not yet begun, in time order, priced, with no court', () => {
    const cells = lessonCells(
      starts,
      '2026-10-01',
      settings,
      new Date('2026-10-01T14:30:00Z'),
      30000,
    );
    expect(cells.map((c) => c.startAt.toISOString())).toEqual([
      '2026-10-01T15:00:00.000Z',
      '2026-10-01T21:30:00.000Z',
    ]);
    for (const c of cells) {
      expect(c).toMatchObject({
        state: 'free',
        freeCount: 1,
        capacity: 1,
        priceIqd: 30000,
        courtId: null,
      });
    }
  });
});

// ── Payment choice and intents ──────────────────────────────────────────────

describe('paymentChoices', () => {
  it('per mode', () => {
    expect(paymentChoices('desk')).toEqual(['desk']);
    expect(paymentChoices('online_optional')).toEqual(['desk', 'online']);
    expect(paymentChoices('online_required')).toEqual(['online']);
    expect(defaultPaymentChoice('online_optional')).toBe('desk');
    expect(defaultPaymentChoice('online_required')).toBe('online');
  });

  it('a choice the branch no longer offers falls back', () => {
    expect(effectiveChoice('desk', 'online')).toBe('desk');
    expect(effectiveChoice('online_required', 'desk')).toBe('online');
    expect(effectiveChoice('online_optional', 'online')).toBe('online');
  });
});

describe('intents', () => {
  it('name every mutable argument, so a changed party or mode is a new key', () => {
    const base = {
      coachId: 'c',
      lessonTypeId: 't',
      startAt: 's',
      partySize: 2,
      mode: 'desk' as const,
    };
    expect(privateIntent(base)).toBe('private:c|t|s|2|desk');
    expect(privateIntent({ ...base, partySize: 3 })).not.toBe(privateIntent(base));
    expect(privateIntent({ ...base, mode: 'online' })).not.toBe(privateIntent(base));
    expect(joinIntent('l', 'online')).toBe('join:l|online');
    expect(courseJoinIntent('c', 'desk')).toBe('course:c|desk');
  });

  it('friends’ names: trimmed, empty dropped, at most party − 1, each ≤ 40', () => {
    expect(friendNamesFor([' Ali ', '', 'Zed', 'X'], 3)).toEqual(['Ali']);
    expect(friendNamesFor(['Ali', 'Zed', 'X'], 4)).toEqual(['Ali', 'Zed', 'X']);
    expect(friendNamesFor(['a'.repeat(50)], 2)[0]!.length).toBe(40);
    expect(friendNamesFor(['Ali'], 1)).toEqual([]);
  });
});

// ── Display ─────────────────────────────────────────────────────────────────

describe('coachPhotoUrl (R43)', () => {
  const base = 'https://proj.supabase.co';
  it('builds the public URL of a coaches/<uuid>/<file> path', () => {
    expect(coachPhotoUrl(PHOTO_PATH, base)).toBe(
      `${base}/storage/v1/object/public/menu-media/${PHOTO_PATH}`,
    );
  });
  it('refuses anything else', () => {
    for (const bad of [
      null,
      '',
      'menu/abc.jpg',
      'coaches/not-a-uuid/x.jpg',
      'coaches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/../secret.jpg',
      'coaches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/a/b.jpg',
    ]) {
      expect(coachPhotoUrl(bad, base), String(bad)).toBeNull();
    }
    expect(coachPhotoUrl(PHOTO_PATH, null)).toBeNull();
  });
  it('an initial for the photo-less avatar', () => {
    expect(coachInitial(' sara')).toBe('S');
    expect(coachInitial('سارة')).toBe('س');
    expect(coachInitial('')).toBe('');
  });
});

describe('the coaches list and the classes', () => {
  const pub = parseCoachingPublic(coachingPublicFixture());

  it('the kinds a coach teaches, in the fixed order, and the lowest price', () => {
    const coach = coachesAt(pub, COACH_VENUE_ID)[0]!;
    expect(kindsTaught(coach, pub.lessonTypes, COACH_VENUE_ID)).toEqual(['private', 'group']);
    expect(lowestOfferPrice(coach, COACH_VENUE_ID)).toBe(15000);
    expect(lowestOfferPrice(coach, 'elsewhere')).toBeNull();
  });

  it('classes soonest first, filtered by kind, with the coach and type joined', () => {
    const all = classRows(pub, COACH_VENUE_ID, 'all');
    expect(all.map((r) => r.session.kind)).toEqual(['group', 'course']);
    expect(all[0]!.coach?.id).toBe(COACH_ID);
    expect(all[0]!.type?.id).toBe(TYPE_GROUP_ID);
    expect(classRows(pub, COACH_VENUE_ID, 'course').map((r) => r.session.courseId)).toEqual([
      COURSE_ID,
    ]);
    expect(classTarget(all[0]!.session)).toEqual({ id: LESSON_ID, kind: 'session' });
    expect(classTarget(all[1]!.session)).toEqual({ id: COURSE_ID, kind: 'course' });
  });

  it('a course title, else its type name', () => {
    expect(
      lessonTitle(
        { titleEn: '', titleAr: '', typeNameEn: 'Private lesson', typeNameAr: 'حصة خاصة' },
        'ar',
      ),
    ).toBe('حصة خاصة');
    expect(
      lessonTitle({ titleEn: 'Course', titleAr: '', typeNameEn: 'x', typeNameAr: 'y' }, 'ar'),
    ).toBe('Course');
  });
});

describe('coachBranch (§4.8.3)', () => {
  it('the param, else the guest’s when the coach teaches there, else the coach’s first', () => {
    expect(coachBranch('p', 'g', ['a', 'g'])).toBe('p');
    expect(coachBranch(null, 'g', ['a', 'g'])).toBe('g');
    expect(coachBranch(null, 'g', ['a', 'b'])).toBe('a');
    expect(coachBranch(null, null, [])).toBeNull();
  });
});

describe('holdLive', () => {
  it('a held enrolment whose window is still open', () => {
    const now = Date.parse('2026-10-01T10:00:00Z');
    expect(holdLive({ status: 'held', holdExpiresAt: '2026-10-01T10:05:00Z' }, now)).toBe(true);
    expect(holdLive({ status: 'held', holdExpiresAt: '2026-10-01T09:55:00Z' }, now)).toBe(false);
    expect(holdLive({ status: 'booked', holdExpiresAt: '2026-10-01T10:05:00Z' }, now)).toBe(false);
  });
});

describe('fixtures sanity', () => {
  it('the slots fixture is on tomorrow’s grid', () => {
    const slots = parseCoachSlots(coachSlotsFixture());
    expect(slots.starts[0]!.startAt).toBe(venueAt(1, 18 * 60).toISOString());
    expect(
      parseCoachProfile(coachProfileFixture()).offers.find((o) => o.kind === 'private')
        ?.lessonTypeId,
    ).toBe(TYPE_PRIVATE_ID);
  });
});

describe('a replay of a spent key (MB-10)', () => {
  const write = (status: string, duplicate: boolean) =>
    parseLessonWrite(
      { duplicate, enrolment_id: ENROLMENT_ID, lesson_id: LESSON_ID, status, places_left: 2 },
      'lesson_join',
    );

  it('keeps the enrolment status the server sent', () => {
    expect(write('cancelled', true).status).toBe('cancelled');
    expect(write('expired', true).status).toBe('expired');
    expect(write('held', false).status).toBe('held');
    expect(write('weird', false).status).toBe('booked');
    expect(isSpentReplay(write('cancelled', true))).toBe(true);
    expect(isSpentReplay(write('expired', true))).toBe(true);
    expect(isSpentReplay(write('booked', true))).toBe(false);
    expect(isSpentReplay(write('cancelled', false))).toBe(false);
  });

  it('runs once more with a fresh key after a cancelled replay, and never answers it as booked', async () => {
    const answers = [write('cancelled', true), write('booked', false)];
    const keys: string[] = [];
    let key = 'k1';
    const result = await writeOnceMore(
      async () => {
        keys.push(key);
        return answers.shift()!;
      },
      () => {
        key = 'k2';
      },
    );
    expect(keys).toEqual(['k1', 'k2']);
    expect(result.status).toBe('booked');
    expect(result.duplicate).toBe(false);
  });

  it('answers a live replay as it is, without a second call', async () => {
    let calls = 0;
    const result = await writeOnceMore(
      async () => {
        calls += 1;
        return write('booked', true);
      },
      () => {
        throw new Error('not forgotten');
      },
    );
    expect(calls).toBe(1);
    expect(result.status).toBe('booked');
  });

  it('refuses a second spent answer instead of showing it', async () => {
    await expect(
      writeOnceMore(
        async () => write('expired', true),
        () => {},
      ),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
});
