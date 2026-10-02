/**
 * Coaching races, committed, two connections (docs/design/coaching/db.md §7;
 * plan "Coaching: make it bulletproof" TG-03). One session takes a write and
 * holds it two seconds (waitForSleeper: it is inside its pg_sleep, so whatever
 * it locked is held); a second session runs the racing write and is checked
 * once the first commits. No race may end in 40P01 or 23P01: every loser gets
 * the coaching code it would get alone.
 *
 * 0291 lesson_booking_guards:
 *   * DB-08: a desk booking queued behind a retirement is COACH_NOT_FOUND; a
 *     group queued behind a pause is COACH_INACTIVE; a group queued behind an
 *     unlink of its type is LESSON_TYPE_NOT_OFFERED; and the price inserted is
 *     the one read under the coach lock (a coach price set meanwhile);
 *   * DB-09: two course sessions moved across each other: the second move is
 *     SESSION_NOT_MOVABLE order, and the sessions keep their order;
 *   * DB-11: a coach booking queued behind close_branch is COACH_NOT_AT_BRANCH
 *     (no lesson at the closed branch); a close queued behind a booking is
 *     BRANCH_HAS_BOOKINGS.
 *
 * TG-03, on a world of its own (world() below: a branch with one or two
 * courts and a court rate, a second branch, two coaches, four guests):
 *   * booking: two guests for one coach and slot (one wins, COACH_BUSY) and
 *     two coaches for the branch's last court (one wins, NO_COURT_FREE), moved
 *     here from coaching-booking.test.ts; the last group place (LESSON_FULL);
 *     a private lesson at one branch against a group at the other for the same
 *     coach (COACH_BUSY); a court hold against a lesson on a one-court branch,
 *     each way (NO_COURT_FREE, SLOT_TAKEN);
 *   * money and the sweep: a held lesson's cancel against the sweep expiring
 *     its hold, each way (DB-39: one end, no strike, no live hold row); the
 *     bank's SUCCESS against the sweep, each way (booked and paid; a lapse the
 *     late SUCCESS revives); SUCCESS against the guest's cancel, each way
 *     (slot_lost; a paid place cancelled free and refunded);
 *   * R31: an "attended" correction while lesson_join's ladder settles the
 *     no-show strike neither waits nor removes the settled strike; the sweep
 *     skips a coach another transaction holds and finishes without waiting;
 *   * source pins: the strike delete and hold_strikes_settle keep their
 *     FOR UPDATE SKIP LOCKED.
 */
import { describe, expect, it } from 'vitest';
import { SEED_STAFF_IDS, stackAvailable } from './helpers';
import { dockerReachable, psql, psqlSession, waitForSleeper } from './stores-harness';
import { latestBody } from './coaching-source';

const up = await stackAvailable();
const docker = up && dockerReachable();

const OWNER = SEED_STAFF_IDS.owner;
const DESK = SEED_STAFF_IDS.court_desk;

/** A branch (two courts, open all day), one accepted coach teaching a private, a group and a course type. */
function fixture() {
  const id = () => crypto.randomUUID();
  const f = {
    tag: id().slice(0, 8),
    venue: id(),
    court1: id(),
    court2: id(),
    priv: id(),
    group: id(),
    course: id(),
    coach: id(),
    prof: id(),
  };
  psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${f.venue}', 'c291-race-${f.tag}', 'C291 race', 'سباق', 'Asia/Baghdad', true);
insert into venue_settings (venue_id, venue_name, opening_hours, coaching_enabled)
select '${f.venue}', 'C291 race', jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb), true
  from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d;
insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
values ('${f.court1}', '${f.venue}', 'C291 race 1', 'ملعب ١', '{60,90,120}', 1, true),
       ('${f.court2}', '${f.venue}', 'C291 race 2', 'ملعب ٢', '{60,90,120}', 2, true);
insert into staff_venues (staff_id, venue_id, role) values ('${DESK}', '${f.venue}', 'court_desk')
on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('${f.prof}', 'c291-race-${f.prof}@test.touch.local', '{"full_name": "Race"}'::jsonb, 'authenticated',
        'authenticated');
update profiles set phone = '+9647700000000', terms_version = '2026-09-23' where id = '${f.prof}';
insert into coaches (id, profile_id, display_name_en, display_name_ar, public_accepted_at)
values ('${f.coach}', '${f.prof}', 'Race', 'سباق', now());
insert into coach_branches (coach_id, venue_id, active) values ('${f.coach}', '${f.venue}', true);
insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
select '${f.coach}', '${f.venue}', d, '00:00', '24:00', 'coach' from generate_series(0, 6) d;
insert into lesson_types (id, venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd, max_places,
                          min_places, cutoff_hours, sessions_count, is_active, launched_at)
values ('${f.priv}', '${f.venue}', 'private', 'Race private', 'حصة', 60, 30000, 5000, 2, 1, 0, null, true, now()),
       ('${f.group}', '${f.venue}', 'group', 'Race group', 'مجموعة', 60, 15000, 5000, 3, 2, 2, null, true, now()),
       ('${f.course}', '${f.venue}', 'course', 'Race course', 'دورة', 60, 80000, 5000, 3, 2, 2, 4, true, now());
insert into coach_lesson_types (coach_id, lesson_type_id, venue_id)
values ('${f.coach}', '${f.priv}', '${f.venue}'), ('${f.coach}', '${f.group}', '${f.venue}'),
       ('${f.coach}', '${f.course}', '${f.venue}');
commit;`);
  return f;
}
type Fixture = ReturnType<typeof fixture>;

function cleanup(f: Fixture) {
  psql(`begin;
