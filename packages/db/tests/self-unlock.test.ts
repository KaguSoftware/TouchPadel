/**
 * 0087 — SEC-34, the self-unlock gap.
 *
 * The idle lock asks the signed-in person for their own PIN, but PINs are only
 * ever set on manager and owner accounts: the cashier who actually works the
 * till has none. Until this migration the screen could not know that, so it
 * showed everybody a PIN box and only offered the password AFTER a wrong guess.
 *
 * `app.has_own_pin()` is the whole fix on the server side, and the properties
 * that matter are the ones a wrong implementation would still appear to
 * satisfy: it must answer about the CALLER and nobody else, and it must give a
 * plain `false` — never a refusal, never a NULL — to everyone who has no PIN,
 * including callers who are not staff at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0087 has_own_pin (SEC-34)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    await owner.auth.signOut();
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  it('is true for the seeded manager and owner, who have PINs', async () => {
    expect((await appRpc(owner, 'has_own_pin', {})).data).toBe(true);
    expect((await appRpc(manager, 'has_own_pin', {})).data).toBe(true);
  });

  it('is FALSE for the cashier — the whole reason SEC-34 exists', async () => {
    // Not an error, not null: a plain false the lock screen can branch on.
    const res = await appRpc(cashier, 'has_own_pin', {});
    expect(res.error).toBeNull();
    expect(res.data).toBe(false);
  });

  it('answers false rather than refusing for a guest and for anon', async () => {
    // A refusal would force the client to treat "not staff" and "no PIN"
    // differently for no benefit; both mean the same thing to the caller.
    const guest = await anonymousSessionClient();
    try {
      const asGuest = await appRpc(guest, 'has_own_pin', {});
      expect(asGuest.error).toBeNull();
      expect(asGuest.data).toBe(false);
    } finally {
      await guest.auth.signOut();
    }
    const asAnon = await appRpc(anonClient(), 'has_own_pin', {});
    expect(asAnon.error).toBeNull();
    expect(asAnon.data).toBe(false);
  });

  it('takes no argument, so it cannot be pointed at another account', async () => {
    // The property that makes it safe for `publicByDesign`. PostgREST resolves
    // a function by its argument names; a call carrying one does not match the
    // zero-argument signature at all.
    const probe = outcome(await appRpc(cashier, 'has_own_pin', { p_staff_id: SEED_STAFF_IDS.owner }));
    expect(probe.ok).toBe(false);
    // And the zero-arg call still answers about the CALLER, not the owner.
    expect((await appRpc(cashier, 'has_own_pin', {})).data).toBe(false);
  });

  it('follows the PIN: false once it is cleared, true once it is set again', async () => {
    // Proves it reads the live column rather than the role. A version that
    // returned `role in ('manager','owner')` would pass every test above.
    const email = `selfunlock-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: 'touch-dev-password',
      email_confirm: true,
      user_metadata: { full_name: 'Self Unlock Target' },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    const staffId = data.user.id;
    try {
      const { error: insErr } = await svc
        .from('staff')
        .insert({ id: staffId, display_name: 'Self Unlock Target', role: 'manager', is_active: true });
      if (insErr) throw new Error(`staff insert: ${insErr.message}`);
      const target = await signedInClient(email);
      try {
        // A manager with NO pin — the case a role-based implementation misses.
        expect((await appRpc(target, 'has_own_pin', {})).data).toBe(false);

        await appRpc(owner, 'set_staff_pin', { p_staff_id: staffId, p_pin: '481937' });
        expect((await appRpc(target, 'has_own_pin', {})).data).toBe(true);

        await appRpc(owner, 'clear_staff_pin', { p_staff_id: staffId });
        expect((await appRpc(target, 'has_own_pin', {})).data).toBe(false);
      } finally {
        await target.auth.signOut();
      }
    } finally {
      await svc.from('staff').delete().eq('id', staffId);
      await svc.auth.admin.deleteUser(staffId).catch(() => undefined);
    }
  });

  it('is false for a DEACTIVATED staff member who still has a pin_hash', async () => {
    // `is_active` is in the predicate on purpose: a leaver must not be told
    // their PIN still exists, and the lock screen must route them to the
    // password rather than a PIN their session can no longer use anyway.
    const email = `selfunlock-inactive-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: 'touch-dev-password',
      email_confirm: true,
      user_metadata: { full_name: 'Inactive Target' },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    const staffId = data.user.id;
    try {
      await svc
        .from('staff')
        .insert({ id: staffId, display_name: 'Inactive Target', role: 'manager', is_active: true });
      await appRpc(owner, 'set_staff_pin', { p_staff_id: staffId, p_pin: '481937' });
      const target = await signedInClient(email);
      try {
        expect((await appRpc(target, 'has_own_pin', {})).data).toBe(true);
        // Deactivate directly: set_staff_active also revokes the session (0081),
        // which would end this client before it could ask.
        await svc.from('staff').update({ is_active: false }).eq('id', staffId);
        expect((await appRpc(target, 'has_own_pin', {})).data).toBe(false);
      } finally {
        await target.auth.signOut();
      }
    } finally {
      await svc.from('staff').delete().eq('id', staffId);
      await svc.auth.admin.deleteUser(staffId).catch(() => undefined);
    }
  });
});
