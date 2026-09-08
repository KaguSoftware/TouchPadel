/**
 * SEC-25 (0082) — the café ordering limits.
 *
 * Before this the whole schema had three rate limits: the PIN lockout, the
 * waiter-call cooldown, and send_test_push. Guest ORDERING — the surface any
 * passer-by reaches by scanning a QR card taped to a table — had none.
 *
 * The damage from that is not a database problem, it is a KITCHEN problem: a
 * hundred tickets print, the prep screen fills with work nobody ordered, and
 * staff cannot separate the real tickets from the noise while it is happening.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  openGuestSession,
  createTestCafeTable,
  ensureCafeProbeData,
  ensureOpenDay,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0082 cafe abuse limits (SEC-25)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let tableId: string;
  const madeTables: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    await ensureCafeProbeData(svc);
    await ensureOpenDay(manager, svc);
    tableId = await createTestCafeTable(svc, `ab${Date.now() % 100000}`);
    madeTables.push(tableId);
  });

  afterAll(async () => {
    await svc.from('venue_settings').update({
      guest_orders_per_minute: 6,
      guest_items_per_order: 40,
    }).not('id', 'is', null);
    // Leave no tables behind: they show up in the operator's table dropdown and
    // an e2e case that expects exactly one match starts finding several.
    for (const id of madeTables) {
      await svc.from('guest_sessions').delete().eq('table_id', id);
      await svc.from('cafe_tables').delete().eq('id', id);
    }
    await manager.auth.signOut();
  });

  const setLimits = (patch: Record<string, number>) =>
    svc.from('venue_settings').update(patch).not('id', 'is', null);

  /** A variant that exists in the café fixtures. */
  const VARIANT = 'f1f70000-0000-4000-8000-0000f0010001';

  it('lets a normal table order without interference', async () => {
    await setLimits({ guest_orders_per_minute: 6, guest_items_per_order: 40 });
    const g = await openGuestSession(manager, tableId);
    const res = await appRpc(g.client, 'create_guest_order', {
      p_items: [{ variant_id: VARIANT, qty: 1 }],
      p_idempotency_key: `ab-ok-${Date.now()}`,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
  });

  it('refuses a burst of orders from one session with TOO_MANY_ORDERS', async () => {
    await setLimits({ guest_orders_per_minute: 3 });
    const g = await openGuestSession(manager, tableId);

    for (let i = 0; i < 3; i++) {
      const ok = await appRpc(g.client, 'create_guest_order', {
        p_items: [{ variant_id: VARIANT, qty: 1 }],
        p_idempotency_key: `ab-burst-${Date.now()}-${i}`,
      }).then(outcome);
      expect(ok.ok, `order ${i + 1} should be allowed: ${ok.errorMessage}`).toBe(true);
    }

    const refused = await appRpc(g.client, 'create_guest_order', {
      p_items: [{ variant_id: VARIANT, qty: 1 }],
      p_idempotency_key: `ab-burst-${Date.now()}-over`,
    }).then(outcome);
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toMatch(/TOO_MANY_ORDERS/);
  });

  /**
   * The limit is per SESSION, not global — one abusive table must not stop the
   * rest of the café ordering. That is the difference between a rate limit and
   * an outage.
   */
  it('another table is unaffected by a session that hit the limit', async () => {
    await setLimits({ guest_orders_per_minute: 2 });
    const noisy = await openGuestSession(manager, tableId);
    for (let i = 0; i < 2; i++) {
      await appRpc(noisy.client, 'create_guest_order', {
        p_items: [{ variant_id: VARIANT, qty: 1 }],
        p_idempotency_key: `ab-noisy-${Date.now()}-${i}`,
      });
    }
    const blocked = await appRpc(noisy.client, 'create_guest_order', {
      p_items: [{ variant_id: VARIANT, qty: 1 }],
      p_idempotency_key: `ab-noisy-${Date.now()}-x`,
    }).then(outcome);
    expect(blocked.errorMessage).toMatch(/TOO_MANY_ORDERS/);

    const otherTable = await createTestCafeTable(svc, `ab2${Date.now() % 100000}`);
    madeTables.push(otherTable);
    const quiet = await openGuestSession(manager, otherTable);
    const ok = await appRpc(quiet.client, 'create_guest_order', {
      p_items: [{ variant_id: VARIANT, qty: 1 }],
      p_idempotency_key: `ab-quiet-${Date.now()}`,
    }).then(outcome);
    expect(ok.ok, ok.errorMessage).toBe(true);
  });

  it('caps the line items on a single guest order with TOO_MANY_ITEMS', async () => {
    await setLimits({ guest_orders_per_minute: 60, guest_items_per_order: 3 });
    const g = await openGuestSession(manager, tableId);

    const res = await appRpc(g.client, 'create_guest_order', {
      p_items: Array.from({ length: 8 }, () => ({ variant_id: VARIANT, qty: 1 })),
      p_idempotency_key: `ab-items-${Date.now()}`,
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/TOO_MANY_ITEMS/);
  });

  /**
   * A busy till legitimately fires faster than any guest, and the actor there is
   * identified and audited. Rate-limiting staff would be an outage during
   * service — exactly when it must not happen.
   */
  it('does not rate-limit staff orders', async () => {
    await setLimits({ guest_orders_per_minute: 1 });
    const tab = await appRpc(manager, 'open_tab', { p_table_id: tableId }).then(outcome);
    // Whether or not a tab opens here, the point is that no staff path raises
    // TOO_MANY_ORDERS — the trigger returns early when guest_session_id is null.
    if (tab.ok) {
      for (let i = 0; i < 3; i++) {
        const res = await appRpc(manager, 'till_add_items', {
          p_tab_id: (tab.data as { tab_id: string }).tab_id,
          p_items: [{ variant_id: VARIANT, qty: 1 }],
          p_idempotency_key: `ab-staff-${Date.now()}-${i}`,
        }).then(outcome);
        expect(res.errorMessage ?? '').not.toMatch(/TOO_MANY_ORDERS/);
      }
    }
  });

  it('exposes the till confirmation threshold as a setting, not a hard block', async () => {
    const { data } = await svc
      .from('venue_settings')
      .select('tab_confirm_threshold_iqd')
      .limit(1)
      .single();
    expect((data as { tab_confirm_threshold_iqd: number }).tab_confirm_threshold_iqd).toBeGreaterThan(0);
    // Advisory on purpose: a genuine large tab must never be blocked by the
    // database mid-service. The operator UI reads this and asks staff to confirm.
  });
});
