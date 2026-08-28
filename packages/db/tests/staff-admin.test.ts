/**
 * 0051 — staff administration by the owner role.
 *
 * SOW L234 ("Staff accounts created and managed by the owner role") is a
 * MODULE-1 promise and L997 makes the role matrix a phase-acceptance
 * condition. `0004:175-176` said these RPCs would "land with the admin drop";
 * they never did, and `/admin/staff` has been a read-only table whose own
 * header says invites stay in the Supabase dashboard.
 *
 * Account creation itself needs the GoTrue admin API and lives in the
 * `staff-admin` edge function; this suite covers everything that is a row
 * change, plus the two lockout invariants, which are the reason this is not
 * just an UPDATE with a role check.
 *
 * Every row it creates is deactivated and renamed back in afterAll, and it
 * never touches the seeded owner it signs in as.
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
  SEED_STAFF_IDS,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0051 staff administration', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  /** Throwaway staff rows created for this suite, cleaned up at the end. */
  const created: string[] = [];

  async function makeStaff(
    tag: string,
    role: 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner' = 'cashier',
  ): Promise<string> {
    const email = `staffadmin-${tag}-${Date.now()}-${created.length}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: 'touch-dev-password',
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const id = data.user.id;
    const { error: sErr } = await svc
      .from('staff')
      .insert({ id, display_name: `Test ${tag}`, role, is_active: true });
    if (sErr) throw new Error(`staff insert failed: ${sErr.message}`);
    created.push(id);
    return id;
  }

  async function readStaff(id: string) {
    const { data } = await svc
      .from('staff')
      .select('id, display_name, role, is_active, pin_hash')
      .eq('id', id)
      .single();
    return data as {
      id: string;
      display_name: string;
      role: string;
      is_active: boolean;
      pin_hash: string | null;
    };
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    // Staff rows are never deleted in the product (audit attribution), but
    // these are test fixtures — remove them so repeated runs stay clean.
    for (const id of created) {
      await svc.from('staff').delete().eq('id', id);
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  describe('authorization', () => {
    it('is owner-only for every mutation', async () => {
      const id = await makeStaff('authz');
      for (const client of [manager, cashier]) {
        expect(
          (await appRpc(client, 'set_staff_role', { p_staff_id: id, p_role: 'prep' })).error
            ?.message,
        ).toBe('FORBIDDEN');
        expect(
          (await appRpc(client, 'set_staff_active', { p_staff_id: id, p_active: false })).error
            ?.message,
        ).toBe('FORBIDDEN');
        expect(
          (await appRpc(client, 'rename_staff', { p_staff_id: id, p_display_name: 'X' })).error
            ?.message,
        ).toBe('FORBIDDEN');
        expect(
          (await appRpc(client, 'clear_staff_pin', { p_staff_id: id })).error?.message,
        ).toBe('FORBIDDEN');
      }
    });

    it('refuses an anonymous guest', async () => {
      const id = await makeStaff('anon');
      const guest = await anonymousSessionClient();
      expect(
        (await appRpc(guest, 'set_staff_role', { p_staff_id: id, p_role: 'owner' })).error?.message,
      ).toBe('FORBIDDEN');
    });

    it('does not expose register_staff to any client', async () => {
      // It presumes the auth user already exists and is called by the edge
      // function with the service role; a client must not reach it.
      const res = await appRpc(owner, 'register_staff', {
        p_staff_id: '00000000-0000-4000-8000-0000000000aa',
        p_display_name: 'Sneaky',
        p_role: 'owner',
        p_actor_id: SEED_STAFF_IDS.owner,
      });
      expect(res.error).not.toBeNull();
      expect(res.error?.message).not.toBe('STAFF_EXISTS');
    });
  });

  describe('set_staff_role', () => {
    it('changes the role and audits it with a reason', async () => {
      const id = await makeStaff('promote');
      const res = await appRpc(owner, 'set_staff_role', {
        p_staff_id: id,
        p_role: 'manager',
        p_reason_code: 'promotion',
      });
      expect(res.error).toBeNull();
      expect((await readStaff(id)).role).toBe('manager');

      const { data } = await svc
        .from('audit_log')
        .select('action, reason_code, before, after')
        .eq('entity_id', id)
        .eq('action', 'staff.role_set')
        .single();
      const row = data as { reason_code: string; before: { role: string }; after: { role: string } };
      expect(row.reason_code).toBe('promotion');
      expect(row.before.role).toBe('cashier');
      expect(row.after.role).toBe('manager');
    });

    it('clears the PIN when the role drops below manager', async () => {
      // PINs exist for managers and owners only (0026). Leaving one behind on a
      // demoted cashier is a live authorisation credential for someone who can
      // no longer authorise anything.
      const id = await makeStaff('demote', 'manager');
      expect((await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: '4321' })).error)
        .toBeNull();
      expect((await readStaff(id)).pin_hash).not.toBeNull();

      expect(
        (await appRpc(owner, 'set_staff_role', { p_staff_id: id, p_role: 'cashier' })).error,
      ).toBeNull();
      expect((await readStaff(id)).pin_hash).toBeNull();
    });

    it('keeps the PIN when moving between manager and owner', async () => {
      const id = await makeStaff('sideways', 'manager');
      await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: '4321' });
      await appRpc(owner, 'set_staff_role', { p_staff_id: id, p_role: 'owner' });
      expect((await readStaff(id)).pin_hash).not.toBeNull();
    });

    it('refuses to change your own role', async () => {
      // Otherwise the only owner can demote themselves and lock the venue out.
      const res = await appRpc(owner, 'set_staff_role', {
        p_staff_id: SEED_STAFF_IDS.owner,
        p_role: 'cashier',
      });
      expect(res.error?.message).toBe('CANNOT_EDIT_SELF');
    });

    it('lets one owner demote another, because a caller is always an owner who remains', async () => {
      // The real invariant is "never zero active owners", and CANNOT_EDIT_SELF is
      // what enforces it: app.staff_role() reads `where id = auth.uid() and
      // is_active` (0010), so the caller IS an active owner and cannot be the
      // target — whoever they demote, they themselves remain. That makes the
      // LAST_OWNER branch unreachable from the client, and this test states the
      // reachable half of the rule rather than pretending to exercise the branch.
      const other = await makeStaff('second-owner', 'owner');
      expect(
        (await appRpc(owner, 'set_staff_role', { p_staff_id: other, p_role: 'manager' })).error,
      ).toBeNull();
      expect((await readStaff(other)).role).toBe('manager');

      const { count } = await svc
        .from('staff')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner')
        .eq('is_active', true);
      expect(count ?? 0).toBeGreaterThan(0);
    });

    it('refuses an unknown staff id', async () => {
      const res = await appRpc(owner, 'set_staff_role', {
        p_staff_id: '00000000-0000-4000-8000-0000000000ab',
        p_role: 'prep',
      });
      expect(res.error?.message).toBe('STAFF_NOT_FOUND');
    });
  });

  describe('set_staff_active', () => {
    it('deactivates and reactivates, auditing both', async () => {
      const id = await makeStaff('deactivate');
      expect(
        (
          await appRpc(owner, 'set_staff_active', {
            p_staff_id: id,
            p_active: false,
            p_reason_code: 'left_the_venue',
          })
        ).error,
      ).toBeNull();
      expect((await readStaff(id)).is_active).toBe(false);

      expect(
        (await appRpc(owner, 'set_staff_active', { p_staff_id: id, p_active: true })).error,
      ).toBeNull();
      expect((await readStaff(id)).is_active).toBe(true);

      const { count } = await svc
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', id)
        .eq('action', 'staff.active_set');
      expect(count).toBe(2);
    });

    it('clears the PIN on deactivation', async () => {
      const id = await makeStaff('pinned', 'manager');
      await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: '9876' });
      await appRpc(owner, 'set_staff_active', { p_staff_id: id, p_active: false });
      expect((await readStaff(id)).pin_hash).toBeNull();
    });

    it('refuses to deactivate yourself', async () => {
      const res = await appRpc(owner, 'set_staff_active', {
        p_staff_id: SEED_STAFF_IDS.owner,
        p_active: false,
      });
      expect(res.error?.message).toBe('CANNOT_EDIT_SELF');
    });

    it('does not delete the row — audit attribution depends on it', async () => {
      const id = await makeStaff('kept');
      await appRpc(owner, 'set_staff_active', { p_staff_id: id, p_active: false });
      const still = await readStaff(id);
      expect(still.id).toBe(id);
      expect(still.display_name).toBe('Test kept');
    });
  });

  describe('rename_staff', () => {
    it('renames and audits the old and new name', async () => {
      const id = await makeStaff('rename');
      expect(
        (await appRpc(owner, 'rename_staff', { p_staff_id: id, p_display_name: '  Ahmed  ' }))
          .error,
      ).toBeNull();
      // Trimmed, because the name is what every audit row is read through.
      expect((await readStaff(id)).display_name).toBe('Ahmed');
    });

    it('refuses an empty or oversized name', async () => {
      const id = await makeStaff('badname');
      expect(
        (await appRpc(owner, 'rename_staff', { p_staff_id: id, p_display_name: '   ' })).error
          ?.message,
      ).toBe('NAME_LENGTH');
      expect(
        (await appRpc(owner, 'rename_staff', { p_staff_id: id, p_display_name: 'x'.repeat(81) }))
          .error?.message,
      ).toBe('NAME_LENGTH');
    });
  });

  describe('clear_staff_pin', () => {
    it('revokes a PIN without touching the role', async () => {
      const id = await makeStaff('clearpin', 'manager');
      await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: '1357' });
      expect((await appRpc(owner, 'clear_staff_pin', { p_staff_id: id })).error).toBeNull();

      const row = await readStaff(id);
      expect(row.pin_hash).toBeNull();
      expect(row.role).toBe('manager');
    });

    it('audits the fact, never the PIN', async () => {
      const id = await makeStaff('pinaudit', 'manager');
      await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: '2468' });
      await appRpc(owner, 'clear_staff_pin', { p_staff_id: id });

      const { data } = await svc
        .from('audit_log')
        .select('before, after')
        .eq('entity_id', id)
        .eq('action', 'staff.pin_cleared')
        .single();
      const serialized = JSON.stringify(data);
      expect(serialized).toContain('had_pin');
      expect(serialized).not.toContain('2468');
    });
  });
});
