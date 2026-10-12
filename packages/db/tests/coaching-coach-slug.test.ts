/**
 * Coaching, 0337 coach_slugs + 0338: a coach's share link names the coach
 * (/c/omar-karim, owner 2026-10-11).
 *
 * In one rolled-back transaction (coaching-core-harness.ts):
 *   * a new coach's slug comes from the English name; a second coach of the
 *     same name gets -2; a name with no latin letter gets "coach";
 *   * renaming the coach keeps the slug;
 *   * a manager edits it through coach_update (lowercased); another coach's
 *     slug is COACH_SLUG_TAKEN, a bad one or one shaped like an id
 *     INVALID_ARGUMENT slug;
 *   * coach_id_for_slug answers the id for a coach who accepted going public,
 *     NULL for an old slug, a coach not yet accepted, or a retired one;
 *   * coaching_public, coach_profile and coaches_admin carry the slug.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { code, data, E, FROM, R, SETUP } from './coaching-core-harness';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** A coach named `en` on guest `guest`, kept under `name`. */
const NAMED = (name: string, guest: string, en: string, accepted = true) => [
  X(
    `insert into coaches (profile_id, display_name_en, display_name_ar, public_accepted_at)
     values ({{${guest}}}::uuid, '${en}', 'مدرّب', ${accepted ? 'now()' : 'null'})`,
  ),
  R(
    `${name}_row`,
    `select jsonb_build_object('id', c.id, 'slug', c.slug) from coaches c
      where c.profile_id = {{${guest}}}::uuid`,
  ),
  FROM(name, `${name}_row`, 'id'),
];

const SLUG = (label: string, coach: string) =>
  R(label, `select to_jsonb(c.slug) from coaches c where c.id = {{${coach}}}::uuid`);

const BODY: string[] = [
  SETUP,
  `select pg_temp.branch('v');`,
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  `select pg_temp.guest('g3');`,
  `select pg_temp.guest('g4');`,
  `select pg_temp.guest('g5');`,
  ...NAMED('omar', 'g1', 'Omar Karim'),
  ...NAMED('omar2', 'g2', '  Omar   KARIM! '),
  ...NAMED('arabic', 'g3', 'عمر'),
  ...NAMED('waiting', 'g4', 'Not Yet', false),
  `select pg_temp.at_branch('omar', 'v');`,

  // ── renaming keeps the slug ─────────────────────────────────────────────
  E(
    'rename',
    'manager',
    `select app.coach_update({{omar}}::uuid, '{"display_name_en": "Omar K"}'::jsonb)`,
  ),
  SLUG('after_rename', 'omar'),

  // ── a manager edits it ──────────────────────────────────────────────────
  E('taken', 'manager', `select app.coach_update({{omar}}::uuid, '{"slug": "omar-karim-2"}'::jsonb)`),
  E('bad', 'manager', `select app.coach_update({{omar}}::uuid, '{"slug": "-omar"}'::jsonb)`),
  E(
    'id_shaped',
    'manager',
    `select app.coach_update({{omar}}::uuid, jsonb_build_object('slug', {{omar2}}))`,
  ),
  E('edit', 'manager', `select app.coach_update({{omar}}::uuid, '{"slug": " Coach-Omar "}'::jsonb)`),

  // ── the link's slug to the coach's id ───────────────────────────────────
  E('find_new', null, `select to_jsonb(app.coach_id_for_slug('coach-omar'))`),
  E('find_upper', null, `select to_jsonb(app.coach_id_for_slug('COACH-OMAR'))`),
  E('find_old', null, `select to_jsonb(app.coach_id_for_slug('omar-karim'))`),
  E('find_waiting', null, `select to_jsonb(app.coach_id_for_slug('not-yet'))`),
  X(`update coaches set status = 'retired', retired_at = now() where id = {{omar2}}::uuid`),
  E('find_retired', null, `select to_jsonb(app.coach_id_for_slug('omar-karim-2'))`),

  // ── the reads carry it ──────────────────────────────────────────────────
  E('public', null, `select app.coaching_public({{v}}::uuid)`),
  E('profile', null, `select app.coach_profile({{omar}}::uuid, {{v}}::uuid)`),
  E('admin', 'manager', `select app.coaches_admin({{v}}::uuid)`),
];

describe.skipIf(!docker)('0337 coach slugs, one transaction', () => {
  let r: Results;
  beforeAll(() => {
    r = scenario('c336', BODY);
  });

  it('makes the slug from the English name, -2 for the same name, coach for none', () => {
    expect(data<Json>(r, 'omar_row').slug).toBe('omar-karim');
    expect(data<Json>(r, 'omar2_row').slug).toBe('omar-karim-2');
    expect(data<Json>(r, 'arabic_row').slug).toMatch(/^coach(-\d+)?$/);
  });

  it('keeps the slug when the coach is renamed', () => {
    expect(data(r, 'rename')).toMatchObject({ display_name_en: 'Omar K', slug: 'omar-karim' });
    expect(data(r, 'after_rename')).toBe('omar-karim');
  });

  it('lets a manager edit it, lowercased, and refuses a taken or bad one', () => {
    expect(code(r, 'taken')).toBe('COACH_SLUG_TAKEN');
    expect(code(r, 'bad')).toBe('INVALID_ARGUMENT:slug');
    expect(code(r, 'id_shaped')).toBe('INVALID_ARGUMENT:slug');
    expect(data(r, 'edit')).toMatchObject({ slug: 'coach-omar' });
  });

  it('turns a link slug into the id of a public coach only', () => {
    const omar = data<Json>(r, 'omar_row').id;
    expect(data(r, 'find_new')).toBe(omar);
    expect(data(r, 'find_upper')).toBe(omar);
    expect(data(r, 'find_old')).toBeNull();
    expect(data(r, 'find_waiting')).toBeNull();
    expect(data(r, 'find_retired')).toBeNull();
  });

  it('carries the slug in the public, profile and admin reads', () => {
    const pub = data<{ coaches: Json[] }>(r, 'public');
    expect(missingKeys(pub, COACHING_SHAPES.coaching_public)).toEqual([]);
    expect(pub.coaches.find((c) => c.slug === 'coach-omar')).toBeDefined();
    const profile = data<{ coach: Json }>(r, 'profile');
    expect(missingKeys(profile, COACHING_SHAPES.coach_profile)).toEqual([]);
    expect(profile.coach.slug).toBe('coach-omar');
    const admin = data<{ coaches: Json[] }>(r, 'admin');
    expect(admin.coaches.find((c) => c.slug === 'coach-omar')).toBeDefined();
  });
});
