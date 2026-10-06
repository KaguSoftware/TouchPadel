/**
 * tournaments_schema_money, the schema (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.1, §1.2, §1.5):
 *
 *   * the five tables: RLS on, no policy, no client grant, the service role's grant, the branch
 *     guard with its link pairs, venue_id not null with no default, no index but the constraints';
 *   * tabs: kind 'tournament', tournament_entry_id, tabs_tournament_shape, every new or re-created
 *     constraint validated, the guard's entry pair before the lesson pair (which stays last);
 *   * the switch: off by default, readable by its column grant, last in venue_settings_public, in
 *     the assistant's readable columns; the outbox CHECK admits tournament_update;
 *   * the internals granted to nobody (the money engine and the standings to the service role
 *     only), compute_tab_totals still six columns, the guard trigger and the cron job;
 *   * the sanitiser and the append-only score audit.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, Q, scenario, X } from './stores-harness';
import { answer, PUBLISH, refusal, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';
import { E } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const TABLES = [
  'tournaments',
  'tournament_entries',
  'tournament_rounds',
  'tournament_matches',
  'tournament_score_events',
];

describe.skipIf(!docker)('tournaments schema (§1.2)', () => {
  it('five branch tables: RLS on, no policy, no client grant, the guard, venue_id with no default, constraint indexes only (0310: plus tournament_entries_venue_idx)', () => {
    const r = scenario('ts-tables', [
      Q(
        'tables',
        `select jsonb_object_agg(c.relname, jsonb_build_object(
           'rls', c.relrowsecurity,
           'policies', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
           'client', has_table_privilege('anon', c.oid, 'select,insert,update,delete')
                     or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'),
           'service', has_table_privilege('service_role', c.oid, 'select,insert,update,delete'),
           'guard', (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_branch_guard'),
           'venue_id', (select a.attnotnull from pg_attribute a
                         where a.attrelid = c.oid and a.attname = 'venue_id' and not a.attisdropped),
           'venue_default', (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
                               join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                              where d.adrelid = c.oid and a.attname = 'venue_id'),
           'loose_indexes', (select count(*) from pg_index i
                              where i.indrelid = c.oid
                                and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid))))
           from pg_class c
          where c.relnamespace = 'public'::regnamespace
            and c.relname in (${TABLES.map((t) => `'${t}'`).join(', ')})`,
      ),
    ]);
    const tables = answer<Record<string, Record<string, unknown>>>(r, 'tables');
    expect(Object.keys(tables).sort()).toEqual([...TABLES].sort());
    for (const [name, t] of Object.entries(tables)) {
      expect(t, name).toMatchObject({
        rls: true,
        policies: 0,
        client: false,
        service: true,
        venue_id: true,
        venue_default: null,
        // 0310: tournament_entries_venue_idx, for the branch-wide money reads.
        loose_indexes: name === 'tournament_entries' ? 1 : 0,
      });
      expect(t.guard, name).toMatch(/trg_branch_guard\('scoped'/);
    }
    expect(tables.tournaments!.guard).toMatch(/'protocol_runs', 'protocol_run_id'\)/);
    expect(tables.tournament_entries!.guard).toMatch(
      /'tournaments', 'tournament_id', 'tournament_entries', 'substitute_for'\)/,
    );
    expect(tables.tournament_matches!.guard).toMatch(
      /'tournament_rounds', 'round_id', 'courts', 'court_id', 'tournament_entries', 'a1', 'tournament_entries', 'a2', 'tournament_entries', 'b1', 'tournament_entries', 'b2'\)/,
    );
    expect(tables.tournament_score_events!.guard).toMatch(/'tournament_matches', 'match_id'\)/);
  });

  it('tabs: the tournament kind and link, every constraint validated, the entry pair before the lesson pair, the entry index', () => {
    const r = scenario('ts-tabs', [
      Q(
        'cons',
        `select jsonb_object_agg(conname, jsonb_build_object('valid', convalidated, 'def', pg_get_constraintdef(oid)))
                   from pg_constraint
                  where conrelid = 'public.tabs'::regclass
                    and conname in ('tabs_kind_chk', 'tabs_tournament_entry_fkey', 'tabs_tournament_shape')`,
      ),
      Q(
        'outbox',
        `select jsonb_build_object('valid', convalidated, 'def', pg_get_constraintdef(oid))
                     from pg_constraint where conname = 'notification_outbox_kind_check'
                      and conrelid = 'public.notification_outbox'::regclass`,
      ),
      Q(
        'guard',
        `select to_jsonb(pg_get_triggerdef(t.oid)) from pg_trigger t
                   where t.tgrelid = 'public.tabs'::regclass and t.tgname = 'zz_branch_guard'`,
      ),
      Q(
        'col',
        `select jsonb_build_object('type', data_type, 'nullable', is_nullable, 'default', column_default)
                  from information_schema.columns where table_schema = 'public' and table_name = 'tabs'
                   and column_name = 'tournament_entry_id'`,
      ),
      // c30 (0310): tournament_entry_money reads tabs by entry, once per entry on the desk
      // detail; without this index each read scans every tab.
      Q(
        'entry_index',
        `select jsonb_build_object('valid', i.indisvalid, 'def', pg_get_indexdef(i.indexrelid))
                   from pg_index i where i.indexrelid = to_regclass('public.tabs_tournament_entry_idx')`,
      ),
    ]);
    const cons = answer<Record<string, { valid: boolean; def: string }>>(r, 'cons');
    expect(Object.keys(cons).sort()).toEqual([
      'tabs_kind_chk',
      'tabs_tournament_entry_fkey',
      'tabs_tournament_shape',
    ]);
    for (const [n, c] of Object.entries(cons)) expect(c.valid, n).toBe(true);
    expect(cons.tabs_kind_chk!.def).toMatch(/'tournament'/);
    expect(cons.tabs_tournament_entry_fkey!.def).toMatch(/REFERENCES tournament_entries\(id\)/);
    expect(answer<{ valid: boolean; def: string }>(r, 'outbox')).toMatchObject({ valid: true });
    expect(answer<{ def: string }>(r, 'outbox').def).toMatch(/'tournament_update'/);
    expect(answer<string>(r, 'guard')).toMatch(
      /'tournament_entries', 'tournament_entry_id', 'lesson_enrolments', 'lesson_enrolment_id'\)$/,
    );
    expect(answer(r, 'col')).toEqual({ type: 'uuid', nullable: 'YES', default: null });
    expect(answer<{ valid: boolean; def: string }>(r, 'entry_index')).toMatchObject({
      valid: true,
    });
    expect(answer<{ def: string }>(r, 'entry_index').def).toMatch(
      /ON public\.tabs USING btree \(tournament_entry_id\) WHERE \(tournament_entry_id IS NOT NULL\)$/,
    );
  });

  it('a tournament tab refuses a booking, a table or a missing entry; no other tab names an entry', () => {
    const r = scenario('ts-shape', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 4 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 1, 'p');`,
      `select pg_temp.day('day1');`,
      E(
        'no_entry',
        null,
        `insert into tabs (venue_id, day_session_id, label, kind)
                            values ({{v}}::uuid, {{day1}}::uuid, 'X', 'tournament') returning to_jsonb(id)`,
      ),
      E(
        'cafe_entry',
        null,
        `insert into tabs (venue_id, day_session_id, label, kind, tournament_entry_id)
                              values ({{v}}::uuid, {{day1}}::uuid, 'X', 'cafe', {{p1_e}}::uuid) returning to_jsonb(id)`,
      ),
      E(
        'ok',
        null,
        `insert into tabs (venue_id, day_session_id, label, kind, tournament_entry_id)
                      values ({{v}}::uuid, {{day1}}::uuid, 'X', 'tournament', {{p1_e}}::uuid) returning to_jsonb(id)`,
      ),
    ]);
    expect(refusal(r, 'no_entry')).toMatch(/tabs_tournament_shape/);
    expect(refusal(r, 'cafe_entry')).toMatch(/tabs_tournament_shape/);
    expect(answer(r, 'ok')).toBeTruthy();
  });

  it('the switch: off by default, granted by column, last in venue_settings_public, readable by the assistant', () => {
    const r = scenario('ts-switch', [
      Q(
        'col',
        `select jsonb_build_object('default', column_default, 'nullable', is_nullable,
                  'grant', has_column_privilege('authenticated', 'public.venue_settings', 'tournaments_enabled', 'SELECT'),
                  'anon', has_column_privilege('anon', 'public.venue_settings', 'tournaments_enabled', 'SELECT'))
                  from information_schema.columns where table_schema = 'public' and table_name = 'venue_settings'
                   and column_name = 'tournaments_enabled'`,
      ),
      Q('values', `select jsonb_agg(distinct tournaments_enabled) from venue_settings`),
      Q(
        'view_last',
        `select to_jsonb(column_name) from information_schema.columns
                       where table_schema = 'public' and table_name = 'venue_settings_public'
                       order by ordinal_position desc limit 1`,
      ),
      Q(
        'assistant',
        `select jsonb_agg(table_name order by table_name) from app.assistant_readable_columns
                       where column_name = 'tournaments_enabled'`,
      ),
    ]);
    expect(answer(r, 'col')).toEqual({
      default: 'false',
      nullable: 'NO',
      grant: true,
      anon: false,
    });
    expect(answer(r, 'values')).toEqual([false]);
    expect(answer(r, 'view_last')).toBe('tournaments_enabled');
    expect(answer(r, 'assistant')).toEqual(['venue_settings', 'venue_settings_public']);
  });

  it('the internals: granted to nobody but the service role where marked; six columns; the trigger and the cron', () => {
    const fns: Record<string, string> = {
      tournament_on: 'uuid',
      tournament_entry_money: 'uuid, uuid',
      tournament_fee_remaining: 'uuid, uuid',
      tournament_release_blocks: 'uuid, text',
      tournament_cancel_internal: 'uuid, text',
      tournament_promote_internal: 'uuid',
      tournament_notify: 'uuid, text, text',
      tournament_sweep: '',
      trg_tournament_block_guard: '',
      tournament_standings: 'uuid',
    };
    const r = scenario('ts-internals', [
      Q(
        'grants',
        `select jsonb_object_agg(p.proname, jsonb_build_object(
                     'anon', has_function_privilege('anon', p.oid, 'execute'),
                     'auth', has_function_privilege('authenticated', p.oid, 'execute'),
                     'service', has_function_privilege('service_role', p.oid, 'execute'),
                     'definer', p.prosecdef))
                     from pg_proc p where p.pronamespace = 'app'::regnamespace
                      and p.proname in (${Object.keys(fns)
                        .map((f) => `'${f}'`)
                        .join(', ')})`,
      ),
      Q(
        'totals_args',
        `select jsonb_agg(p.proargnames) from pg_proc p
                         where p.proname = 'compute_tab_totals' and p.pronamespace = 'app'::regnamespace`,
      ),
      Q(
        'trigger',
        `select to_jsonb(pg_get_triggerdef(t.oid)) from pg_trigger t
                     where t.tgrelid = 'public.reservations'::regclass and t.tgname = 'reservations_tournament_guard'`,
      ),
      Q(
        'cron',
        `select case when exists (select 1 from pg_extension where extname = 'pg_cron')
                        then (select to_jsonb(j.schedule) from cron.job j where j.jobname = 'tp_tournament_sweep')
                        else '"no pg_cron"'::jsonb end`,
      ),
    ]);
    const grants = answer<
      Record<string, { anon: boolean; auth: boolean; service: boolean; definer: boolean }>
    >(r, 'grants');
    expect(Object.keys(grants).sort()).toEqual(Object.keys(fns).sort());
    const serviceOnly = ['tournament_entry_money', 'tournament_sweep', 'tournament_standings'];
    for (const [name, g] of Object.entries(grants)) {
      expect({ anon: g.anon, auth: g.auth }, name).toEqual({ anon: false, auth: false });
      if (serviceOnly.includes(name)) expect(g.service, name).toBe(true);
      expect(g.definer, name).toBe(true);
    }
    // compute_tab_totals returns a record of six OUT columns (S1): read them by name.
    const args = answer<string[][]>(r, 'totals_args');
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual([
      'p_tab_id',
      'subtotal_iqd',
      'discount_iqd',
      'tax_iqd',
      'court_iqd',
      'total_iqd',
      'lesson_iqd',
    ]);
    expect(answer<string>(r, 'trigger')).toMatch(
      /BEFORE UPDATE OF status, court_id, start_at, end_at, kind ON public\.reservations FOR EACH ROW WHEN \(\(\(old\.block_purpose = 'event'::text\) AND \(old\.protocol_run_id IS NOT NULL\)\)\) EXECUTE FUNCTION app\.trg_tournament_block_guard\(\)/,
    );
    expect(['* * * * *', 'no pg_cron']).toContain(answer(r, 'cron'));
  });

  it('names and prizes are sanitised; the score audit is append-only', () => {
    const r = scenario('ts-sanitise', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { prize_en: 'Trophy\u0007 and ​medals' }),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      Q('prize', `select to_jsonb(prize_en) from tournaments where id = {{t1}}::uuid`),
      X(`update tournaments set status = 'running' where id = {{t1}}::uuid`),
      X(`insert into tournament_rounds (venue_id, tournament_id, round_no, generated_by)
         values ({{v}}::uuid, {{t1}}::uuid, 1, {{desk}}::uuid)`),
      X(`insert into tournament_matches (venue_id, tournament_id, round_id, round_no, court_id, a1, a2, b1, b2)
         select {{v}}::uuid, {{t1}}::uuid, r.id, 1, {{c1}}::uuid, {{p1_e}}::uuid, {{p2_e}}::uuid, {{p3_e}}::uuid, {{p4_e}}::uuid
           from tournament_rounds r where r.tournament_id = {{t1}}::uuid`),
      X(`insert into tournament_score_events (venue_id, tournament_id, match_id, points_a, points_b, actor_staff_id, reason)
         select {{v}}::uuid, {{t1}}::uuid, m.id, 12, 12, {{desk}}::uuid, 'ok' from tournament_matches m
          where m.tournament_id = {{t1}}::uuid`),
      E(
        'update',
        null,
        `with u as (update tournament_score_events set reason = 'changed'
                           where tournament_id = {{t1}}::uuid returning 1) select to_jsonb(count(*)) from u`,
      ),
      E(
        'delete',
        null,
        `with d as (delete from tournament_score_events
                           where tournament_id = {{t1}}::uuid returning 1) select to_jsonb(count(*)) from d`,
      ),
      E(
        'four',
        null,
        `insert into tournament_matches (venue_id, tournament_id, round_id, round_no, court_id, a1, a2, b1, b2)
                        select {{v}}::uuid, {{t1}}::uuid, r.id, 1, {{c2}}::uuid, {{p5_e}}::uuid, {{p5_e}}::uuid,
                               {{p6_e}}::uuid, {{p7_e}}::uuid
                          from tournament_rounds r where r.tournament_id = {{t1}}::uuid returning to_jsonb(id)`,
      ),
    ]);
    expect(answer<string>(r, 'prize')).not.toMatch(/[\u0007​]/);
    expect(refusal(r, 'update')).toMatch(/append-only|not allowed|forbid|MUTATION/i);
    expect(refusal(r, 'delete')).toMatch(/append-only|not allowed|forbid|MUTATION/i);
    expect(refusal(r, 'four')).toMatch(/tournament_matches_four/);
  });
});
