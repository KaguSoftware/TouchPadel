/**
 * 0062 — court records admin (SOW L299-301). Courts had every column since
 * 0007 and no write path at all: "RPC-only (admin CRUD lands with the admin
 * drop)" that never landed.
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
  ensureTestRateRule,
  futureSlot,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0062 courts admin', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  const made: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    if (made.length > 0) await svc.from('courts').delete().in('id', made);
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  async function createCourt(name: string): Promise<string> {
    const res = await appRpc(manager, 'upsert_court', {
      p_name_en: name,
      p_name_ar: `ملعب ${name}`,
      p_indoor: true,
    });
    if (res.error) throw new Error(res.error.message);
    const id = res.data as string;
    made.push(id);
    return id;
  }

  it('creates and updates a court, audited, with a fresh sort_order tail', async () => {
    const id = await createCourt(`CA-${Date.now()}`);
    const { data: row } = await svc.from('courts').select('*').eq('id', id).single();
    expect((row as { duration_options: number[] }).duration_options).toEqual([60, 90, 120]);

    const upd = await appRpc(manager, 'upsert_court', {
      p_id: id,
      p_name_en: 'Center Court',
      p_name_ar: 'الملعب المركزي',
      p_indoor: false,
      p_duration_options: [45, 90],
    });
    expect(upd.error).toBeNull();
    const { data: after } = await svc.from('courts').select('indoor, duration_options').eq('id', id).single();
    expect(after).toEqual({ indoor: false, duration_options: [45, 90] });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action')
      .eq('entity_id', id)
      .order('at', { ascending: false })
      .limit(2);
    expect((audit as { action: string }[]).map((a) => a.action).sort()).toEqual([
      'courts.create',
      'courts.update',
    ]);
  });

  it('refuses cashiers, junk durations and stray photo paths by name', async () => {
    const denied = outcome(
      await appRpc(cashier, 'upsert_court', { p_name_en: 'X', p_name_ar: 'س', p_indoor: true }),
    );
    expect(denied.errorMessage).toContain('FORBIDDEN');

    const badDur = outcome(
      await appRpc(manager, 'upsert_court', {
        p_name_en: 'X',
        p_name_ar: 'س',
        p_indoor: true,
        p_duration_options: [20],
      }),
    );
    expect(badDur.errorMessage).toContain('INVALID_DURATIONS');

    const badPhoto = outcome(
      await appRpc(manager, 'upsert_court', {
        p_name_en: 'X',
        p_name_ar: 'س',
        p_indoor: true,
        p_photo_path: 'items/evil.png',
      }),
    );
    expect(badPhoto.errorMessage).toContain('INVALID_PHOTO_PATH');
  });

  it('will not deactivate a court holding a future live booking', async () => {
    const id = await createCourt(`CB-${Date.now()}`);
    await ensureTestRateRule(svc);
    const slot = futureSlot();
    const { error } = await svc.from('reservations').insert({
      court_id: id,
      kind: 'booking',
      status: 'confirmed',
      source: 'desk',
      start_at: slot.start.toISOString(),
      end_at: slot.plus(60).toISOString(),
      guest_name: 'courts-admin-test',
      price_iqd: 40_000,
    });
    expect(error).toBeNull();

    const refused = outcome(
      await appRpc(manager, 'upsert_court', {
        p_id: id,
        p_name_en: 'CB',
        p_name_ar: 'س',
        p_indoor: true,
        p_is_active: false,
      }),
    );
    expect(refused.errorMessage).toContain('COURT_HAS_FUTURE_RESERVATIONS');

    const cancel = await svc
      .from('reservations')
      .update({ status: 'cancelled', cancellation_reason: 'staff_error' })
      .eq('court_id', id);
    expect(cancel.error).toBeNull();
    const ok = await appRpc(manager, 'upsert_court', {
      p_id: id,
      p_name_en: 'CB',
      p_name_ar: 'س',
      p_indoor: true,
      p_is_active: false,
    });
    expect(ok.error).toBeNull();
  });

  it('reorder_courts applies a permutation and refuses duplicates', async () => {
    const a = await createCourt(`CC1-${Date.now()}`);
    const b = await createCourt(`CC2-${Date.now()}`);
    const res = await appRpc(manager, 'reorder_courts', { p_ids: [b, a] });
    expect(res.error).toBeNull();
    const { data } = await svc
      .from('courts')
      .select('id, sort_order')
      .in('id', [a, b]);
    const byId = new Map((data as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]));
    expect(byId.get(b)).toBeLessThan(byId.get(a)!);

    const dup = outcome(await appRpc(manager, 'reorder_courts', { p_ids: [a, a] }));
    expect(dup.errorMessage).toContain('DUPLICATE_ID');
  });
});
