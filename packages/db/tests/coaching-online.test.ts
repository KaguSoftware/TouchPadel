/**
 * 0284 lesson_online_payment — a lesson place paid online, end to end through
 * the fake provider (docs/design/coaching/money.md §6, §10 O1-O13; build
 * contracts C-3, C-26, R3, R25, R28, R29, R30, R33, R34, R50, R65, R70).
 *
 * The edge function lesson-begin is the only caller of the prepare; here the
 * service client stands in for it, and for the webhook, the polls and the
 * reconciler, exactly as deposits.test.ts and matches-tickets.test.ts do for
 * deposits and tickets ("the fake bank says SUCCESS"): lesson_payment_prepare,
 * then deposit_mark_created, then deposit_apply with the bank's answer.
 *
 * The held enrolments are planted as the booking RPCs of 0283 leave them (a
 * private lesson `held` with its court `hold` row, a group or course place
 * `held`), with the service role: this file tests the money path, not the
 * booking RPCs (coaching-booking tests do). Lessons sit 120+ days out at 10:00
 * local, far from every other suite's futureSlot() range, on this file's own
 * coach; a private lesson's hold is on this file's own court. Settings are
 * switched for the file and put back in afterAll.
 *
 *   * O1  private: begin -> SUCCESS -> booked: the hold becomes the lesson's
 *         court row in place, the lesson scheduled, the enrolment booked, one
 *         paid_online event (actor system); a double tap reuses the attempt;
 *         deposit_status answers the X14 lesson shape; a duplicate webhook
 *         changes nothing;
 *   * O2  group and course: booked, the event carries places (R78);
 *   * O3  prepare's refusals, in order, with details;
 *   * O4  FAILED keeps the hold; a retry succeeds; a late SUCCESS on the
 *         failed attempt is duplicate_success (O8);
 *   * O5  EXPIRED: enrolment, lesson (payment_expired) and hold expired, the
 *         expired event, a lapsed_hold strike (R30);
 *   * O6  a late SUCCESS: revived when still free (revived: true, the strike
 *         withdrawn, R29, R65); slot_lost when the coach was booked meanwhile;
 *   * O7  a hold expired by TTL past the payment's grace: SUCCESS re-picks a
 *         court from the locked set (R34);
 *   * O9  the reconciler's net (R28) starts the refund a cancel never started;
 *         the refund outcome, the attention list, retry; deposit_refund_request
 *         on a live enrolment is PAYMENT_STATE lesson_live (CM-5);
 *   * O12 a full group (R29): a held place past its grace loses the last place
 *         to the desk; its SUCCESS is slot_lost, never a ninth place;
 *   * the source rules: no push call in Money's two bodies (R40).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  appRpc,
  createTestCourt,
  guestClient,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';

type Json = Record<string, unknown>;
const TERMS = '2026-09-23';
const MIN = 60_000;

// ── the source rules (pure) ─────────────────────────────────────────────────
const MIGRATIONS = path.resolve(import.meta.dirname, '../supabase/migrations');
const FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_lesson_online_payment.sql'));

/** One function's body from the migration text, by its dollar tag ($<name>_<ordinal>$). */
function body(src: string, name: string): string {
  const start = src.indexOf(`create or replace function app.${name}(`);
  if (start < 0) return '';
  const open = src.indexOf(`$${name}_`, start);
  const close = src.indexOf('$', open + 1);
  if (open < 0 || close < 0) return '';
  const tag = src.slice(open, close + 1);
  const end = src.indexOf(tag, close + 1);
  return end > close ? src.slice(close + 1, end) : '';
}