select set_config('request.jwt.claims', '', true);
update reservations set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'C291 cleanup'
 where venue_id = '${f.venue}' and status in ('pending', 'confirmed', 'arrived');
update lesson_enrolments set status = 'cancelled', cancel_kind = 'staff', cancelled_at = now(), hold_expires_at = null
 where venue_id = '${f.venue}' and status in ('held', 'booked');
update lessons set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now(), hold_expires_at = null
 where venue_id = '${f.venue}' and status in ('held', 'scheduled');
update courses set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now()
 where venue_id = '${f.venue}' and status in ('open', 'running');
update coaches set status = 'retired', retired_at = coalesce(retired_at, now()) where id = '${f.coach}';
update courts set is_active = false where venue_id = '${f.venue}';
update venue_settings set coaching_enabled = false where venue_id = '${f.venue}';
delete from staff_venues where venue_id = '${f.venue}';
update venues set is_active = false where id = '${f.venue}' and status <> 'closed';
commit;`);
}

/** One committed session as `who`, optionally named `app` and holding its locks two seconds before the commit. */
const as = (who: string, sql: string, app?: string) =>
  psqlSession(`${app ? `set application_name = '${app}';\n` : ''}begin;
select set_config('request.jwt.claims', '{"sub": "${who}", "role": "authenticated"}', true);
${sql};
${app ? 'select pg_sleep(2);\n' : ''}commit;`);

/** Settle both; the holder must win; the racer's outcome is returned. */
async function race(holder: Promise<string>, app: string, racer: () => Promise<string>) {
  await waitForSleeper(app);
  const [h, r] = await Promise.allSettled([holder, racer()]);
  expect(h.status, h.status === 'rejected' ? String(h.reason) : '').toBe('fulfilled');
  if (r.status === 'rejected') {
    const msg = String(r.reason);
    expect(msg).not.toMatch(/40P01|deadlock|23P01|exclusion/i);
    return { ok: false as const, msg };
  }
  return { ok: true as const, out: r.value };
}

/** A start `days` days and `hours` hours past the current hour (on the 30-minute grid). */
const startIn = (days: number, hours = 0) =>
  `(date_trunc('hour', now()) + interval '${days} days ${hours} hours')`;

const live = (f: Fixture) =>
  psql(
    `select count(*) from lessons where venue_id = '${f.venue}' and status in ('held', 'scheduled')`,
  );

describe.skipIf(!docker)(
  '0291 DB-08: creation reads the coach, the link and the price again under the coach lock',
  () => {
    it('a desk booking queued behind a retirement is COACH_NOT_FOUND, and no lesson is left', async () => {
      const f = fixture();
      try {
        const app = `c291-retire-${f.tag}`;
        const holder = as(OWNER, `select app.set_coach_status('${f.coach}', 'retired', null)`, app);
        const out = await race(holder, app, () =>
          as(
            DESK,
            `select app.desk_book_lesson('${f.coach}', '${f.priv}', ${startIn(3, 2)}, null, 'Walk In', null, 1,
                                       'c291-r-${f.tag}')`,
          ),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/COACH_NOT_FOUND/);
        expect(live(f)).toBe('0');
      } finally {
        cleanup(f);
      }
    }, 60_000);

    it('a group queued behind a pause is COACH_INACTIVE', async () => {
      const f = fixture();
      try {
        const app = `c291-pause-${f.tag}`;
        const holder = as(OWNER, `select app.set_coach_status('${f.coach}', 'paused', null)`, app);
        const out = await race(holder, app, () =>
          as(
            DESK,
            `select app.desk_create_group('${f.coach}', '${f.group}', ${startIn(3, 4)}, 'c291-p-${f.tag}')`,
          ),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/COACH_INACTIVE/);
        expect(live(f)).toBe('0');
      } finally {
        cleanup(f);
      }
    }, 60_000);

    it('a group queued behind an unlink of its type is LESSON_TYPE_NOT_OFFERED', async () => {
      const f = fixture();
      try {
        const app = `c291-unlink-${f.tag}`;
        const holder = as(
          OWNER,
          `select app.set_coach_lesson_types('${f.coach}', '${f.venue}', array['${f.priv}']::uuid[])`,
          app,
        );
        const out = await race(holder, app, () =>
          as(
            DESK,
            `select app.desk_create_group('${f.coach}', '${f.group}', ${startIn(3, 6)}, 'c291-u-${f.tag}')`,
          ),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/LESSON_TYPE_NOT_OFFERED/);
        expect(live(f)).toBe('0');
      } finally {
        cleanup(f);
      }
    }, 60_000);

    it('a booking queued behind a coach price takes the price set meanwhile', async () => {
      const f = fixture();
      try {
        const app = `c291-price-${f.tag}`;
        const holder = as(
          OWNER,
          `select app.set_coach_price('${f.coach}', '${f.priv}', 27000)`,
          app,
        );
        const out = await race(holder, app, () =>
          as(
            DESK,
            `select app.desk_book_lesson('${f.coach}', '${f.priv}', ${startIn(3, 8)}, null, 'Walk In', null, 1,
                                       'c291-c-${f.tag}')`,
          ),
        );
        expect(out.ok, out.ok ? '' : out.msg).toBe(true);
        expect(
          psql(`select l.price_iqd || '|' || e.price_iqd from lessons l join lesson_enrolments e on e.lesson_id = l.id
               where l.venue_id = '${f.venue}' and l.status = 'scheduled'`),
        ).toBe('27000|27000');
      } finally {
        cleanup(f);
      }
    }, 60_000);
  },
);

describe.skipIf(!docker)(
  '0291 DB-09: the course-session order is read again under the coach lock',
  () => {
    it('two sessions moved across each other: the second is SESSION_NOT_MOVABLE order', async () => {
      const f = fixture();
      try {
        const created = psql(`begin;
