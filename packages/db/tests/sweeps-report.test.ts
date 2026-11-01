/**
 * 0402 sweeps_report: the six background bodies that catch an item's, a branch's or a step's
 * error and carry on now also store it on the dev monitoring panel (app.monitor, 0393), kind
 * `<function>_failed`, source cron, level error, ids only in the detail.
 *
 *   * Static (always runs): in each function's latest body, every `exception when others` handler
 *     calls app.monitor with its kind, so a later re-issue that drops one fails here.
 *   * Stack: for each function, one rolled-back psql transaction (stores-harness) replaces the
 *     helper the handler guards with one that raises, runs the function, and reads the event back.
 *     The sabotage is DDL inside the transaction, so it rolls back with everything else.
 *
 * Without docker the stack cases skip themselves.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, Q, scenario, X, type Results } from './stores-harness';
import { PUBLISH, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

const FORCED = 'SWEEPS_REPORT_FORCED';

// Ids this file plants itself carry no run of eight digits: app.monitor_scrub_text (0393) masks
// one as a phone or card number, dashes included, so a digit-heavy uuid is stored as `[number]`.
const PROFILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0402';

/** Replace `app.<sig>` with a body that raises FORCED (same signature, so create or replace takes it). */
const BREAK = (sig: string, returns: string) =>
  X(`create or replace function app.${sig} returns ${returns} language plpgsql
     as $x$ begin raise exception '${FORCED}'; end $x$`);

/** The forced events of `kind`, oldest first. */
const EVENTS = (label: string, kind: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('source', source, 'level', level, 'kind', kind,
                                                  'message', message, 'detail', detail) order by id), '[]'::jsonb)
       from app.monitoring_events
      where kind = '${kind}' and message like '%${FORCED}%'`,
  );

interface Event {
  source: string;
  level: string;
  kind: string;
  message: string;
  detail: Record<string, unknown>;
}

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''}`).toBe(true);
  return o!.data as T;
}

const FUNCTIONS: Array<[string, number]> = [
  ['match_sweep', 3],
  ['lesson_sweep', 3],
  ['tournament_sweep', 5],
  ['checklist_sweep', 1],
  ['loyalty_nightly_one', 1],
  ['price_promo_apply_due', 2],
];

