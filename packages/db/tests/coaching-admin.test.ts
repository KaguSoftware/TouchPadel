/**
 * Coaching, database sub-step 0282 coaching_admin (docs/design/coaching/db.md
 * §4.6, §7; build contracts C-4, C-5, C-7, C-17, C-22, C-25, C-27, CD-10,
 * R26, R43, R45, R46, R52, R56, R57, R61, R73, R81).
 *
 *   * promote: twice is ALREADY_COACH; a photo folder that is a profile id is
 *     refused (R43); a retired coach is re-activated with the consent cleared
 *     (R61);
 *   * a manager acts only on coaches of their branches; set_coach_branches
 *     refuses dropping a branch with lessons to come (BRANCH_HAS_BOOKINGS
 *     detail coach_lessons, R52, R73);
 *   * unlinking a type deletes the coach's own price for it (R46);
 *   * the price lock: a manager's price change on a launched type is
 *     PRICE_VIA_PROTOCOL price, its length, sessions or a private type's
 *     places PRICE_VIA_PROTOCOL shape, switching a draft on
 *     LAUNCH_VIA_PROTOCOL; drafts are free; the owner passes; set_coach_price
 *     is refused to a manager even on a draft (D-8);
 *   * the patch allowlist; the two-hour cut-off default and lesson_types_cutoff
 *     (R26);
 *   * hours: HOURS_INVALID, HOURS_OVERLAP with the 0-based index (R73) within
 *     a set and across branches, 24:00;
 *   * time off: TIME_OFF_HAS_LESSONS, HOURS_OVERLAP time_off, cancel twice, a
 *     stranger's id (X31);
 *   * storage_path_in_use counts a coach photo (R43);
 *   * coach_me: not a coach, a retired coach (R45), a staff member who
 *     coaches (C-27), a branch with coaching off; the R81 shapes.
 *
 * 0290 (coaching_admin_fixes, the post-build review): a save keeps the
 * branches the caller cannot show and never adds one (DB-01); hours at a
 * dropped or closed branch never block hours elsewhere (DB-02); a replaced
 * photo is queued and a deleted profile is never promoted (DB-03); a relink
 * starts from the type price (DB-04); touching windows join and a lesson may
 * cross local midnight (DB-05, §1.15 D3); a retried time off is the same row
 * (DB-06). Then three committed two-connection races: unlink against
 * set_coach_price in both orders, retirement against coach_update.
 *
 * One rolled-back psql transaction (coaching-core-harness.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';
import { SEED_STAFF_IDS, stackAvailable } from './helpers';
import {
  dockerReachable,
  MK,
  psql,
  psqlSession,
  scenario,
  waitForSleeper,
  X,
  type Results,
} from './stores-harness';
import { at, code, data, E, failed, FROM, K, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const PROMOTE = (who: string, guest: string, venues: string, photo = 'null') =>
  `select app.coach_promote({{${guest}}}, 'Coach ${guest}', 'المدرّب ${guest}', 'Bio', 'سيرة', ${photo}, array[${venues}]::uuid[])`;

const BODY: string[] = [
  SETUP,
  // ── fixtures: three branches (the manager and desk work at v and w, not x),
  // guests, a stored photo path.
  `select pg_temp.branch('v');`,
  `select pg_temp.branch('w');`,
  `select pg_temp.branch('x', true, false);`,
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  `select pg_temp.guest('g3');`,
  `select pg_temp.guest('g4');`,
  `select pg_temp.guest('g5');`,
  K('photo', `select 'coaches/' || gen_random_uuid() || '/p.jpg'`),

  // ── promote (C-7, R43, R61) ─────────────────────────────────────────────
  E('promote', 'owner', PROMOTE('owner', 'g1', '{{v}}')),
  FROM('c1', 'promote', 'coach_id'),
  E('promote_again', 'manager', PROMOTE('manager', 'g1', '{{v}}')),
  E(
    'promote_bad_folder',
    'manager',
    PROMOTE('manager', 'g2', '{{v}}', `'coaches/' || {{g2}} || '/a.jpg'`),
  ),
  E('promote_bad_format', 'manager', PROMOTE('manager', 'g2', '{{v}}', `'items/a.jpg'`)),
  E('promote_g2', 'manager', PROMOTE('manager', 'g2', '{{v}}', '{{photo}}')),
  FROM('c2', 'promote_g2', 'coach_id'),
  E('promote_not_my_branch', 'manager', PROMOTE('manager', 'g3', '{{x}}')),
  E('promote_by_guest', 'g5', PROMOTE('g5', 'g3', '{{v}}')),
  E(
    'promote_no_profile',
    'owner',
    `select app.coach_promote('00000000-0000-4000-8000-000000000000', 'A', 'B', '', '', null, array[{{v}}]::uuid[])`,
  ),
  E('promote_g3_at_x', 'owner', PROMOTE('owner', 'g3', '{{x}}')),
  FROM('c3', 'promote_g3_at_x', 'coach_id'),
  R(
    'c1_row',
    `select jsonb_build_object('status', c.status, 'accepted', c.public_accepted_at is not null,
                 'branches', (select jsonb_agg(b.venue_id) from coach_branches b where b.coach_id = c.id and b.active))
                 from coaches c where c.id = {{c1}}::uuid`,
  ),
  E('storage_live', 'manager', `select to_jsonb(app.storage_path_in_use({{photo}}))`),
  E(
    'storage_other',
    'manager',
    `select to_jsonb(app.storage_path_in_use('coaches/' || gen_random_uuid() || '/q.jpg'))`,
  ),

  // ── retire, then promote again (R45, R61, R43) ──────────────────────────
  X(`update coaches set public_accepted_at = now() where id = {{c2}}::uuid`),
  E('retire_c2', 'manager', `select app.set_coach_status({{c2}}, 'retired', 'left the club')`),
  R(
    'c2_retired',
    `select jsonb_build_object('status', c.status, 'photo', c.photo_path,
                     'queued', (select count(*) from coach_photo_purges q where q.coach_id = c.id))
                     from coaches c where c.id = {{c2}}::uuid`,
  ),
  E('storage_after_retire', 'manager', `select to_jsonb(app.storage_path_in_use({{photo}}))`),
  E('resume_retired', 'manager', `select app.set_coach_status({{c2}}, 'active', null)`),
  E('revive_c2', 'manager', PROMOTE('manager', 'g2', '{{v}}')),
  R(
    'c2_revived',
    `select jsonb_build_object('status', status, 'accepted', public_accepted_at, 'retired_at', retired_at)
                     from coaches where id = {{c2}}::uuid`,
  ),

  // ── scope: a manager acts only on coaches of their branches ─────────────
  E(
    'update_out_of_scope',
    'manager',
    `select app.coach_update({{c3}}, '{"display_name_en": "Renamed"}'::jsonb)`,
  ),
  E(
    'update_owner',
    'owner',
    `select app.coach_update({{c3}}, '{"display_name_en": "Renamed"}'::jsonb)`,
  ),
  E('update_bad_key', 'manager', `select app.coach_update({{c1}}, '{"status": "paused"}'::jsonb)`),
  E(
    'update_bad_photo',
    'manager',
    `select app.coach_update({{c1}}, jsonb_build_object('photo_path', 'coaches/' || {{c1}} || '/x.jpg'))`,
  ),
  E(
    'update_ok',
    'manager',
    `select app.coach_update({{c1}}, '{"bio_en": "New bio", "sort_order": 3}'::jsonb)`,
  ),

  // ── branches (R52, R73) ─────────────────────────────────────────────────
  E('branches_vw', 'owner', `select app.set_coach_branches({{c1}}, array[{{v}}, {{w}}]::uuid[])`),
  `select pg_temp.at_branch('c1', 'w');`,
  `select pg_temp.lt('lt_wp', 'private', 'w');`,
  `select pg_temp.teach('c1', 'lt_wp');`,
  E(
    'desk_book_w',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_wp}}, ${at(2)}, null, 'Walk In', null, 1, 'c279-k-desk-w')`,
  ),
  FROM('lesson_w', 'desk_book_w', 'lesson_id'),
  E('drop_w', 'manager', `select app.set_coach_branches({{c1}}, array[{{v}}]::uuid[])`),
  E('branches_empty', 'manager', `select app.set_coach_branches({{c1}}, array[]::uuid[])`),
  E(
    'branches_x_by_manager',
    'manager',
    `select app.set_coach_branches({{c1}}, array[{{v}}, {{w}}, {{x}}]::uuid[])`,
  ),

  // ── lesson types and the coach's price (R46, D-8) ───────────────────────
  `select pg_temp.lt('lt_vp', 'private', 'v');`,
  `select pg_temp.lt('lt_vx', 'private', 'v');`,
  E(
    'types_link',
    'owner',
    `select app.set_coach_lesson_types({{c1}}, {{v}}, array[{{lt_vp}}]::uuid[])`,
  ),
  E('price_manager', 'manager', `select app.set_coach_price({{c1}}, {{lt_vp}}, 25000)`),
  E('price_owner', 'owner', `select app.set_coach_price({{c1}}, {{lt_vp}}, 25000)`),
  E('price_bad', 'owner', `select app.set_coach_price({{c1}}, {{lt_vp}}, 0)`),
  E('price_not_taught', 'owner', `select app.set_coach_price({{c1}}, {{lt_vx}}, 25000)`),
  R('prices_before', `select to_jsonb(count(*)) from coach_prices where coach_id = {{c1}}::uuid`),
  E('types_unlink', 'manager', `select app.set_coach_lesson_types({{c1}}, {{v}}, array[]::uuid[])`),
  R('prices_after', `select to_jsonb(count(*)) from coach_prices where coach_id = {{c1}}::uuid`),
  E(
    'types_foreign',
    'manager',
    `select app.set_coach_lesson_types({{c1}}, {{v}}, array[{{lt_wp}}]::uuid[])`,
  ),
  E(
    'types_not_at_branch',
    'owner',
    `select app.set_coach_lesson_types({{c3}}, {{v}}, array[{{lt_vp}}]::uuid[])`,
  ),

  // ── the price lock (C-17, R46) and the validator (R26) ──────────────────
  E(
    'draft_create',
    'manager',
    `select app.upsert_lesson_type({{v}}, null, '{"kind": "group", "name_en": "Evening group", "name_ar": "مجموعة المساء", "duration_min": 60, "max_places": 4, "min_places": 2, "price_iqd": 12000}'::jsonb)`,
  ),
  FROM('draft', 'draft_create', 'lesson_type_id'),
  E(
    'draft_price',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"price_iqd": 13000}'::jsonb)`,
  ),
  E(
    'draft_launch_manager',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"is_active": true}'::jsonb)`,
  ),
  E('coach_price_draft_manager', 'manager', `select app.set_coach_price({{c1}}, {{draft}}, 10000)`),
  E(
    'draft_launch_owner',
    'owner',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"is_active": true}'::jsonb)`,
  ),
  E(
    'launched_price_manager',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"price_iqd": 14000}'::jsonb)`,
  ),
  E(
    'launched_share_manager',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"court_share_iqd": 1000}'::jsonb)`,
  ),
  E(
    'launched_length_manager',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"duration_min": 90}'::jsonb)`,
  ),
  E(
    'launched_places_group',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"max_places": 5, "name_en": "Evening group+"}'::jsonb)`,
  ),
  E(
    'launched_off',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"is_active": false}'::jsonb)`,
  ),
  E(
    'launched_on_again',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"is_active": true}'::jsonb)`,
  ),
  E(
    'private_places_manager',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{lt_vp}}, '{"max_places": 3}'::jsonb)`,
  ),
  E(
    'launched_price_owner',
    'owner',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"price_iqd": 14000}'::jsonb)`,
  ),
  E(
    'patch_launched_at',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"launched_at": null}'::jsonb)`,
  ),
  E(
    'patch_kind_update',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{draft}}, '{"kind": "private"}'::jsonb)`,
  ),
  E(
    'create_no_kind',
    'manager',
    `select app.upsert_lesson_type({{v}}, null, '{"name_en": "A", "name_ar": "ب", "duration_min": 60, "max_places": 4}'::jsonb)`,
  ),
  E(
    'create_cutoff_zero',
    'manager',
    `select app.upsert_lesson_type({{v}}, null, '{"kind": "group", "name_en": "A", "name_ar": "ب", "duration_min": 60, "max_places": 4, "min_places": 2, "cutoff_hours": 0}'::jsonb)`,
  ),
  E(
    'create_course_cheap',
    'owner',
    `select app.upsert_lesson_type({{v}}, null, '{"kind": "course", "name_en": "A", "name_ar": "ب", "duration_min": 60, "max_places": 4, "sessions_count": 8, "price_iqd": 5}'::jsonb)`,
  ),
  E(
    'create_other_branch',
    'manager',
    `select app.upsert_lesson_type({{x}}, null, '{"kind": "private", "name_en": "A", "name_ar": "ب", "duration_min": 60, "max_places": 1}'::jsonb)`,
  ),
  E(
    'upsert_unknown_id',
    'owner',
    `select app.upsert_lesson_type({{v}}, '00000000-0000-4000-8000-000000000000', '{}'::jsonb)`,
  ),
  E('upsert_by_desk', 'desk', `select app.upsert_lesson_type({{v}}, null, '{}'::jsonb)`),

  // ── hours (C-4, CD-10, R73) ─────────────────────────────────────────────
  `select pg_temp.coach('c4', 'g4', 'v');`,
  `select pg_temp.at_branch('c4', 'w');`,
  X(`delete from coach_hours where coach_id = {{c4}}::uuid`),
  E(
    'hours_off_grid',
    'g4',
    `select app.set_my_coach_hours({{v}}, '[{"weekday": 1, "start": "09:15", "end": "12:00"}]'::jsonb)`,
  ),
  E('hours_not_array', 'g4', `select app.set_my_coach_hours({{v}}, '{"weekday": 1}'::jsonb)`),
  E(
    'hours_overlap_set',
    'g4',
    `select app.set_my_coach_hours({{v}}, '[{"weekday": 1, "start": "09:00", "end": "12:00"}, {"weekday": 1, "start": "11:00", "end": "13:00"}]'::jsonb)`,
  ),
  E(
    'hours_v',
    'g4',
    `select app.set_my_coach_hours({{v}}, '[{"weekday": 1, "start": "09:00", "end": "12:00"}, {"weekday": 2, "start_time": "18:00", "end_time": "24:00"}]'::jsonb)`,
  ),
  E(
    'hours_cross_branch',
    'manager',
    `select app.set_coach_hours({{c4}}, {{w}}, '[{"weekday": 2, "start": "08:00", "end": "10:00"}, {"weekday": 1, "start": "11:30", "end": "14:00"}]'::jsonb)`,
  ),
  E(
    'hours_w',
    'manager',
    `select app.set_coach_hours({{c4}}, {{w}}, '[{"weekday": 1, "start": "12:00", "end": "14:00"}]'::jsonb)`,
  ),
  E('hours_not_at_branch', 'owner', `select app.set_coach_hours({{c4}}, {{x}}, '[]'::jsonb)`),
  E('hours_mine', 'g4', `select app.coach_hours_mine()`),
  E('hours_not_coach', 'g5', `select app.coach_hours_mine()`),
  E('hours_anon', null, `select app.coach_hours_mine()`),

  // ── time off (TIME_OFF_HAS_LESSONS, X31) ────────────────────────────────
  E(
    'off_over_lesson',
    'owner',
    `select app.add_coach_time_off({{c1}}, ${at(2, -1)}, ${at(2, 2)}, 'trip')`,
  ),
  E('off_ok', 'owner', `select app.add_coach_time_off({{c1}}, ${at(5)}, ${at(6)}, 'family')`),
  FROM('off1', 'off_ok', 'id'),
  E('off_overlap', 'owner', `select app.add_coach_time_off({{c1}}, ${at(5, 12)}, ${at(7)}, '')`),
  E('off_past', 'g4', `select app.add_my_time_off(${at(-3)}, ${at(-2)}, '')`),
  E('off_reason_long', 'g4', `select app.add_my_time_off(${at(9)}, ${at(10)}, repeat('x', 201))`),
  E('off_mine', 'g4', `select app.add_my_time_off(${at(9)}, ${at(10)}, 'clinic')`),
  E('off_cancel_stranger', 'g4', `select app.cancel_my_time_off({{off1}})`),
  E('off_cancel', 'owner', `select app.cancel_coach_time_off({{off1}})`),
  E('off_cancel_again', 'owner', `select app.cancel_coach_time_off({{off1}})`),
  E(
    'off_cancel_unknown',
    'manager',
    `select app.cancel_coach_time_off('00000000-0000-4000-8000-000000000000')`,
  ),

  // ── coach_me (X9, R45, R81, C-27) ───────────────────────────────────────
  `select pg_temp.branch('off', false);`,
  `select pg_temp.at_branch('c1', 'off');`,
  E('me_c1', 'g1', `select app.coach_me()`),
  E('me_none', 'g5', `select app.coach_me()`),
  E('retire_c3', 'owner', `select app.set_coach_status({{c3}}, 'retired', null)`),
  E('me_retired', 'g3', `select app.coach_me()`),
  E('self_retired', 'g3', `select app.coach_hours_mine()`),
  MK('staffcoach', 'cashier'),
  E('promote_staff', 'owner', PROMOTE('owner', 'staffcoach', '{{v}}')),
  E('me_staff', 'staffcoach', `select app.coach_me()`),

  // ── the admin read (X19) ────────────────────────────────────────────────
  E('admin_v', 'manager', `select app.coaches_admin({{v}})`),
  E('admin_x_manager', 'manager', `select app.coaches_admin({{x}})`),
  E('admin_desk', 'desk', `select app.coaches_admin({{v}})`),

  // ── 0290 DB-01: a save keeps the branches the caller cannot show ────────
  `select pg_temp.guest('g6');`,
  `select pg_temp.coach('c5', 'g6', 'v');`,
  `select pg_temp.at_branch('c5', 'x');`,
  E(
    'mgr_save_vwx',
    'manager',
    `select app.set_coach_branches({{c5}}, array[{{v}}, {{w}}, {{x}}]::uuid[])`,
  ),
  E('mgr_untick_own', 'manager', `select app.set_coach_branches({{c5}}, array[{{x}}]::uuid[])`),
  R(
    'c5_branches',
    `select jsonb_object_agg(case b.venue_id when {{v}}::uuid then 'v' when {{w}}::uuid then 'w' else 'x' end, b.active)
       from coach_branches b where b.coach_id = {{c5}}::uuid`,
  ),
  // A closed branch: the owner keeps it by listing it, then drops it.
  `select pg_temp.guest('g7');`,
  `select pg_temp.coach('c6', 'g7', 'v');`,
  `select pg_temp.branch('cl');`,
  `select pg_temp.at_branch('c6', 'cl');`,
  X(`update venues set status = 'closed', is_active = false where id = {{cl}}::uuid`),
  E(
    'mgr_new_foreign',
    'manager',
    `select app.set_coach_branches({{c6}}, array[{{v}}, {{x}}]::uuid[])`,
  ),
  // DB-02: the closed branch's 24/7 hours no longer clash with hours at v.
  E(
    'hours_beside_closed',
    'manager',
    `select app.set_coach_hours({{c6}}, {{v}}, '[{"weekday": 1, "start": "09:00", "end": "12:00"}]'::jsonb)`,
  ),
  E('admin_beside_closed', 'manager', `select app.coaches_admin({{v}})`),
  E(
    'owner_keep_closed',
    'owner',
    `select app.set_coach_branches({{c6}}, array[{{v}}, {{cl}}]::uuid[])`,
  ),
  E('owner_drop_closed', 'owner', `select app.set_coach_branches({{c6}}, array[{{v}}]::uuid[])`),
  R(
    'c6_cl_hours',
    `select to_jsonb(count(*)) from coach_hours where coach_id = {{c6}}::uuid and venue_id = {{cl}}::uuid`,
  ),

  // ── 0290 DB-02: hours at a dropped branch go with it ────────────────────
  `select pg_temp.guest('g8');`,
  `select pg_temp.coach('c7', 'g8', 'v');`,
  `select pg_temp.at_branch('c7', 'w');`,
  E(
    'hours_blocked',
    'manager',
    `select app.set_coach_hours({{c7}}, {{v}}, '[{"weekday": 1, "start": "09:00", "end": "12:00"}]'::jsonb)`,
  ),
  E('drop_w_c7', 'manager', `select app.set_coach_branches({{c7}}, array[{{v}}]::uuid[])`),
  R(
    'c7_w_hours',
    `select to_jsonb(count(*)) from coach_hours where coach_id = {{c7}}::uuid and venue_id = {{w}}::uuid`,
  ),
  R(
    'c7_hours_audit',
    `select coalesce(jsonb_agg(after), '[]'::jsonb) from audit_log
      where action = 'coaching.hours' and entity_id = {{c7}}::text and (after->>'windows')::int = 0`,
  ),
  E(
    'hours_after_drop',
    'manager',
    `select app.set_coach_hours({{c7}}, {{v}}, '[{"weekday": 1, "start": "09:00", "end": "12:00"}]'::jsonb)`,
  ),
  E('readd_w', 'manager', `select app.set_coach_branches({{c7}}, array[{{v}}, {{w}}]::uuid[])`),
  R(
    'c7_w_hours_after',
    `select to_jsonb(count(*)) from coach_hours where coach_id = {{c7}}::uuid and venue_id = {{w}}::uuid`,
  ),

  // ── 0290 DB-03: a replaced photo is queued; a deleted profile is never promoted
  K('photo_a', `select 'coaches/' || gen_random_uuid() || '/a.jpg'`),
  K('photo_b', `select 'coaches/' || gen_random_uuid() || '/b.jpg'`),
  E(
    'photo_set_a',
    'owner',
    `select app.coach_update({{c7}}, jsonb_build_object('photo_path', {{photo_a}}))`,
  ),
  E(
    'photo_set_b',
    'owner',
    `select app.coach_update({{c7}}, jsonb_build_object('photo_path', {{photo_b}}))`,
  ),
  R(
    'c7_purges',
    `select coalesce(jsonb_agg(q.folder order by q.queued_at), '[]'::jsonb) from coach_photo_purges q
      where q.coach_id = {{c7}}::uuid`,
  ),
  R('photo_a_folder', `select to_jsonb(substring({{photo_a}} from '^(coaches/[0-9a-f-]{36})/'))`),
  `select pg_temp.guest('g9');`,
  X(`update profiles set deleted_at = now() where id = {{g9}}::uuid`),
  E('promote_deleted', 'owner', PROMOTE('owner', 'g9', '{{v}}')),

  // ── 0290 DB-04: a relink starts from the type price; the internal needs the link
  X(
    `insert into coach_prices (coach_id, lesson_type_id, venue_id, price_iqd) values ({{c1}}, {{lt_vp}}, {{v}}, 27000)`,
  ),
  E(
    'relink',
    'owner',
    `select app.set_coach_lesson_types({{c1}}, {{v}}, array[{{lt_vp}}]::uuid[])`,
  ),
  R('relink_prices', `select to_jsonb(count(*)) from coach_prices where coach_id = {{c1}}::uuid`),
  E(
    'internal_not_offered',
    'owner',
    `select app.set_coach_price_internal({{c1}}, {{lt_vx}}, 1000, null)`,
  ),

  // ── 0290 DB-05 (§1.15 D3): touching windows join, a lesson may cross midnight
  `select pg_temp.guest('g10');`,
  `select pg_temp.coach('c9', 'g10', 'v');`,
  E(
    'hours_c9',
    'owner',
    `select app.set_coach_hours({{c9}}, {{v}}, '[{"weekday": 6, "start": "10:00", "end": "12:00"},
       {"weekday": 6, "start": "12:00", "end": "16:00"}, {"weekday": 6, "start": "18:00", "end": "24:00"},
       {"weekday": 0, "start": "00:00", "end": "02:00"}]'::jsonb)`,
  ),
  ...(
    [
      ['in_touching', 0, '11:30', 0, '12:30'],
      ['in_gap', 0, '15:30', 0, '16:30'],
      ['in_across_gap', 0, '11:00', 0, '19:00'],
      ['in_midnight', 0, '23:30', 1, '00:30'],
      ['in_evening_to_2', 0, '18:00', 1, '02:00'],
      ['in_past_2', 1, '01:30', 1, '02:30'],
      ['in_sunday_start', 1, '00:00', 1, '01:00'],
      ['in_friday_night', -1, '23:30', 0, '00:30'],
      ['in_saturday_1am', 0, '01:00', 0, '02:00'],
    ] as const
  ).map(([label, d1, t1, d2, t2]) =>
    R(
      label,
      `select to_jsonb(app.coach_in_hours({{c9}}::uuid, {{v}}::uuid, tstzrange(
         ((date_trunc('week', now())::date + 5 + ${d1}) + time '${t1}') at time zone 'Asia/Baghdad',
         ((date_trunc('week', now())::date + 5 + ${d2}) + time '${t2}') at time zone 'Asia/Baghdad', '[)')))`,
    ),
  ),

  // ── 0290 DB-06: a retried time off is the same row ──────────────────────
  E('off_retry_1', 'g4', `select app.add_my_time_off(${at(20)}, ${at(21)}, 'clinic')`),
  E('off_retry_2', 'g4', `select app.add_my_time_off(${at(20)}, ${at(21)}, 'clinic')`),
  E(
    'off_retry_staff',
    'owner',
    `select app.add_coach_time_off({{c4}}, ${at(20)}, ${at(21)}, 'clinic')`,
  ),
  R(
    'off_retry_rows',
    `select jsonb_build_object(
       'rows', (select count(*) from coach_time_off t where t.coach_id = {{c4}}::uuid and t.cancelled_at is null
                   and t.period = tstzrange(${at(20)}, ${at(21)}, '[)')),
       'audits', (select count(*) from audit_log a where a.action = 'coaching.time_off'
                   and a.entity_id in (select t.id::text from coach_time_off t where t.coach_id = {{c4}}::uuid
                                         and t.period = tstzrange(${at(20)}, ${at(21)}, '[)'))))`,
  ),
];

describe.skipIf(!docker)(
  'coaching admin (0282): coaches, types, the price lock, hours, time off, coach_me',
  () => {
    let r: Results;
    beforeAll(() => {
      r = scenario('c279', BODY);
    });

    it('promotes a guest once; refuses a photo folder named by a profile and a branch the manager does not work at', () => {
      expect(data<Json>(r, 'promote')).toMatchObject({ status: 'active', revived: false });
      expect(code(r, 'promote_again')).toMatch(/^ALREADY_COACH/);
      expect(code(r, 'promote_bad_folder')).toBe('INVALID_ARGUMENT:p_photo_path');
      expect(code(r, 'promote_bad_format')).toBe('INVALID_ARGUMENT:p_photo_path');
      expect(data<Json>(r, 'promote_g2')).toMatchObject({ status: 'active' });
      expect(code(r, 'promote_not_my_branch')).toBe('FORBIDDEN');
      expect(code(r, 'promote_by_guest')).toBe('FORBIDDEN');
      expect(code(r, 'promote_no_profile')).toBe('CUSTOMER_NOT_FOUND');
      // R61: a new coach is not public until they accept.
      expect(data<Json>(r, 'c1_row')).toMatchObject({ status: 'active', accepted: false });
      // R43: the live coach photo is in use.
      expect(data(r, 'storage_live')).toBe(true);
      expect(data(r, 'storage_other')).toBe(false);
    });

    it('retires (photo queued, path cleared) and brings a retired coach back unaccepted', () => {
      expect(data<Json>(r, 'retire_c2')).toMatchObject({ status: 'retired', duplicate: false });
      expect(data<Json>(r, 'c2_retired')).toEqual({ status: 'retired', photo: null, queued: 1 });
      expect(data(r, 'storage_after_retire')).toBe(false);
      expect(code(r, 'resume_retired')).toBe('INVALID_TRANSITION:retired');
      expect(data<Json>(r, 'revive_c2')).toMatchObject({ status: 'active', revived: true });
      expect(data<Json>(r, 'c2_revived')).toEqual({
        status: 'active',
        accepted: null,
        retired_at: null,
      });
    });

    it('keeps a manager to the coaches of their branches; validates the patch', () => {
      expect(code(r, 'update_out_of_scope')).toBe('FORBIDDEN');
      expect(data<Json>(r, 'update_owner')).toMatchObject({ display_name_en: 'Renamed' });
      expect(code(r, 'update_bad_key')).toBe('INVALID_ARGUMENT:status');
      expect(code(r, 'update_bad_photo')).toBe('INVALID_ARGUMENT:photo_path');
      expect(data<Json>(r, 'update_ok')).toMatchObject({ bio_en: 'New bio', sort_order: 3 });
    });

    it('refuses to drop a branch with lessons to come (R52, R73 detail coach_lessons)', () => {
      expect((data<Json>(r, 'branches_vw').venue_ids as string[]).length).toBe(2);
      expect(data<Json>(r, 'desk_book_w')).toMatchObject({ duplicate: false });
      const f = failed(r, 'drop_w');
      expect(f.code).toBe('BRANCH_HAS_BOOKINGS');
      expect(f.detail).toBe('coach_lessons');
      expect(code(r, 'branches_empty')).toBe('INVALID_ARGUMENT:p_venue_ids');
      expect(code(r, 'branches_x_by_manager')).toBe('FORBIDDEN');
    });

    it('deletes the coach price when the coach stops teaching the type (R46); the owner alone sets one directly (D-8)', () => {
      expect(data<Json>(r, 'types_link')).toMatchObject({ lesson_type_ids: [expect.any(String)] });
      expect(code(r, 'price_manager')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(data<Json>(r, 'price_owner')).toMatchObject({ price_iqd: 25000 });
      expect(code(r, 'price_bad')).toBe('INVALID_ARGUMENT:p_price_iqd');
      expect(code(r, 'price_not_taught')).toBe('LESSON_TYPE_NOT_OFFERED');
      expect(data(r, 'prices_before')).toBe(1);
      expect(data<Json>(r, 'types_unlink')).toMatchObject({
        lesson_type_ids: [],
        prices_removed: [expect.objectContaining({ price_iqd: 25000 })],
      });
      expect(data(r, 'prices_after')).toBe(0);
      expect(code(r, 'types_foreign')).toMatch(/^LESSON_TYPE_NOT_FOUND/);
      expect(code(r, 'types_not_at_branch')).toBe('COACH_NOT_AT_BRANCH');
    });

    it('applies the price lock to a manager and lets drafts and the owner through (C-17, R46)', () => {
      // R26: a group type with a minimum gets a two-hour cut-off.
      expect(data<Json>(r, 'draft_create')).toMatchObject({
        cutoff_hours: 2,
        is_active: false,
        launched_at: null,
      });
      expect(data<Json>(r, 'draft_price')).toMatchObject({ price_iqd: 13000 });
      expect(code(r, 'draft_launch_manager')).toBe('LAUNCH_VIA_PROTOCOL');
      expect(code(r, 'coach_price_draft_manager')).toBe('PRICE_VIA_PROTOCOL:price');
      const launched = data<Json>(r, 'draft_launch_owner');
      expect(launched).toMatchObject({ is_active: true });
      expect(launched.launched_at).not.toBeNull();
      expect(code(r, 'launched_price_manager')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(code(r, 'launched_share_manager')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(code(r, 'launched_length_manager')).toBe('PRICE_VIA_PROTOCOL:shape');
      expect(data<Json>(r, 'launched_places_group')).toMatchObject({ max_places: 5 });
      expect(data<Json>(r, 'launched_off')).toMatchObject({ is_active: false });
      expect(data<Json>(r, 'launched_on_again')).toMatchObject({ is_active: true });
      expect(code(r, 'private_places_manager')).toBe('PRICE_VIA_PROTOCOL:shape');
      expect(data<Json>(r, 'launched_price_owner')).toMatchObject({ price_iqd: 14000 });
    });

    it('validates the lesson type patch key by key', () => {
      expect(code(r, 'patch_launched_at')).toBe('INVALID_ARGUMENT:launched_at');
      expect(code(r, 'patch_kind_update')).toBe('INVALID_ARGUMENT:kind');
      expect(code(r, 'create_no_kind')).toBe('INVALID_ARGUMENT:kind');
      expect(code(r, 'create_cutoff_zero')).toBe('INVALID_ARGUMENT:cutoff_hours');
      expect(code(r, 'create_course_cheap')).toBe('INVALID_ARGUMENT:price_iqd');
      expect(code(r, 'create_other_branch')).toBe('FORBIDDEN');
      expect(code(r, 'upsert_unknown_id')).toBe('LESSON_TYPE_NOT_FOUND');
      expect(code(r, 'upsert_by_desk')).toBe('FORBIDDEN');
    });

    it('writes weekly hours on the :00/:30 grid with 24:00, and names the clashing window (R73)', () => {
      expect(code(r, 'hours_off_grid')).toBe('HOURS_INVALID:0');
      expect(code(r, 'hours_not_array')).toBe('HOURS_INVALID:p_windows');
      expect(code(r, 'hours_overlap_set')).toBe('HOURS_OVERLAP:1');
      const v = data<Json>(r, 'hours_v');
      expect(missingKeys(v, ['coach_id', 'venue_id', 'windows', 'hours'])).toEqual([]);
      expect(v.windows).toEqual([
        expect.objectContaining({
          weekday: 1,
          start_time: '09:00',
          end_time: '12:00',
          set_by: 'coach',
        }),
        expect.objectContaining({
          weekday: 2,
          start_time: '18:00',
          end_time: '24:00',
          set_by: 'coach',
        }),
      ]);
      // Across branches: window 1 (Monday 11:30-14:00 at w) overlaps Monday 09:00-12:00 at v.
      expect(code(r, 'hours_cross_branch')).toBe('HOURS_OVERLAP:1');
      expect(data<Json>(r, 'hours_w')).toMatchObject({
        windows: [expect.objectContaining({ set_by: 'staff' })],
      });
      expect(code(r, 'hours_not_at_branch')).toBe('COACH_NOT_AT_BRANCH');
      const mine = data<Json>(r, 'hours_mine');
      expect(missingKeys(mine, COACHING_SHAPES.coach_hours_mine)).toEqual([]);
      expect(code(r, 'hours_not_coach')).toBe('NOT_A_COACH');
      expect(code(r, 'hours_anon')).toBe('AUTH_REQUIRED');
    });

    it('adds and cancels time off; refuses one over a lesson and one over another period', () => {
      expect(code(r, 'off_over_lesson')).toBe('TIME_OFF_HAS_LESSONS:1');
      expect(data<Json>(r, 'off_ok')).toMatchObject({ set_by: 'staff', reason: 'family' });
      expect(code(r, 'off_overlap')).toBe('HOURS_OVERLAP:time_off');
      expect(code(r, 'off_past')).toBe('INVALID_ARGUMENT:p_ends_at');
      expect(code(r, 'off_reason_long')).toBe('INVALID_ARGUMENT:p_reason');
      expect(data<Json>(r, 'off_mine')).toMatchObject({ set_by: 'coach' });
      expect(code(r, 'off_cancel_stranger')).toBe('INVALID_ARGUMENT:p_id');
      expect(data<Json>(r, 'off_cancel')).toMatchObject({ duplicate: false });
      expect(data<Json>(r, 'off_cancel_again')).toMatchObject({ duplicate: true });
      expect(code(r, 'off_cancel_unknown')).toBe('INVALID_ARGUMENT:p_id');
    });

    it('answers coach_me for a coach, a non-coach, a retired coach and a staff member who coaches (X9, R45, R81)', () => {
      const me = data<Json>(r, 'me_c1');
      expect(missingKeys(me, COACHING_SHAPES.coach_me)).toEqual([]);
      const coach = me.coach as Json;
      expect(coach).toMatchObject({ public_accepted: false, add_cap: 30, adds_today: 0 });
      const branches = coach.branches as Json[];
      // A branch with coaching off is listed, switched off (R45), not hidden.
      expect(branches.map((b) => b.coaching_enabled).sort()).toEqual([false, true, true]);
      expect(data<Json>(r, 'me_none')).toMatchObject({ coach: null });
      const retired = data<Json>(r, 'me_retired');
      expect(missingKeys(retired, COACHING_SHAPES.coach_me_retired)).toEqual([]);
      expect(Object.keys(retired.coach as Json).sort()).toEqual([
        'display_name_ar',
        'display_name_en',
        'id',
        'status',
      ]);
      expect(code(r, 'self_retired')).toBe('NOT_A_COACH');
      expect(data<Json>(r, 'promote_staff')).toMatchObject({ status: 'active' });
      const staff = data<Json>(r, 'me_staff');
      expect((staff.coach as Json).status).toBe('active');
    });

    it('reads the admin list for managers and the owner only (X19)', () => {
      const admin = data<Json>(r, 'admin_v');
      expect(missingKeys(admin, COACHING_SHAPES.coaches_admin)).toEqual([]);
      const coaches = admin.coaches as Json[];
      expect(coaches.length).toBeGreaterThanOrEqual(3);
      expect(code(r, 'admin_x_manager')).toBe('FORBIDDEN');
      expect(code(r, 'admin_desk')).toBe('FORBIDDEN');
    });

    it('0290 DB-01: a save keeps the branches the caller cannot show, and never adds one', () => {
      const ids = (k: string) => [...(data<Json>(r, k).venue_ids as string[])].sort();
      expect(data<Json>(r, 'mgr_save_vwx')).toMatchObject({ dropped: [] });
      expect(ids('mgr_save_vwx')).toHaveLength(3);
      // The manager unticks every branch of their own: x (not theirs) stays.
      expect(ids('mgr_untick_own')).toHaveLength(1);
      expect((data<Json>(r, 'mgr_untick_own').dropped as string[]).length).toBe(2);
      expect(data<Json>(r, 'c5_branches')).toEqual({ v: false, w: false, x: true });
      // A branch the manager does not work at and the coach is not at: still FORBIDDEN.
      expect(code(r, 'mgr_new_foreign')).toBe('FORBIDDEN');
      // The owner keeps a closed branch by listing it, and may drop it.
      expect(ids('owner_keep_closed')).toHaveLength(2);
      expect(data<Json>(r, 'owner_keep_closed')).toMatchObject({ dropped: [] });
      expect((data<Json>(r, 'owner_drop_closed').dropped as string[]).length).toBe(1);
      expect(ids('owner_drop_closed')).toHaveLength(1);
      expect(data(r, 'c6_cl_hours')).toBe(0);
    });

    it('0290 DB-02: hours at a dropped or closed branch never block hours elsewhere', () => {
      expect(data<Json>(r, 'hours_beside_closed')).toMatchObject({
        windows: [expect.objectContaining({ weekday: 1, start_time: '09:00' })],
      });
      const c6 = (data<Json>(r, 'admin_beside_closed').coaches as Json[]).find(
        (c) => c.coach_id === data<Json>(r, 'owner_keep_closed').coach_id,
      );
      expect(c6?.hours_elsewhere).toEqual([]);
      expect(code(r, 'hours_blocked')).toBe('HOURS_OVERLAP:0');
      expect((data<Json>(r, 'drop_w_c7').dropped as string[]).length).toBe(1);
      expect(data(r, 'c7_w_hours')).toBe(0);
      expect(data<Json[]>(r, 'c7_hours_audit')).toEqual([
        expect.objectContaining({ windows: 0, branch_dropped: true }),
      ]);
      expect(data<Json>(r, 'hours_after_drop')).toMatchObject({
        windows: [expect.objectContaining({ weekday: 1, start_time: '09:00', end_time: '12:00' })],
      });
      expect((data<Json>(r, 'readd_w').venue_ids as string[]).length).toBe(2);
      expect(data(r, 'c7_w_hours_after')).toBe(0);
    });

    it('0290 DB-03: a replaced photo is queued for removal; a deleted profile is never promoted', () => {
      expect(data<Json>(r, 'photo_set_a')).toMatchObject({ photo_path: expect.any(String) });
      expect(data<Json>(r, 'photo_set_b')).toMatchObject({ photo_path: expect.any(String) });
      expect(data(r, 'c7_purges')).toEqual([data(r, 'photo_a_folder')]);
      expect(code(r, 'promote_deleted')).toBe('CUSTOMER_NOT_FOUND');
    });

    it('0290 DB-04: a relink starts from the type price; a price needs the link', () => {
      expect(data<Json>(r, 'relink')).toMatchObject({
        prices_removed: [expect.objectContaining({ price_iqd: 27000 })],
      });
      expect(data(r, 'relink_prices')).toBe(0);
      expect(code(r, 'internal_not_offered')).toBe('LESSON_TYPE_NOT_OFFERED');
    });

    it('0290 DB-05 (§1.15 D3): touching windows join and a lesson may cross local midnight', () => {
      expect(data<Json>(r, 'hours_c9').windows as Json[]).toHaveLength(4);
      expect(data(r, 'in_touching')).toBe(true);
      expect(data(r, 'in_gap')).toBe(false);
      expect(data(r, 'in_across_gap')).toBe(false);
      expect(data(r, 'in_midnight')).toBe(true);
      expect(data(r, 'in_evening_to_2')).toBe(true);
      expect(data(r, 'in_past_2')).toBe(false);
      expect(data(r, 'in_sunday_start')).toBe(true);
      expect(data(r, 'in_friday_night')).toBe(false);
      // 01:00 Saturday local is Friday 22:00 UTC: the weekday is the branch's.
      expect(data(r, 'in_saturday_1am')).toBe(false);
    });

    it('0290 DB-06: a retried time off is the row already there, audited once', () => {
      const first = data<Json>(r, 'off_retry_1');
      expect(missingKeys(first, COACHING_SHAPES.add_my_time_off)).toEqual([]);
      expect(first).toMatchObject({ duplicate: false, set_by: 'coach' });
      expect(data<Json>(r, 'off_retry_2')).toMatchObject({ id: first.id, duplicate: true });
      // Another person adding the same period is not a retry.
      expect(code(r, 'off_retry_staff')).toBe('HOURS_OVERLAP:time_off');
      expect(data<Json>(r, 'off_retry_rows')).toEqual({ rows: 1, audits: 1 });
    });
  },
);

// ── 0290: two connections, committed (DB-03, DB-04) ──────────────────────────

describe.skipIf(!docker)('coach admin races (0290, committed, two connections)', () => {
  const OWNER = SEED_STAFF_IDS.owner;

  /** A branch, one accepted coach with a photo teaching one private type there. */
  function fixture() {
    const id = () => crypto.randomUUID();
    const f = {
      tag: id().slice(0, 8),
      venue: id(),
      type: id(),
      coach: id(),
      prof: id(),
      folder: `coaches/${id()}`,
    };
    psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${f.venue}', 'c290-race-${f.tag}', 'C290 race', 'سباق', 'Asia/Baghdad', true);
insert into venue_settings (venue_id, venue_name, opening_hours, coaching_enabled)
select '${f.venue}', 'C290 race', jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb), true
  from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d;
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('${f.prof}', 'c290-race-${f.prof}@test.touch.local', '{"full_name": "Race"}'::jsonb, 'authenticated', 'authenticated');
insert into coaches (id, profile_id, display_name_en, display_name_ar, bio_en, bio_ar, photo_path, public_accepted_at)
values ('${f.coach}', '${f.prof}', 'Race', 'سباق', 'Bio', 'سيرة', '${f.folder}/p.jpg', now());
insert into coach_branches (coach_id, venue_id, active) values ('${f.coach}', '${f.venue}', true);
insert into lesson_types (id, venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd, max_places,
                          min_places, cutoff_hours, is_active, launched_at)