select set_config('request.jwt.claims', '{"sub": "${DESK}", "role": "authenticated"}', true);
select (app.desk_create_course('${f.coach}', '${f.course}',
          array[${startIn(1, 10)}, ${startIn(2, 10)}, ${startIn(3, 10)}, ${startIn(4, 10)}], '', '',
          'c291-k-${f.tag}'))->>'course_id';
commit;`)
          .split('\n')
          .find((l) => /^[0-9a-f-]{36}$/.test(l.trim()));
        expect(created).toBeTruthy();
        const session = (n: number) =>
          psql(`select id from lessons where course_id = '${created}' and session_no = ${n}`);
        const s2 = session(2);
        const s3 = session(3);
        // Each move alone keeps the order against the other's old time: S2 to day 2 18:00, S3 to day 2 14:00.
        const app = `c291-order-${f.tag}`;
        const holder = as(
          DESK,
          `select app.desk_reschedule_session('${s2}', ${startIn(2, 18)})`,
          app,
        );
        const out = await race(holder, app, () =>
          as(DESK, `select app.desk_reschedule_session('${s3}', ${startIn(2, 14)})`),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/SESSION_NOT_MOVABLE[\s\S]*order/);
        expect(
          psql(
            `select string_agg(session_no::text, ',' order by start_at) from lessons where course_id = '${created}'`,
          ),
        ).toBe('1,2,3,4');
      } finally {
        cleanup(f);
      }
    }, 60_000);
  },
);

describe.skipIf(!docker)(
  '0291 DB-11: a lesson never lands at a branch that has just closed',
  () => {
    it('a coach booking queued behind close_branch is COACH_NOT_AT_BRANCH', async () => {
      const f = fixture();
      try {
        const app = `c291-close-${f.tag}`;
        const holder = as(OWNER, `select app.close_branch('${f.venue}')`, app);
        const out = await race(holder, app, () =>
          as(
            f.prof,
            `select app.coach_book_private('${f.priv}', '${f.venue}', ${startIn(3, 2)}, 'Student', null, 1,
                                         'c291-x-${f.tag}')`,
          ),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/COACH_NOT_AT_BRANCH/);
        expect(psql(`select status from venues where id = '${f.venue}'`)).toBe('closed');
        expect(psql(`select count(*) from lessons where venue_id = '${f.venue}'`)).toBe('0');
      } finally {
        cleanup(f);
      }
    }, 60_000);

    it('a close queued behind a coach booking is BRANCH_HAS_BOOKINGS', async () => {
      const f = fixture();
      try {
        const app = `c291-book-${f.tag}`;
        const holder = as(
          f.prof,
          `select app.coach_book_private('${f.priv}', '${f.venue}', ${startIn(3, 2)}, 'Student', null, 1,
                                       'c291-y-${f.tag}')`,
          app,
        );
        const out = await race(holder, app, () =>
          as(OWNER, `select app.close_branch('${f.venue}')`),
        );
        expect(out.ok).toBe(false);
        expect(out.ok ? '' : out.msg).toMatch(/BRANCH_HAS_BOOKINGS/);
        expect(psql(`select status from venues where id = '${f.venue}'`)).toBe('open');
        expect(live(f)).toBe('1');
      } finally {
        cleanup(f);
      }
    }, 60_000);
  },
);

// ── TG-03: the rest of the races ─────────────────────────────────────────────

const MANAGER = SEED_STAFF_IDS.manager;

/**
 * A world of its own, committed: branch A (two courts, or one with oneCourt; a court rate for
 * hold_slot; online lesson payment), branch B (one court), coach A teaching a private and a group
 * type at A and a group type at B, coach B teaching the private type at A, four guests who may
 * book. coachA fixes coach A's id (the sweep orders its work by coach id).
 */
function world(o: { oneCourt?: boolean; coachA?: string } = {}) {
  const id = () => crypto.randomUUID();
  const w = {
    tag: id().slice(0, 8),
    venue: id(),
    venueB: id(),
    court1: id(),
    court2: id(),
    courtB: id(),
    priv: id(),
    group: id(),
    groupB: id(),
    coachA: o.coachA ?? id(),
    coachB: id(),
    profA: id(),
    profB: id(),
    g: [id(), id(), id(), id()] as const,
  };
  const users = [w.profA, w.profB, ...w.g].map((u) => `'${u}'`).join(', ');
  psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${w.venue}', 'ctg03-a-${w.tag}', 'TG03 A', 'فرع أ', 'Asia/Baghdad', true),
       ('${w.venueB}', 'ctg03-b-${w.tag}', 'TG03 B', 'فرع ب', 'Asia/Baghdad', true);
insert into venue_settings (venue_id, venue_name, opening_hours, coaching_enabled, lesson_payment_mode)
select v, 'TG03', (select jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb)
                     from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d), true, 'online_optional'
  from unnest(array['${w.venue}', '${w.venueB}']::uuid[]) v;
insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
values ('${w.court1}', '${w.venue}', 'TG03 A1', 'ملعب ١', '{60,90,120}', 1, true),
       ('${w.court2}', '${w.venue}', 'TG03 A2', 'ملعب ٢', '{60,90,120}', 2, ${o.oneCourt ? 'false' : 'true'}),
       ('${w.courtB}', '${w.venueB}', 'TG03 B1', 'ملعب', '{60,90,120}', 1, true);
with r as (insert into rate_rules (venue_id, name, court_id, days_of_week, start_time, end_time, priority, valid_from,
                                   is_active)
           values ('${w.venue}', 'TG03 all day', null, '{0,1,2,3,4,5,6}', '00:00', '23:59:59', 0, current_date - 1, true)
           returning id)
insert into rate_rule_prices (rule_id, duration_min, price_iqd)
select r.id, d, 40000 from r, unnest(array[60, 90, 120]) d;
insert into staff_venues (staff_id, venue_id, role)
values ('${DESK}', '${w.venue}', 'court_desk'), ('${DESK}', '${w.venueB}', 'court_desk'),
       ('${MANAGER}', '${w.venue}', 'manager')
on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select x, 'ctg03-' || x || '@test.touch.local', '{"full_name": "Race"}'::jsonb, 'authenticated', 'authenticated'
  from unnest(array[${users}]::uuid[]) x;
update profiles set phone = '+9647700000000', terms_version = '2026-09-23' where id = any (array[${users}]::uuid[]);
insert into coaches (id, profile_id, display_name_en, display_name_ar, public_accepted_at)
values ('${w.coachA}', '${w.profA}', 'TG03 A', 'المدرّب أ', now()), ('${w.coachB}', '${w.profB}', 'TG03 B', 'المدرّب ب', now());
insert into coach_branches (coach_id, venue_id, active)
values ('${w.coachA}', '${w.venue}', true), ('${w.coachA}', '${w.venueB}', true), ('${w.coachB}', '${w.venue}', true);
insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
select b.coach_id, b.venue_id, d, '00:00', '24:00', 'coach'
  from coach_branches b, generate_series(0, 6) d
 where b.coach_id in ('${w.coachA}', '${w.coachB}');
insert into lesson_types (id, venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd, max_places,
                          min_places, cutoff_hours, sessions_count, is_active, launched_at)
values ('${w.priv}', '${w.venue}', 'private', 'TG03 private', 'حصة', 60, 30000, 5000, 2, 1, 0, null, true, now()),
       ('${w.group}', '${w.venue}', 'group', 'TG03 group', 'مجموعة', 60, 15000, 5000, 3, 2, 2, null, true, now()),
       ('${w.groupB}', '${w.venueB}', 'group', 'TG03 group B', 'مجموعة', 60, 15000, 5000, 3, 2, 2, null, true, now());
insert into coach_lesson_types (coach_id, lesson_type_id, venue_id)
values ('${w.coachA}', '${w.priv}', '${w.venue}'), ('${w.coachA}', '${w.group}', '${w.venue}'),
       ('${w.coachA}', '${w.groupB}', '${w.venueB}'), ('${w.coachB}', '${w.priv}', '${w.venue}');
commit;`);
  return w;
}
type World = ReturnType<typeof world>;

