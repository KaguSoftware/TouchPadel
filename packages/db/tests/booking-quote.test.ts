import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  SEED_STAFF,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  guestClient,
  outcome,
  serviceClient,
  signedInClient,
  stackAvailable,
} from './helpers';

/**
 * 0117 (C5) — quote = charge on the guest path.
 *
 * hold_slot stamps the price it quoted on the hold; confirm_booking still
 * re-prices from the rules (they are the truth for what is charged) but a
 * GUEST whose hold carries a different stamp is refused PRICE_CHANGED instead
 * of being charged an amount they never saw. Staff at the desk are exempt; a
 * hold from before 0117 (no stamp) behaves as before.
 */
const up = await stackAvailable();

interface ReservationRow {
  id: string;
  kind: string;
  status: string;
  rate_rule_id: string | null;
  price_iqd: number | null;
}

describe.skipIf(!up)('0117 quote = charge (C5)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;
  // Price edits are undone after every test so the shared TEST rule is stable.
  const restores: (() => Promise<void>)[] = [];

  async function reservation(id: string): Promise<ReservationRow> {
    const { data, error } = await svc
      .from('reservations')
      .select('id, kind, status, rate_rule_id, price_iqd')
      .eq('id', id)
      .single();
    if (error) throw new Error(`reservation read failed: ${error.message}`);
    return data as ReservationRow;
  }

  async function hold(guest: SupabaseClient, hourUtc = 6): Promise<ReservationRow> {
    const slot = futureSlot(hourUtc);
    const held = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    if (!held.ok) throw new Error(`hold_slot: ${held.errorMessage}`);
    return reservation((held.data as { reservation_id: string }).reservation_id);
  }

  /** Move the 60-minute price of the rule that priced this hold by +5,000 IQD; undone in afterEach. */
  async function bumpRulePrice(ruleId: string): Promise<{ before: number; after: number }> {
    const { data, error } = await svc
      .from('rate_rule_prices')
      .select('price_iqd')
      .eq('rule_id', ruleId)
      .eq('duration_min', 60)
      .single();
    if (error) throw new Error(`rate_rule_prices read failed: ${error.message}`);
    const before = (data as { price_iqd: number }).price_iqd;
    const after = before + 5_000;
    const upd = await svc.from('rate_rule_prices').update({ price_iqd: after }).eq('rule_id', ruleId).eq('duration_min', 60);
    if (upd.error) throw new Error(`rate_rule_prices update failed: ${upd.error.message}`);
    restores.push(async () => {
      await svc.from('rate_rule_prices').update({ price_iqd: before }).eq('rule_id', ruleId).eq('duration_min', 60);
    });
    return { before, after };
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, `QUOTE${Date.now() % 100000}`);
  });

  afterEach(async () => {
    while (restores.length) await restores.pop()!();
  });

  it('hold_slot stamps the quoted rule and price on the hold', async () => {
    const guest = await guestClient(svc, 'quote-stamp');
    const h = await hold(guest);
    expect(h.kind).toBe('hold');
    expect(h.rate_rule_id).not.toBeNull();
    expect(h.price_iqd).toBeGreaterThan(0);
  });

  it('confirms at the quoted price when nothing moved', async () => {
    const guest = await guestClient(svc, 'quote-same');
    const h = await hold(guest, 7);
    const c = await appRpc(guest, 'confirm_booking', { p_hold_id: h.id }).then(outcome);
    expect(c.ok, c.errorMessage).toBe(true);
    expect((c.data as { price_iqd: number }).price_iqd).toBe(h.price_iqd);
    const after = await reservation(h.id);
    expect(after.status).toBe('confirmed');
    expect(after.price_iqd).toBe(h.price_iqd);
  });

  it('refuses a GUEST with PRICE_CHANGED when the rule moved after the hold, naming both prices', async () => {
    const guest = await guestClient(svc, 'quote-moved');
    const h = await hold(guest, 8);
    const { before, after } = await bumpRulePrice(h.rate_rule_id!);
    expect(h.price_iqd).toBe(before);

    // Raw response: outcome() keeps only the message; the prices ride in details.
    const c = await appRpc(guest, 'confirm_booking', { p_hold_id: h.id });
    expect(c.error?.message).toBe('PRICE_CHANGED');
    const detail = JSON.parse(c.error?.details ?? '{}') as { quoted_iqd: number; current_iqd: number };
    expect(detail.quoted_iqd).toBe(before);
    expect(detail.current_iqd).toBe(after);

    // Nothing was charged or confirmed.
    const still = await reservation(h.id);
    expect(still.status).toBe('pending');
    expect(still.price_iqd).toBe(before);
  });

  it('the desk may confirm a moved hold — it sees the live price — and the live price is what is stamped', async () => {
    const guest = await guestClient(svc, 'quote-desk');
    const h = await hold(guest, 9);
    const { after } = await bumpRulePrice(h.rate_rule_id!);
    const c = await appRpc(desk, 'confirm_booking', { p_hold_id: h.id }).then(outcome);
    expect(c.ok, c.errorMessage).toBe(true);
    expect((c.data as { price_iqd: number }).price_iqd).toBe(after);
  });

  it('a hold from before 0117 (no stamp) confirms as it always did', async () => {
    const guest = await guestClient(svc, 'quote-legacy');
    const h = await hold(guest, 10);
    const strip = await svc.from('reservations').update({ rate_rule_id: null, price_iqd: null }).eq('id', h.id);
    expect(strip.error).toBeNull();
    await bumpRulePrice(h.rate_rule_id!);
    const c = await appRpc(guest, 'confirm_booking', { p_hold_id: h.id }).then(outcome);
    expect(c.ok, c.errorMessage).toBe(true);
    expect((c.data as { price_iqd: number }).price_iqd).toBeGreaterThan(0);
  });
});
