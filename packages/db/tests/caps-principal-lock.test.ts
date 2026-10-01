/**
 * 0269 — a cap that is counted and then inserted is counted under a lock on
 * whoever it caps (app.lock_principal). Before 0269 hold_slot counted a
 * guest's live holds with nothing held, then took a PER-COURT lock, so N
 * parallel holds on N courts each counted fewer than the cap and all inserted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0269 caps counted under a principal lock', () => {
  let svc: SupabaseClient;
  const courts: string[] = [];
  let saved: number | null = null;

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTestRateRule(svc);
    for (let i = 0; i < 6; i++) courts.push(await createTestCourt(svc, `P0269-${i}`));
    const { data, error } = await svc.from('platform_settings').select('max_live_holds_per_guest').eq('id', true).single();
    if (error) throw new Error(error.message);
    saved = (data as { max_live_holds_per_guest: number | null }).max_live_holds_per_guest;
    const set = await svc.from('platform_settings').update({ max_live_holds_per_guest: 2 }).eq('id', true);
    if (set.error) throw new Error(set.error.message);
  });

  afterAll(async () => {
    if (!svc) return;
    await svc.from('platform_settings').update({ max_live_holds_per_guest: saved }).eq('id', true);
  });

  it('six parallel holds by one guest on six courts: exactly the cap succeed, the rest HOLD_QUOTA_EXCEEDED', async () => {
    const guest = await guestClient(svc, 'cap-0269');
    const slot = futureSlot();
    const results = await Promise.all(
      courts.map((court) =>
        appRpc(guest, 'hold_slot', {
          p_court_id: court,
          p_start_at: slot.start.toISOString(),
          p_duration_min: 60,
        }).then(outcome),
      ),
    );
    const held = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    expect(held).toHaveLength(2);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r.errorMessage).toContain('HOLD_QUOTA_EXCEEDED');
  });
});
