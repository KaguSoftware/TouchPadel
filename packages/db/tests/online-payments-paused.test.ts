/**
 * 0340 online_payments_paused: while platform_settings.online_payments_live is
 * false (it ships false and no RPC sets it) the owner cannot switch on online
 * deposits, online lesson payment or open matches. Settings that keep those
 * off still save. The flag is flipped here with the service role to prove the
 * refusals lift, and put back in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  appRpc,
  serviceClient,
  setOnlinePaymentsLive,
  signedInClient,
  stackAvailable,
  SEED_STAFF,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0340 online payments paused', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let wasLive = false;

  const deposit = (p_patch: unknown) => appRpc(owner, 'set_deposit_settings', { p_patch, p_venue_id: VENUE_A_ID });
  const coaching = (p_patch: unknown) => appRpc(owner, 'set_coaching_settings', { p_venue_id: VENUE_A_ID, p_patch });
  const match = (p_patch: unknown) => appRpc(owner, 'set_match_settings', { p_patch, p_venue_id: VENUE_A_ID });

  const state = async () => {
    const { data, error } = await svc
      .from('venue_settings')
      .select('deposit_mode, lesson_payment_mode, matches_enabled')
      .eq('venue_id', VENUE_A_ID)
      .single();
    expect(error).toBeNull();
    return data as { deposit_mode: string; lesson_payment_mode: string; matches_enabled: boolean };
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    wasLive = await setOnlinePaymentsLive(false);
  });

  afterAll(async () => {
    if (!owner) return;
    await setOnlinePaymentsLive(true);
    await deposit({ deposit_mode: 'off' });
    await coaching({ lesson_payment_mode: 'desk' });
    await match({ matches_enabled: false });
    await setOnlinePaymentsLive(wasLive);
    await owner.auth.signOut();
  });

  it('ships the lock closed and answers online_payments_live() false', async () => {
    const { data } = await svc.from('platform_settings').select('online_payments_live').eq('id', true).single();
    expect((data as { online_payments_live: boolean }).online_payments_live).toBe(false);
    const res = await appRpc(owner, 'online_payments_live', {});
    expect(res.error).toBeNull();
    expect(res.data).toBe(false);
    // Not for anon.
    expect((await appRpc(anonClient(), 'online_payments_live', {})).error?.message ?? '').toMatch(/permission denied/i);
  });

  it('refuses an online deposit mode, accepts off and the other fields', async () => {
    for (const mode of ['optional', 'required']) {
      expect((await deposit({ deposit_mode: mode })).error?.message).toBe('ONLINE_PAYMENTS_PAUSED');
    }
    expect((await state()).deposit_mode).toBe('off');
    expect((await deposit({ deposit_mode: 'off' })).error).toBeNull();
    expect((await deposit({ deposit_percent_bp: 3000 })).error).toBeNull();
    // A bad value is still a shape error, not a pause.
    expect((await deposit({ deposit_mode: 'bogus' })).error?.message).toBe('INVALID_ARGUMENT');
  });

  it('refuses an online lesson payment mode, accepts desk and the other fields', async () => {
    for (const mode of ['online_optional', 'online_required']) {
      expect((await coaching({ lesson_payment_mode: mode })).error?.message).toBe('ONLINE_PAYMENTS_PAUSED');
    }
    expect((await state()).lesson_payment_mode).toBe('desk');
    expect((await coaching({ lesson_payment_mode: 'desk' })).error).toBeNull();
    expect((await coaching({ coach_max_open_private: 7 })).error).toBeNull();
  });

  it('refuses matches_enabled true, accepts false and the other fields', async () => {
    expect((await match({ matches_enabled: true })).error?.message).toBe('ONLINE_PAYMENTS_PAUSED');
    expect((await state()).matches_enabled).toBe(false);
    expect((await match({ matches_enabled: false })).error).toBeNull();
    expect((await match({ match_ticket_price_iqd: 10000 })).error).toBeNull();
  });

  it('still refuses a non-owner with FORBIDDEN first', async () => {
    const manager = await signedInClient(SEED_STAFF.manager);
    const res = await appRpc(manager, 'set_match_settings', { p_patch: { matches_enabled: true }, p_venue_id: VENUE_A_ID });
    expect(res.error?.message).toBe('FORBIDDEN');
    await manager.auth.signOut();
  });

  it('lifts every refusal when the flag is set', async () => {
    await setOnlinePaymentsLive(true);
    expect((await appRpc(owner, 'online_payments_live', {})).data).toBe(true);
    expect((await deposit({ deposit_mode: 'optional' })).error).toBeNull();
    expect((await match({ matches_enabled: true })).error).toBeNull();
    const lessonMode = await coaching({ lesson_payment_mode: 'online_optional' });
    // Without live lessons terms the older ONLINE_PAYMENT_OFF guard still answers; the pause is not it.
    expect(lessonMode.error?.message ?? '').not.toBe('ONLINE_PAYMENTS_PAUSED');
    await deposit({ deposit_mode: 'off' });
    await match({ matches_enabled: false });
    await setOnlinePaymentsLive(false);
    expect((await match({ matches_enabled: true })).error?.message).toBe('ONLINE_PAYMENTS_PAUSED');
  });
});