function endWorld(w: World) {
  const both = `('${w.venue}', '${w.venueB}')`;
  psql(`begin;
select set_config('request.jwt.claims', '', true);
update reservations set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'TG03 cleanup'
 where venue_id in ${both} and status in ('pending', 'confirmed', 'arrived');
update lesson_enrolments set status = 'cancelled', cancel_kind = 'staff', cancelled_at = now(), hold_expires_at = null
 where venue_id in ${both} and status in ('held', 'booked');
update lessons set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now(), hold_expires_at = null
 where venue_id in ${both} and status in ('held', 'scheduled');
update booking_payments set status = 'failed', failed_at = now()
 where venue_id in ${both} and status in ('created', 'pending');
update coaches set status = 'retired', retired_at = coalesce(retired_at, now())
 where id in ('${w.coachA}', '${w.coachB}');
update courts set is_active = false where venue_id in ${both};
update venue_settings set coaching_enabled = false, lesson_payment_mode = 'desk' where venue_id in ${both};
delete from staff_venues where venue_id in ${both};
update venues set is_active = false where id in ${both} and status <> 'closed';
-- The fake provider's refunds, done, and the paid places' money given back: nothing of this
-- world is left for the reconciler's due list or the sweep's refund backstop (DB-40).
update booking_payments set status = 'refunded', refunded_at = now()
 where venue_id in ${both} and status = 'refund_pending';
update booking_payments
   set status = 'refunded', refund_reason = 'staff_cancel', refund_amount_iqd = amount_iqd,
       refund_requested_at = now(), refunded_at = now()
 where venue_id in ${both} and status = 'succeeded';
commit;`);
}

/** The value a committed session printed last (psql -At: one line per result). */
const lastLine = (out: string) => out.trim().split('\n').pop() ?? '';

/** Run `sql` committed as `who` (null: postgres with no claims) and return its last line. */
const now1 = (who: string | null, sql: string) =>
  lastLine(
    psql(`begin;
select set_config('request.jwt.claims', ${who ? `'{"sub": "${who}", "role": "authenticated"}'` : `''`}, true);
${sql};
commit;`),
  );

/** As `as`, for postgres with no claims (the cron's and the webhook's bodies). */
const asSystem = (sql: string, app?: string) =>
  psqlSession(`${app ? `set application_name = '${app}';\n` : ''}begin;
select set_config('request.jwt.claims', '', true);
${sql};
${app ? 'select pg_sleep(2);\n' : ''}commit;`);

