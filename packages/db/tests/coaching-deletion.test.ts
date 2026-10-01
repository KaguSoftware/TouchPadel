/**
 * Coaching, migration 0289 lesson_account_deletion (docs/design/coaching/db.md §4.10, §6 rows 31–33,
 * §7 row coaching-deletion.test.ts; build contracts C-21, C-29, CD-12, R28, R43, R44, R63).
 *
 * Student and coach deletion end to end with the sweep (0286):
 *
 *   * a student: the friend names go at once; a coach-booked confirmed link keeps a fixed marker
 *     ('Deleted account', never NULL) and loses the typed phone; a pending link (C-21) is dropped
 *     silently, the coach's typed student kept as typed; then the sweep cancels the live
 *     enrolments account_deleted and refunds only the shares of sessions not yet started (R28:
 *     160,000 for 8 sessions, deleted after session 3 -> one refund of 100,000);
 *   * a coach: retired at once, bios and photo emptied, the photo folder queued for removal (R43),
 *     time-off reasons emptied, the display names kept for the statements (C-29, R63); then the
 *     sweep cancels the coach's lessons coach_retired;
 *   * the audit row counts what was touched; the deletion takes no coach lock (it never waits on a
 *     coach-lock holder: the sweep does the cancels).
 *
 * The refund amount is Money's engine (0281 lesson_enrolment_money, lesson_refund_start).
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, scenario, T, X } from './stores-harness';
import { E, GUEST, PLANT } from './coaching-plant';
import { allocateCourseMoney } from '../../core/src/coaching/statement';

const up = await stackAvailable();
const docker = up && dockerReachable();

const NOW_H = `date_trunc('hour', now())`;

describe.skipIf(!docker)('coaching 0289: delete_my_account', () => {
  it('a student: scrubbed at once, linked rows marked, a pending link dropped; the sweep cancels and refunds', () => {
    const session = (n: number) =>
      KEEP(
        `k${n}`,
        `select pg_temp.lesson(jsonb_build_object('kind', 'course', 'coach_id', {{c2}},
        'lesson_type_id', {{lt_course}}, 'course_id', {{k}}, 'session_no', ${n}, 'price_iqd', null,
        'court_share_iqd', 8000, 'max_places', 8, 'min_places', 1, 'cutoff_at', ${NOW_H} - interval '22 days',
        'status', ${n <= 3 ? `'completed', 'completed_at', now()` : `'scheduled'`},
        'start_at', ${NOW_H} + interval '${(n - 4) * 7} days' + interval '2 hours',
        'end_at', ${NOW_H} + interval '${(n - 4) * 7} days' + interval '3 hours'))`,
      );
    const r = scenario('cf286-a', [
      PLANT,
      GUEST('st'),
      GUEST('c1_p'),
      GUEST('c2_p'),
      GUEST('c3_p'),
      KEEP('c1', `select pg_temp.coach({{c1_p}})`),
      KEEP('c2', `select pg_temp.coach({{c2_p}})`),
      KEEP('c3', `select pg_temp.coach({{c3_p}})`),
      KEEP('lt', `select pg_temp.ltype()`),
      KEEP(
        'lt_group',
        `select pg_temp.ltype('{"kind":"group","name_en":"Group","price_iqd":15000,"max_places":6,
        "min_places":1,"cutoff_hours":1}'::jsonb)`,
      ),
      KEEP(
        'lt_course',
        `select pg_temp.ltype('{"kind":"course","name_en":"Course","price_iqd":160000,
        "sessions_count":8,"court_share_iqd":8000,"max_places":8,"min_places":1,"cutoff_hours":1}'::jsonb)`,
      ),
      // (a) Tomorrow's private lesson the student booked with a friend, paid online.
      KEEP(
        'pl',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'booked_by_kind', 'guest', 'created_by_profile_id', {{st}}, 'created_by_staff_id', null,
        'start_at', ${NOW_H} + interval '1 day', 'end_at', ${NOW_H} + interval '1 day 1 hour'))`,
      ),
      KEEP(
        'e_own',
        `select pg_temp.genrol({{st}}, jsonb_build_object('lesson_id', {{pl}}, 'party_size', 2,
        'friend_names', array['Ali']))`,
      ),
      KEEP('pay_own', `select pg_temp.paid({{e_own}})`),
      // (b) A group session where a coach added the student and the student confirmed the link.
      KEEP(
        'gl',
        `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c3}},
        'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 6, 'min_places', 1,
        'cutoff_at', ${NOW_H} + interval '1 day 22 hours',
        'start_at', ${NOW_H} + interval '2 days', 'end_at', ${NOW_H} + interval '2 days 1 hour'))`,
      ),
      KEEP(
        'e_linked',
        `select pg_temp.cenrol({{c3_p}}, jsonb_build_object('lesson_id', {{gl}}, 'guest_id', {{st}},
        'guest_name', 'Sara as typed', 'guest_phone', '07700000002', 'price_iqd', 15000,
        'link_confirmed_at', now()))`,
      ),
      // (c) Another group session: a coach-typed phone matched this account but was never confirmed.
      KEEP(
        'gl2',
        `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c3}},
        'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 6, 'min_places', 1,
        'cutoff_at', ${NOW_H} + interval '2 days 22 hours',
        'start_at', ${NOW_H} + interval '3 days', 'end_at', ${NOW_H} + interval '3 days 1 hour'))`,
      ),
      KEEP(
        'e_pending',
        `select pg_temp.cenrol({{c3_p}}, jsonb_build_object('lesson_id', {{gl2}}, 'guest_id', {{st}},
        'guest_name', 'Someone typed', 'guest_phone', '07700000003', 'price_iqd', 15000))`,
      ),
      // (d) A running course: 8 sessions, 160,000 online; sessions 1-3 given.
      KEEP(
        'k',
        `select pg_temp.ins('courses', jsonb_build_object('venue_id', {{venue}}, 'coach_id', {{c2}},
        'lesson_type_id', {{lt_course}}, 'price_iqd', 160000, 'court_share_iqd', 8000, 'coach_share_bp', 6000,
        'sessions_count', 8, 'max_places', 8, 'min_places', 1, 'cutoff_at', ${NOW_H} - interval '22 days',
        'cutoff_checked_at', now() - interval '22 days', 'signup_closes_at', ${NOW_H} + interval '28 days 2 hours',
        'status', 'running', 'created_by_kind', 'staff', 'created_by_staff_id', {{desk}}))`,
      ),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(session),
      KEEP(
        'e_course',
        `select pg_temp.genrol({{st}}, jsonb_build_object('course_id', {{k}}, 'price_iqd', 160000,
        'first_session_no', 1, 'sessions_covered', 8))`,
      ),
      KEEP('pay_course', `select pg_temp.paid({{e_course}})`),

      T('delete', 'st', `select app.delete_my_account('DELETE')`),
      Q(
        'after_delete',
        `select jsonb_object_agg(id::text, jsonb_build_object('status', status, 'guest_id', guest_id,
                           'guest_name', guest_name, 'guest_phone', guest_phone, 'friends', to_jsonb(friend_names)))
                           from lesson_enrolments where id in ({{e_own}}, {{e_linked}}, {{e_pending}}, {{e_course}})`,
      ),
      Q(
        'audit',
        `select after from audit_log where action = 'account.delete' and entity_id = {{st}}::text`,
      ),
      E('sweep', `select app.lesson_sweep()`),
      Q(
        'after_sweep',
        `select jsonb_object_agg(id::text, jsonb_build_object('status', status, 'cancel_kind', cancel_kind))
                          from lesson_enrolments where id in ({{e_own}}, {{e_linked}}, {{e_pending}}, {{e_course}})`,
      ),
      Q(
        'lesson_pl',
        `select jsonb_build_object('status', status, 'cancel_reason', cancel_reason) from lessons where id = {{pl}}`,
      ),
      Q(
        'refunds',
        `select jsonb_object_agg(id::text, jsonb_build_object('status', status, 'reason', refund_reason,
                      'amount', refund_amount_iqd)) from booking_payments where id in ({{pay_own}}, {{pay_course}})`,
      ),
      Q(
        'ids',
        `select jsonb_build_object('own', {{e_own}}, 'linked', {{e_linked}}, 'pending', {{e_pending}},
                  'course', {{e_course}}, 'pay_own', {{pay_own}}, 'pay_course', {{pay_course}})`,
      ),
    ]);
    const ids = ok<{
      own: string;
      linked: string;
      pending: string;
      course: string;
      pay_own: string;
      pay_course: string;
    }>(r, 'ids');
    expect(ok(r, 'delete')).toMatchObject({ deleted: true });

    type Row = {
      status: string;
      guest_id: string | null;
      guest_name: string | null;
      guest_phone: string | null;
      friends: string[];
    };
    const d = ok<Record<string, Row>>(r, 'after_delete');
    // At once: the student's friend names; a confirmed typed link keeps a marker, loses the phone.
    expect(d[ids.own]).toMatchObject({
      status: 'booked',
      guest_name: null,
      guest_phone: null,
      friends: [],
    });
    expect(d[ids.linked]).toMatchObject({ guest_name: 'Deleted account', guest_phone: null });
    // C-21: the pending link is dropped silently; the coach's typed student is untouched.
    expect(d[ids.pending]).toEqual({
      status: 'booked',
      guest_id: null,
      guest_name: 'Someone typed',
      guest_phone: '07700000003',
      friends: [],
    });
    expect(ok<Record<string, unknown>>(r, 'audit')).toMatchObject({
      lesson_enrolments_scrubbed: 2,
      lesson_links_dropped: 1,
      coach_retired: false,
      coach_photo_queued: 0,
    });

    // The sweep: everything not yet started is cancelled account_deleted.
    const s = ok<Record<string, { status: string; cancel_kind: string | null }>>(r, 'after_sweep');
    expect(s[ids.own]).toEqual({ status: 'cancelled', cancel_kind: 'account_deleted' });
    expect(s[ids.linked]).toEqual({ status: 'cancelled', cancel_kind: 'account_deleted' });
    expect(s[ids.pending]).toEqual({ status: 'booked', cancel_kind: null });
    expect(s[ids.course]).toEqual({ status: 'cancelled', cancel_kind: 'account_deleted' });
    expect(ok(r, 'lesson_pl')).toEqual({ status: 'cancelled', cancel_reason: 'account_deleted' });

    // R28: the private lesson in full; the course only the five sessions not yet started.
    const shares = allocateCourseMoney(160_000, 8);
    const refunds = ok<Record<string, { status: string; reason: string; amount: number }>>(
      r,
      'refunds',
    );
    expect(refunds[ids.pay_own]).toMatchObject({ reason: 'account_deleted', amount: 40_000 });
    expect(refunds[ids.pay_course]).toMatchObject({
      reason: 'account_deleted',
      amount: shares.slice(3).reduce((a, b) => a + b, 0),
    });
    expect(refunds[ids.pay_course]!.amount).toBe(100_000);
  });

  it('a coach: retired, bios and photo emptied, the folder queued, names kept; the sweep cancels coach_retired', () => {
    const r = scenario('cf286-b', [
      PLANT,
      GUEST('cp'),
      KEEP('folder', `select 'coaches/' || gen_random_uuid()::text`),
      KEEP(
        'c1',
        `select pg_temp.coach({{cp}}, jsonb_build_object('bio_en', 'Ten years on court.',
        'bio_ar', 'عشر سنوات في الملعب.', 'photo_path', {{folder}} || '/portrait.jpg',
        'display_name_en', 'Coach Dana', 'display_name_ar', 'المدرّبة دانا'))`,
      ),
      X(`select pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
           'period', tstzrange(now() + interval '10 days', now() + interval '12 days', '[)'),
           'reason', 'Family wedding', 'set_by', 'coach'))`),
      KEEP('lt', `select pg_temp.ltype()`),
      KEEP(
        'l1',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} + interval '1 day', 'end_at', ${NOW_H} + interval '1 day 1 hour'))`,
      ),
      T('delete', 'cp', `select app.delete_my_account('DELETE')`),
      Q(
        'coach',
        `select jsonb_build_object('status', status, 'retired', retired_at is not null, 'bio_en', bio_en,
                    'bio_ar', bio_ar, 'photo_path', photo_path, 'name_en', display_name_en, 'name_ar', display_name_ar)
                    from coaches where id = {{c1}}`,
      ),
      Q(
        'purges',
        `select coalesce(jsonb_agg(folder), '[]'::jsonb) from coach_photo_purges where coach_id = {{c1}}`,
      ),
      Q(
        'time_off',
        `select coalesce(jsonb_agg(reason), '[]'::jsonb) from coach_time_off where coach_id = {{c1}}`,
      ),
      Q(
        'audit',
        `select after from audit_log where action = 'account.delete' and entity_id = {{cp}}::text`,
      ),
      Q('lesson_before', `select to_jsonb(status) from lessons where id = {{l1}}`),
      E('sweep', `select app.lesson_sweep()`),
      Q(
        'lesson_after',
        `select jsonb_build_object('status', status, 'cancel_reason', cancel_reason)
                           from lessons where id = {{l1}}`,
      ),
      Q('folder_q', `select to_jsonb({{folder}}::text)`),
    ]);
    ok(r, 'delete');
    expect(ok(r, 'coach')).toEqual({
      status: 'retired',
      retired: true,
      bio_en: '',
      bio_ar: '',
      photo_path: null,
      name_en: 'Coach Dana',
      name_ar: 'المدرّبة دانا',
    });
    expect(ok(r, 'purges')).toEqual([ok(r, 'folder_q')]);
    expect(ok(r, 'time_off')).toEqual(['']);
    expect(ok<Record<string, unknown>>(r, 'audit')).toMatchObject({
      coach_retired: true,
      coach_photo_queued: 1,
      coach_time_off_scrubbed: 1,
    });
    // No coach lock at deletion: the lesson is the sweep's to cancel.
    expect(ok(r, 'lesson_before')).toBe('scheduled');
    expect(ok(r, 'lesson_after')).toEqual({ status: 'cancelled', cancel_reason: 'coach_retired' });
  });

  it('takes no coach lock: it does not wait on a coach-lock holder', () => {
    // The body's own text: no lock_coach, no try_lock_coach, no court lock (db.md §2.4 rule 7).
    const r = scenario('cf286-c', [
      PLANT,
      Q(
        'src',
        `select to_jsonb(prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app' and p.proname = 'delete_my_account'`,
      ),
    ]);
    const src = ok<string>(r, 'src');
    expect(src).not.toMatch(/lock_coach|lock_court|lock_match/);
    expect(src).toMatch(/coach_photo_purges/);
  });
});
