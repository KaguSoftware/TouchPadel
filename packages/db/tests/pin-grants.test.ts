import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_PINS,
  SEED_STAFF,
  appRpc,
  createTestCafeTable,
  createTestMenuItem,
  ensureOpenDay,
  outcome,
  serviceClient,
  signedInClient,
  stackAvailable,
  testIdemKey,
} from './helpers';

/**
 * 0115 (S3) — the manager-PIN lockout engages on the money path.
 *
 * Before 0115 a wrong PIN passed straight into apply_discount / override_price /
 * refund / void_after_send / write_off_expired raised PIN_INVALID from the
 * caller, which rolled the just-inserted pin_attempts row back: unlimited
 * guesses, no lockout. Now the PIN is proved to app.verify_manager_pin on its
 * own (the attempt commits), which mints a single-use grant the money RPC
 * consumes. Without a grant the money RPC refuses PIN_GRANT_REQUIRED whatever
 * the PIN says — so it is not an oracle — and records nothing.
 *
 * `appRpc` (helpers.ts) verifies first like every production client; the RAW
 * calls below go through c.schema('app').rpc directly to hit the wall.
 */
const up = await stackAvailable();

const WRONG_PIN = '999999';

describe.skipIf(!up)('0115 manager-PIN grants (S3)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let managerId: string;
  let tabId: string;

  const raw = (c: SupabaseClient, fn: string, args: Record<string, unknown>) => c.schema('app').rpc(fn, args);

  async function attempts(): Promise<number> {
    const { data } = await svc.schema('app').from('pin_attempts').select('device_id');
    return (data ?? []).length;
  }

  async function grants(): Promise<{ consumed_at: string | null; authorizer_id: string }[]> {
    const { data } = await svc.schema('app').from('pin_grants').select('consumed_at, authorizer_id');
    return (data ?? []) as { consumed_at: string | null; authorizer_id: string }[];
  }

  async function clean(): Promise<void> {
    // .schema('app') is load-bearing (see pin-uniformity.test.ts): both tables
    // live in `app`, and a bare from() resolves to public and deletes nothing.
    await svc.schema('app').from('pin_attempts').delete().like('device_id', '%');
    await svc.schema('app').from('pin_grants').delete().gte('id', 0);
  }

  async function discount(c: SupabaseClient, pin: string) {
    return raw(c, 'apply_discount', {
      p_tab_id: tabId,
      p_kind: 'discount_percent',
      p_value: 500,
      p_pin: pin,
      p_reason_code: 'pin-grants-test',
      p_device_id: 'TILL-GRANT-TEST',
    }).then(outcome);
  }

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    const { data: me } = await manager.auth.getUser();
    managerId = me.user!.id;

    await ensureOpenDay(manager, svc);
    const tableId = await createTestCafeTable(svc, 'pin-grants');
    const item = await createTestMenuItem(svc, 'pin-grants-item', 5_000);
    const opened = await appRpc(cashier, 'open_tab', {
      p_table_id: tableId,
      p_label: 'pin-grants',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    if (!opened.ok) throw new Error(`seed open_tab failed: ${opened.errorMessage}`);
    tabId = (opened.data as { tab_id: string }).tab_id;
    const added = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 2 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    if (!added.ok) throw new Error(`seed till_add_items failed: ${added.errorMessage}`);
  });

  afterAll(async () => {
    await clean();
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  beforeEach(clean);

  it('refuses a money RPC with the CORRECT pin when nothing was verified first, and records no attempt', async () => {
    const res = await discount(manager, DEV_PINS.manager);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toBe('PIN_GRANT_REQUIRED');
    expect(await attempts()).toBe(0);
  });

  it('answers a WRONG pin at the money RPC identically — the money RPC is not an oracle', async () => {
    const bad = await discount(manager, WRONG_PIN);
    const good = await discount(manager, DEV_PINS.manager);
    expect(bad.errorMessage).toBe('PIN_GRANT_REQUIRED');
    expect(good.errorMessage).toBe('PIN_GRANT_REQUIRED');
    expect(await attempts()).toBe(0);
    expect(await grants()).toEqual([]);
  });

  it('verify then spend: the grant is consumed exactly once', async () => {
    const v = await raw(manager, 'verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: 'TILL-GRANT-TEST' }).then(outcome);
    expect(v.ok, v.errorMessage).toBe(true);
    expect(v.data).toBe(managerId);
    let g = await grants();
    expect(g).toHaveLength(1);
    expect(g[0]!.consumed_at).toBeNull();
    expect(g[0]!.authorizer_id).toBe(managerId);

    const first = await discount(manager, DEV_PINS.manager);
    expect(first.ok, first.errorMessage).toBe(true);
    g = await grants();
    expect(g[0]!.consumed_at).not.toBeNull();

    // Spent. A second money write needs a second verification.
    const second = await discount(manager, DEV_PINS.manager);
    expect(second.errorMessage).toBe('PIN_GRANT_REQUIRED');
  });

  it('a grant older than app.pin_grant_ttl() is dead', async () => {
    const v = await raw(manager, 'verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: 'TILL-GRANT-TEST' }).then(outcome);
    expect(v.ok, v.errorMessage).toBe(true);
    const stale = new Date(Date.now() - 3 * 60_000).toISOString();
    const upd = await svc.schema('app').from('pin_grants').update({ created_at: stale }).gte('id', 0);
    expect(upd.error).toBeNull();
    const res = await discount(manager, DEV_PINS.manager);
    expect(res.errorMessage).toBe('PIN_GRANT_REQUIRED');
  });

  it('a grant belongs to the session that typed the PIN, not to the manager whose PIN it was', async () => {
    // The cashier types the manager's PIN at the till: the grant is the cashier's.
    const v = await raw(cashier, 'verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: 'TILL-GRANT-TEST' }).then(outcome);
    expect(v.ok, v.errorMessage).toBe(true);
    // The manager's own session holds no grant.
    const other = await discount(manager, DEV_PINS.manager);
    expect(other.errorMessage).toBe('PIN_GRANT_REQUIRED');
    // The cashier's does.
    const mine = await discount(cashier, DEV_PINS.manager);
    expect(mine.ok, mine.errorMessage).toBe(true);
  });

  it('wrong PINs through the helper (verify first, like the till) are counted and lock out at five', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await appRpc(cashier, 'apply_discount', {
        p_tab_id: tabId, p_kind: 'discount_percent', p_value: 500, p_pin: WRONG_PIN,
        p_reason_code: 'pin-grants-test', p_device_id: 'TILL-GRANT-TEST',
      }).then(outcome);
      expect(r.errorMessage).toBe('PIN_INVALID');
    }
    expect(await attempts()).toBe(5);
    const sixth = await appRpc(cashier, 'apply_discount', {
      p_tab_id: tabId, p_kind: 'discount_percent', p_value: 500, p_pin: DEV_PINS.manager,
      p_reason_code: 'pin-grants-test', p_device_id: 'TILL-GRANT-TEST',
    }).then(outcome);
    // Even the CORRECT pin is refused while locked — that is the lockout engaging on the money path.
    expect(sixth.errorMessage).toBe('PIN_LOCKED');
    expect(await grants()).toEqual([]);
  });

  it('the helper path succeeds end to end with the correct pin and leaves a consumed grant', async () => {
    const r = await appRpc(manager, 'apply_discount', {
      p_tab_id: tabId, p_kind: 'discount_percent', p_value: 500, p_pin: DEV_PINS.manager,
      p_reason_code: 'pin-grants-test', p_device_id: 'TILL-GRANT-TEST',
    }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    const g = await grants();
    expect(g).toHaveLength(1);
    expect(g[0]!.consumed_at).not.toBeNull();
  });

  it('consume_pin_grant is not client-callable', async () => {
    const r = await raw(manager, 'consume_pin_grant', { p_device_id: 'TILL-GRANT-TEST' }).then(outcome);
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/permission denied|PGRST202|not find/i);
  });
});
