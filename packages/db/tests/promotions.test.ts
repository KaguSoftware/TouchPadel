/**
 * 0067 — promotions (spec 06.26 / 06.27) applied at the till as ONE
 * tab_adjustments discount row (06.13: "the server applies the single best").
 *
 * Money assertions read the same surfaces a guest and a manager see:
 * app.compute_tab_totals (service role), settle_tab's returned bill, and the
 * day-close views — a promotion that does not reach those is not a promotion.
 *
 * Runs against the local stack; skips itself cleanly when the stack is down.
 * Promotions are never deleted (06.26), so every promotion this suite creates
 * is DISABLED in afterEach and the suite starts by disabling whatever an
 * earlier run left enabled.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  anonClient,
  signedInClient,
  anonymousSessionClient,
  guestClient,
  appRpc,
  outcome,
  testIdemKey,
  SEED_STAFF,
  SEED_STAFF_IDS,
  createTestMenuItem,
  createTestCourt,
  ensureOpenDay,
  ensureTillFresh,
  futureSlot,
} from './helpers';

const up = await stackAvailable();

/** Exact reference of the SQL percent branch: base - ((base * (100 - pct) + 50) / 100) on bigint. */
function pctDiscountRef(base: number, pct: number): number {
  return base - Number((BigInt(base) * BigInt(100 - pct) + 50n) / 100n);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface Eligible {
  promotionId: string;
  name_en: string;
  name_ar: string;
  type: 'percent' | 'amount';
  value: number;
  amountIqd: number;
}

interface Applied {
  promotionId: string;
  amountIqd: number;
  adjustmentId: string;
  replacedPromotionId: string | null;
  unchanged: boolean;
  duplicate?: boolean;
}

describe.skipIf(!up)('0067 promotions', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let dayId: string;
  let tz: string;

  let itemA: Awaited<ReturnType<typeof createTestMenuItem>>; // 6,000
  let itemB: Awaited<ReturnType<typeof createTestMenuItem>>; // 4,000

  /** Promotions created by the running test — disabled in afterEach. */
  let made: string[] = [];

  type PromoArgs = Record<string, unknown>;
  let promoN = 0;
  /** Create a promotion as the manager with sensible defaults; throws on error. */
  async function mk(over: PromoArgs = {}, as: SupabaseClient = manager): Promise<string> {
    const n = promoN++;
    const res = await appRpc(as, 'upsert_promotion', {
      p_name_en: `Promo ${n}`,
      p_name_ar: `عرض ${n}`,
      p_type: 'percent',
      p_value: 10,
      ...over,
    });
    if (res.error) throw new Error(`upsert_promotion: ${res.error.message}`);
    const id = res.data as string;
    made.push(id);
    return id;
  }

  async function openTab(label: string): Promise<string> {
    const res = await appRpc(cashier, 'open_tab', {
      p_label: label,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    return (res.data as { tab_id: string }).tab_id;
  }

  async function addItem(tabId: string, item: { variantId: string }, qty = 1) {
    const res = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (res.error) throw new Error(`till_add_items: ${res.error.message}`);
  }

  /** A tab holding A (6,000) + B (4,000) = 10,000 of goods. */
  async function tabAB(label: string): Promise<string> {
    const tabId = await openTab(label);
    await addItem(tabId, itemA);
    await addItem(tabId, itemB);
    return tabId;
  }

  async function eligible(tabId: string, code?: string): Promise<Eligible[]> {
    const res = await appRpc(cashier, 'eligible_promotions', { p_tab_id: tabId, p_code: code ?? null });
    if (res.error) throw new Error(`eligible_promotions: ${res.error.message}`);
    return res.data as Eligible[];
  }

  async function apply(tabId: string, code?: string, key?: string, as: SupabaseClient = cashier) {
    return appRpc(as, 'apply_best_promotion', {
      p_tab_id: tabId,
      p_code: code ?? null,
      p_idempotency_key: key ?? testIdemKey('promotion.apply'),
      p_device_id: 'TILL-TEST',
    });
  }

  async function totals(tabId: string) {
    const { data, error } = await svc.schema('app').rpc('compute_tab_totals', { p_tab_id: tabId });
    if (error) throw new Error(error.message);
    return (data as { subtotal_iqd: number; discount_iqd: number; court_iqd: number; total_iqd: number }[])[0]!;
  }

  async function promoRows(tabId: string) {
    const { data } = await svc
      .from('tab_adjustments')
      .select('id, kind, value, amount_iqd, applied_by, authorized_by, reason_code, promotion_id')
      .eq('tab_id', tabId)
      .not('promotion_id', 'is', null);
    return (data ?? []) as {
      id: string; kind: string; value: number; amount_iqd: number; applied_by: string;
      authorized_by: string; reason_code: string; promotion_id: string;
    }[];
  }

  async function redemptions(tabId: string) {
    const { data } = await svc.from('promotion_redemptions').select('*').eq('tab_id', tabId);
    return (data ?? []) as { promotion_id: string; amount_iqd: number; code_used: string | null; customer_id: string | null }[];
  }

  /** Local wall-clock in the venue timezone: hour (0-23) and dow (0 = Sunday). */
  function venueNow(): { hour: number; dow: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
    const wd = parts.find((p) => p.type === 'weekday')!.value;
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
    return { hour, dow };
  }
  const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

  /** A confirmed booking on a fresh court, optionally for a known guest. */
  async function booking(guestId?: string): Promise<{ reservationId: string; courtId: string }> {
    const courtId = await createTestCourt(svc, `Court promo ${Date.now()}-${promoN}`);
    const slot = futureSlot();
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: slot.start.toISOString(),
        end_at: slot.plus(60).toISOString(),
        guest_id: guestId ?? null,
        guest_name: guestId ? null : 'Promo Test',
        price_iqd: 40_000,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { reservationId: (data as { id: string }).id, courtId };
  }

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);
    await ensureTillFresh(svc);
    dayId = await ensureOpenDay(manager, svc);

    // Whatever an earlier run left enabled would compete for "best".
    const { error } = await svc.from('promotions').update({ enabled: false }).eq('enabled', true);
    if (error) throw new Error(`disable leftovers: ${error.message}`);

    const { data: vs } = await svc.from('venue_settings').select('timezone').single();
    tz = (vs as { timezone: string }).timezone;

    itemA = await createTestMenuItem(svc, 'promo-a', 6000);
    itemB = await createTestMenuItem(svc, 'promo-b', 4000);
  });

  afterEach(async () => {
    if (made.length > 0) {
      const { error } = await svc.from('promotions').update({ enabled: false }).in('id', made);
      if (error) throw new Error(`disable made: ${error.message}`);
      made = [];
    }
  });

  afterAll(async () => {
    await manager.auth.signOut();
    await cashier.auth.signOut();
    await prep.auth.signOut();
  });

  // -------------------------------------------------------------------------
  // Configuration: upsert / validate / audit / enable / code
  // -------------------------------------------------------------------------
  describe('app.upsert_promotion', () => {
    it('creates with canonical defaults, audited with before/after', async () => {
      const id = await mk({ p_scope: { itemIds: [itemA.itemId], courtIds: [] }, p_limits: { total: 5, minSpendIqd: null } });
      const { data } = await svc.from('promotions').select('*').eq('id', id).single();
      const row = data as Record<string, unknown>;
      expect(row.type).toBe('percent');
      expect(row.value).toBe(10);
      expect(row.auto).toBe(true);
      expect(row.enabled).toBe(true);
      expect(row.weekdays).toEqual([]);
      expect(row.created_by).toBe(SEED_STAFF_IDS.manager);
      // Canonical: empty arrays and null limits dropped, ids as lower-case uuid text.
      expect(row.scope).toEqual({ itemIds: [itemA.itemId] });
      expect(row.limits).toEqual({ total: 5 });

      const upd = await appRpc(manager, 'upsert_promotion', {
        p_id: id, p_name_en: 'Renamed', p_name_ar: 'أُعيدت تسميته', p_type: 'amount', p_value: 2500,
      });
      expect(upd.error).toBeNull();
      const { data: after } = await svc.from('promotions').select('name_en, type, value, scope').eq('id', id).single();
      expect(after).toEqual({ name_en: 'Renamed', type: 'amount', value: 2500, scope: {} });

      const { data: audit } = await svc
        .from('audit_log')
        .select('action, before, after')
        .eq('entity', 'promotions')
        .eq('entity_id', id)
        .order('id', { ascending: true });
      const rows = audit as { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> }[];
      expect(rows.map((r) => r.action)).toEqual(['promotion.upsert', 'promotion.upsert']);
      expect(rows[0]!.before).toBeNull();
      expect(rows[1]!.before?.type).toBe('percent');
      expect(rows[1]!.after.type).toBe('amount');
    });

    it('validates by name', async () => {
      const err = async (args: PromoArgs) =>
        outcome(await appRpc(manager, 'upsert_promotion', {
          p_name_en: 'V', p_name_ar: 'ت', p_type: 'percent', p_value: 10, ...args,
        })).errorMessage;

      expect(await err({ p_name_ar: '  ' })).toBe('NAME_REQUIRED');
      expect(await err({ p_type: 'bogo' })).toBe('INVALID_VALUE');
      expect(await err({ p_value: 0 })).toBe('INVALID_VALUE');
      expect(await err({ p_value: 100 })).toBe('INVALID_VALUE');
      expect(await err({ p_type: 'amount', p_value: 0 })).toBe('INVALID_VALUE');
      expect(await err({ p_starts_at: '2030-01-02T00:00:00Z', p_ends_at: '2030-01-01T00:00:00Z' })).toBe('INVALID_RANGE');
      expect(await err({ p_hour_from: '10:00' })).toBe('INVALID_RANGE');
      expect(await err({ p_hour_from: '10:00', p_hour_to: '10:00' })).toBe('INVALID_RANGE');
      expect(await err({ p_weekdays: [7] })).toBe('INVALID_WEEKDAYS');
      expect(await err({ p_weekdays: [1, 1] })).toBe('INVALID_WEEKDAYS');
      expect(await err({ p_scope: { itemIds: ['00000000-0000-4000-8000-000000000000'] } })).toBe('INVALID_VALUE');
      expect(await err({ p_scope: { tables: [] } })).toBe('INVALID_VALUE');
      expect(await err({ p_scope: { itemIds: ['not-a-uuid'] } })).toBe('INVALID_VALUE');
      expect(await err({ p_limits: { total: 0 } })).toBe('INVALID_VALUE');
      expect(await err({ p_limits: { perCustomer: 1.5 } })).toBe('INVALID_VALUE');
      expect(await err({ p_limits: { stacking: true } })).toBe('INVALID_VALUE');
      expect(await err({ p_public_code: 'ab' })).toBe('INVALID_VALUE');
      expect(await err({ p_id: '00000000-0000-4000-8000-000000000000' })).toBe('PROMOTION_NOT_FOUND');
    });

    it('normalises codes, refuses a taken one, keeps on null and clears on empty', async () => {
      const code = `T${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
      const a = await mk({ p_public_code: ` ${code.toLowerCase()} ` });
      const { data: r1 } = await svc.from('promotions').select('public_code').eq('id', a).single();
      expect((r1 as { public_code: string }).public_code).toBe(code);

      const taken = outcome(await appRpc(manager, 'upsert_promotion', {
        p_name_en: 'B', p_name_ar: 'ب', p_type: 'percent', p_value: 5, p_public_code: code,
      }));
      expect(taken.errorMessage).toBe('CODE_TAKEN');

      // null keeps
      const keep = await appRpc(manager, 'upsert_promotion', {
        p_id: a, p_name_en: 'A2', p_name_ar: 'أ٢', p_type: 'percent', p_value: 10,
      });
      expect(keep.error).toBeNull();
      const { data: r2 } = await svc.from('promotions').select('public_code').eq('id', a).single();
      expect((r2 as { public_code: string }).public_code).toBe(code);

      // '' clears
      const clear = await appRpc(manager, 'upsert_promotion', {
        p_id: a, p_name_en: 'A3', p_name_ar: 'أ٣', p_type: 'percent', p_value: 10, p_public_code: '',
      });
      expect(clear.error).toBeNull();
      const { data: r3 } = await svc.from('promotions').select('public_code').eq('id', a).single();
      expect((r3 as { public_code: string | null }).public_code).toBeNull();
    });

    it('is manager/owner only; a cashier, prep and a guest are refused by the guard', async () => {
      const args = { p_name_en: 'X', p_name_ar: 'س', p_type: 'percent', p_value: 10 };
      expect(outcome(await appRpc(cashier, 'upsert_promotion', args)).errorMessage).toBe('FORBIDDEN');
      expect(outcome(await appRpc(prep, 'upsert_promotion', args)).errorMessage).toBe('FORBIDDEN');
      const guest = await anonymousSessionClient();
      expect(outcome(await appRpc(guest, 'upsert_promotion', args)).errorMessage).toBe('FORBIDDEN');
    });
  });

  describe('app.set_promotion_enabled / app.generate_promo_code', () => {
    it('toggles enabled with an audit row; manager only', async () => {
      const id = await mk();
      const off = await appRpc(manager, 'set_promotion_enabled', { p_id: id, p_enabled: false });
      expect(off.error).toBeNull();
      expect(off.data).toMatchObject({ id, enabled: false, duplicate: false });
      const again = await appRpc(manager, 'set_promotion_enabled', { p_id: id, p_enabled: false });
      expect(again.data).toMatchObject({ enabled: false, duplicate: true });

      const { data: audit } = await svc
        .from('audit_log')
        .select('action')
        .eq('entity_id', id)
        .eq('action', 'promotion.set_enabled');
      expect(audit).toHaveLength(1);

      expect(outcome(await appRpc(cashier, 'set_promotion_enabled', { p_id: id, p_enabled: true })).errorMessage).toBe('FORBIDDEN');
      expect(outcome(await appRpc(manager, 'set_promotion_enabled', {
        p_id: '00000000-0000-4000-8000-000000000000', p_enabled: true,
      })).errorMessage).toBe('PROMOTION_NOT_FOUND');
    });

    it('generates an 8-character unambiguous code, stored and audited; manager only', async () => {
      const id = await mk({ p_auto: false });
      const res = await appRpc(manager, 'generate_promo_code', { p_id: id });
      expect(res.error).toBeNull();
      const code = res.data as string;
      expect(code).toHaveLength(8);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);

      const { data: row } = await svc.from('promotions').select('public_code').eq('id', id).single();
      expect((row as { public_code: string }).public_code).toBe(code);

      // Regenerating replaces the code.
      const res2 = await appRpc(manager, 'generate_promo_code', { p_id: id });
      expect(res2.data).not.toBe(code);

      const { data: audit } = await svc
        .from('audit_log')
        .select('action')
        .eq('entity_id', id)
        .eq('action', 'promotion.generate_code');
      expect(audit).toHaveLength(2);

      expect(outcome(await appRpc(cashier, 'generate_promo_code', { p_id: id })).errorMessage).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // Money helper parity (SQL twin of @touch/core promotionDiscountIqd)
  // -------------------------------------------------------------------------
  it('app.promotion_amount_iqd equals the bigint reference for every percent, and caps amounts', async () => {
    for (const base of [0, 1, 15, 999, 1_250, 6_000, 10_000, 1_000_000]) {
      for (const pct of [1, 7, 10, 15, 33, 50, 99]) {
        const { data, error } = await svc.schema('app').rpc('promotion_amount_iqd', {
          p_base: base, p_type: 'percent', p_value: pct,
        });
        expect(error, `${base} @ ${pct}%`).toBeNull();
        expect(Number(data)).toBe(pctDiscountRef(base, pct));
      }
    }
    const capped = await svc.schema('app').rpc('promotion_amount_iqd', { p_base: 1_000, p_type: 'amount', p_value: 1_500 });
    expect(Number(capped.data)).toBe(1_000);
    const bad = await svc.schema('app').rpc('promotion_amount_iqd', { p_base: 1_000, p_type: 'percent', p_value: 100 });
    expect(bad.error?.message).toBe('INVALID_PCT');
  });

  // -------------------------------------------------------------------------
  // Eligibility
  // -------------------------------------------------------------------------
  describe('app.eligible_promotions', () => {
    it('prices a whole-bill percent promotion off the goods subtotal', async () => {
      const id = await mk({ p_value: 15 });
      const tabId = await tabAB('elig-basic');
      const list = await eligible(tabId);
      expect(list.map((e) => e.promotionId)).toEqual([id]);
      expect(list[0]).toMatchObject({ type: 'percent', value: 15, amountIqd: pctDiscountRef(10_000, 15) });
      expect(list[0]!.name_ar).toMatch(/^عرض/);
    });

    it('respects starts_at / ends_at and disabled', async () => {
      const tabId = await tabAB('elig-window');
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const notYet = await mk({ p_starts_at: future });
      const expired = await mk({ p_starts_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), p_ends_at: past });
      const off = await mk({ p_enabled: false });
      const live = await mk({ p_starts_at: past, p_ends_at: future });
      const ids = (await eligible(tabId)).map((e) => e.promotionId);
      expect(ids).toEqual([live]);
      expect(ids).not.toContain(notYet);
      expect(ids).not.toContain(expired);
      expect(ids).not.toContain(off);
    });

    it('respects the weekday and the hour window in the venue timezone, crossing midnight', async () => {
      const tabId = await tabAB('elig-time');
      const { hour, dow } = venueNow();
      const today = await mk({ p_weekdays: [dow] });
      const otherDay = await mk({ p_weekdays: [(dow + 1) % 7, (dow + 2) % 7] });
      // [h-1, h+2): contains now with an hour of margin either side; crosses
      // midnight for h = 0 or h >= 22, exercising the wrap branch.
      const inWindow = await mk({ p_hour_from: hh(hour - 1), p_hour_to: hh(hour + 2) });
      const outside = await mk({ p_hour_from: hh(hour + 3), p_hour_to: hh(hour + 4) });
      const ids = (await eligible(tabId)).map((e) => e.promotionId);
      expect(ids).toContain(today);
      expect(ids).toContain(inWindow);
      expect(ids).not.toContain(otherDay);
      expect(ids).not.toContain(outside);
    });

    it('restricts the base to scoped items / categories, and never below 1 IQD', async () => {
      const tabId = await tabAB('elig-scope');
      const onA = await mk({ p_scope: { itemIds: [itemA.itemId] } });          // base 6,000
      const onCatB = await mk({ p_scope: { categoryIds: [itemB.categoryId] } }); // base 4,000
      const third = await createTestMenuItem(svc, 'promo-c', 1000);
      const onC = await mk({ p_scope: { itemIds: [third.itemId] } });          // base 0 -> not eligible
      const list = await eligible(tabId);
      const by = Object.fromEntries(list.map((e) => [e.promotionId, e.amountIqd]));
      expect(by[onA]).toBe(pctDiscountRef(6_000, 10));
      expect(by[onCatB]).toBe(pctDiscountRef(4_000, 10));
      expect(by[onC]).toBeUndefined();
    });

    it('courtIds: only a tab charged to a booking on one of those courts', async () => {
      const { reservationId, courtId } = await booking();
      const { courtId: otherCourt } = await booking();
      const onCourt = await mk({ p_scope: { courtIds: [courtId] } });
      const onOther = await mk({ p_scope: { courtIds: [otherCourt] } });

      const noBooking = await tabAB('elig-court-none');
      expect((await eligible(noBooking)).map((e) => e.promotionId)).toEqual([]);

      const withBooking = await tabAB('elig-court');
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', withBooking);
      const ids = (await eligible(withBooking)).map((e) => e.promotionId);
      expect(ids).toEqual([onCourt]);
      expect(ids).not.toContain(onOther);
      // The court fee is outside the discount base (0053): 10 % of the goods.
      expect((await eligible(withBooking))[0]!.amountIqd).toBe(pctDiscountRef(10_000, 10));
    });

    it('minSpendIqd compares against the gross (goods + court)', async () => {
      const tabId = await tabAB('elig-minspend');
      const tooHigh = await mk({ p_limits: { minSpendIqd: 10_001 } });
      const exact = await mk({ p_limits: { minSpendIqd: 10_000 } });
      let ids = (await eligible(tabId)).map((e) => e.promotionId);
      expect(ids).toEqual([exact]);
      expect(ids).not.toContain(tooHigh);

      // Charging the tab to a 40,000 booking lifts the gross past the bar.
      const { reservationId } = await booking();
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);
      ids = (await eligible(tabId)).map((e) => e.promotionId);
      expect(ids).toContain(tooHigh);
    });

    it('a code promotion is eligible only with its code; an unknown code is named', async () => {
      const tabId = await tabAB('elig-code');
      const id = await mk({ p_auto: false });
      const code = (await appRpc(manager, 'generate_promo_code', { p_id: id })).data as string;
      expect((await eligible(tabId)).map((e) => e.promotionId)).toEqual([]);
      expect((await eligible(tabId, ` ${code.toLowerCase()} `)).map((e) => e.promotionId)).toEqual([id]);
      const bad = await appRpc(cashier, 'eligible_promotions', { p_tab_id: tabId, p_code: 'NOPE9999' });
      expect(bad.error?.message).toBe('CODE_INVALID');
    });

    it('is till-only: prep and a guest are refused; a missing tab is named', async () => {
      const tabId = await tabAB('elig-guard');
      expect(outcome(await appRpc(prep, 'eligible_promotions', { p_tab_id: tabId })).errorMessage).toBe('FORBIDDEN');
      const guest = await anonymousSessionClient();
      expect(outcome(await appRpc(guest, 'eligible_promotions', { p_tab_id: tabId })).errorMessage).toBe('FORBIDDEN');
      expect(outcome(await appRpc(cashier, 'eligible_promotions', {
        p_tab_id: '00000000-0000-4000-8000-000000000000',
      })).errorMessage).toBe('TAB_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // Applying
  // -------------------------------------------------------------------------
  describe('app.apply_best_promotion', () => {
    it('applies the single best of two, as a promotion adjustment authorised by the configuring manager', async () => {
      const tenPct = await mk({ p_value: 10 });                       // 1,000
      const fifteenHundred = await mk({ p_type: 'amount', p_value: 1500 }); // 1,500
      const tabId = await tabAB('apply-best');

      const list = await eligible(tabId);
      expect(list.map((e) => e.promotionId)).toEqual([fifteenHundred, tenPct]);
      expect(list.map((e) => e.amountIqd)).toEqual([1500, 1000]);

      const res = await apply(tabId);
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ promotionId: fifteenHundred, amountIqd: 1500, unchanged: false, replacedPromotionId: null });

      const rows = await promoRows(tabId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: 'discount_amount',
        value: 1500,
        amount_iqd: 1500,
        reason_code: 'promotion',
        promotion_id: fifteenHundred,
        applied_by: SEED_STAFF_IDS.cashier,
        authorized_by: SEED_STAFF_IDS.manager,
      });
      const reds = await redemptions(tabId);
      expect(reds).toHaveLength(1);
      expect(reds[0]).toMatchObject({ promotion_id: fifteenHundred, amount_iqd: 1500, code_used: null });

      const { data: audit } = await svc
        .from('audit_log')
        .select('action, reason_code, authorizer_id, device_id')
        .eq('entity_id', (res.data as Applied).adjustmentId)
        .eq('action', 'promotion.apply')
        .single();
      expect(audit).toMatchObject({ reason_code: 'promotion', authorizer_id: SEED_STAFF_IDS.manager, device_id: 'TILL-TEST' });
    });

    it('reaches the bill: compute_tab_totals, settle_tab and the stamped tab agree', async () => {
      await mk({ p_value: 20 }); // 2,000 off 10,000
      const tabId = await tabAB('apply-bill');
      await apply(tabId);
      const t = await totals(tabId);
      expect(t).toMatchObject({ subtotal_iqd: 10_000, discount_iqd: 2_000, total_iqd: 8_000 });

      const settled = await appRpc(cashier, 'settle_tab', {
        p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 10_000, p_idempotency_key: testIdemKey('payment.record'),
      });
      expect(settled.error).toBeNull();
      expect(settled.data).toMatchObject({ status: 'settled', discount_iqd: 2_000, total_iqd: 8_000, change_iqd: 2_000 });
      const { data: tab } = await svc.from('tabs').select('discount_iqd, total_iqd').eq('id', tabId).single();
      expect(tab).toEqual({ discount_iqd: 2_000, total_iqd: 8_000 });

      // A settled tab takes no promotion.
      expect(outcome(await apply(tabId)).errorMessage).toBe('TAB_NOT_OPEN');
    });

    it('stores percent as basis points, the convention apply_discount uses', async () => {
      await mk({ p_value: 7 });
      const tabId = await tabAB('apply-bp');
      await apply(tabId);
      expect((await promoRows(tabId))[0]).toMatchObject({ kind: 'discount_percent', value: 700, amount_iqd: pctDiscountRef(10_000, 7) });
    });

    it('re-apply replaces: one promotion per tab, the replacement audited; same promotion is a no-op', async () => {
      const first = await mk({ p_value: 10 });
      const tabId = await tabAB('apply-replace');
      const r1 = (await apply(tabId)).data as Applied;
      expect(r1.promotionId).toBe(first);

      // Same best, same amount: nothing rewritten.
      const same = (await apply(tabId)).data as Applied;
      expect(same).toMatchObject({ promotionId: first, adjustmentId: r1.adjustmentId, unchanged: true });

      // The bill grows: the same promotion is worth more, so it IS rewritten.
      await addItem(tabId, itemA); // goods now 16,000
      const grown = (await apply(tabId)).data as Applied;
      expect(grown).toMatchObject({ promotionId: first, amountIqd: pctDiscountRef(16_000, 10), unchanged: false, replacedPromotionId: first });

      const better = await mk({ p_type: 'amount', p_value: 3000 });
      const r2 = (await apply(tabId)).data as Applied;
      expect(r2).toMatchObject({ promotionId: better, amountIqd: 3000, replacedPromotionId: first });

      const rows = await promoRows(tabId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.promotion_id).toBe(better);
      expect(await redemptions(tabId)).toHaveLength(1);
      expect((await totals(tabId)).discount_iqd).toBe(3000);

      const { data: audit } = await svc
        .from('audit_log')
        .select('action, entity_id, before')
        .eq('action', 'promotion.replace')
        .in('entity_id', [r1.adjustmentId, grown.adjustmentId]);
      expect(audit).toHaveLength(2);
      const replaced = (audit as { entity_id: string; before: { promotion_id: string; redemption: unknown } }[])
        .find((a) => a.entity_id === grown.adjustmentId)!;
      expect(replaced.before.promotion_id).toBe(first);
      expect(replaced.before.redemption).toBeTruthy();
    });

    it('is idempotent on the key, and the key belongs to its caller', async () => {
      await mk();
      const tabId = await tabAB('apply-idem');
      const key = testIdemKey('promotion.apply');
      const a = (await apply(tabId, undefined, key)).data as Applied;
      const b = (await apply(tabId, undefined, key)).data as Applied;
      expect(b).toMatchObject({ promotionId: a.promotionId, amountIqd: a.amountIqd, duplicate: true });
      expect(await redemptions(tabId)).toHaveLength(1);
      expect(outcome(await apply(tabId, undefined, key, manager)).errorMessage).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('raises NO_ELIGIBLE_PROMOTION when nothing applies, and a disabled promotion never applies', async () => {
      await mk({ p_enabled: false });
      const tabId = await tabAB('apply-none');
      expect(outcome(await apply(tabId)).errorMessage).toBe('NO_ELIGIBLE_PROMOTION');
      expect(await promoRows(tabId)).toHaveLength(0);
    });

    it('a single-use code is refused the second time; a known ineligible code is named', async () => {
      const id = await mk({ p_auto: false, p_code_single_use: true });
      const code = (await appRpc(manager, 'generate_promo_code', { p_id: id })).data as string;
      const tab1 = await tabAB('code-1');
      const r = await apply(tab1, code);
      expect(r.error).toBeNull();
      expect((await redemptions(tab1))[0]!.code_used).toBe(code);

      // Re-applying on the SAME tab with the same code is fine (its own redemption).
      expect((await apply(tab1, code)).error).toBeNull();

      const tab2 = await tabAB('code-2');
      expect(outcome(await apply(tab2, code)).errorMessage).toBe('CODE_NOT_ELIGIBLE');
      expect(outcome(await apply(tab2, 'ZZZZ9999')).errorMessage).toBe('CODE_INVALID');
      expect(await promoRows(tab2)).toHaveLength(0);
    });

    it('limits.total counts redemptions on other tabs', async () => {
      await mk({ p_limits: { total: 1 } });
      const tab1 = await tabAB('total-1');
      expect((await apply(tab1)).error).toBeNull();
      expect((await apply(tab1)).error).toBeNull(); // own redemption never blocks
      const tab2 = await tabAB('total-2');
      expect(outcome(await apply(tab2)).errorMessage).toBe('NO_ELIGIBLE_PROMOTION');
    });

    it('limits.perCustomer counts by the booking guest; an unidentified tab is not eligible', async () => {
      const guest = await guestClient(svc, 'promo');
      const guestId = (await guest.auth.getUser()).data.user!.id;
      await guest.auth.signOut();
      const id = await mk({ p_limits: { perCustomer: 1 } });

      const anon = await tabAB('cust-anon');
      expect((await eligible(anon)).map((e) => e.promotionId)).toEqual([]);

      const b1 = await booking(guestId);
      const tab1 = await tabAB('cust-1');
      await svc.from('tabs').update({ reservation_id: b1.reservationId }).eq('id', tab1);
      expect((await apply(tab1)).data).toMatchObject({ promotionId: id });
      expect((await redemptions(tab1))[0]!.customer_id).toBe(guestId);

      const b2 = await booking(guestId);
      const tab2 = await tabAB('cust-2');
      await svc.from('tabs').update({ reservation_id: b2.reservationId }).eq('id', tab2);
      expect(outcome(await apply(tab2)).errorMessage).toBe('NO_ELIGIBLE_PROMOTION');

      // A different guest is unaffected.
      const other = await guestClient(svc, 'promo-other');
      const otherId = (await other.auth.getUser()).data.user!.id;
      await other.auth.signOut();
      const b3 = await booking(otherId);
      const tab3 = await tabAB('cust-3');
      await svc.from('tabs').update({ reservation_id: b3.reservationId }).eq('id', tab3);
      expect((await apply(tab3)).error).toBeNull();
    });

    it('cashier can apply; prep and a guest cannot; nothing is written for a missing tab', async () => {
      await mk();
      const tabId = await tabAB('apply-guard');
      expect(outcome(await apply(tabId, undefined, undefined, prep)).errorMessage).toBe('FORBIDDEN');
      const guest = await anonymousSessionClient();
      expect(outcome(await apply(tabId, undefined, undefined, guest)).errorMessage).toBe('FORBIDDEN');
      expect(outcome(await apply('00000000-0000-4000-8000-000000000000')).errorMessage).toBe('TAB_NOT_FOUND');
      expect((await apply(tabId)).error).toBeNull();
    });

    it('merge_tabs drops the donor promotion (audited) and keeps the survivor one', async () => {
      await mk({ p_value: 10 });
      const donor = await tabAB('merge-donor');
      const survivor = await tabAB('merge-survivor');
      const d = (await apply(donor)).data as Applied;
      const s = (await apply(survivor)).data as Applied;

      const merged = await appRpc(cashier, 'merge_tabs', { p_donor_tab_id: donor, p_survivor_tab_id: survivor });
      expect(merged.error).toBeNull();

      const rows = await promoRows(survivor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(s.adjustmentId);
      expect(await redemptions(donor)).toHaveLength(0);
      expect(await redemptions(survivor)).toHaveLength(1);

      const { data: audit } = await svc
        .from('audit_log')
        .select('action')
        .eq('entity_id', d.adjustmentId)
        .eq('action', 'promotion.drop_on_merge');
      expect(audit).toHaveLength(1);

      // The survivor's snapshot is stale against 20,000 of goods; a re-apply refreshes it.
      const refreshed = (await apply(survivor)).data as Applied;
      expect(refreshed.amountIqd).toBe(pctDiscountRef(20_000, 10));
    });
  });

  // -------------------------------------------------------------------------
  // Day close + RLS
  // -------------------------------------------------------------------------
  it('day close counts a promotion as a discount authorised by the configuring manager', async () => {
    await mk({ p_type: 'amount', p_value: 1234 });
    const tabId = await tabAB('dayclose');
    const applied = (await apply(tabId)).data as Applied;
    await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId, p_method: 'card', p_idempotency_key: testIdemKey('payment.record'),
    });

    const { data: staffRow } = await svc.from('staff').select('display_name').eq('id', SEED_STAFF_IDS.manager).single();
    const managerName = (staffRow as { display_name: string }).display_name;

    const { data: summary, error } = await manager
      .from('v_day_close_summary')
      .select('discounts_iqd, adjustment_count, authorizer_names')
      .eq('day_session_id', dayId)
      .single();
    expect(error).toBeNull();
    const s = summary as { discounts_iqd: number; adjustment_count: number; authorizer_names: string[] };
    expect(Number(s.discounts_iqd)).toBeGreaterThanOrEqual(1234);
    expect(s.adjustment_count).toBeGreaterThanOrEqual(1);
    expect(s.authorizer_names).toContain(managerName);

    const { data: drill } = await manager
      .from('v_day_close_adjustments')
      .select('kind, amount_iqd, reason_code, authorized_by_name, applied_by_name')
      .eq('adjustment_id', applied.adjustmentId)
      .single();
    expect(drill).toMatchObject({
      kind: 'discount_amount', amount_iqd: 1234, reason_code: 'promotion', authorized_by_name: managerName,
    });
  });

  it('RLS: every staff role reads promotions, guests get silence, anon is denied, writes are refused', async () => {
    await mk();
    const { data: asPrep, error: prepErr } = await prep.from('promotions').select('id').limit(1);
    expect(prepErr).toBeNull();
    expect(asPrep!.length).toBeGreaterThan(0);

    const guest = await anonymousSessionClient();
    const { data: asGuest, error: guestErr } = await guest.from('promotions').select('id').limit(1);
    expect(guestErr).toBeNull();
    expect(asGuest).toHaveLength(0);
    const { data: guestReds, error: guestRedErr } = await guest.from('promotion_redemptions').select('id').limit(1);
    expect(guestRedErr).toBeNull();
    expect(guestReds).toHaveLength(0);

    const { error: anonErr } = await anonClient().from('promotions').select('id').limit(1);
    expect(anonErr).not.toBeNull();

    const { error: ins } = await manager.from('promotions').insert({
      name_en: 'x', name_ar: 'س', type: 'percent', value: 1, created_by: SEED_STAFF_IDS.manager,
    });
    expect(ins).not.toBeNull();
    const { error: upd } = await manager.from('promotions').update({ enabled: false }).eq('id', made[0]!);
    expect(upd).not.toBeNull();
    const { error: del } = await manager.from('promotions').delete().eq('id', made[0]!);
    expect(del).not.toBeNull();
  });
});
