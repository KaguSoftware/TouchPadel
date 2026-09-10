/**
 * SEC-13 (0078) — the staff PIN floor.
 *
 * A PIN here is not a login: it is the MANAGER AUTHORISATION on the money paths.
 * `override_price`, `void_after_send`, `write_off_expired` and the refund flow
 * all take `p_pin` and call `verify_manager_pin` before they will move a price,
 * void a sent item or write off stock. It is what stands between a cashier alone
 * at the till and an unlogged discount.
 *
 * 0078 raised it from 4 digits to 6 and refused the three shapes a person
 * actually picks when told "six digits".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  SEED_STAFF,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0078 staff PIN strength (SEC-13)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let staffId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const email = `pinstrength-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: 'touch-dev-password',
      email_confirm: true,
      user_metadata: { full_name: 'PIN Strength Target' },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    staffId = data.user.id;
    const { error: insErr } = await svc
      .from('staff')
      .insert({ id: staffId, display_name: 'PIN Strength Target', role: 'manager', is_active: true });
    if (insErr) throw new Error(`staff insert: ${insErr.message}`);
  });

  afterAll(async () => {
    await svc.from('staff').delete().eq('id', staffId);
    await svc.auth.admin.deleteUser(staffId).catch(() => undefined);
    await owner.auth.signOut();
  });

  const set = (pin: string) =>
    appRpc(owner, 'set_staff_pin', { p_staff_id: staffId, p_pin: pin }).then(outcome);

  it('refuses anything shorter than six digits — the old 4-digit floor is gone', async () => {
    for (const pin of ['4321', '12345', '1', '']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be refused`).toBe(false);
      expect(res.errorMessage).toMatch(/PIN_FORMAT/);
    }
  });

  it('refuses non-digits', async () => {
    for (const pin of ['12345a', 'abcdef', '123 456', '12-3456']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be refused`).toBe(false);
      expect(res.errorMessage).toMatch(/PIN_FORMAT/);
    }
  });

  /**
   * Six digits that are worth about two. 21 PINs out of a million — a rounding
   * error against the keyspace, and the ones anyone would guess first.
   */
  it('refuses a repeated digit', async () => {
    for (const pin of ['000000', '111111', '222222', '999999']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be refused`).toBe(false);
      expect(res.errorMessage).toMatch(/PIN_WEAK/);
    }
  });

  it('refuses a sequential run in either direction', async () => {
    for (const pin of ['123456', '234567', '345678', '567890', '654321', '098765']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be refused`).toBe(false);
      expect(res.errorMessage).toMatch(/PIN_WEAK/);
    }
  });

  it('accepts a real six-digit PIN, and a longer one', async () => {
    for (const pin of ['719264', '380517', '482913', '9047163852']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be accepted: ${res.errorMessage}`).toBe(true);
    }
  });

  /**
   * Documented non-goals. A rule that refuses a PIN the user believes is fine,
   * with no way to explain why, trains people to write the PIN down — which is
   * a worse outcome than 191919.
   */
  it('deliberately allows repeated pairs and non-runs — see the 0078 header', async () => {
    for (const pin of ['121212', '191919', '890123']) {
      const res = await set(pin);
      expect(res.ok, `${pin} should be allowed: ${res.errorMessage}`).toBe(true);
    }
  });

  it('still refuses a non-owner, before it looks at the PIN at all', async () => {
    const manager = await signedInClient(SEED_STAFF.manager);
    const res = await appRpc(manager, 'set_staff_pin', {
      p_staff_id: staffId,
      p_pin: '482913',
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });

  /**
   * The seeded PINs must satisfy the rule they exist to demonstrate. seed.sql
   * writes pin_hash through crypt() directly, so a weak seed would keep WORKING
   * while being unsettable through the product — the exact divergence between
   * the dev environment and the shipped rule that hides bugs.
   */
  it('the seeded dev PINs would themselves pass set_staff_pin', async () => {
    for (const pin of [DEV_PINS.owner, DEV_PINS.manager]) {
      expect(pin).toMatch(/^[0-9]{6,12}$/);
      const res = await set(pin);
      expect(res.ok, `seeded PIN ${pin} is refused by the product: ${res.errorMessage}`).toBe(true);
    }
  });
});
