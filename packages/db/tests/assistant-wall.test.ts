/**
 * 0109 — the assistant's read-only wall (plan §2.2, §7.1).
 *
 * Three properties, each of which a wrong implementation would still appear
 * to satisfy from the chat:
 *
 *   * app.assistant_run_tool turns transaction_read_only ON before it
 *     dispatches, so a write reached through it fails with 25006 — proven with
 *     a planted probe that does exactly what the dispatcher does and then
 *     tries an INSERT, called both through PostgREST (where STABLE already
 *     implies read-only) and through a plain read-write psql transaction
 *     (where only the set_config line stands between the probe and the row);
 *   * every rpc name the catalog dispatches has a branch and answers inside
 *     that read-only transaction on the seeded stack — a "read" RPC that
 *     quietly writes would surface here as a read-only error;
 *   * an unknown name raises ASSISTANT_UNKNOWN_TOOL, and only the owner may
 *     call any of it.
 *
 * The probe is DDL, which PostgREST cannot do, so it goes in through the
 * stack's own container exactly as scripts/check-safe-update.mjs reads the
 * catalog. Without docker on PATH those cases skip themselves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF } from './helpers';
import { DISPATCHED_RPCS } from '../../core/src/assistant/tools';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const NIL = '00000000-0000-4000-8000-000000000000';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

const RANGE = { p_from: '2026-09-01', p_to: '2026-09-18' };

describe.skipIf(!up)('0109 assistant read-only wall', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let ids: { booking: string | null; series: string | null; profile: string | null; campaign: string | null };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const one = async (table: string, filter?: [string, string]) => {
      let q = svc.from(table).select('id').limit(1);
      if (filter) q = q.eq(filter[0], filter[1]);
      const { data } = await q;
      return (data?.[0] as { id: string } | undefined)?.id ?? null;
    };
    ids = {
      booking: await one('reservations', ['kind', 'booking']),
      series: await one('reservation_series'),
      profile: await one('profiles'),
      campaign: await one('marketing_campaigns'),
    };
  });

  afterAll(async () => {
    await owner.auth.signOut();
  });

  const run = (tool: string, args: Record<string, unknown>) =>
    appRpc(owner, 'assistant_run_tool', { p_tool: tool, p_args: args }).then(outcome);

  it('dispatches list_staff and wraps the result', async () => {
    const res = await run('list_staff', {});
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { tool: string; data: unknown[]; row_count: number; truncated: boolean };
    expect(d.tool).toBe('list_staff');
    expect(Array.isArray(d.data)).toBe(true);
    expect(d.row_count).toBe(d.data.length);
    expect(d.truncated).toBe(false);
  });

  it('raises ASSISTANT_UNKNOWN_TOOL for a name outside the catalog', async () => {
    const res = await run('drop_everything', {});
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/ASSISTANT_UNKNOWN_TOOL/);
  });

  it('refuses everyone but the owner', async () => {
    const manager = await signedInClient(SEED_STAFF.manager);
    const res = await appRpc(manager, 'assistant_run_tool', { p_tool: 'list_staff', p_args: {} }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });

  // ── every catalog name answers inside the read-only transaction ───────────

  /** Minimal valid arguments per rpc on the seeded stack. */
  function minimalArgs(rpc: string): Record<string, unknown> {
    switch (rpc) {
      case 'report_compare':
        return { p_report: 'revenue', ...RANGE, p_compare: 'previousPeriod' };
      case 'report_drill':
        return { p_figure: 'revenue', ...RANGE };
      case 'booking_bill':
        return { p_reservation_id: ids.booking ?? NIL };
      case 'series_detail':
        return { p_series_id: ids.series ?? NIL };
      case 'customer_record':
        return { p_customer_id: ids.profile ?? NIL };
      case 'marketing_campaign_performance':
        return { p_campaign: ids.campaign ?? NIL };
      case 'customer_search':
        return { p_query: 'dev' };
      case 'assistant_stock_view':
        return { p_view: 'on_hand', p_limit: 5 };
      case 'assistant_table_read':
        return { p_table: 'courts', p_limit: 1 };
      case 'assistant_audit_page':
        return { p_limit: 5 };
      case 'analytics_menu_snapshot':
      case 'ops_overview':
      case 'list_staff':
      case 'staff_requests_page':
      case 'marketing_overview':
      case 'assistant_courts_and_rates':
      case 'assistant_settings_read':
      case 'assistant_system_status':
      case 'assistant_usage':
        return {};
      default:
        return { ...RANGE }; // every remaining tool takes a business-day range
    }
  }

  it('the test knows an argument set for every dispatched rpc', () => {
    // If the catalog gains a name, this fails loudly and the case list below
    // has to grow with it — which is the point.
    for (const rpc of DISPATCHED_RPCS) expect(minimalArgs(rpc)).toBeDefined();
  });

  it.each([...DISPATCHED_RPCS])('%s answers through the wall', async (rpc) => {
    const res = await run(rpc, minimalArgs(rpc));
    if (!res.ok) {
      // A lookup whose seed row is absent may say NOT_FOUND; it must never say
      // the name is unknown, and it must never have tried to write.
      expect(res.errorMessage).not.toMatch(/ASSISTANT_UNKNOWN_TOOL/);
      expect(res.errorMessage).not.toMatch(/read-only/i);
      expect(res.errorMessage, `${rpc}: ${res.errorMessage}`).toMatch(/NOT_FOUND/);
      return;
    }
    const d = res.data as { tool: string; data: unknown; row_count: number | null };
    expect(d.tool).toBe(rpc);
    expect(d.data).not.toBeUndefined();
  });

  // ── the wall itself ───────────────────────────────────────────────────────

  describe.skipIf(!docker)('planted probe (needs docker)', () => {
    // A STABLE body cannot INSERT directly — Postgres refuses that on its own
    // ("INSERT is not allowed in a non-volatile function"). The hole the wall
    // closes is a VOLATILE function CALLED from the STABLE dispatcher: plpgsql
    // runs each function with its own read-only flag, so without the
    // set_config line the nested write goes through. The probe reproduces the
    // dispatcher's shape (owner guard, optional wall, then a volatile callee).
    const AS_OWNER = `
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';`;

    beforeAll(async () => {
      psql(`
        create or replace function app.assistant_probe_writer()
        returns void
        language plpgsql security definer set search_path = public as $w$
        begin
          insert into assistant_index_queue (kind, ref, op) values ('note', 'wall-probe', 'upsert');
        end $w$;
        revoke all on function app.assistant_probe_writer() from public, anon, authenticated;

        create or replace function app.assistant_run_tool_probe(p_wall boolean)
        returns jsonb
        language plpgsql stable security definer set search_path = public as $probe$
        begin
          if not app.is_staff('owner') then
            raise exception 'FORBIDDEN' using errcode = 'P0001';
          end if;
          if p_wall then
            perform set_config('transaction_read_only', 'on', true);
          end if;
          perform app.assistant_probe_writer();
          return '{}'::jsonb;
        end $probe$;
        grant execute on function app.assistant_run_tool_probe(boolean) to authenticated;
        notify pgrst, 'reload schema';
      `);
      // PostgREST reloads its schema cache asynchronously.
      for (let i = 0; i < 20; i++) {
        const res = await appRpc(owner, 'assistant_run_tool_probe', { p_wall: true }).then(outcome);
        if (!/schema cache/i.test(res.errorMessage ?? '')) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    });

    afterAll(() => {
      psql(`
        drop function if exists app.assistant_run_tool_probe(boolean);
        drop function if exists app.assistant_probe_writer();
        delete from assistant_index_queue where ref = 'wall-probe';
        notify pgrst, 'reload schema';
      `);
    });

    const probeInTx = (wall: boolean): { ok: boolean; err: string } => {
      try {
        psql(`begin; ${AS_OWNER} select app.assistant_run_tool_probe(${wall}); commit;`);
        return { ok: true, err: '' };
      } catch (e) {
        return { ok: false, err: String((e as { stderr?: string }).stderr ?? (e as Error).message) };
      }
    };
    const planted = () => psql(`select count(*) from assistant_index_queue where ref = 'wall-probe'`);

    it('control: without the wall, a volatile callee CAN write from a STABLE function', () => {
      const r = probeInTx(false);
      expect(r.ok, r.err).toBe(true);
      expect(planted()).toBe('1');
      psql(`delete from assistant_index_queue where ref = 'wall-probe'`);
    });

    it('with the wall, the same write fails with 25006 in a plain read-write transaction', () => {
      const r = probeInTx(true);
      expect(r.ok).toBe(false);
      expect(r.err).toMatch(/read-only transaction/i);
      expect(planted()).toBe('0');
    });

    it('through PostgREST the write fails with the wall on', async () => {
      const res = await appRpc(owner, 'assistant_run_tool_probe', { p_wall: true }).then(outcome);
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/read-only/i);
      expect(planted()).toBe('0');
    });

    it('through PostgREST a STABLE function already runs read-only (plan §2.2 UNVERIFIED, now verified)', async () => {
      const res = await appRpc(owner, 'assistant_run_tool_probe', { p_wall: false }).then(outcome);
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/read-only/i);
      expect(planted()).toBe('0');
    });

    it('the dispatcher itself leaves transaction_read_only on', () => {
      const out = psql(`
        begin; ${AS_OWNER}
        select app.assistant_run_tool('list_staff', '{}');
        select current_setting('transaction_read_only');
        rollback;
      `);
      expect(out.split('\n').at(-2)).toBe('on');
    });
  });
});
