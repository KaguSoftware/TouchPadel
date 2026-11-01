/**
 * 0384 blocked_areas_enforced (F-16): a page the owner blocks is blocked on
 * the server too. app.pre_request (PostgREST's pre-request hook) refuses an
 * RPC with AREA_BLOCKED when the caller has every page it belongs to
 * (app.access_area_rpcs) blocked; an RPC another open page shares, an RPC no
 * page owns, an owner, a guest and the service role are never refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCESS_AREA_KEYS } from '../../core/src/staff/access';
import { serviceClient, signedInClient, DEV_PASSWORD, VENUE_A_ID } from './helpers';
import { docker, scenario, T, Q, FX, MK } from './psql-scenario';

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261101000384_blocked_areas_enforced.sql', import.meta.url)),
  'utf8',
);
const ROWS = [...MIGRATION.matchAll(/\('([a-z]+)', '([a-z0-9_]+)'\)/g)].map((m) => ({ area: m[1]!, rpc: m[2]! }));

describe('0384 the map matches @touch/core', () => {
  it('the CHECK lists exactly ACCESS_AREA_KEYS', () => {
    const chk = MIGRATION.slice(MIGRATION.indexOf('access_area_rpcs_area_chk'));
    const list = [...chk.slice(0, chk.indexOf('))')).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect([...list].sort()).toEqual([...ACCESS_AREA_KEYS].sort());
  });
  it('every area owns at least one RPC, and every row names a known area', () => {
    const areas = new Set(ROWS.map((r) => r.area));
    expect([...areas].sort()).toEqual([...ACCESS_AREA_KEYS].sort());
    for (const r of ROWS) expect(ACCESS_AREA_KEYS as string[]).toContain(r.area);
  });
  it('the shell, PIN and personal RPCs are never mapped', () => {
    const mapped = new Set(ROWS.map((r) => r.rpc));
    for (const rpc of ['heartbeat', 'verify_manager_pin', 'verify_own_pin', 'staff_activity_ping', 'my_checklists_today',
                       'staff_requests_page', 'open_till_shift', 'close_till_shift', 'refund', 'hold_slot', 'report_event']) {
      expect(mapped.has(rpc), rpc).toBe(false);
    }
  });
});

describe.skipIf(!docker)('0384 the rule', () => {
  it('every mapped RPC exists, and the hook is set on the authenticator role', () => {
    const r = scenario([
      Q('missing', `select coalesce(jsonb_agg(a.rpc), '[]') from app.access_area_rpcs a
                     where not exists (select 1 from pg_proc p where p.proname = a.rpc and p.pronamespace = 'app'::regnamespace)`),
      Q('hook', `select to_jsonb(exists (select 1 from pg_roles r, unnest(r.rolconfig) c
                   where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=app.pre_request'))`),
    ]);
    expect(r.missing?.data).toEqual([]);
    expect(r.hook?.data).toBe(true);
  });

  it('refuses only when every page of the RPC is blocked, and never an owner or a guest', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      FX(`update staff set blocked_areas = '{till}' where id = {{c1}}::uuid`),
      T('split', 'c1', `select to_jsonb(app.area_blocked_rpc('split_evenly'))`),
      T('openTab', 'c1', `select to_jsonb(app.area_blocked_rpc('open_tab'))`),
      T('heartbeat', 'c1', `select to_jsonb(app.area_blocked_rpc('heartbeat'))`),
      FX(`update staff set blocked_areas = '{till,desk,shop}' where id = {{c1}}::uuid`),
      T('openTabAll', 'c1', `select to_jsonb(app.area_blocked_rpc('open_tab'))`),
      FX(`update staff set blocked_areas = '{}' where id = {{c1}}::uuid`),
      T('none', 'c1', `select to_jsonb(app.area_blocked_rpc('split_evenly'))`),
      FX(`update staff set blocked_areas = '{till}' where id = {{owner}}::uuid`),
      T('owner', 'owner', `select to_jsonb(app.area_blocked_rpc('split_evenly'))`),
      FX(`insert into pg_temp.vars values ('guest', gen_random_uuid()::text)`),
      T('guest', 'guest', `select to_jsonb(app.area_blocked_rpc('split_evenly'))`),
      // The hook itself, as PostgREST calls it.
      FX(`update staff set blocked_areas = '{till}' where id = {{c1}}::uuid`),
      `select set_config('request.path', '/rpc/split_evenly', true);`,
      T('hookSplit', 'c1', `select to_jsonb(app.pre_request() is null)`),
      `select set_config('request.path', '/rpc/open_tab', true);`,
      T('hookOpenTab', 'c1', `select to_jsonb(app.pre_request() is null)`),
      `select set_config('request.path', '/tabs', true);`,
      T('hookTable', 'c1', `select to_jsonb(app.pre_request() is null)`),
    ]);
    expect(r.split?.data).toBe(true);
    expect(r.openTab?.data).toBe(false);
    expect(r.heartbeat?.data).toBe(false);
    expect(r.openTabAll?.data).toBe(true);
    expect(r.none?.data).toBe(false);
    expect(r.owner?.data).toBe(false);
    expect(r.guest?.data).toBe(false);
    expect(r.hookSplit).toMatchObject({ ok: false, code: 'AREA_BLOCKED', detail: 'split_evenly' });
    expect(r.hookOpenTab).toMatchObject({ ok: true });
    expect(r.hookTable).toMatchObject({ ok: true });
  });
});

describe.skipIf(!docker)('0384 through the API', () => {
  let svc: SupabaseClient;
  let staffId: string;
  let email: string;

  beforeAll(async () => {
    svc = serviceClient();
    email = `blocked-areas-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    staffId = data.user.id;
    const ins = await svc.from('staff').insert({ id: staffId, display_name: 'Blocked Areas', role: 'cashier', is_active: true });
    if (ins.error) throw new Error(`staff insert: ${ins.error.message}`);
    await svc.from('staff_venues').upsert({ staff_id: staffId, venue_id: VENUE_A_ID, role: 'cashier' });
  });

  afterAll(async () => {
    await svc.from('staff_venues').delete().eq('staff_id', staffId);
    await svc.from('staff').delete().eq('id', staffId);
    await svc.auth.admin.deleteUser(staffId).catch(() => undefined);
  });

  it('a blocked till page refuses its RPC with AREA_BLOCKED; unblocked, the RPC answers itself', async () => {
    const c = await signedInClient(email);
    const args = { p_tab_id: '00000000-0000-4000-8000-000000000000', p_n: 2 };
    await svc.from('staff').update({ blocked_areas: ['till'] }).eq('id', staffId);
    const blocked = await c.schema('app').rpc('split_evenly', args);
    expect(blocked.error?.message).toBe('AREA_BLOCKED');
    expect(blocked.error?.details).toBe('split_evenly');
    // A shared RPC (desk and shop still open) is not refused by the gate.
    const shared = await c.schema('app').rpc('area_blocked_rpc', { p_rpc: 'open_tab' });
    expect(shared.error).toBeNull();
    expect(shared.data).toBe(false);
    await svc.from('staff').update({ blocked_areas: [] }).eq('id', staffId);
    const open = await c.schema('app').rpc('split_evenly', args);
    expect(open.error?.message).toBe('TAB_NOT_FOUND');
    await c.auth.signOut();
  });
});
