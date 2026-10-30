/**
 * 0334 play_profile_coach_levels (docs/design/play-coaches/contracts-2026-10-11.md §4):
 *
 *   - app.set_my_play_profile: answers kept (p_wants in its canonical order, each once), the
 *     skipped survey (all three NULL) still stamps play_survey_at, a bad value is
 *     INVALID_PLAY_PROFILE and writes nothing, anon has no grant, an anonymous café session has
 *     no profile, the guest reads the four columns by a plain select (the column grant), another
 *     guest's row is out of reach, the CHECKs hold a service-role write too, and account deletion
 *     empties them;
 *   - coaches.levels: coach_update takes `levels` (canonical order, duplicates dropped, refusals
 *     for a value outside the list, a non-array, a null element), the CHECK holds a direct write,
 *     and coaches_admin, coaching_public and coach_profile (a named branch and NULL) carry it,
 *     [] meaning every level;
 *   - tournament_public.entries: the registered entries in registration order (a promoted
 *     waitlist entry at its promotion), before and after the draw, no withdrawn or waitlisted
 *     entry, `mine` for the caller only (false for anon), the public player shape and no
 *     forbidden key or guest id; [] on a missing tournament.
 *
 * The first block runs through PostgREST as real sessions (helpers.ts); the other two are one
 * rolled-back psql transaction each (stores-harness). Needs the local stack.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';
import { TOUR_PUBLIC_FORBIDDEN_KEYS } from '../../core/src/tournaments';
import {
  anonClient,
  anonymousSessionClient,
  appRpc,
  createStaffOfRole,
  guestClient,
  serviceClient,
  stackAvailable,
} from './helpers';
import { E, GUEST, SETUP } from './matches-harness';
import { COACH_SETUP } from './coaching-read-harness';
import { dockerReachable, KEEP, Q, scenario, T, X, type Results } from './stores-harness';
import {
  answer,
  PUBLISH,
  refusal,
  ROUNDS,
  RUN,
  TOUR_BRANCH,
  TOUR_SETUP,
} from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();
const NIL = '00000000-0000-4000-8000-000000000000';
const COLUMNS = 'play_level, play_years, play_wants, play_survey_at';

interface PlayProfile {
  play_level: string | null;
  play_years: string | null;
  play_wants: string[] | null;
  play_survey_at: string | null;
}

async function uid(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getUser();
  return data.user!.id;
}

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe.skipIf(!up)('0334 app.set_my_play_profile', () => {
  let svc: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let bId: string;
  let desk: { id: string; client: SupabaseClient };

  beforeAll(async () => {
    svc = serviceClient();
    a = await guestClient(svc, 'play-a');
    b = await guestClient(svc, 'play-b');
    aId = await uid(a);
    bId = await uid(b);
    desk = await createStaffOfRole(svc, 'court_desk', 'play');
  });

  afterAll(async () => {
    if (desk) await svc.from('staff').update({ is_active: false }).eq('id', desk.id);
  });

  const own = async (c: SupabaseClient, id: string) =>
    (await c.from('profiles').select(COLUMNS).eq('id', id).maybeSingle()) as {
      data: PlayProfile | null;
      error: { message: string } | null;
    };

  it('a new account has never been asked: all four NULL, read by a plain select', async () => {
    const row = await own(a, aId);
    expect(row.error).toBeNull();
    expect(row.data).toEqual({
      play_level: null,
      play_years: null,
      play_wants: null,
      play_survey_at: null,
    });
  });

  it('keeps the answers, the wants in their canonical order and each once, and stamps the time', async () => {
    const before = Date.now();
    const res = await appRpc(a, 'set_my_play_profile', {
      p_level: 'beginner',
      p_years: 'one_to_three',
      p_wants: ['lessons', 'matches', 'lessons'],
    });
    expect(res.error).toBeNull();
    const out = res.data as PlayProfile;
    expect(out).toMatchObject({
      play_level: 'beginner',
      play_years: 'one_to_three',
      play_wants: ['matches', 'lessons'],
    });
    expect(Date.parse(out.play_survey_at!)).toBeGreaterThanOrEqual(before - 5_000);
    expect(Object.keys(out).sort()).toEqual([
      'play_level',
      'play_survey_at',
      'play_wants',
      'play_years',
    ]);
    const row = await own(a, aId);
    expect(row.data).toMatchObject({
      play_level: 'beginner',
      play_years: 'one_to_three',
      play_wants: ['matches', 'lessons'],
    });
    expect(Date.parse(row.data!.play_survey_at!)).toBe(Date.parse(out.play_survey_at!));
  });

  it('takes every level and every years answer it lists', async () => {
    for (const p_level of ['new', 'beginner', 'intermediate', 'advanced']) {
      for (const p_years of ['never', 'under_one', 'one_to_three', 'three_plus']) {
        const res = await appRpc(a, 'set_my_play_profile', {
          p_level,
          p_years,
          p_wants: ['tournaments'],
        });
        expect(res.error, `${p_level}/${p_years}`).toBeNull();
        expect(res.data).toMatchObject({
          play_level: p_level,
          play_years: p_years,
          play_wants: ['tournaments'],
        });
      }
    }
  });

  it('a skipped survey (all three NULL) clears the answers and still stamps play_survey_at; [] is no answer', async () => {
    const res = await appRpc(a, 'set_my_play_profile', {
      p_level: null,
      p_years: null,
      p_wants: null,
    });
    expect(res.error).toBeNull();
    const out = res.data as PlayProfile;
    expect(out).toMatchObject({ play_level: null, play_years: null, play_wants: null });
    expect(out.play_survey_at).not.toBeNull();
    const none = await appRpc(a, 'set_my_play_profile', {});
    expect(none.error).toBeNull();
    expect(none.data).toMatchObject({ play_level: null, play_years: null, play_wants: null });
    expect((none.data as PlayProfile).play_survey_at).not.toBeNull();
    const empty = await appRpc(a, 'set_my_play_profile', {
      p_level: 'advanced',
      p_years: null,
      p_wants: [],
    });
    expect(empty.data).toMatchObject({
      play_level: 'advanced',
      play_years: null,
      play_wants: null,
    });
  });

  it('refuses a value outside its list with INVALID_PLAY_PROFILE naming the argument, and writes nothing', async () => {
    const set = await appRpc(a, 'set_my_play_profile', {
      p_level: 'intermediate',
      p_years: 'under_one',
      p_wants: ['matches'],
    });
    expect(set.error).toBeNull();
    const kept = (await own(a, aId)).data;
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ p_level: 'pro', p_years: null, p_wants: null }, 'p_level'],
      [{ p_level: 'Beginner', p_years: null, p_wants: null }, 'p_level'],
      [{ p_level: null, p_years: 'ten', p_wants: null }, 'p_years'],
      [{ p_level: null, p_years: null, p_wants: ['golf'] }, 'p_wants'],
      [{ p_level: null, p_years: null, p_wants: ['matches', null] }, 'p_wants'],
    ];
    for (const [args, detail] of bad) {
      const res = await appRpc(a, 'set_my_play_profile', args);
      expect(res.error?.message, JSON.stringify(args)).toBe('INVALID_PLAY_PROFILE');
      expect(res.error?.details).toBe(detail);
    }
    expect((await own(a, aId)).data).toEqual(kept);
  });

  it('anon has no grant; an anonymous café session has no profile (ACCOUNT_REQUIRED)', async () => {
    const anon = await appRpc(anonClient(), 'set_my_play_profile', {
      p_level: 'new',
      p_years: null,
      p_wants: null,
    });
    expect(anon.error?.message ?? '').toMatch(/permission denied/i);
    const session = await anonymousSessionClient();
    const res = await appRpc(session, 'set_my_play_profile', {
      p_level: 'new',
      p_years: null,
      p_wants: null,
    });
    expect(res.error?.message).toBe('ACCOUNT_REQUIRED');
  });

  it("another guest's row is out of reach: the RPC writes the caller's own, no direct write, no read", async () => {
    expect(
      (
        await appRpc(b, 'set_my_play_profile', {
          p_level: 'advanced',
          p_years: 'three_plus',
          p_wants: null,
        })
      ).error,
    ).toBeNull();
    const aBefore = (await own(a, aId)).data;
    expect(
      (await appRpc(b, 'set_my_play_profile', { p_level: 'new', p_years: 'never', p_wants: null }))
        .error,
    ).toBeNull();
    expect((await own(a, aId)).data).toEqual(aBefore);

    // No UPDATE grant on the columns, for the own row or another's.
    const direct = await a
      .from('profiles')
      .update({ play_level: 'advanced' } as never)
      .eq('id', aId);
    expect(direct.error?.message ?? '').toMatch(/permission denied/i);
    const other = await a
      .from('profiles')
      .update({ play_level: 'advanced' } as never)
      .eq('id', bId);
    expect(other.error?.message ?? '').toMatch(/permission denied/i);

    // profiles_select: a guest reads their own row only; the desk reads guests.
    expect((await own(a, bId)).data).toBeNull();
    const deskRead = await own(desk.client, bId);
    expect(deskRead.error).toBeNull();
    expect(deskRead.data).toMatchObject({ play_level: 'new', play_years: 'never' });
  });

  it('the CHECKs hold a service-role write too', async () => {
    for (const patch of [
      { play_level: 'pro' },
      { play_years: 'forever' },
      { play_wants: ['golf'] },
      { play_wants: [] },
    ]) {
      const res = await svc.from('profiles').update(patch).eq('id', aId);
      expect(res.error?.code, JSON.stringify(patch)).toBe('23514');
    }
  });

  it('account deletion empties all four', async () => {
    const g = await guestClient(svc, 'play-del');
    const gId = await uid(g);
    expect(
      (
        await appRpc(g, 'set_my_play_profile', {
          p_level: 'advanced',
          p_years: 'three_plus',
          p_wants: ['matches'],
        })
      ).error,
    ).toBeNull();
    expect((await appRpc(g, 'delete_my_account', { p_confirm: 'DELETE' })).error).toBeNull();
    const row = await svc.from('profiles').select(COLUMNS).eq('id', gId).single();
    expect(row.data).toEqual({
      play_level: null,
      play_years: null,
      play_wants: null,
      play_survey_at: null,
    });
  });
});

describe.skipIf(!docker)('0334 coach levels', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('c334', [
      SETUP,
      COACH_SETUP,
      `select pg_temp.cbranch();`,
      `select pg_temp.coach('ca');`,
      `select pg_temp.coach('cb');`,
      Q('fresh', `select to_jsonb(levels) from coaches where id = {{co_ca}}::uuid`),
      T(
        'set',
        'manager',
        `select app.coach_update({{co_ca}}, '{"levels": ["advanced", "beginner", "advanced"]}'::jsonb)`,
      ),
      Q('stored', `select to_jsonb(levels) from coaches where id = {{co_ca}}::uuid`),
      T('bad_value', 'manager', `select app.coach_update({{co_ca}}, '{"levels": ["pro"]}'::jsonb)`),
      T(
        'bad_type',
        'manager',
        `select app.coach_update({{co_ca}}, '{"levels": "beginner"}'::jsonb)`,
      ),
      T('bad_null', 'manager', `select app.coach_update({{co_ca}}, '{"levels": [null]}'::jsonb)`),
      T(
        'bad_case',
        'manager',
        `select app.coach_update({{co_ca}}, '{"levels": ["Beginner"]}'::jsonb)`,
      ),
      T('cashier', 'cashier', `select app.coach_update({{co_ca}}, '{"levels": []}'::jsonb)`),
      Q('after_refusals', `select to_jsonb(levels) from coaches where id = {{co_ca}}::uuid`),
      Q(
        'audit',
        `select jsonb_build_object('before', a.before->'levels', 'after', a.after->'levels')
           from audit_log a where a.action = 'coaching.coach.update' and a.entity_id = {{co_ca}}
          order by a.at desc limit 1`,
      ),
      // The CHECK, written directly as postgres.
      `do $chk$
       begin
         begin
           update coaches set levels = '{pro}' where id = pg_temp.var('co_cb')::uuid;
           insert into pg_temp.out(label, res) values ('chk_value', '{"ok": true}');
         exception when check_violation then
           insert into pg_temp.out(label, res) values ('chk_value', jsonb_build_object('ok', false, 'code', sqlstate));
         end;
         begin
           update coaches set levels = '{beginner,beginner,beginner,beginner}' where id = pg_temp.var('co_cb')::uuid;
           insert into pg_temp.out(label, res) values ('chk_count', '{"ok": true}');
         exception when check_violation then
           insert into pg_temp.out(label, res) values ('chk_count', jsonb_build_object('ok', false, 'code', sqlstate));
         end;
       end $chk$;`,
      T('admin', 'manager', `select app.coaches_admin({{v}})`),
      E('pub', null, `select app.coaching_public({{v}})`),
      E('prof', null, `select app.coach_profile({{co_ca}}, {{v}})`),
      E('prof_null', null, `select app.coach_profile({{co_cb}}, null)`),
      // Clearing them: [] = every level.
      T('clear', 'manager', `select app.coach_update({{co_ca}}, '{"levels": []}'::jsonb)`),
      E('pub_cleared', null, `select app.coaching_public({{v}})`),
    ]);
    expect(Object.keys(r).length).toBeGreaterThan(10);
  });

  it('a coach starts with no levels (every level)', () => {
    expect(answer(r, 'fresh')).toEqual([]);
  });

  it('coach_update keeps levels in the canonical order, each once, and answers them on the card', () => {
    const set = answer<Record<string, unknown>>(r, 'set');
    expect(set.levels).toEqual(['beginner', 'advanced']);
    expect(missingKeys(set, COACHING_SHAPES.coach_update)).toEqual([]);
    expect(answer(r, 'stored')).toEqual(['beginner', 'advanced']);
    expect(answer(r, 'audit')).toEqual({ before: [], after: ['beginner', 'advanced'] });
  });

  it('refuses a level outside the list, a non-array and a null element; the role first', () => {
    expect(refusal(r, 'bad_value')).toBe('INVALID_ARGUMENT:levels');
    expect(refusal(r, 'bad_type')).toBe('INVALID_ARGUMENT:levels');
    expect(refusal(r, 'bad_null')).toBe('INVALID_ARGUMENT:levels');
    expect(refusal(r, 'bad_case')).toBe('INVALID_ARGUMENT:levels');
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(answer(r, 'after_refusals')).toEqual(['beginner', 'advanced']);
  });

  it('the CHECK refuses a value outside the list and more than three', () => {
    expect(r.chk_value).toEqual({ ok: false, code: '23514' });
    expect(r.chk_count).toEqual({ ok: false, code: '23514' });
  });

  it('coaches_admin, coaching_public and coach_profile carry levels; [] means every level', () => {
    const admin = answer<{ coaches: Array<{ coach_id: string; levels: unknown }> }>(r, 'admin');
    expect(missingKeys(admin, COACHING_SHAPES.coaches_admin)).toEqual([]);
    expect(admin.coaches.map((c) => c.levels).sort()).toEqual([[], ['beginner', 'advanced']]);

    const pub = answer<Record<string, unknown>>(r, 'pub');
    expect(missingKeys(pub, COACHING_SHAPES.coaching_public)).toEqual([]);
    const levels = (pub.coaches as Array<{ levels: unknown }>).map((c) => c.levels);
    expect(levels).toContainEqual(['beginner', 'advanced']);
    expect(levels).toContainEqual([]);

    const prof = answer<{ coach: { levels: unknown } }>(r, 'prof');
    expect(missingKeys(prof, COACHING_SHAPES.coach_profile)).toEqual([]);
    expect(prof.coach.levels).toEqual(['beginner', 'advanced']);
    expect(answer<{ coach: { levels: unknown } }>(r, 'prof_null').coach.levels).toEqual([]);

    const cleared = answer<{ coaches: Array<{ levels: unknown }> }>(r, 'pub_cleared');
    expect(cleared.coaches.map((c) => c.levels)).toEqual([[], []]);
    expect(answer(r, 'clear')).toMatchObject({ levels: [] });
  });
});

describe.skipIf(!docker)('0334 tournament_public entries', () => {
  let r: Results;
  interface Entry {
    player: { name: string | null; former: boolean; no: number | null };
    mine: boolean;
  }
  const entries = (label: string) => answer<{ entries: Entry[] }>(r, label).entries;

  it('runs the scenario', () => {
    r = scenario('tp334', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      // Withdrawn before anyone else entered: never listed.
      GUEST('gone', '{"given": "Gone", "family": "Away"}'),
      X(`insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, entered_at,
                                         withdrawn_reason, withdrawn_at)
         select t.venue_id, t.id, {{gone}}::uuid, 'withdrawn', 'guest', clock_timestamp() - interval '2 days',
                'guest', now()
           from tournaments t where t.id = {{t1}}::uuid`),
      // Entered a day ago on the waitlist, promoted after everyone below: listed last.
      GUEST('late', '{"given": "Waiter", "family": "Listed"}'),
      X(`insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, entered_at)
         select t.venue_id, t.id, {{late}}::uuid, 'waitlisted', 'guest', clock_timestamp() - interval '1 day'
           from tournaments t where t.id = {{t1}}::uuid`),
      `select pg_temp.field('t1', 4, 'p');`,
      // A desk walk-in with no accepted terms: name null.
      GUEST('walk', '{"phone": null, "terms": null, "gender": null}'),
      T('walk', 'desk', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      // The RPC stamps now(), the start of this one test transaction; in real use it is its own
      // transaction's start, after the four above.
      X(`update tournament_entries set entered_at = clock_timestamp()
          where tournament_id = {{t1}}::uuid and guest_id = {{walk}}::uuid`),
      X(`update tournament_entries set status = 'registered', promoted_at = clock_timestamp()
          where tournament_id = {{t1}}::uuid and guest_id = {{late}}::uuid`),
      // Still waiting: never listed.
      GUEST('queue', '{"given": "Queue", "family": "Person"}'),
      X(`insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, entered_at)
         select t.venue_id, t.id, {{queue}}::uuid, 'waitlisted', 'guest', clock_timestamp()
           from tournaments t where t.id = {{t1}}::uuid`),
      KEEP(
        'guest_ids',
        `select jsonb_agg(pg_temp.var(x))::text from unnest(array['gone', 'late', 'p1', 'p2', 'p3', 'p4', 'walk', 'queue']) x`,
      ),
      KEEP(
        'entry_ids',
        `select jsonb_agg(e.id)::text from tournament_entries e where e.tournament_id = {{t1}}::uuid`,
      ),
      E('anon', null, `select app.tournament_public({{t1}})`),
      T('mine', 'p2', `select app.tournament_public({{t1}})`),
      T('mine_late', 'late', `select app.tournament_public({{t1}})`),
      T('mine_queue', 'queue', `select app.tournament_public({{t1}})`),
      E('nil', null, `select app.tournament_public('${NIL}')`),
      E('null', null, `select app.tournament_public(null)`),
      Q(
        'ids',
        `select jsonb_build_object('guests', {{guest_ids}}::jsonb, 'entries', {{entry_ids}}::jsonb)`,
      ),
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 1),
      E('after', null, `select app.tournament_public({{t1}})`),
    ]);
    expect(answer(r, 'sched')).toBeTruthy();
  });

  it('lists the registered entries in registration order, before the draw, with the public player shape', () => {
    const list = entries('anon');
    expect(list.map((e) => e.player.name)).toEqual([
      'Player1 F.',
      'Player2 F.',
      'Player3 F.',
      'Player4 F.',
      null,
      'Waiter L.',
    ]);
    for (const e of list) {
      // 0373 added seat, the entry's board chair.
      expect(Object.keys(e).sort()).toEqual(['mine', 'player', 'seat']);
      expect(Object.keys(e.player).sort()).toEqual(['former', 'name', 'no']);
      expect(e.player.former).toBe(false);
      expect(e.player.no).toBeNull();
    }
  });

  it('mine is the caller’s own entry only, and false for anon or a guest still waiting', () => {
    expect(entries('anon').map((e) => e.mine)).toEqual([false, false, false, false, false, false]);
    expect(entries('mine').map((e) => e.mine)).toEqual([false, true, false, false, false, false]);
    expect(entries('mine_late').map((e) => e.mine)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(entries('mine_queue').every((e) => !e.mine)).toBe(true);
  });

  it('names no guest id, phone or full name, and no forbidden key', () => {
    const pub = answer(r, 'anon');
    const keys = keysOf(pub);
    for (const k of TOUR_PUBLIC_FORBIDDEN_KEYS) expect(keys, k).not.toContain(k);
    const text = JSON.stringify(pub);
    const ids = answer<{ guests: string[]; entries: string[] }>(r, 'ids');
    for (const id of [...ids.guests, ...ids.entries]) expect(text).not.toContain(id);
    for (const name of ['Fam1', 'Gone', 'Queue', 'Listed']) expect(text).not.toContain(name);
  });

  it('a missing tournament answers entries []', () => {
    expect(answer(r, 'nil')).toEqual({ missing: true, entries: [] });
    expect(answer(r, 'null')).toEqual({ missing: true, entries: [] });
  });

  it('after the draw: the same entries in the same order, each with its seed', () => {
    const list = entries('after');
    expect(list.map((e) => e.player.name)).toEqual(entries('anon').map((e) => e.player.name));
    expect(list.map((e) => e.player.no).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(answer<{ rounds: unknown[] }>(r, 'after').rounds).toHaveLength(1);
  });
});