/**
 * A guest's private lesson of coach A held for an online payment, as lesson_book_private and
 * lesson-begin leave it (the lesson and its enrolment held, the pending court hold, one pending
 * attempt). holdAgo: minutes since the hold lapsed (negative: still live); deadlineAgo: the
 * attempt's.
 */
function held(
  w: World,
  guest: string,
  start: string,
  o: { holdAgo?: number; deadlineAgo?: number; noPayment?: boolean } = {},
) {
  const hold = `now() - interval '${o.holdAgo ?? -10} minutes'`;
  const out = psql(`begin;
select set_config('request.jwt.claims', '', true);
with l as (
  insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                       coach_share_bp, max_places, min_places, status, hold_expires_at, booked_by_kind,
                       created_by_profile_id)
  values ('${w.venue}', '${w.coachA}', '${w.priv}', 'private', ${start}, ${start} + interval '1 hour', 30000, 5000,
          6000, 2, 1, 'held', ${hold}, 'guest', '${guest}')
  returning id),
h as (
  insert into reservations (venue_id, court_id, kind, status, hold_expires_at, start_at, end_at, source, guest_name,
                            lesson_id)
  select '${w.venue}', '${w.court1}', 'hold', 'pending', ${hold}, ${start}, ${start} + interval '1 hour', 'mobile',
         'Lesson', l.id from l
  returning id),
e as (
  insert into lesson_enrolments (venue_id, lesson_id, guest_id, booked_by_kind, booked_by_profile_id,
                                 link_confirmed_at, price_iqd, payment_mode, status, hold_expires_at)
  select '${w.venue}', l.id, '${guest}', 'guest', '${guest}', now(), 30000, 'online', 'held', ${hold} from l
  returning id),
p as (
  insert into booking_payments (purpose, provider, sandbox, request_id, amount_iqd, quoted_price_iqd, locale,
                                deadline_at, guest_id, venue_id, lesson_enrolment_id, hold_id, status)
  select 'lesson', 'fake', false, gen_random_uuid(), 30000, 30000, 'en',
         now() - interval '${o.deadlineAgo ?? -10} minutes', '${guest}', '${w.venue}', e.id, h.id, 'pending'
    from e, h
   where ${o.noPayment ? 'false' : 'true'}
  returning request_id)
select l.id || '|' || e.id || '|' || h.id || '|' || coalesce((select request_id::text from p), '')
  from l, e, h;
commit;`);
  const [lesson, enrolment, holdRow, request] = lastLine(out).split('|') as [
    string,
    string,
    string,
    string,
  ];
  return { lesson, enrolment, hold: holdRow, request };
}

const SUCCESS_SQL = (request: string) =>
  `select app.deposit_apply('${request}'::uuid, null, 'SUCCESS', 30000, 'IQD', false, 'webhook', true, '{}'::jsonb)`;

interface PlaceState {
  enrolment: string;
  kind: string | null;
  lesson: string;
  hold: string;
  live_courts: number;
  payments: Array<{ status: string; reason: string | null }>;
  strikes: number;
  expired_events: number;
}

/** One held place's state, for the assertions. */
function placeState(p: { lesson: string; enrolment: string; hold: string }): PlaceState {
  return JSON.parse(
    psql(`select jsonb_build_object(
      'enrolment', (select status from lesson_enrolments where id = '${p.enrolment}'),
      'kind', (select cancel_kind from lesson_enrolments where id = '${p.enrolment}'),
      'lesson', (select status from lessons where id = '${p.lesson}'),
      'hold', (select status from reservations where id = '${p.hold}'),
      'live_courts', (select count(*) from reservations where lesson_id = '${p.lesson}'
                        and status in ('pending', 'confirmed', 'arrived')),
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'reason', refund_reason)
                                             order by created_at), '[]'::jsonb)
                     from booking_payments where lesson_enrolment_id = '${p.enrolment}'),
      'strikes', (select count(*) from lesson_strikes where enrolment_id = '${p.enrolment}'),
      'expired_events', (select count(*) from lesson_events
                          where enrolment_id = '${p.enrolment}' and type = 'expired'))`),
  ) as PlaceState;
}

/** Keep clear of the per-minute cron (tp_lesson_sweep, tp_hold_strikes): start between :04 and :50. */
async function clearOfCron() {
  for (;;) {
    const s = Number(psql(`select floor(extract(second from clock_timestamp()))::int`));
    if (s >= 4 && s <= 50) return;
    await new Promise((res) => setTimeout(res, 500));
  }
}

const SWEEP = `select app.lesson_sweep()`;
const NO_DEADLOCK = /40P01|deadlock|23P01|exclusion/i;

