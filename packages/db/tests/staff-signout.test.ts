/**
 * SEC-35 (0081) — deactivating a staff member ends their SESSION, not just
 * their permissions.
 *
 * Before 0081 the DB half was done and looked complete: `is_active = false`
 * makes app.staff_role() return null, so every staff RPC refuses immediately.
 * But the refresh token in the till browser kept minting new access tokens, so
 * the leaver stayed signed in, kept a live Realtime subscription and kept
 * whatever a plain `authenticated` principal can reach.
 *
 * The assertion that matters is the last one: the refresh token must stop
 * working. Everything else was already true.
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
  SUPABASE_URL,
  ANON_KEY,
  DEV_PASSWORD,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0081 staff deactivation revokes sessions (SEC-35)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  const made: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
  });

  afterAll(async () => {
    for (const id of made) {
      await svc.from('staff').delete().eq('id', id);
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    await owner.auth.signOut();
  });

  /** A real staff account, signed in, with its refresh token captured. */
  async function leaver(tag: string) {
    const email = `leaver-${tag}-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `Leaver ${tag}` },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    const id = data.user.id;
    made.push(id);
    const { error: insErr } = await svc
      .from('staff')
      .insert({ id, display_name: `Leaver ${tag}`, role: 'cashier', is_active: true });
    if (insErr) throw new Error(`staff insert: ${insErr.message}`);

    const client = await signedInClient(email);
    const session = (await client.auth.getSession()).data.session!;
    return { id, client, refreshToken: session.refresh_token };
  }

  const refresh = (token: string) =>
    fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    });

  it('the refresh token works while the account is active — the test is not vacuous', async () => {
    const l = await leaver('active');
    const res = await refresh(l.refreshToken);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { access_token?: string };
    expect(body.access_token).toBeTruthy();
  });

  /**
   * THE ONE THAT MATTERS. A refresh token captured before the deactivation must
   * not mint a new access token afterwards.
   */
  it('a refresh token captured before deactivation no longer mints a JWT', async () => {
    const l = await leaver('revoked');

    const res = await appRpc(owner, 'set_staff_active', {
      p_staff_id: l.id,
      p_active: false,
      p_reason_code: 'left',
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect((res.data as { sessions_revoked: number }).sessions_revoked).toBeGreaterThan(0);

    const after = await refresh(l.refreshToken);
    expect(after.ok).toBe(false);
    const body = (await after.json()) as { access_token?: string };
    expect(body.access_token).toBeUndefined();
  });

  it('records how many sessions were ended on the audit row', async () => {
    const l = await leaver('audited');
    await appRpc(owner, 'set_staff_active', { p_staff_id: l.id, p_active: false });

    const { data } = await svc
      .from('audit_log')
      .select('after')
      .eq('action', 'staff.active_set')
      .eq('entity_id', l.id)
      .order('at', { ascending: false })
      .limit(1)
      .single();
    const after = (data as { after: Record<string, unknown> }).after;
    expect(after.is_active).toBe(false);
    expect(after.sessions_revoked).toBeGreaterThan(0);
  });

  it('still clears the authorisation PIN — the 0051 behaviour is intact', async () => {
    const l = await leaver('pin');
    await svc.from('staff').update({ role: 'manager' }).eq('id', l.id);
    await appRpc(owner, 'set_staff_pin', { p_staff_id: l.id, p_pin: '482913' });

    const { data: before } = await svc.from('staff').select('pin_hash').eq('id', l.id).single();
    expect((before as { pin_hash: string | null }).pin_hash).not.toBeNull();

    await appRpc(owner, 'set_staff_active', { p_staff_id: l.id, p_active: false });

    const { data: after } = await svc.from('staff').select('pin_hash').eq('id', l.id).single();
    expect((after as { pin_hash: string | null }).pin_hash).toBeNull();
  });

  /**
   * Reactivating must not punish whatever session the person has now — there is
   * nothing to revoke and revoking would sign out an account that just regained
   * its access.
   */
  it('reactivation revokes nothing', async () => {
    const l = await leaver('reactivated');
    await appRpc(owner, 'set_staff_active', { p_staff_id: l.id, p_active: false });

    const res = await appRpc(owner, 'set_staff_active', {
      p_staff_id: l.id,
      p_active: true,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect((res.data as { sessions_revoked: number }).sessions_revoked).toBe(0);
  });

  it('the guards are unchanged — non-owner refused, self-edit refused', async () => {
    const l = await leaver('guards');
    const manager = await signedInClient(SEED_STAFF.manager);
    const denied = await appRpc(manager, 'set_staff_active', {
      p_staff_id: l.id,
      p_active: false,
    }).then(outcome);
    expect(denied.ok).toBe(false);
    expect(denied.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();

    const ownerId = (await owner.auth.getUser()).data.user!.id;
    const self = await appRpc(owner, 'set_staff_active', {
      p_staff_id: ownerId,
      p_active: false,
    }).then(outcome);
    expect(self.ok).toBe(false);
    expect(self.errorMessage).toMatch(/CANNOT_EDIT_SELF/);
  });
});
