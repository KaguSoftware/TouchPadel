/**
 * RLS role-matrix runner — executes the declarative matrix in rls-matrix.ts
 * against 8 real principals through PostgREST/GoTrue (module 1 acceptance:
 * "confirmed by a written role test").
 *
 * Extending: later drops append rules to rls-matrix.ts; this runner needs no
 * changes unless a new table requires a bespoke probe row or update filter.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  guestClient,
  ensureTestRateRule,
  createTestCourt,
  ensureCafeProbeData,
  ensureCustomerProbeData,
  ensurePromotionProbeData,
  ensureTillFresh,
  appRpc,
  SEED_STAFF,
  DEV_PINS,
} from './helpers';
import {
  matrix,
  PRINCIPALS,
  type Principal,
  type MatrixRule,
  type SelectRule,
  type WriteRule,
  type RpcRule,
} from './rls-matrix';

const up = await stackAvailable();

type PgError = { code?: string; message: string } | null;

function isPermissionDenied(error: PgError): boolean {
  return !!error && (error.code === '42501' || /permission denied/i.test(error.message));
}
function isGuarded(error: PgError): boolean {
  // SESSION_EXPIRED joins in drop 2: guest-session-bound RPCs refuse callers
  // without a live table session at the guard layer (0014 touch_guest_session).
  return !!error && /(FORBIDDEN|AUTH_REQUIRED|ACCOUNT_REQUIRED|SESSION_EXPIRED)/.test(error.message);
}

/** update/delete need a PostgREST filter; harmless per-table primary-key filters. */
const WRITE_FILTERS: Record<string, [string, unknown]> = {
  venue_settings: ['id', true],
  rate_rule_prices: ['rule_id', '00000000-0000-4000-8000-000000000000'],
  audit_log: ['id', -1],
  stock_movements: ['id', -1],
  notification_outbox: ['id', -1],
  // drop 4 (0027–0034)
  telegram_outbox: ['id', -1],
  telegram_actions: ['id', -1],
  cafe_settings: ['key', '__none__'],
  menu_item_costs: ['item_id', '00000000-0000-4000-8000-000000000000'],
  // drop 5 (0065) — customer_flags has a composite pk, no `id`
  customer_flags: ['customer_id', '00000000-0000-4000-8000-000000000000'],
};