describe.skipIf(!docker)('TG-03 booking races (committed, two connections)', () => {
  /** One guest's booking in a session of its own, held two seconds before the commit. */
  const book = (guest: string, coach: string, type: string, start: string, key: string) =>
    psqlSession(`begin;
select set_config('request.jwt.claims', '{"sub": "${guest}", "role": "authenticated"}', true);
select app.lesson_book_private('${coach}', '${type}', ${start}, 1, '{}'::text[], 'desk', 30000, '${key}');
select pg_sleep(2);
commit;`);

  it('two guests book one coach at one slot: one wins, the other is COACH_BUSY', async () => {
    const w = world();
    try {
      const results = await Promise.allSettled([
        book(w.g[0], w.coachA, w.priv, startIn(3, 2), `race-a-${w.tag}`),
        book(w.g[1], w.coachA, w.priv, startIn(3, 2), `race-b-${w.tag}`),
      ]);
      const won = results.filter((x) => x.status === 'fulfilled');
      const lost = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(String(lost[0]!.reason)).toMatch(/COACH_BUSY/);
      expect(String(lost[0]!.reason)).not.toMatch(NO_DEADLOCK);
      expect(
        psql(
          `select count(*) from lessons where coach_id = '${w.coachA}' and status = 'scheduled'`,
        ),
      ).toBe('1');
      expect(
        psql(`select count(*) from reservations where venue_id = '${w.venue}' and kind = 'lesson'
                and status = 'confirmed'`),
      ).toBe('1');
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it("two coaches race for the branch's last court: one wins, the other is NO_COURT_FREE", async () => {
    const w = world({ oneCourt: true });
    try {
      const results = await Promise.allSettled([
        book(w.g[0], w.coachA, w.priv, startIn(4, 2), `race-c-${w.tag}`),
        book(w.g[1], w.coachB, w.priv, startIn(4, 2), `race-d-${w.tag}`),
      ]);
      const won = results.filter((x) => x.status === 'fulfilled');
      const lost = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(String(lost[0]!.reason)).toMatch(/NO_COURT_FREE/);
      expect(String(lost[0]!.reason)).not.toMatch(NO_DEADLOCK);
      expect(
        psql(`select count(*) from lessons where venue_id = '${w.venue}' and status = 'scheduled'`),
      ).toBe('1');
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it('two guests for the last group place: one joins, the other is LESSON_FULL', async () => {
    const w = world();
    try {
      const g = now1(
        DESK,
        `select app.desk_create_group('${w.coachA}', '${w.group}', ${startIn(3, 6)}, 'tg03-g-${w.tag}')->>'lesson_id'`,
      );
      for (const n of [1, 2])
        now1(
          DESK,
          `select app.desk_add_student('${g}', null, null, 'Walk ${n}', null, 'tg03-add${n}-${w.tag}')`,
        );
      const app = `tg03-full-${w.tag}`;
      const holder = as(
        w.g[0],
        `select app.lesson_join('${g}', 'desk', 15000, 'tg03-j0-${w.tag}')`,
        app,
      );
      const out = await race(holder, app, () =>
        as(w.g[1], `select app.lesson_join('${g}', 'desk', 15000, 'tg03-j1-${w.tag}')`),
      );
      expect(out.ok).toBe(false);
      expect(out.ok ? '' : out.msg).toMatch(/LESSON_FULL/);
      expect(
        psql(
          `select count(*) from lesson_enrolments where lesson_id = '${g}' and status = 'booked'`,
        ),
      ).toBe('3');
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it('a private lesson at one branch against a group at the other for the same coach: COACH_BUSY', async () => {
    const w = world();
    try {
      const app = `tg03-xb-${w.tag}`;
      const holder = as(
        w.g[0],
        `select app.lesson_book_private('${w.coachA}', '${w.priv}', ${startIn(3, 8)}, 1, '{}'::text[], 'desk',
                                        30000, 'tg03-xb-${w.tag}')`,
        app,
      );
      const out = await race(holder, app, () =>
        as(
          DESK,
          `select app.desk_create_group('${w.coachA}', '${w.groupB}', ${startIn(3, 8)}, 'tg03-xg-${w.tag}')`,
        ),
      );
      expect(out.ok).toBe(false);
      expect(out.ok ? '' : out.msg).toMatch(/COACH_BUSY/);
      expect(
        psql(`select count(*) from lessons where coach_id = '${w.coachA}'
                and status in ('held', 'scheduled')`),
      ).toBe('1');
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it('a court hold against a lesson on a one-court branch, each way: NO_COURT_FREE, then SLOT_TAKEN', async () => {
    const w = world({ oneCourt: true });
    try {
      const app1 = `tg03-hl-${w.tag}`;
      const holder1 = as(
        w.g[0],
        `select app.hold_slot('${w.court1}', ${startIn(5, 2)}, 60, 'tg03-h1-${w.tag}')`,
        app1,
      );
      const out1 = await race(holder1, app1, () =>
        as(
          w.g[1],
          `select app.lesson_book_private('${w.coachA}', '${w.priv}', ${startIn(5, 2)}, 1, '{}'::text[],
                                          'desk', 30000, 'tg03-l1-${w.tag}')`,
        ),
      );
      expect(out1.ok).toBe(false);
      expect(out1.ok ? '' : out1.msg).toMatch(/NO_COURT_FREE/);

      const app2 = `tg03-lh-${w.tag}`;
      const holder2 = as(
        w.g[1],
        `select app.lesson_book_private('${w.coachA}', '${w.priv}', ${startIn(5, 6)}, 1, '{}'::text[], 'desk',
                                        30000, 'tg03-l2-${w.tag}')`,
        app2,
      );
      const out2 = await race(holder2, app2, () =>
        as(w.g[2], `select app.hold_slot('${w.court1}', ${startIn(5, 6)}, 60, 'tg03-h2-${w.tag}')`),
      );
      expect(out2.ok).toBe(false);
      expect(out2.ok ? '' : out2.msg).toMatch(/SLOT_TAKEN/);
      expect(
        psql(`select count(*) from reservations where court_id = '${w.court1}'
                and status in ('pending', 'confirmed', 'arrived')`),
      ).toBe('2');
    } finally {
      endWorld(w);
    }
  }, 60_000);
});

describe.skipIf(!docker)('TG-03 money and sweep races (committed, two connections)', () => {
  it("DB-39: a held lesson's cancel against the sweep expiring its hold, each way: one end, no live hold", async () => {
    const w = world();
    try {
      await clearOfCron();
      // The guest cancels while the sweep queues behind the coach lock.
      const a = held(w, w.g[0], startIn(6, 2), { holdAgo: 1, noPayment: true });
      const app1 = `tg03-cs-${w.tag}`;
      const holder1 = as(w.g[0], `select app.lesson_cancel_mine('${a.enrolment}')`, app1);
      const out1 = await race(holder1, app1, () => asSystem(SWEEP));
      expect(out1.ok, out1.ok ? '' : out1.msg).toBe(true);
      expect(placeState(a)).toMatchObject({
        enrolment: 'cancelled',
        lesson: 'cancelled',
        live_courts: 0,
        strikes: 0,
        expired_events: 0,
      });

      // The sweep expires first; the guest's cancel queued behind it finds the place over.
      const b = held(w, w.g[1], startIn(6, 6), { holdAgo: 1, noPayment: true });
      const app2 = `tg03-sc-${w.tag}`;
      const holder2 = asSystem(SWEEP, app2);
      const out2 = await race(holder2, app2, () =>
        as(w.g[1], `select app.lesson_cancel_mine('${b.enrolment}')`),
      );
      if (!out2.ok) expect(out2.msg).not.toMatch(NO_DEADLOCK);
      expect(placeState(b)).toMatchObject({
        enrolment: 'expired',
        lesson: 'expired',
        live_courts: 0,
        expired_events: 1,
        // The lapse struck once (R30); the cancel added nothing.
        strikes: 1,
      });
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it("the bank's SUCCESS against the sweep, each way: booked and paid; a lapse the late SUCCESS revives", async () => {
    const w = world();
    try {
      await clearOfCron();
      // SUCCESS holds the coach; the sweep then finds the place booked.
      const a = held(w, w.g[0], startIn(7, 2), { holdAgo: 1, deadlineAgo: 1 });
      const app1 = `tg03-ps-${w.tag}`;
      const holder1 = asSystem(SUCCESS_SQL(a.request), app1);
      const out1 = await race(holder1, app1, () => asSystem(SWEEP));
      expect(out1.ok, out1.ok ? '' : out1.msg).toBe(true);
      expect(placeState(a)).toMatchObject({
        enrolment: 'booked',
        lesson: 'scheduled',
        live_courts: 1,
        payments: [{ status: 'succeeded', reason: null }],
        strikes: 0,
      });

      // The sweep expires a lapse whose attempt is past its grace; the SUCCESS queued behind it
      // revives the place (the court is still free) and withdraws the lapsed_hold strike.
      const b = held(w, w.g[1], startIn(7, 6), { holdAgo: 1, deadlineAgo: 11 });
      const app2 = `tg03-sp-${w.tag}`;
      const holder2 = asSystem(SWEEP, app2);
      const out2 = await race(holder2, app2, () => asSystem(SUCCESS_SQL(b.request)));
      expect(out2.ok, out2.ok ? '' : out2.msg).toBe(true);
      expect(placeState(b)).toMatchObject({
        enrolment: 'booked',
        lesson: 'scheduled',
        live_courts: 1,
        payments: [{ status: 'succeeded', reason: null }],
        strikes: 0,
      });
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it("SUCCESS against the guest's cancel, each way: slot_lost; a paid place cancelled free and refunded", async () => {
    const w = world();
    try {
      // The cancel first: the SUCCESS behind it is refunded whole, slot_lost.
      const a = held(w, w.g[0], startIn(8, 2));
      const app1 = `tg03-cp-${w.tag}`;
      const holder1 = as(w.g[0], `select app.lesson_cancel_mine('${a.enrolment}')`, app1);
      const out1 = await race(holder1, app1, () => asSystem(SUCCESS_SQL(a.request)));
      expect(out1.ok, out1.ok ? '' : out1.msg).toBe(true);
      expect(placeState(a)).toMatchObject({
        enrolment: 'cancelled',
        lesson: 'cancelled',
        live_courts: 0,
        payments: [{ status: 'refund_pending', reason: 'slot_lost' }],
        strikes: 0,
      });

      // The SUCCESS first: the cancel behind it finds a paid place days out (free) and refunds it.
      const b = held(w, w.g[1], startIn(8, 6));
      const app2 = `tg03-pc-${w.tag}`;
      const holder2 = asSystem(SUCCESS_SQL(b.request), app2);
      const out2 = await race(holder2, app2, () =>
        as(w.g[1], `select app.lesson_cancel_mine('${b.enrolment}')`),
      );
      expect(out2.ok, out2.ok ? '' : out2.msg).toBe(true);
      expect(placeState(b)).toMatchObject({
        enrolment: 'cancelled',
        kind: 'guest_free',
        lesson: 'cancelled',
        live_courts: 0,
        payments: [{ status: 'refund_pending', reason: 'guest_cancel' }],
        strikes: 0,
      });
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it('R31: an attended correction while lesson_join settles the no-show strike neither waits nor removes it', async () => {
    const w = world();
    try {
      expect(psql(`select hold_strikes_since is not null from platform_settings where id`)).toBe(
        't',
      );
      await clearOfCron();
      const guest = w.g[2];
      // Coach B's lesson, under way: the guest's own place marked a no-show (a strike, unsettled).
      const booked = JSON.parse(
        now1(
          guest,
          `select app.lesson_book_private('${w.coachB}', '${w.priv}', ${startIn(9, 2)}, 1, '{}'::text[], 'desk',
                                          30000, 'tg03-ns-${w.tag}')::text`,
        ),
      ) as { lesson_id: string; enrolment_id: string };
      psql(`update lessons set start_at = now() - interval '30 minutes', end_at = now() + interval '30 minutes'
             where id = '${booked.lesson_id}'`);
      now1(
        DESK,
        `select app.desk_mark_attendance('${booked.lesson_id}', '${booked.enrolment_id}', 'no_show')`,
      );
      expect(
        psql(`select count(*) from lesson_strikes
               where enrolment_id = '${booked.enrolment_id}' and settled_at is null`),
      ).toBe('1');
      // Coach A's group the guest joins: the ladder settles the strike and holds its row.
      const g = now1(
        DESK,
        `select app.desk_create_group('${w.coachA}', '${w.group}', ${startIn(9, 6)}, 'tg03-rg-${w.tag}')->>'lesson_id'`,
      );
      const app = `tg03-r31-${w.tag}`;
      let holderDone = 0;
      const holder = as(
        guest,
        `select app.lesson_join('${g}', 'desk', 15000, 'tg03-rj-${w.tag}')`,
        app,
      ).then((x) => {
        holderDone = Date.now();
        return x;
      });
      let racerDone = 0;
      const out = await race(holder, app, () =>
        as(
          DESK,
          `select app.desk_mark_attendance('${booked.lesson_id}', '${booked.enrolment_id}', 'attended')`,
        ).then((x) => {
          racerDone = Date.now();
          return x;
        }),
      );
      expect(out.ok, out.ok ? '' : out.msg).toBe(true);
      // The correction skipped the locked strike row: it finished while the join still held it.
      expect(racerDone).toBeLessThan(holderDone);
      expect(
        psql(`select string_agg(kind || ':' || (settled_at is not null) || ':' || coalesce(counted::text, '-'), ',')
                from lesson_strikes where enrolment_id = '${booked.enrolment_id}'`),
      ).toBe('no_show:true:true');
      expect(
        psql(`select status from lesson_attendance where enrolment_id = '${booked.enrolment_id}'`),
      ).toBe('attended');
    } finally {
      endWorld(w);
    }
  }, 60_000);

  it('the sweep skips a coach another transaction holds, without waiting, and catches up after', async () => {
    // Coach A sorts last; a decoy coach with due work sorts first, so the coach the sweep waits
    // for (D-3) is never the busy one.
    const w = world({ coachA: `ffffffff-${crypto.randomUUID().slice(9)}` });
    const decoy = `00000000-${crypto.randomUUID().slice(9)}`;
    try {
      await clearOfCron();
      // The decoy's lesson ended an hour ago (the sweep completes it); coach A's group is past
      // its cut-off with nobody booked.
      psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into coaches (id, profile_id, display_name_en, display_name_ar, public_accepted_at)
values ('${decoy}', '${w.g[3]}', 'TG03 decoy', 'المدرّب د', now());
insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                     coach_share_bp, max_places, min_places, status, booked_by_kind, created_by_staff_id)
values ('${w.venue}', '${decoy}', '${w.priv}', 'private', now() - interval '2 hours', now() - interval '1 hour',
        30000, 5000, 6000, 2, 1, 'scheduled', 'staff', '${DESK}');
commit;`);
      const g = now1(
        DESK,
        `select app.desk_create_group('${w.coachA}', '${w.group}', ${startIn(1, 6)}, 'tg03-sk-${w.tag}')->>'lesson_id'`,
      );
      psql(`update lessons set cutoff_at = now() - interval '1 minute' where id = '${g}'`);
      const app = `tg03-skip-${w.tag}`;
      let holderDone = 0;
      const holder = as(
        DESK,
        `select app.desk_book_lesson('${w.coachA}', '${w.priv}', ${startIn(2, 2)}, null, 'Walk In', null, 1,
                                     'tg03-hold-${w.tag}')`,
        app,
      ).then((x) => {
        holderDone = Date.now();
        return x;
      });
      let racerDone = 0;
      const out = await race(holder, app, () =>
        asSystem(SWEEP).then((x) => {
          racerDone = Date.now();
          return x;
        }),
      );
      expect(out.ok, out.ok ? '' : out.msg).toBe(true);
      const run = JSON.parse(lastLine(out.ok ? out.out : '{}')) as Record<string, number>;
      expect(run.skipped).toBeGreaterThanOrEqual(1);
      expect(racerDone).toBeLessThan(holderDone);
      expect(
        psql(`select status || ':' || (cutoff_checked_at is null) from lessons where id = '${g}'`),
      ).toBe('scheduled:true');
      // Once the coach is free, the next run judges the cut-off: under-filled, cancelled.
      now1(null, SWEEP);
      expect(psql(`select status || ':' || cancel_reason from lessons where id = '${g}'`)).toBe(
        'cancelled:under_filled',
      );
    } finally {
      psql(`begin;
select set_config('request.jwt.claims', '', true);
update lessons set status = 'completed', completed_at = now() where coach_id = '${decoy}' and status = 'scheduled';
update coaches set status = 'retired', retired_at = now() where id = '${decoy}';
commit;`);
      endWorld(w);
    }
  }, 60_000);
});

describe('TG-03 source pins: R31 never waits on a strike row', () => {
  it('the attendance correction deletes the no-show strike FOR UPDATE SKIP LOCKED', () => {
    expect(latestBody('lesson_mark_internal').body).toMatch(
      /delete from lesson_strikes[\s\S]*?for update skip locked/i,
    );
  });

  it('hold_strikes_settle takes a lesson strike FOR UPDATE SKIP LOCKED', () => {
    expect(latestBody('hold_strikes_settle').body).toMatch(
      /from lesson_strikes ls[\s\S]*?for update skip locked/i,
    );
  });
});