describe('0402: every caught error of the six bodies reaches app.monitor', () => {
  const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const latestBody = (name: string): string => {
    for (const f of [...files].reverse()) {
      const sql = readFileSync(dir + f, 'utf8');
      const hits = [...sql.matchAll(new RegExp(`create (or replace )?function app\\.${name}\\(`, 'g'))];
      if (hits.length === 0) continue;
      const at = hits.at(-1)!.index!;
      const tag = sql.slice(at).match(/as (\$[a-z_0-9]+\$)/)![1]!;
      const start = sql.indexOf(tag, at) + tag.length;
      return sql.slice(start, sql.indexOf(tag, start));
    }
    throw new Error(`no body for ${name}`);
  };

  it.each(FUNCTIONS)('%s: each of its %i handlers calls app.monitor', (name, handlers) => {
    const body = latestBody(name);
    expect(body.split('exception when others then').length - 1).toBe(handlers);
    const calls = [...body.matchAll(/perform app\.monitor\('cron', 'error', '([a-z_]+)'/g)].map((m) => m[1]);
    expect(calls).toEqual(Array(handlers).fill(`${name}_failed`));
    // Each call sits in a handler: after its first `exception when others`.
    expect(body.indexOf('perform app.monitor(')).toBeGreaterThan(body.indexOf('exception when others then'));
  });
});

describe.skipIf(!docker)('0402: a forced failure is stored on the monitoring panel', () => {
  it('match_sweep: the DF-20 refunds step', () => {
    const r = scenario('sr-match', [
      BREAK('ticket_refund_deleted(p_guest_id uuid default null)', 'integer'),
      Q('sweep', `select app.match_sweep()`),
      EVENTS('ev', 'match_sweep_failed'),
    ]);
    expect(ok<{ errors: number }>(r, 'sweep').errors).toBeGreaterThanOrEqual(1);
    const ev = ok<Event[]>(r, 'ev');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: 'cron', level: 'error', detail: { step: 'refunds', sqlstate: 'P0001' } });
    expect(ev[0]!.message).toContain('match_sweep: DF-20 refunds left for the next run');
  });

  it('lesson_sweep: the refund net step', () => {
    const r = scenario('sr-lesson', [
      BREAK('lesson_refund_net()', 'integer'),
      Q('sweep', `select app.lesson_sweep()`),
      EVENTS('ev', 'lesson_sweep_failed'),
    ]);
    expect(ok<{ errors: number }>(r, 'sweep').errors).toBeGreaterThanOrEqual(1);
    const ev = ok<Event[]>(r, 'ev');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ source: 'cron', level: 'error', detail: { step: 'refund_net' } });
    expect(ev[0]!.message).toContain('lesson_sweep: refund net left for the next run');
  });

  it('tournament_sweep: the cut-off of one tournament', () => {
    const r = scenario('sr-tour', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { min_entries: 4 }),
      `select pg_temp.field('t1', 4, 'p');`,
      X(`update tournaments set registration_closes_at = now() - interval '1 minute' where id = {{t1}}::uuid`),
      BREAK('tournament_close_internal(p_tournament_id uuid, p_by text)', 'integer'),
      Q('sweep', `select app.tournament_sweep()`),
      EVENTS('ev', 'tournament_sweep_failed'),
      Q('status', `select to_jsonb(status) from tournaments where id = {{t1}}::uuid`),
    ]);
    expect(ok<{ errors: number }>(r, 'sweep').errors).toBeGreaterThanOrEqual(1);
    const ev = ok<Event[]>(r, 'ev');
    const mine = ev.filter((e) => e.detail.step === 'cut_off');
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]).toMatchObject({ source: 'cron', level: 'error', detail: { sqlstate: 'P0001' } });
    expect(typeof mine[0]!.detail.tournament_id).toBe('string');
    // The tournament is left open for the next run, as before.
    expect(ok(r, 'status')).toBe('open');
  });

  it('checklist_sweep: one branch', () => {
    const r = scenario('sr-check', [
      X(`insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by)
         values ({{venue}}::uuid, 'cashier', 'open', 'SR list', 'قائمة', 1, {{owner}}::uuid)`),
      BREAK('checklist_materialize(p_venue uuid, p_date date)', 'integer'),
      Q('sweep', `select to_jsonb(app.checklist_sweep())`),
      EVENTS('ev', 'checklist_sweep_failed'),
    ]);
    expect(typeof ok(r, 'sweep')).toBe('number');
    const ev = ok<Event[]>(r, 'ev');
    const venueA = ev.filter((e) => e.message.includes('checklist_sweep venue'));
    expect(venueA.length).toBeGreaterThanOrEqual(1);
    expect(venueA.every((e) => typeof e.detail.venue_id === 'string')).toBe(true);
    expect(venueA[0]).toMatchObject({ source: 'cron', level: 'error', detail: { sqlstate: 'P0001' } });
  });

  it('loyalty_nightly_one: one account', () => {
    const r = scenario('sr-loyalty', [
      BREAK('loyalty_recompute(p_profile uuid)', 'void'),
      Q('one', `select to_jsonb(app.loyalty_nightly_one('${PROFILE}'::uuid, null, now()))`),
      EVENTS('ev', 'loyalty_nightly_one_failed'),
    ]);
    expect(ok(r, 'one')).toBe('error');
    const ev = ok<Event[]>(r, 'ev');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      source: 'cron',
      level: 'error',
      detail: { profile_id: PROFILE, sqlstate: 'P0001' },
    });
  });

  it('price_promo_apply_due: the apply and the put-back', () => {
    const r = scenario('sr-promo', [
      X(`insert into protocol_runs (id, venue_id, template_id, template_version, kind, title_en, started_by,
                                    status, scheduled_for)
         select '${RUN_ID}'::uuid, {{venue}}::uuid, t.id, t.version, 'price_promo', 'SR promo', {{manager}}::uuid,
                'scheduled', now() - interval '1 minute'
           from protocol_templates t where t.venue_id = {{venue}}::uuid and t.kind = 'price_promo'
          limit 1`),
      BREAK('price_promo_apply_internal(p_run_id uuid)', 'jsonb'),
      BREAK('protocol_step_allowed(p_from text, p_to text)', 'boolean'),
      Q('due', `select app.price_promo_apply_due()`),
      EVENTS('ev', 'price_promo_apply_due_failed'),
    ]);
    ok(r, 'due');
    const mine = ok<Event[]>(r, 'ev').filter((e) => e.detail.run_id === RUN_ID);
    expect(mine.map((e) => e.detail.step)).toEqual(['apply', 'put_back']);
    for (const e of mine) {
      expect(e).toMatchObject({ source: 'cron', level: 'error', detail: { sqlstate: 'P0001' } });
    }
  });
});