describe.skipIf(!up)('RLS role matrix (drops 1-5: 0004-0021 + 0024 + 0027-0034 + 0065 surface)', () => {
  const clients = {} as Record<Principal, SupabaseClient>;
  let svc: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();

    // Probe data every 'rows' expectation can rely on.
    await ensureTestRateRule(svc);
    await ensureCafeProbeData(svc); // drop 2+3 probe rows (ee57 prefix)
    await ensureCustomerProbeData(svc); // drop 5 (0065) probe note + flag
    await ensurePromotionProbeData(svc); // drop 5 (0067) disabled probe promotion + redemption
    await ensureTillFresh(svc); // degraded mode would corrupt guest-RPC guard outcomes
    const probeCourt = await createTestCourt(svc, 'RLS-probe');
    const { error: resErr } = await svc.from('reservations').insert({
      court_id: probeCourt,
      kind: 'booking',
      status: 'confirmed',
      start_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      end_at: new Date(Date.now() + 30 * 24 * 3600_000 + 3600_000).toISOString(),
      source: 'desk',
      guest_name: 'RLS Probe',
    });
    if (resErr) throw new Error(`probe reservation failed: ${resErr.message}`);
    // drop 5 (0066): a series belonging to no guest, for the reservation_series row.
    const { error: seriesErr } = await svc.from('reservation_series').insert({
      court_id: probeCourt,
      pattern: 'weekly',
      start_time: '10:00',
      duration_min: 60,
      starts_on: '2001-01-01',
      ends_on: '2001-01-01',
      guest_name: 'RLS Probe',
    });
    if (seriesErr) throw new Error(`probe series failed: ${seriesErr.message}`);
    const { error: auditErr } = await svc.from('audit_log').insert({
      action: 'test.probe',
      entity: 'rls-matrix',
      entity_id: 'probe',
    });
    if (auditErr) throw new Error(`probe audit row failed: ${auditErr.message}`);

    clients.anon = anonClient();
    clients.guest_account = await guestClient(svc, 'rls');
    clients.guest_anon_session = await anonymousSessionClient();
    clients.cashier = await signedInClient(SEED_STAFF.cashier);
    clients.prep = await signedInClient(SEED_STAFF.prep);
    clients.court_desk = await signedInClient(SEED_STAFF.court_desk);
    clients.manager = await signedInClient(SEED_STAFF.manager);
    clients.owner = await signedInClient(SEED_STAFF.owner);
  });

  async function runSelect(rule: SelectRule, p: Principal): Promise<string | null> {
    const { data, error } = await clients[p]
      .from(rule.name)
      .select(rule.columns ?? '*')
      .limit(5);
    const want = rule.expect[p];
    const got = error ? 'denied' : (data?.length ?? 0) > 0 ? 'rows' : 'silence';
    return got === want
      ? null
      : `select ${rule.name}${rule.columns ? `(${rule.columns})` : ''} as ${p}: want ${want}, got ${got}` +
          (error ? ` (${error.message})` : '');
  }

  async function runWrite(rule: WriteRule, p: Principal): Promise<string | null> {
    const table = clients[p].from(rule.name);
    const filter = WRITE_FILTERS[rule.name] ?? ['id', '00000000-0000-4000-8000-000000000000'];
    let error: PgError = null;
    if (rule.op === 'insert') {
      ({ error } = await table.insert(rule.payload ?? {}));
    } else if (rule.op === 'update') {
      ({ error } = await table.update(rule.payload ?? {}).eq(filter[0], filter[1] as never));
    } else {
      ({ error } = await table.delete().eq(filter[0], filter[1] as never));
    }
    const want = rule.expect[p];
    const got = error ? 'denied' : 'allowed';
    return got === want ? null : `${rule.op} ${rule.name} as ${p}: want ${want}, got ${got}`;
  }

  async function runRpc(rule: RpcRule, p: Principal): Promise<string | null> {
    const { error } = await appRpc(clients[p], rule.name, rule.args);
    const want = rule.expect[p];
    const got = isPermissionDenied(error)
      ? 'denied'
      : isGuarded(error)
        ? 'guarded'
        : 'execute'; // ok, or a business-validation error past the guard layer
    return got === want
      ? null
      : `rpc app.${rule.name} as ${p}: want ${want}, got ${got}` +
          (error ? ` (${error.message})` : '');
  }

  for (const rule of matrix) {
    const label =
      rule.kind === 'rpc'
        ? `rpc app.${rule.name}`
        : rule.kind === 'select'
          ? `select ${rule.name}${(rule as SelectRule).columns ? ` [${(rule as SelectRule).columns}]` : ''}`
          : `${(rule as WriteRule).op} ${rule.name}`;

    it(`${label} — all 8 principals match the matrix`, async () => {
      const failures: string[] = [];
      for (const p of PRINCIPALS) {
        const failure =
          rule.kind === 'select'
            ? await runSelect(rule, p)
            : rule.kind === 'write'
              ? await runWrite(rule as WriteRule, p)
              : await runRpc(rule as RpcRule, p);
        if (failure) failures.push(failure);
      }
      expect(failures, failures.join('\n')).toHaveLength(0);
    });
  }

  // ── Stateful named cases the declarative matrix cannot express ────────────

  it('verify_manager_pin: correct PIN returns authorizer; wrong PIN -> null; 6th attempt -> PIN_LOCKED', async () => {
    const device = `TEST-PIN-${Date.now()}`;

    // The 0026 rekey counts failures per CALLER (not per client device id), so
    // this test's own failures from a rerun < 5 minutes ago would still lock
    // the cashier. pin_attempts is throwaway telemetry — clear the cashier's
    // window first (composite key '{uid}:{device}').
    const cashierUid = (await clients.cashier.auth.getUser()).data.user!.id;
    const { error: clearErr } = await svc
      .schema('app')
      .from('pin_attempts')
      .delete()
      .like('device_id', `${cashierUid}:%`);
    expect(clearErr).toBeNull();

    const good = await appRpc(clients.cashier, 'verify_manager_pin', {
      p_pin: DEV_PINS.manager,
      p_device_id: device,
    });
    expect(good.error).toBeNull();
    expect(typeof good.data).toBe('string'); // authorizer staff uuid

    for (let i = 0; i < 5; i++) {
      const bad = await appRpc(clients.cashier, 'verify_manager_pin', {
        p_pin: '000000',
        p_device_id: device,
      });
      // Invalid PIN returns NULL (no raise) so the attempt row persists and the
      // lockout can engage — see migration 0011.
      expect(bad.error).toBeNull();
      expect(bad.data).toBeNull();
    }
    const locked = await appRpc(clients.cashier, 'verify_manager_pin', {
      p_pin: DEV_PINS.manager, // even the RIGHT pin is refused while locked
      p_device_id: device,
    });
    expect(locked.error?.message).toContain('PIN_LOCKED');
  });

  it('guest cannot cancel another guest reservation; owner of a hold can read it back', async () => {
    const court = await createTestCourt(svc, 'RLS-own');
    const start = new Date(Date.now() + 21 * 24 * 3600_000);
    start.setUTCHours(9, 0, 0, 0);

    const held = await appRpc(clients.guest_account, 'hold_slot', {
      p_court_id: court,
      p_start_at: start.toISOString(),
      p_duration_min: 60,
    });
    expect(held.error).toBeNull();
    const resId = (held.data as { reservation_id: string }).reservation_id;

    // The holder sees their own row…
    const own = await clients.guest_account
      .from('reservations')
      .select('id')
      .eq('id', resId);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    // …another guest gets RLS silence on read and FORBIDDEN on cancel.
    const other = await anonymousSessionClient();
    const peek = await other.from('reservations').select('id').eq('id', resId);
    expect(peek.error).toBeNull();
    expect(peek.data).toHaveLength(0);
    const cancel = await appRpc(other, 'cancel_reservation', { p_reservation_id: resId });
    expect(cancel.error?.message).toContain('FORBIDDEN');
  });

  it('guest cancel inside the cancellation window is refused; staff cancel succeeds', async () => {
    const court = await createTestCourt(svc, 'RLS-window');
    const start = new Date(Date.now() + 2 * 3600_000); // 2h out < 12h window
    const guestId = (await clients.guest_account.auth.getUser()).data.user!.id;

    const { data: res, error } = await svc
      .from('reservations')
      .insert({
        court_id: court,
        kind: 'booking',
        status: 'confirmed',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 3600_000).toISOString(),
        source: 'mobile',
        guest_id: guestId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const resId = (res as { id: string }).id;

    const guestCancel = await appRpc(clients.guest_account, 'cancel_reservation', {
      p_reservation_id: resId,
    });
    expect(guestCancel.error?.message).toContain('CANCELLATION_WINDOW');

    const staffCancel = await appRpc(clients.court_desk, 'cancel_reservation', {
      p_reservation_id: resId,
      p_reason: 'guest called the desk',
    });
    expect(staffCancel.error).toBeNull();
  });
});
