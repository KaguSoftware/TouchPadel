/**
 * 0052 — the two venue-settings writers, exercised the way a client calls them.
 *
 * `app.set_opening_hours` (0013) and `app.set_waiter_call_cooldown` (0031) both
 * did a bare `update venue_settings set ...`. Supabase loads `safeupdate` on
 * PostgREST connections, so both were refused with "UPDATE requires a WHERE
 * clause" for every real caller, for their entire life — meaning SOW L319
 * ("Opening hours and closed days") could not be satisfied from the product at
 * all, and the waiter-call cooldown control never saved either.
 *
 * The reason no suite caught it is the reason this file exists: every other DB
 * test that touches venue_settings writes through the SERVICE ROLE, where
 * safeupdate is not loaded — the tests took the one path on which the bug does
 * not exist. Everything here goes through a signed-in staff client, i.e. through
 * PostgREST, i.e. through safeupdate.
 *
 * `packages/db/scripts/check-safe-update.mjs` is the structural half of this
 * guard, and was verified RED against the pre-fix bodies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0052 venue settings write through PostgREST', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  let original: {
    opening_hours: unknown;
    closed_dates: string[];
    waiter_call_cooldown_seconds: number;
  };

  async function readSettings() {
    const { data, error } = await svc
      .from('venue_settings')
      .select('opening_hours, closed_dates, waiter_call_cooldown_seconds')
      .single();
    if (error) throw new Error(error.message);
    return data as typeof original;
  }

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    original = await readSettings();
  });

  afterAll(async () => {
    // Restore exactly; other suites read these.
    await svc
      .from('venue_settings')
      .update({
        opening_hours: original.opening_hours,
        closed_dates: original.closed_dates,
        waiter_call_cooldown_seconds: original.waiter_call_cooldown_seconds,
      })
      .eq('id', true);
  });

  describe('set_opening_hours', () => {
    it('saves opening hours from a staff session', async () => {
      // The whole point: this call is the one that used to raise
      // "UPDATE requires a WHERE clause" every single time.
      const hours = { mon: [['08:00', '22:00']] };
      const res = await appRpc(manager, 'set_opening_hours', { p_opening_hours: hours });
      expect(res.error).toBeNull();
      expect((await readSettings()).opening_hours).toEqual(hours);
    });

    it('saves closed dates from a staff session', async () => {
      const res = await appRpc(manager, 'set_opening_hours', {
        p_closed_dates: ['2026-12-25', '2027-01-01'],
      });
      expect(res.error).toBeNull();
      expect((await readSettings()).closed_dates).toEqual(['2026-12-25', '2027-01-01']);
    });

    it('can clear the closed-date list, which is how a venue reopens', async () => {
      // Distinct from null: the RPC coalesces null to "leave unchanged", so
      // clearing has to send an empty array and get an empty array back.
      await appRpc(manager, 'set_opening_hours', { p_closed_dates: ['2026-12-25'] });
      const res = await appRpc(manager, 'set_opening_hours', { p_closed_dates: [] });
      expect(res.error).toBeNull();
      expect((await readSettings()).closed_dates).toEqual([]);
    });

    it('leaves the other column alone when only one is given', async () => {
      await appRpc(manager, 'set_opening_hours', {
        p_opening_hours: { tue: [['10:00', '20:00']] },
        p_closed_dates: ['2026-06-01'],
      });
      await appRpc(manager, 'set_opening_hours', { p_opening_hours: { wed: [['11:00', '21:00']] } });
      const after = await readSettings();
      expect(after.opening_hours).toEqual({ wed: [['11:00', '21:00']] });
      expect(after.closed_dates).toEqual(['2026-06-01']);
    });

    it('refuses a non-object hours payload', async () => {
      const res = await appRpc(manager, 'set_opening_hours', { p_opening_hours: [1, 2] });
      expect(res.error?.message).toBe('INVALID_HOURS');
    });

    it('is refused for a cashier and for an anonymous guest', async () => {
      expect(
        (await appRpc(cashier, 'set_opening_hours', { p_closed_dates: [] })).error?.message,
      ).toBe('FORBIDDEN');
      const guest = await anonymousSessionClient();
      expect((await appRpc(guest, 'set_opening_hours', { p_closed_dates: [] })).error?.message).toBe(
        'FORBIDDEN',
      );
    });

    it('audits the change with before and after', async () => {
      const { count: before } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'settings.opening_hours');
      await appRpc(manager, 'set_opening_hours', { p_closed_dates: ['2026-03-03'] });
      const { count: after } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'settings.opening_hours');
      expect((after ?? 0) - (before ?? 0)).toBe(1);
    });
  });

  describe('set_waiter_call_cooldown', () => {
    it('saves from a staff session', async () => {
      const res = await appRpc(manager, 'set_waiter_call_cooldown', { p_seconds: 180 });
      expect(res.error).toBeNull();
      expect((await readSettings()).waiter_call_cooldown_seconds).toBe(180);
    });

    it('keeps its range guard', async () => {
      expect(
        (await appRpc(manager, 'set_waiter_call_cooldown', { p_seconds: 10 })).error?.message,
      ).toBe('INVALID_COOLDOWN');
      expect(
        (await appRpc(manager, 'set_waiter_call_cooldown', { p_seconds: 601 })).error?.message,
      ).toBe('INVALID_COOLDOWN');
    });

    it('is refused for a cashier', async () => {
      const res = await appRpc(cashier, 'set_waiter_call_cooldown', { p_seconds: 120 });
      expect(res.error?.message).toBe('FORBIDDEN');
    });
  });
});
