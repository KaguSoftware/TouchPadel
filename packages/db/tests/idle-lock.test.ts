/**
 * 0064 — verify_own_pin (the idle-lock unlock) + the till_idle_lock_seconds
 * setting. Self-scoped, rate-limited, staff-only; NO_PIN_SET routes the client
 * to password re-auth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0064 idle lock', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let owner: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    owner = await signedInClient(SEED_STAFF.owner);
    // Clear this suite's rate-limit residue from prior runs.
    await svc.from('pin_attempts').delete().like('device_id', '%:self:%');
  });

  afterAll(async () => {
    await manager.auth.signOut();
    await owner.auth.signOut();
  });

  it('accepts the caller’s OWN pin and refuses a colleague’s', async () => {
    const own = await appRpc(manager, 'verify_own_pin', { p_pin: DEV_PINS.manager });
    expect(own.error).toBeNull();
    expect(own.data).toBe(true);

    // The owner's pin is valid in the venue — but not for THIS caller.
    const cross = await appRpc(manager, 'verify_own_pin', { p_pin: DEV_PINS.owner });
    expect(cross.error).toBeNull();
    expect(cross.data).toBe(false);
  });

  it('locks after five failures inside five minutes, per caller', async () => {
    for (let i = 0; i < 5; i++) {
      await appRpc(owner, 'verify_own_pin', { p_pin: '000000', p_device_id: `D${i}` });
    }
    const locked = outcome(await appRpc(owner, 'verify_own_pin', { p_pin: DEV_PINS.owner }));
    expect(locked.errorMessage).toContain('PIN_LOCKED');
    // The manager is unaffected — the limiter keys on the caller.
    const other = await appRpc(manager, 'verify_own_pin', { p_pin: DEV_PINS.manager });
    expect(other.data).toBe(true);
    await svc.from('pin_attempts').delete().like('device_id', '%:self:%');
  });

  it('refuses anonymous sessions and names NO_PIN_SET for pin-less staff', async () => {
    const anon = await anonymousSessionClient();
    try {
      const denied = outcome(await appRpc(anon, 'verify_own_pin', { p_pin: '1234' }));
      expect(denied.errorMessage).toContain('FORBIDDEN');
    } finally {
      await anon.auth.signOut();
    }

    // The seeded cashier has no pin_hash.
    const cashier = await signedInClient(SEED_STAFF.cashier);
    try {
      const res = outcome(await appRpc(cashier, 'verify_own_pin', { p_pin: '1234' }));
      expect(res.errorMessage).toContain('NO_PIN_SET');
    } finally {
      await cashier.auth.signOut();
    }
  });

  it('till_idle_lock_seconds is a registered, range-validated manager setting', async () => {
    // cafe_setting_specs itself is internal (not granted); the registration is
    // proven through the write surface it powers.
    const set = await appRpc(manager, 'set_cafe_setting', {
      p_key: 'till_idle_lock_seconds',
      p_value: 120,
    });
    expect(set.error).toBeNull();
    const { data } = await svc
      .from('cafe_settings')
      .select('value')
      .eq('key', 'till_idle_lock_seconds')
      .single();
    expect((data as { value: number }).value).toBe(120);

    const bad = outcome(
      await appRpc(manager, 'set_cafe_setting', { p_key: 'till_idle_lock_seconds', p_value: 9999 }),
    );
    expect(bad.errorMessage).toContain('INVALID_SETTING_VALUE');
    await appRpc(manager, 'set_cafe_setting', { p_key: 'till_idle_lock_seconds', p_value: 300 });
  });
});
