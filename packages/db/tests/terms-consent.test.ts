/**
 * 0153 — app.accept_terms and the profiles consent columns.
 *
 * The Terms of Service only bind a guest who accepted them, and the only
 * evidence of that is the version and the server-stamped time on their profile.
 * These assertions keep that evidence honest: it is written only through the
 * RPC (never by the device, so never with a device clock), only for a real
 * account, and it survives account deletion on the anonymised tombstone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  guestClient,
  anonymousSessionClient,
  appRpc,
  outcome,
} from './helpers';

const up = await stackAvailable();

const VERSION = '2026-09-23';

async function ownConsent(c: SupabaseClient) {
  const { data: user } = await c.auth.getUser();
  const { data, error } = await c
    .from('profiles')
    .select('terms_version, terms_accepted_at')
    .eq('id', user.user!.id)
    .single();
  if (error) throw error;
  return data as { terms_version: string | null; terms_accepted_at: string | null };
}

describe.skipIf(!up)('0153 accept_terms', () => {
  let svc: SupabaseClient;

  beforeAll(() => {
    svc = serviceClient();
  });

  it('starts null, then records the version with a server timestamp', async () => {
    const guest = await guestClient(svc, 'terms');
    expect(await ownConsent(guest)).toEqual({ terms_version: null, terms_accepted_at: null });

    const before = Date.now();
    const res = outcome(await appRpc(guest, 'accept_terms', { p_version: VERSION }));
    expect(res.ok).toBe(true);

    const after = await ownConsent(guest);
    expect(after.terms_version).toBe(VERSION);
    const at = Date.parse(after.terms_accepted_at!);
    // Server clock, not the caller's: within a generous window of the call.
    expect(at).toBeGreaterThan(before - 60_000);
    expect(at).toBeLessThan(Date.now() + 60_000);
  });

  it('accepts a dotted revision of the same day', async () => {
    const guest = await guestClient(svc, 'terms-rev');
    const res = outcome(await appRpc(guest, 'accept_terms', { p_version: `${VERSION}.2` }));
    expect(res.ok).toBe(true);
    expect((await ownConsent(guest)).terms_version).toBe(`${VERSION}.2`);
  });

  it('refuses a missing or free-text version with VERSION_INVALID', async () => {
    const guest = await guestClient(svc, 'terms-bad');
    for (const p_version of [null, '', 'yes', '2026-9-23', "2026-09-23'; drop table profiles; --"]) {
      const res = outcome(await appRpc(guest, 'accept_terms', { p_version }));
      expect(res.ok).toBe(false);
      expect(res.errorMessage).toMatch(/VERSION_INVALID/);
    }
    expect((await ownConsent(guest)).terms_version).toBeNull();
  });

  it('refuses an anonymous café session with ACCOUNT_REQUIRED', async () => {
    const anon = await anonymousSessionClient();
    const res = outcome(await appRpc(anon, 'accept_terms', { p_version: VERSION }));
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/ACCOUNT_REQUIRED/);
  });

  it('cannot be written directly — the RPC is the only path', async () => {
    const guest = await guestClient(svc, 'terms-direct');
    const { data: user } = await guest.auth.getUser();
    const { error } = await guest
      .from('profiles')
      .update({ terms_version: VERSION, terms_accepted_at: '2000-01-01T00:00:00Z' })
      .eq('id', user.user!.id);
    expect(error).not.toBeNull();
    expect((await ownConsent(guest)).terms_version).toBeNull();
  });

  it('keeps the acceptance on the tombstone after account deletion', async () => {
    const guest = await guestClient(svc, 'terms-del');
    const { data: user } = await guest.auth.getUser();
    const id = user.user!.id;
    expect(outcome(await appRpc(guest, 'accept_terms', { p_version: VERSION })).ok).toBe(true);
    expect(outcome(await appRpc(guest, 'delete_my_account', { p_confirm: 'DELETE' })).ok).toBe(true);

    const { data } = await svc
      .from('profiles')
      .select('full_name, phone, deleted_at, terms_version, terms_accepted_at')
      .eq('id', id)
      .single();
    expect(data!.full_name).toBe('Deleted account');
    expect(data!.phone).toBeNull();
    expect(data!.deleted_at).not.toBeNull();
    expect(data!.terms_version).toBe(VERSION);
    expect(data!.terms_accepted_at).not.toBeNull();
  });
});