values ('${f.type}', '${f.venue}', 'private', 'Race private', 'حصة', 60, 30000, 5000, 2, 1, 0, true, now());
insert into coach_lesson_types (coach_id, lesson_type_id, venue_id) values ('${f.coach}', '${f.type}', '${f.venue}');
commit;`);
    return f;
  }

  function cleanup(f: ReturnType<typeof fixture>) {
    psql(`begin;
select set_config('request.jwt.claims', '', true);
update coaches set status = 'retired', retired_at = coalesce(retired_at, now()) where id = '${f.coach}';
update venue_settings set coaching_enabled = false where venue_id = '${f.venue}';
update venues set is_active = false where id = '${f.venue}';
commit;`);
  }

  /** One call as the owner in a committed session of its own, optionally holding it two seconds. */
  const asOwner = (sql: string, app?: string) =>
    psqlSession(`${app ? `set application_name = '${app}';\n` : ''}begin;
select set_config('request.jwt.claims', '{"sub": "${OWNER}", "role": "authenticated"}', true);
${sql};
${app ? 'select pg_sleep(2);\n' : ''}commit;`);

  const prices = (f: ReturnType<typeof fixture>) =>
    psql(`select count(*) from coach_prices where coach_id = '${f.coach}'`);

  it('DB-04: an unlink holding the coach makes a concurrent set_coach_price LESSON_TYPE_NOT_OFFERED', async () => {
    const f = fixture();
    try {
      const app = `c290-unlink-${f.tag}`;
      const holder = asOwner(
        `select app.set_coach_lesson_types('${f.coach}', '${f.venue}', array[]::uuid[])`,
        app,
      );
      await waitForSleeper(app);
      const price = asOwner(`select app.set_coach_price('${f.coach}', '${f.type}', 27000)`);
      const [h, p] = await Promise.allSettled([holder, price]);
      expect(h.status).toBe('fulfilled');
      expect(p.status).toBe('rejected');
      expect(String((p as PromiseRejectedResult).reason)).toMatch(/LESSON_TYPE_NOT_OFFERED/);
      expect(prices(f)).toBe('0');
    } finally {
      cleanup(f);
    }
  }, 60_000);

  it('DB-04: a price holding the coach is deleted by the unlink that waited for it', async () => {
    const f = fixture();
    try {
      const app = `c290-price-${f.tag}`;
      const holder = asOwner(`select app.set_coach_price('${f.coach}', '${f.type}', 27000)`, app);
      await waitForSleeper(app);
      const unlink = asOwner(
        `select app.set_coach_lesson_types('${f.coach}', '${f.venue}', array[]::uuid[])`,
      );
      const [h, u] = await Promise.allSettled([holder, unlink]);
      expect(h.status).toBe('fulfilled');
      expect(u.status).toBe('fulfilled');
      expect(prices(f)).toBe('0');
    } finally {
      cleanup(f);
    }
  }, 60_000);

  it('DB-03: a retirement holding the coach makes a concurrent coach_update INVALID_ARGUMENT retired', async () => {
    const f = fixture();
    try {
      const app = `c290-retire-${f.tag}`;
      const holder = asOwner(`select app.set_coach_status('${f.coach}', 'retired', null)`, app);
      await waitForSleeper(app);
      const update = asOwner(
        `select app.coach_update('${f.coach}', '{"bio_en": "Stale", "sort_order": 4}'::jsonb)`,
      );
      const [h, u] = await Promise.allSettled([holder, update]);
      expect(h.status).toBe('fulfilled');
      expect(u.status).toBe('rejected');
      expect(String((u as PromiseRejectedResult).reason)).toMatch(/INVALID_ARGUMENT[\s\S]*retired/);
      expect(
        psql(`select status || '|' || bio_en || '|' || coalesce(photo_path, '-') || '|' || sort_order
                from coaches where id = '${f.coach}'`),
      ).toBe('retired|Bio|-|0');
    } finally {
      cleanup(f);
    }
  }, 60_000);
});