describe('0284 the source rules (pure)', () => {
  it('ships the migration', () => {
    expect(FILE, 'packages/db/supabase/migrations/*_lesson_online_payment.sql').toBeDefined();
  });

  it("Money's lesson bodies queue no push and sync no reminder (R40, R18): the events do", () => {
    const src = readFileSync(path.join(MIGRATIONS, FILE!), 'utf8');
    for (const fn of ['lesson_settle_success', 'lesson_hold_expire', 'lesson_payment_prepare']) {
      const b = body(src, fn);
      expect(b.length, fn).toBeGreaterThan(100);
      expect(b, fn).not.toMatch(/lesson_notify\s*\(/);
      expect(b, fn).not.toMatch(/lesson_sync_reminders\s*\(/);
    }
  });

  it('deposit_apply: the coach, then the courts, then the rows, then the payment row; one waiting expiry (R33)', () => {
    const src = readFileSync(path.join(MIGRATIONS, FILE!), 'utf8');
    const b = body(src, 'deposit_apply').replace(/--[^\n]*/g, '');
    const at = (s: string) => b.indexOf(s);
    expect(at('app.lock_coach(')).toBeGreaterThan(0);
    expect(at('app.lock_coach(')).toBeLessThan(at('app.lock_court('));
    expect(at('app.lock_court(')).toBeLessThan(at('app.lesson_lock_branch_courts('));
    expect(at('app.lesson_lock_branch_courts(')).toBeLessThan(
      at('where id = v.hold_id for update'),
    );
    expect(at('where id = v.hold_id for update')).toBeLessThan(
      at('from booking_payments where id = v.id for update'),
    );
    // The lesson arm's stale-hold expiry never waits and comes after the deposit settle call
    // (whose own expiry is the body's one waiting reservations lock).
    expect(b).not.toMatch(/app\.match_expire_holds\(/);
    expect(b).toMatch(/for update of x skip locked/);
    expect(at('app.deposit_settle_success(')).toBeLessThan(at('for update of x skip locked'));
    expect(at('for update of x skip locked')).toBeLessThan(at('app.lesson_settle_success('));
  });
});

// ── the stack ────────────────────────────────────────────────────────────────
const up = await stackAvailable();

describe.skipIf(!up)('0284 lessons paid online (fake provider through deposit_apply)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let court: string;
  let coach: string;
  const lt = { private: '', group: '', course: '' };
  let saved: {
    coaching_enabled: boolean;
    lesson_payment_mode: string;
    terms: string | null;
  } | null = null;
  const payments = new Set<string>(); // request ids, closed in afterAll
  const enrolments = new Set<string>();

  // ── plumbing ──────────────────────────────────────────────────────────────
  const call = async (c: SupabaseClient, fn: string, args: Json) => {
    const { data, error } = await appRpc(c, fn, args);
    return {
      ok: !error,
      code: error?.message,
      detail: (error as { details?: string | null } | null)?.details ?? null,
      data: data as Json,
    };
  };
  const svcCall = (fn: string, args: Json) => call(svc, fn, args);

  const ins = async (table: string, row: Json): Promise<string> => {
    const { data, error } = await svc.from(table).insert(row).select('id').single();
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    return (data as { id: string }).id;
  };
  const one = async (table: string, id: string, cols = '*') => {
    const { data, error } = await svc.from(table).select(cols).eq('id', id).single();
    if (error) throw new Error(`select ${table}: ${error.message}`);
    return data as unknown as Json;
  };
  const setRow = async (table: string, id: string, patch: Json) => {
    const { error } = await svc.from(table).update(patch).eq('id', id);
    if (error) throw new Error(`update ${table}: ${error.message}`);
  };
  const setVenue = async (patch: Json) => {
    const { error } = await svc.from('venue_settings').update(patch).eq('venue_id', VENUE_A_ID);
    if (error) throw new Error(`venue_settings: ${error.message}`);
  };
  const setTerms = async (version: string | null) => {
    const { error } = await svc
      .from('platform_settings')
      .update({ lesson_terms_version: version })
      .eq('id', true);
    if (error) throw new Error(`platform_settings: ${error.message}`);
  };

  /** 120+ days out, 10:00 Baghdad (07:00 UTC): clear of every other suite's slots. */
  const slot = (n: number, minutes = 60) => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 120 + n);
    start.setUTCHours(7, 0, 0, 0);
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + minutes * MIN).toISOString(),
    };
  };
  const soon = (minutes: number) => new Date(Date.now() + minutes * MIN).toISOString();

  /** A guest who may pay online for a lesson: a phone (guestClient) and the lessons terms accepted. */
  const newGuest = async (tag: string) => {
    const client = await guestClient(svc, tag);
    const { data } = await client.auth.getUser();
    const id = data.user!.id;
    const t = await call(client, 'accept_terms', { p_version: TERMS });
    expect(t.ok, t.code).toBe(true);
    return { client, id };
  };

  /** A private lesson held for an online payment, as 0283's lesson_book_private leaves it. */
  const plantPrivate = async (guestId: string, n: number) => {
    const s = slot(n);
    const hold = soon(15);
    const lesson = await ins('lessons', {
      venue_id: VENUE_A_ID,
      coach_id: coach,
      lesson_type_id: lt.private,
      kind: 'private',
      start_at: s.start,
      end_at: s.end,
      price_iqd: 40_000,
      court_share_iqd: 10_000,
      coach_share_bp: 6000,
      max_places: 2,
      min_places: 1,
      status: 'held',
      hold_expires_at: hold,
      booked_by_kind: 'guest',
      created_by_profile_id: guestId,
    });
    const holdRow = await ins('reservations', {
      venue_id: VENUE_A_ID,
      court_id: court,
      kind: 'hold',
      status: 'pending',
      start_at: s.start,
      end_at: s.end,
      guest_name: 'Lesson',
      source: 'mobile',
      hold_expires_at: hold,
      lesson_id: lesson,
    });
    const enrolment = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID,
      lesson_id: lesson,
      guest_id: guestId,
      booked_by_kind: 'guest',
      booked_by_profile_id: guestId,
      price_iqd: 40_000,
      payment_mode: 'online',
      status: 'held',
      hold_expires_at: hold,
      link_confirmed_at: new Date().toISOString(),
    });
    enrolments.add(enrolment);
    return { lesson, hold: holdRow, enrolment, start: s.start };
  };

  /** A scheduled group session (desk-created) with `booked` walk-ins already on it. */
  const plantGroup = async (n: number, maxPlaces: number, walkIns: number) => {
    const s = slot(n);
    const lesson = await ins('lessons', {
      venue_id: VENUE_A_ID,
      coach_id: coach,
      lesson_type_id: lt.group,
      kind: 'group',
      start_at: s.start,
      end_at: s.end,
      price_iqd: 15_000,
      court_share_iqd: 10_000,
      coach_share_bp: 6000,
      max_places: maxPlaces,
      min_places: 1,
      cutoff_at: new Date(Date.parse(s.start) - 2 * 60 * MIN).toISOString(),
      status: 'scheduled',
      booked_by_kind: 'staff',
      created_by_staff_id: SEED_STAFF_IDS.court_desk,
    });
    for (let i = 0; i < walkIns; i++) await deskPlace(lesson, `Walk-in ${i + 1}`);
    return { lesson, start: s.start };
  };
  const deskPlace = (lesson: string, name: string) =>
    ins('lesson_enrolments', {
      venue_id: VENUE_A_ID,
      lesson_id: lesson,
      guest_name: name,
      booked_by_kind: 'staff',
      booked_by_staff_id: SEED_STAFF_IDS.court_desk,
      price_iqd: 15_000,
      payment_mode: 'desk',
      status: 'booked',
    });
  /** A guest's held place in a group session or a course. */
  const heldPlace = async (
    guestId: string,
    target: { lesson?: string; course?: string; sessions?: number },
    price: number,
  ) => {
    const e = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID,
      guest_id: guestId,
      booked_by_kind: 'guest',
      booked_by_profile_id: guestId,
      price_iqd: price,
      payment_mode: 'online',
      status: 'held',
      hold_expires_at: soon(15),
      link_confirmed_at: new Date().toISOString(),
      ...(target.lesson ? { lesson_id: target.lesson } : {}),
      ...(target.course
        ? { course_id: target.course, first_session_no: 1, sessions_covered: target.sessions }
        : {}),
    });
    enrolments.add(e);
    return e;
  };

  /** lesson-begin minus the gateway: prepare, then the gateway's id and page (pending). */
  const begin = async (guestId: string, enrolment: string) => {
    const prep = await svcCall('lesson_payment_prepare', {
      p_guest_id: guestId,
      p_enrolment_id: enrolment,
      p_locale: 'en',
      p_provider: 'fake',
    });
    expect(prep.ok, `${prep.code} ${prep.detail ?? ''}`).toBe(true);
    const row = prep.data as {
      id: string;
      request_id: string;
      amount_iqd: number;
      reused: boolean;
      status: string;
      deadline_at: string;
    };
    payments.add(row.request_id);
    if (row.status === 'created') {
      const created = await svcCall('deposit_mark_created', {
        p_request_id: row.request_id,
        p_provider_payment_id: `pay-${crypto.randomUUID()}`,
        p_form_url: `http://127.0.0.1:54321/functions/v1/payments-fake?ref=${row.request_id}`,
        p_provider_status: 'CREATED',
        p_raw: {},
      });
      expect(created.ok, created.code).toBe(true);
    }
    return { ...row, data: prep.data };
  };

  /** What the webhook does with the bank's answer. */
  const apply = (requestId: string, status: string, amount: number | null) =>
    svcCall('deposit_apply', {
      p_request_id: requestId,
      p_provider_payment_id: null,
      p_provider_status: status,
      p_amount: amount,
      p_currency: 'IQD',
      p_canceled: false,
      p_source: 'webhook',
      p_signature_ok: true,
      p_raw: { status },
    });

  const eventsOf = async (enrolment: string) => {
    const { data } = await svc
      .from('lesson_events')
      .select('type, actor, code, data, lesson_id, course_id')
      .eq('enrolment_id', enrolment)
      .order('id');
    return (data ?? []) as Json[];
  };
  const strikesOf = async (enrolment: string) => {
    const { data } = await svc
      .from('lesson_strikes')
      .select('kind, lesson_id, settled_at')
      .eq('enrolment_id', enrolment);
    return (data ?? []) as Json[];
  };
  const liveCourtRows = async (lesson: string) => {
    const { data } = await svc
      .from('reservations')
      .select('id, kind, status, court_id')
      .eq('lesson_id', lesson)
      .in('status', ['pending', 'confirmed', 'arrived']);
    return (data ?? []) as Json[];
  };
  const bookedPlaces = async (lesson: string) => {
    const { data } = await svc
      .from('lesson_enrolments')
      .select('party_size')
      .eq('lesson_id', lesson)
      .eq('status', 'booked');
    return ((data ?? []) as { party_size: number }[]).reduce((s, r) => s + r.party_size, 0);
  };

  // ── the file's coach, court, types and switches ───────────────────────────
  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);

    const { data: vs } = await svc
      .from('venue_settings')
      .select('coaching_enabled, lesson_payment_mode')
      .eq('venue_id', VENUE_A_ID)
      .single();
    const { data: ps } = await svc
      .from('platform_settings')
      .select('lesson_terms_version')
      .eq('id', true)
      .single();
    saved = {
      coaching_enabled: (vs as Json).coaching_enabled as boolean,
      lesson_payment_mode: (vs as Json).lesson_payment_mode as string,
      terms: ((ps as Json).lesson_terms_version as string | null) ?? null,
    };
    await setTerms(TERMS);
    await setVenue({ coaching_enabled: true, lesson_payment_mode: 'online_optional' });

    court = await createTestCourt(svc, `L0284 ${Date.now()}`);

    const coachGuest = await guestClient(svc, 'l0284-coach');
    const coachProfile = (await coachGuest.auth.getUser()).data.user!.id;
    coach = await ins('coaches', {
      profile_id: coachProfile,
      display_name_en: 'Coach 0284',
      display_name_ar: 'مدرّب ٠٢٨١',
      public_accepted_at: new Date().toISOString(),
    });
    {
      const { error } = await svc
        .from('coach_branches')
        .insert({ coach_id: coach, venue_id: VENUE_A_ID });
      if (error) throw new Error(`coach_branches: ${error.message}`);
    }
    {
      const { error } = await svc.from('coach_hours').insert(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          coach_id: coach,
          venue_id: VENUE_A_ID,
          weekday,
          start_time: '00:00',
          end_time: '24:00',
          set_by: 'coach',
        })),
      );
      if (error) throw new Error(`coach_hours: ${error.message}`);
    }
    const launched = new Date().toISOString();
    lt.private = await ins('lesson_types', {
      venue_id: VENUE_A_ID,
      kind: 'private',
      name_en: 'Private 0284',
      name_ar: 'حصة خاصة ٠٢٨١',
      duration_min: 60,
      price_iqd: 40_000,
      court_share_iqd: 10_000,
      max_places: 2,
      min_places: 1,
      cutoff_hours: 0,
      is_active: true,
      launched_at: launched,
    });
    lt.group = await ins('lesson_types', {
      venue_id: VENUE_A_ID,
      kind: 'group',
      name_en: 'Group 0284',
      name_ar: 'حصة جماعية ٠٢٨١',
      duration_min: 60,
      price_iqd: 15_000,
      court_share_iqd: 10_000,
      max_places: 8,
      min_places: 1,
      cutoff_hours: 2,
      is_active: true,
      launched_at: launched,
    });
    lt.course = await ins('lesson_types', {
      venue_id: VENUE_A_ID,
      kind: 'course',
      name_en: 'Course 0284',
      name_ar: 'دورة ٠٢٨١',
      duration_min: 60,
      price_iqd: 100_001,
      court_share_iqd: 8_000,
      max_places: 8,
      min_places: 1,
      cutoff_hours: 2,
      sessions_count: 4,
      is_active: true,
      launched_at: launched,
    });
  });

  afterAll(async () => {
    if (!svc) return;
    // Close every attempt still open (its enrolment expires with it), then any
    // place still held: nothing of this file is left for the sweep to find.
    for (const rq of payments) {
      const { data } = await svc
        .from('booking_payments')
        .select('status')
        .eq('request_id', rq)
        .single();
      if (data && ['created', 'pending'].includes((data as Json).status as string))
        await apply(rq, 'EXPIRED', null);
    }
    for (const e of enrolments) {
      const { data } = await svc.from('lesson_enrolments').select('status').eq('id', e).single();
      if (data && (data as Json).status === 'held')
        await svcCall('lesson_hold_expire', { p_enrolment_id: e });
    }
    // Paused: kept off every guest list and the public reads (R16, R76); its lessons stay.
    if (coach) await setRow('coaches', coach, { status: 'paused' });
    if (saved) {
      await setVenue({
        coaching_enabled: saved.coaching_enabled,
        lesson_payment_mode: saved.lesson_payment_mode,
      });
      await setTerms(saved.terms);
    }
  });

  // ── O1 ────────────────────────────────────────────────────────────────────
  it('O1 private: begin -> the bank says SUCCESS -> booked on the same court, one paid_online event', async () => {
    const g = await newGuest('l0284-o1');
    const p = await plantPrivate(g.id, 1);

    const a = await begin(g.id, p.enrolment);
    expect(a.data).toMatchObject({
      purpose: 'lesson',
      status: 'created',
      amount_iqd: 40_000,
      reused: false,
      provider: 'fake',
      sandbox: false,
      enrolment_id: p.enrolment,
      lesson_id: p.lesson,
      course_id: null,
      locale: 'en',
    });
    expect(a.data.guest_phone).toBeTruthy();

    // The window owns the hold (0242:411-414): enrolment, lesson and hold row all reach the deadline.
    const deadline = Date.parse(a.deadline_at);
    for (const [table, id] of [
      ['lesson_enrolments', p.enrolment],
      ['lessons', p.lesson],
      ['reservations', p.hold],
    ] as const) {
      const r = await one(table, id, 'hold_expires_at');
      expect(Date.parse(r.hold_expires_at as string), table).toBeGreaterThanOrEqual(deadline);
    }
    const pay = await one('booking_payments', a.id);
    expect(pay).toMatchObject({
      purpose: 'lesson',
      lesson_enrolment_id: p.enrolment,
      hold_id: p.hold,
      reservation_id: null,
      venue_id: VENUE_A_ID,
      ticket_count: null,
      quoted_price_iqd: 40_000,
      status: 'pending',
    });

    // A double tap hands back the same attempt.
    const again = await svcCall('lesson_payment_prepare', {
      p_guest_id: g.id,
      p_enrolment_id: p.enrolment,
      p_locale: 'ar',
      p_provider: 'fake',
    });
    expect(again.ok, again.code).toBe(true);
    expect(again.data).toMatchObject({ request_id: a.request_id, reused: true, status: 'pending' });

    // What the payment screen polls (X14).
    const st = await call(g.client, 'deposit_status', { p_request_id: a.request_id });
    expect(st.ok, st.code).toBe(true);
    expect(missingKeys(st.data, COACHING_SHAPES.deposit_status)).toEqual([]);
    expect(st.data).toMatchObject({
      purpose: 'lesson',
      status: 'pending',
      amount_iqd: 40_000,
      price_iqd: 40_000,
      rest_iqd: 0,
      hold_live: true,
      attempts_left: 2,
      reservation: null,
      ticket_count: null,
      deposit_mode: null,
      lesson: {
        enrolment_id: p.enrolment,
        enrolment_status: 'held',
        kind: 'private',
        lesson_id: p.lesson,
        course_id: null,
        venue_id: VENUE_A_ID,
        coach_id: coach,
        coach_name_en: 'Coach 0284',
        type_name_en: 'Private 0284',
      },
    });
    expect(Date.parse((st.data.lesson as Json).start_at as string)).toBe(Date.parse(p.start));
    // Another guest reads it as not there.
    const stranger = await newGuest('l0284-o1-x');
    expect(
      (await call(stranger.client, 'deposit_status', { p_request_id: a.request_id })).code,
    ).toBe('PAYMENT_NOT_FOUND');

    const ok = await apply(a.request_id, 'SUCCESS', 40_000);
    expect(ok.ok, ok.code).toBe(true);
    expect(ok.data).toMatchObject({
      matched: true,
      status: 'succeeded',
      purpose: 'lesson',
      lesson_enrolment_id: p.enrolment,
    });

    const hold = await one('reservations', p.hold);
    expect(hold).toMatchObject({
      kind: 'lesson',
      status: 'confirmed',
      court_id: court,
      hold_expires_at: null,
      lesson_id: p.lesson,
    });
    expect(await one('lessons', p.lesson)).toMatchObject({
      status: 'scheduled',
      hold_expires_at: null,
    });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({
      status: 'booked',
      hold_expires_at: null,
    });
    expect(await one('booking_payments', a.id)).toMatchObject({
      status: 'succeeded',
      refund_reason: null,
    });

    const ev = (await eventsOf(p.enrolment)).filter((e) => e.type === 'paid_online');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: 'system', lesson_id: p.lesson, course_id: null });
    expect(ev[0]!.data).toMatchObject({
      payment_id: a.id,
      amount_iqd: 40_000,
      lesson_id: p.lesson,
    });
    expect(ev[0]!.data).not.toHaveProperty('places_taken'); // a private lesson sends no places
    expect(ev[0]!.data).not.toHaveProperty('revived');

    const { data: audit } = await svc.from('audit_log').select('action').eq('entity_id', a.id);
    expect(((audit ?? []) as Json[]).map((r) => r.action)).toEqual(
      expect.arrayContaining(['lesson.payment_begin', 'lesson.paid_online']),
    );

    // The duplicate webhook: logged, nothing moves.
    const dup = await apply(a.request_id, 'SUCCESS', 40_000);
    expect(dup.data).toMatchObject({ matched: true, status: 'succeeded' });
    expect((await eventsOf(p.enrolment)).filter((e) => e.type === 'paid_online')).toHaveLength(1);
    expect(await liveCourtRows(p.lesson)).toHaveLength(1);

    // Paid: nothing more to pay online.
    const after = await svcCall('lesson_payment_prepare', {
      p_guest_id: g.id,
      p_enrolment_id: p.enrolment,
      p_locale: 'en',
      p_provider: 'fake',
    });
    expect([after.code, after.detail]).toEqual(['LESSON_NOT_PAYABLE', 'booked']);
  });

  // ── O2 ────────────────────────────────────────────────────────────────────
  it('O2 group and course: the place is booked; the event carries the booked places (R78)', async () => {
    const grp = await plantGroup(2, 4, 2);
    const g = await newGuest('l0284-o2g');
    const e = await heldPlace(g.id, { lesson: grp.lesson }, 15_000);
    const a = await begin(g.id, e);
    expect(await one('booking_payments', a.id)).toMatchObject({
      hold_id: null,
      lesson_enrolment_id: e,
      amount_iqd: 15_000,
    });
    const r = await apply(a.request_id, 'SUCCESS', 15_000);
    expect(r.data).toMatchObject({ status: 'succeeded' });
    expect(await one('lesson_enrolments', e)).toMatchObject({
      status: 'booked',
      hold_expires_at: null,
    });
    expect(await bookedPlaces(grp.lesson)).toBe(3);
    const ev = (await eventsOf(e)).find((x) => x.type === 'paid_online')!;
    expect(ev.data).toMatchObject({ places_taken: 3, places_total: 4, lesson_id: grp.lesson });

    // A course: four weekly sessions, the whole course for one person.
    const s = [10, 17, 24, 31].map((n) => slot(n));
    const course = await ins('courses', {
      venue_id: VENUE_A_ID,
      coach_id: coach,
      lesson_type_id: lt.course,
      price_iqd: 100_001,
      court_share_iqd: 8_000,
      coach_share_bp: 6000,
      sessions_count: 4,
      max_places: 8,
      min_places: 1,
      cutoff_at: new Date(Date.parse(s[0]!.start) - 2 * 60 * MIN).toISOString(),
      signup_closes_at: s[3]!.start,
      created_by_kind: 'staff',
      created_by_staff_id: SEED_STAFF_IDS.court_desk,
    });
    const sessions: string[] = [];
    for (let i = 0; i < 4; i++) {
      sessions.push(
        await ins('lessons', {
          venue_id: VENUE_A_ID,
          coach_id: coach,
          lesson_type_id: lt.course,
          kind: 'course',
          course_id: course,
          session_no: i + 1,
          start_at: s[i]!.start,
          end_at: s[i]!.end,
          court_share_iqd: 8_000,
          coach_share_bp: 6000,
          max_places: 8,
          min_places: 1,
          cutoff_at: new Date(Date.parse(s[0]!.start) - 2 * 60 * MIN).toISOString(),
          status: 'scheduled',
          booked_by_kind: 'staff',
          created_by_staff_id: SEED_STAFF_IDS.court_desk,
        }),
      );
    }
    const gc = await newGuest('l0284-o2c');
    const ec = await heldPlace(gc.id, { course, sessions: 4 }, 100_001);
    const ac = await begin(gc.id, ec);
    const st = await call(gc.client, 'deposit_status', { p_request_id: ac.request_id });
    expect(missingKeys(st.data, COACHING_SHAPES.deposit_status)).toEqual([]);
    expect(st.data.lesson).toMatchObject({
      kind: 'course',
      lesson_id: null,
      course_id: course,
      enrolment_status: 'held',
    });
    expect(Date.parse((st.data.lesson as Json).start_at as string)).toBe(Date.parse(s[0]!.start));
    const rc = await apply(ac.request_id, 'SUCCESS', 100_001);
    expect(rc.data).toMatchObject({ status: 'succeeded' });
    expect(await one('lesson_enrolments', ec)).toMatchObject({ status: 'booked' });
    const evc = (await eventsOf(ec)).find((x) => x.type === 'paid_online')!;
    expect(evc).toMatchObject({ course_id: course, lesson_id: sessions[0] });
    expect(evc.data).toMatchObject({ places_taken: 1, places_total: 8, lesson_id: sessions[0] });
  });

  // ── O3 ────────────────────────────────────────────────────────────────────
  it("O3 prepare's refusals, with their details", async () => {
    const g = await newGuest('l0284-o3');
    const other = await newGuest('l0284-o3-x');
    const p = await plantPrivate(g.id, 3);
    const prep = (guest: string, enrolment: string | null, provider = 'fake') =>
      svcCall('lesson_payment_prepare', {
        p_guest_id: guest,
        p_enrolment_id: enrolment,
        p_locale: 'en',
        p_provider: provider,
      });
    const refusal = async (pr: Promise<{ code?: string; detail: string | null }>) => {
      const r = await pr;
      return [r.code, r.detail];
    };

    expect(await refusal(prep(g.id, null))).toEqual(['INVALID_ARGUMENT', 'p_enrolment_id']);
    expect(await refusal(prep(g.id, p.enrolment, 'paypal'))).toEqual([
      'INVALID_ARGUMENT',
      'p_provider',
    ]);
    expect(await refusal(prep(crypto.randomUUID(), p.enrolment))).toEqual([
      'ACCOUNT_REQUIRED',
      null,
    ]);
    // Someone else's enrolment reads as none.
    expect(await refusal(prep(other.id, p.enrolment))).toEqual(['ENROLMENT_NOT_FOUND', null]);
    expect(await refusal(prep(g.id, crypto.randomUUID()))).toEqual(['ENROLMENT_NOT_FOUND', null]);

    // A desk-paid place is paid at the desk.
    const grp = await plantGroup(4, 6, 0);
    const desk = await ins('lesson_enrolments', {
      venue_id: VENUE_A_ID,
      lesson_id: grp.lesson,
      guest_id: g.id,
      booked_by_kind: 'guest',
      booked_by_profile_id: g.id,
      price_iqd: 15_000,
      payment_mode: 'desk',
      status: 'booked',
      link_confirmed_at: new Date().toISOString(),
    });
    expect(await refusal(prep(g.id, desk))).toEqual(['LESSON_NOT_PAYABLE', 'desk']);

    // The branch's switches, in order: coaching off, then online off.
    await setVenue({ coaching_enabled: false });
    try {
      expect(await refusal(prep(g.id, p.enrolment))).toEqual(['COACHING_OFF', null]);
    } finally {
      await setVenue({ coaching_enabled: true });
    }
    await setVenue({ lesson_payment_mode: 'desk' });
    try {
      expect(await refusal(prep(g.id, p.enrolment))).toEqual(['ONLINE_PAYMENT_OFF', null]);
    } finally {
      await setVenue({ lesson_payment_mode: 'online_optional' });
    }

    // C-26, R50: terms with the lessons section, accepted by this guest.
    await setTerms('2026-12-01');
    try {
      expect(await refusal(prep(g.id, p.enrolment))).toEqual(['TERMS_REQUIRED', 'lessons']);
    } finally {
      await setTerms(TERMS);
    }
    await setTerms(null);
    try {
      expect(await refusal(prep(g.id, p.enrolment))).toEqual(['TERMS_REQUIRED', 'lessons']);
    } finally {
      await setTerms(TERMS);
    }

    // No attempt was recorded by any refusal.
    const { data: none } = await svc
      .from('booking_payments')
      .select('id')
      .eq('lesson_enrolment_id', p.enrolment);
    expect(none ?? []).toHaveLength(0);

    // Three attempts per enrolment.
    for (let i = 0; i < 3; i++) {
      const a = await begin(g.id, p.enrolment);
      expect((await apply(a.request_id, 'FAILED', null)).data).toMatchObject({ status: 'failed' });
    }
    expect(await refusal(prep(g.id, p.enrolment))).toEqual(['TOO_MANY_ATTEMPTS', null]);
    // FAILED kept the place held all along.
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'held' });
  });

  // ── O4, O8 ────────────────────────────────────────────────────────────────
  it('O4 FAILED keeps the hold and a retry succeeds; O8 the first attempt paying late is duplicate_success', async () => {
    const g = await newGuest('l0284-o4');
    const p = await plantPrivate(g.id, 5);
    const first = await begin(g.id, p.enrolment);
    expect((await apply(first.request_id, 'FAILED', null)).data).toMatchObject({
      status: 'failed',
    });
    expect(await one('reservations', p.hold)).toMatchObject({ kind: 'hold', status: 'pending' });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'held' });
    const st = await call(g.client, 'deposit_status', { p_request_id: first.request_id });
    expect(st.data).toMatchObject({ status: 'failed', hold_live: true, attempts_left: 2 });

    const second = await begin(g.id, p.enrolment);
    expect(second.request_id).not.toBe(first.request_id);
    expect((await apply(second.request_id, 'SUCCESS', 40_000)).data).toMatchObject({
      status: 'succeeded',
    });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'booked' });

    // The bank pays the failed attempt after all: one place, so that money goes back whole.
    const late = await apply(first.request_id, 'SUCCESS', 40_000);
    expect(late.data).toMatchObject({ status: 'refund_pending' });
    expect(await one('booking_payments', first.id)).toMatchObject({
      status: 'refund_pending',
      refund_reason: 'duplicate_success',
      refund_amount_iqd: 40_000,
    });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'booked' });
    expect((await eventsOf(p.enrolment)).filter((e) => e.type === 'paid_online')).toHaveLength(1);

    // The wrong amount is not our payment: the whole row back, the enrolment untouched.
    const g2 = await newGuest('l0284-o8');
    const p2 = await plantPrivate(g2.id, 6);
    const a2 = await begin(g2.id, p2.enrolment);
    expect((await apply(a2.request_id, 'SUCCESS', 39_000)).data).toMatchObject({
      status: 'refund_pending',
    });
    expect(await one('booking_payments', a2.id)).toMatchObject({
      refund_reason: 'amount_mismatch',
    });
    expect(await one('lesson_enrolments', p2.enrolment)).toMatchObject({ status: 'held' });
    expect(await one('reservations', p2.hold)).toMatchObject({ kind: 'hold', status: 'pending' });
  });

  // ── O5, O6 ────────────────────────────────────────────────────────────────
  it('O5 EXPIRED: the place, the lesson and its hold expire, with a lapsed_hold strike; O6 a late SUCCESS when the coach was booked meanwhile is slot_lost', async () => {
    const g = await newGuest('l0284-o5');
    const p = await plantPrivate(g.id, 7);
    const a = await begin(g.id, p.enrolment);

    const ex = await apply(a.request_id, 'EXPIRED', null);
    expect(ex.data).toMatchObject({ status: 'expired', lesson_enrolment_id: p.enrolment });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({
      status: 'expired',
      cancel_kind: 'expired',
      hold_expires_at: null,
    });
    expect(await one('lessons', p.lesson)).toMatchObject({
      status: 'expired',
      cancel_reason: 'payment_expired',
      hold_expires_at: null,
    });
    expect(await one('reservations', p.hold)).toMatchObject({ kind: 'hold', status: 'expired' });
    const ev = (await eventsOf(p.enrolment)).filter((e) => e.type === 'expired');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: 'system', code: 'payment_expired', lesson_id: p.lesson });
    // R30: recorded, applied later by hold_strikes_settle (the cron may already have settled it).
    expect(await strikesOf(p.enrolment)).toEqual([
      expect.objectContaining({ kind: 'lapsed_hold', lesson_id: p.lesson }),
    ]);
    const st = await call(g.client, 'deposit_status', { p_request_id: a.request_id });
    expect(st.data).toMatchObject({
      status: 'expired',
      hold_live: false,
      lesson: { enrolment_status: 'expired' },
    });
    // Expired: nothing more to pay.
    const re = await svcCall('lesson_payment_prepare', {
      p_guest_id: g.id,
      p_enrolment_id: p.enrolment,
      p_locale: 'en',
      p_provider: 'fake',
    });
    expect([re.code, re.detail]).toEqual(['LESSON_NOT_PAYABLE', 'expired']);

    // The coach takes another lesson over that hour; then the bank pays.
    const s = slot(7);
    await ins('lessons', {
      venue_id: VENUE_A_ID,
      coach_id: coach,
      lesson_type_id: lt.group,
      kind: 'group',
      start_at: s.start,
      end_at: s.end,
      price_iqd: 15_000,
      court_share_iqd: 10_000,
      coach_share_bp: 6000,
      max_places: 4,
      min_places: 1,
      cutoff_at: new Date(Date.parse(s.start) - 2 * 60 * MIN).toISOString(),
      status: 'scheduled',
      booked_by_kind: 'staff',
      created_by_staff_id: SEED_STAFF_IDS.court_desk,
    });
    const late = await apply(a.request_id, 'SUCCESS', 40_000);
    expect(late.data).toMatchObject({ status: 'refund_pending' });
    expect(await one('booking_payments', a.id)).toMatchObject({
      status: 'refund_pending',
      refund_reason: 'slot_lost',
      refund_amount_iqd: 40_000,
    });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'expired' });
    expect(await one('lessons', p.lesson)).toMatchObject({ status: 'expired' });
    expect(await liveCourtRows(p.lesson)).toHaveLength(0);
    // R65: the guest did pay; no unsettled lapsed_hold strike is left on them.
    expect((await strikesOf(p.enrolment)).filter((s2) => s2.settled_at === null)).toEqual([]);
  });

  it('O6 a late SUCCESS while everything is still free revives the lesson (R29) and withdraws the strike (R65)', async () => {
    const g = await newGuest('l0284-o6');
    const p = await plantPrivate(g.id, 8);
    const a = await begin(g.id, p.enrolment);
    expect((await apply(a.request_id, 'EXPIRED', null)).data).toMatchObject({ status: 'expired' });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'expired' });

    const late = await apply(a.request_id, 'SUCCESS', 40_000);
    expect(late.data).toMatchObject({ status: 'succeeded' });
    expect(await one('lessons', p.lesson)).toMatchObject({
      status: 'scheduled',
      cancel_reason: null,
      cancelled_at: null,
      hold_expires_at: null,
    });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({
      status: 'booked',
      cancel_kind: null,
      cancelled_at: null,
      hold_expires_at: null,
    });
    // A court row again (possibly another court: re-picked from the branch's locked set).
    const rows = await liveCourtRows(p.lesson);
    expect(rows).toEqual([expect.objectContaining({ kind: 'lesson', status: 'confirmed' })]);
    const ev = (await eventsOf(p.enrolment)).filter((e) => e.type === 'paid_online');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({ payment_id: a.id, revived: true });
    expect((await strikesOf(p.enrolment)).filter((s) => s.settled_at === null)).toEqual([]);
  });

  // ── O7 ────────────────────────────────────────────────────────────────────
  it('O7 a hold expired by TTL past the payment grace: SUCCESS re-picks a court from the locked set (R25, R34)', async () => {
    const g = await newGuest('l0284-o7');
    const p = await plantPrivate(g.id, 9);
    const a = await begin(g.id, p.enrolment);
    // The hold row's TTL and the attempt's deadline both well past (the ten-minute grace too);
    // the enrolment and the lesson keep their window, so the lesson sweep leaves them alone.
    await setRow('reservations', p.hold, { hold_expires_at: soon(-30) });
    await setRow('booking_payments', a.id, { deadline_at: soon(-20) });

    const r = await apply(a.request_id, 'SUCCESS', 40_000);
    expect(r.data).toMatchObject({ status: 'succeeded' });
    expect(await one('reservations', p.hold)).toMatchObject({ kind: 'hold', status: 'expired' });
    const rows = await liveCourtRows(p.lesson);
    expect(rows).toEqual([expect.objectContaining({ kind: 'lesson', status: 'confirmed' })]);
    expect(rows[0]!.id).not.toBe(p.hold);
    expect(await one('lessons', p.lesson)).toMatchObject({ status: 'scheduled' });
    expect(await one('lesson_enrolments', p.enrolment)).toMatchObject({ status: 'booked' });
  });

  // ── O12 ───────────────────────────────────────────────────────────────────
  it('O12 a full group (R29): the desk takes the last place while a held one is past its grace; its SUCCESS is slot_lost', async () => {
    const grp = await plantGroup(11, 3, 2);
    const g1 = await newGuest('l0284-o12');
    const e1 = await heldPlace(g1.id, { lesson: grp.lesson }, 15_000);
    const a1 = await begin(g1.id, e1);
    // G1's window and its payment's grace are over: its place no longer counts...
    await setRow('lesson_enrolments', e1, { hold_expires_at: soon(-15) });
    await setRow('booking_payments', a1.id, { deadline_at: soon(-15) });
    // ...so the desk sells the third and last place.
    await deskPlace(grp.lesson, 'Walk-in 3');
    expect(await bookedPlaces(grp.lesson)).toBe(3);

    const r = await apply(a1.request_id, 'SUCCESS', 15_000);
    expect(r.data).toMatchObject({ status: 'refund_pending' });
    expect(await one('booking_payments', a1.id)).toMatchObject({
      refund_reason: 'slot_lost',
      refund_amount_iqd: 15_000,
    });
    // Never a fourth place (held, or expired by the sweep meanwhile: never booked).
    expect(await bookedPlaces(grp.lesson)).toBe(3);
    expect(['held', 'expired']).toContain((await one('lesson_enrolments', e1)).status);
  });

  // ── O9, O11 ───────────────────────────────────────────────────────────────
  it('O9 the reconciler starts the refund a cancel never started (R28); O11 the refund outcome; the attention list; CM-5', async () => {
    const grp = await plantGroup(12, 6, 0);
    const g = await newGuest('l0284-o9');
    const e = await heldPlace(g.id, { lesson: grp.lesson }, 15_000);
    const a = await begin(g.id, e);
    expect((await apply(a.request_id, 'SUCCESS', 15_000)).data).toMatchObject({
      status: 'succeeded',
    });

    // CM-5: the lesson is still ahead, so a manager cannot hand the money back by hand.
    const early = await call(manager, 'deposit_refund_request', {
      p_payment_id: a.id,
      p_amount_iqd: null,
    });
    expect([early.code, early.detail]).toEqual(['PAYMENT_STATE', 'lesson_live']);

    // A cancel that wrote its statuses but never reached the refund (as postgres, no refund),
    // a long time ago: the net has no window.
    await setRow('lesson_enrolments', e, {
      status: 'cancelled',
      cancel_kind: 'staff',
      cancelled_at: new Date().toISOString(),
    });
    await setRow('booking_payments', a.id, {
      updated_at: new Date(Date.now() - 40 * 24 * 60 * MIN).toISOString(),
    });

    const due = await svcCall('deposits_due_for_reconcile', { p_limit: 100 });
    expect(due.ok, due.code).toBe(true);
    expect(await one('booking_payments', a.id)).toMatchObject({
      status: 'refund_pending',
      refund_reason: 'staff_cancel',
      refund_amount_iqd: 15_000,
    });
    const claimed = (due.data as unknown as Json[]).find((r) => r.id === a.id);
    expect(claimed).toMatchObject({
      action: 'refund',
      purpose: 'lesson',
      lesson_enrolment_id: e,
      refund_amount_iqd: 15_000,
    });
    // Started once: a second run finds nothing more due.
    await svcCall('deposits_due_for_reconcile', { p_limit: 100 });
    expect(await one('booking_payments', a.id)).toMatchObject({
      status: 'refund_pending',
      refund_amount_iqd: 15_000,
    });
    expect((await eventsOf(e)).filter((x) => x.type === 'refunded')).toHaveLength(1);

    // Qi refuses: the attention list shows it at its branch, with the lesson keys.
    const failed = await svcCall('deposit_refund_apply', {
      p_payment_id: a.id,
      p_outcome: 'failed',
      p_provider_status: '18',
      p_refund_provider_id: null,
      p_raw: {},
    });
    expect(failed.data).toMatchObject({ status: 'refund_failed', changed: true });
    const list = await call(manager, 'deposit_attention', { p_venue_id: VENUE_A_ID });
    expect(list.ok, list.code).toBe(true);
    const item = (list.data as unknown as Json[]).find((r) => r.id === a.id);
    expect(item).toMatchObject({
      purpose: 'lesson',
      status: 'refund_failed',
      lesson_enrolment_id: e,
      enrolment_id: e,
      lesson_id: grp.lesson,
      course_id: null,
      customer_id: g.id,
      reservation_id: null,
      court_name_en: null,
    });
    expect(Date.parse(item!.start_at as string)).toBe(Date.parse(grp.start));

    const retry = await call(manager, 'deposit_refund_retry', { p_payment_id: a.id });
    expect(retry.ok, retry.code).toBe(true);
    const done = await svcCall('deposit_refund_apply', {
      p_payment_id: a.id,
      p_outcome: 'succeeded',
      p_provider_status: 'SUCCESS',
      p_refund_provider_id: 'rf-1',
      p_raw: {},
    });
    expect(done.data).toMatchObject({ status: 'refunded', changed: true });
    const { data: audit } = await svc
      .from('audit_log')
      .select('action, after')
      .eq('entity_id', a.id)
      .eq('action', 'lesson.refunded');
    expect(audit ?? []).toHaveLength(1);
    expect(((audit ?? []) as Json[])[0]!.after).toMatchObject({
      amount_iqd: 15_000,
      reason: 'staff_cancel',
      lesson_enrolment_id: e,
    });
    // No deposit_refunded push for a lesson: the cancel told the guest.
    const { data: outbox } = await svc
      .from('notification_outbox')
      .select('kind')
      .eq('profile_id', g.id)
      .eq('kind', 'deposit_refunded');
    expect(outbox ?? []).toHaveLength(0);
  });
});
