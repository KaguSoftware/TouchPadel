/**
 * 0401 coach_student_level (F-70): a coach sees and sets the level of a
 * student whose account link they confirmed, and only that student.
 *
 *   * coach_lesson: a linked place carries `level` {claimed, confirmed,
 *     confirmed_role, confirmed_at, note}; an unlinked place (a typed phone
 *     that matched an account but was never confirmed, or none) carries NULL
 *     and nothing else, so the roster never says whether a phone matched;
 *   * coach_set_student_level: the coach's own linked student (role 'coach',
 *     note, duplicate, clear), refused for another coach's student
 *     (REF_NOT_FOUND), an unlinked place (LEVEL_NOT_LINKED) and anyone who is
 *     not a coach (FORBIDDEN);
 *   * staff_set_customer_level no longer takes a coach (FORBIDDEN), and the
 *     court desk still judges.
 *
 * Same rolled-back harness as coaching-deletion.test.ts (stores-harness
 * scenario + coaching-plant PLANT).
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, refused, scenario, T } from './stores-harness';
import { GUEST, PLANT } from './coaching-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

const NOW_H = `date_trunc('hour', now())`;

interface RosterEntry {
  enrolment_id: string;
  level: null | { claimed: string | null; confirmed: string | null; confirmed_role: string | null; confirmed_at: string | null; note: string | null };
}

describe.skipIf(!docker)('0401 coach student level', () => {
  it('reads and sets the level of the coach\'s own linked students only', () => {
    const r = scenario('csl401', [
      PLANT,
      GUEST('st'), GUEST('st2'), GUEST('c1_p'), GUEST('c2_p'),
      KEEP('c1', `select pg_temp.coach({{c1_p}})`),
      KEEP('c2', `select pg_temp.coach({{c2_p}})`),
      KEEP('lt_group', `select pg_temp.ltype('{"kind":"group","name_en":"Group","price_iqd":15000,"max_places":6,
        "min_places":1,"cutoff_hours":1}'::jsonb)`),
      KEEP('gl', `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c1}},
        'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 6, 'min_places', 1,
        'cutoff_at', ${NOW_H} + interval '1 day 22 hours',
        'start_at', ${NOW_H} + interval '2 days', 'end_at', ${NOW_H} + interval '2 days 1 hour'))`),
      KEEP('gl2', `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c2}},
        'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 6, 'min_places', 1,
        'cutoff_at', ${NOW_H} + interval '2 days 22 hours',
        'start_at', ${NOW_H} + interval '3 days', 'end_at', ${NOW_H} + interval '3 days 1 hour'))`),
      // A student the coach added and who confirmed the link.
      KEEP('e_linked', `select pg_temp.cenrol({{c1_p}}, jsonb_build_object('lesson_id', {{gl}}, 'guest_id', {{st}},
        'guest_name', 'Sara as typed', 'guest_phone', '07700000002', 'price_iqd', 15000, 'link_confirmed_at', now()))`),
      // A typed phone that matched st2's account but was never confirmed.
      KEEP('e_pending', `select pg_temp.cenrol({{c1_p}}, jsonb_build_object('lesson_id', {{gl}}, 'guest_id', {{st2}},
        'guest_name', 'Someone typed', 'guest_phone', '07700000003', 'price_iqd', 15000))`),
      // A typed student with no account at all.
      KEEP('e_typed', `select pg_temp.cenrol({{c1_p}}, jsonb_build_object('lesson_id', {{gl}}, 'price_iqd', 15000,
        'guest_name', 'Walk In', 'guest_phone', '07700000004'))`),
      // Another coach's linked student.
      KEEP('e_other', `select pg_temp.cenrol({{c2_p}}, jsonb_build_object('lesson_id', {{gl2}}, 'guest_id', {{st2}},
        'guest_name', 'Other coach', 'guest_phone', '07700000005', 'price_iqd', 15000, 'link_confirmed_at', now()))`),
      `update profiles set play_level = 'beginner' where id = (select val from pg_temp.vars where name = 'st')::uuid;`,

      T('roster_before', 'c1_p', `select app.coach_lesson({{gl}}) -> 'roster'`),
      T('set', 'c1_p', `select app.coach_set_student_level({{e_linked}}, 'intermediate', 'Good volleys')`),
      T('again', 'c1_p', `select app.coach_set_student_level({{e_linked}}, 'intermediate', 'Good volleys')`),
      T('roster_after', 'c1_p', `select app.coach_lesson({{gl}}) -> 'roster'`),
      Q('profile', `select jsonb_build_object('level', level_confirmed, 'role', level_confirmed_role, 'by', level_confirmed_by = {{c1_p}}::uuid,
                     'note', level_note) from profiles where id = {{st}}::uuid`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'customer.level_confirmed' and entity_id = {{st}}`),
      T('bad_level', 'c1_p', `select app.coach_set_student_level({{e_linked}}, 'pro', null)`),
      T('note_no_level', 'c1_p', `select app.coach_set_student_level({{e_linked}}, null, 'x')`),
      T('pending', 'c1_p', `select app.coach_set_student_level({{e_pending}}, 'advanced', null)`),
      T('typed', 'c1_p', `select app.coach_set_student_level({{e_typed}}, 'advanced', null)`),
      T('other', 'c1_p', `select app.coach_set_student_level({{e_other}}, 'advanced', null)`),
      T('not_coach', 'st', `select app.coach_set_student_level({{e_linked}}, 'advanced', null)`),
      T('desk', 'desk', `select app.coach_set_student_level({{e_linked}}, 'advanced', null)`),
      T('old_path_coach', 'c1_p', `select app.staff_set_customer_level({{st2}}, 'advanced', null)`),
      T('old_path_desk', 'desk', `select app.staff_set_customer_level({{st2}}, 'advanced', null) - 'customer_id'`),
      T('clear', 'c1_p', `select app.coach_set_student_level({{e_linked}}, null, null)`),
    ]);

    const before = ok<RosterEntry[]>(r, 'roster_before');
    const by = (rows: RosterEntry[], id: string) => rows.find((e) => e.enrolment_id === id);
    const linked = before.find((e) => e.level !== null);
    expect(linked?.level).toMatchObject({ claimed: 'beginner', confirmed: null });
    expect(before.filter((e) => e.level !== null)).toHaveLength(1);
    expect(JSON.stringify(before)).not.toMatch(/profile_id|guest_id/);

    expect(ok(r, 'set')).toMatchObject({ level_confirmed: 'intermediate', level_confirmed_role: 'coach', level_note: 'Good volleys', duplicate: false });
    expect(ok(r, 'set')).not.toHaveProperty('customer_id');
    expect(ok(r, 'again')).toMatchObject({ duplicate: true });
    const after = ok<RosterEntry[]>(r, 'roster_after');
    expect(after.find((e) => e.level !== null)?.level).toMatchObject({
      claimed: 'beginner', confirmed: 'intermediate', confirmed_role: 'coach', note: 'Good volleys',
    });
    expect(by(after, linked!.enrolment_id)).toBeDefined();
    expect(ok(r, 'profile')).toEqual({ level: 'intermediate', role: 'coach', by: true, note: 'Good volleys' });
    expect(ok(r, 'audit')).toBe(1);

    expect(refused(r, 'bad_level')).toBe('INVALID_PLAY_PROFILE:p_level');
    expect(refused(r, 'note_no_level')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'pending')).toBe('LEVEL_NOT_LINKED');
    expect(refused(r, 'typed')).toBe('LEVEL_NOT_LINKED');
    expect(refused(r, 'other')).toBe('REF_NOT_FOUND:enrolment');
    expect(refused(r, 'not_coach')).toBe('FORBIDDEN');
    expect(refused(r, 'desk')).toBe('FORBIDDEN');
    expect(refused(r, 'old_path_coach')).toBe('FORBIDDEN');
    expect(ok(r, 'old_path_desk')).toMatchObject({ level_confirmed: 'advanced', level_confirmed_role: 'court_desk' });
    expect(ok(r, 'clear')).toMatchObject({ level_confirmed: null, level_confirmed_role: null, duplicate: false });
  });
});
