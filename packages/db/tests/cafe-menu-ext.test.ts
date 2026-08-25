/**
 * Cafe rebuild — menu extensions (0027), modifier reveals (0028), cafe
 * settings (0029), order pricing / featured discount (0030) and tables +
 * storage (0031). Disjoint from cafe-flow.test.ts (wave-3 split).
 *
 * Runs against the live local stack; skips itself when the stack is down.
 * Every setting / flag it flips is restored in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestMenuItem,
  addModifierToItem,
  addRevealGroup,
  createTestCafeTable,
  openGuestSession,
  ensureOpenDay,
  ensureTillFresh,
  setCafeSetting,
  snapshotCafeSettings,
  type GuestSession,
} from './helpers';
import { applyPctDiscountIqd } from '../../core/src/money/discount';

const up = await stackAvailable();

describe.skipIf(!up)('cafe menu extensions (0027-0031: sold_out / photo / cost / reveals / settings / bell / storage)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let anon: SupabaseClient;

  let tableId: string;
  let guest: GuestSession;
  let restoreSettings: () => Promise<void>;

  // Items under test
  let plain: { categoryId: string; itemId: string; variantId: string }; // sold_out / photo / cost
  let featured: { categoryId: string; itemId: string; variantId: string }; // 15 % promo
  let meal: { categoryId: string; itemId: string; variantId: string }; // reveals
  let mealModifierId: string; // linked group G1: "make it a meal"
  let mealGroupId: string;
  let drinkGroupId: string; // revealed group G2 (min 1 / max 1)
  let colaId: string;
  let waterId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    anon = anonClient();

    restoreSettings = await snapshotCafeSettings(svc, owner);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);

    plain = await createTestMenuItem(svc, 'ext-plain', 2_500);
    featured = await createTestMenuItem(svc, 'ext-featured', 7_777);
    meal = await createTestMenuItem(svc, 'ext-meal', 4_000);
    const m = await addModifierToItem(svc, meal.itemId, 'اجعلها وجبة', 1_500);
    mealModifierId = m.modifierId;
    mealGroupId = m.groupId;
    const reveal = await addRevealGroup(svc, mealModifierId, { min: 1, max: 1 }, [
      { nameAr: 'كولا', deltaIqd: 500 },
      { nameAr: 'ماء', deltaIqd: 0 },
    ]);
    drinkGroupId = reveal.groupId;
    colaId = reveal.modifierIds[0]!;
    waterId = reveal.modifierIds[1]!;

    tableId = await createTestCafeTable(svc, 'EXT');
    guest = await openGuestSession(owner, tableId);
  });

  afterAll(async () => {
    if (!svc) return;
    await restoreSettings?.();
    if (plain) await svc.from('menu_items').update({ sold_out: false }).eq('id', plain.itemId);
    if (tableId) await svc.from('cafe_tables').update({ bell_enabled: true }).eq('id', tableId);
  });

  const order = (client: SupabaseClient, items: unknown[]) =>
    appRpc(client, 'create_guest_order', {
      p_items: items,
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);

  // ── sold_out ──────────────────────────────────────────────────────────────

  it('sold_out: availability view reports orderable=false and guest ordering raises ITEM_UNAVAILABLE', async () => {
    const on = await appRpc(manager, 'set_item_sold_out', {
      p_item_id: plain.itemId,
      p_sold_out: true,
    }).then(outcome);
    expect(on.ok, on.errorMessage).toBe(true);

    const { data: av } = await anon
      .from('menu_item_availability')
      .select('item_id, orderable')
      .eq('item_id', plain.itemId)
      .single();
    expect((av as { orderable: boolean }).orderable).toBe(false);

    const refused = await order(guest.client, [{ variant_id: plain.variantId, qty: 1 }]);
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toContain('ITEM_UNAVAILABLE');

    const off = await appRpc(manager, 'set_item_sold_out', {
      p_item_id: plain.itemId,
      p_sold_out: false,
    }).then(outcome);
    expect(off.ok, off.errorMessage).toBe(true);
    const { data: av2 } = await anon
      .from('menu_item_availability')
      .select('orderable')
      .eq('item_id', plain.itemId)
      .single();
    expect((av2 as { orderable: boolean }).orderable).toBe(true);

    const nullFlag = await appRpc(manager, 'set_item_sold_out', {
      p_item_id: plain.itemId,
      p_sold_out: null,
    }).then(outcome);
    expect(nullFlag.errorMessage).toContain('INVALID_SOLD_OUT');
  });

  // ── photo path validation ─────────────────────────────────────────────────

  it('set_item_photo: items/ prefix + safe segments only (INVALID_PHOTO_PATH), blur capped at 400', async () => {
    const bad = [
      'categories/x/y.webp', // wrong prefix for an item
      'items/../secret.webp', // traversal
      'items//x.webp', // empty segment
      'items/.hidden.webp', // dot segment
      'items/x/y.gif', // extension not allowed
      'x.webp',
    ];
    for (const p of bad) {
      const r = await appRpc(manager, 'set_item_photo', {
        p_item_id: plain.itemId,
        p_photo_path: p,
      }).then(outcome);
      expect(r.ok, p).toBe(false);
      expect(r.errorMessage, p).toContain('INVALID_PHOTO_PATH');
    }

    const longBlur = await appRpc(manager, 'set_item_photo', {
      p_item_id: plain.itemId,
      p_photo_path: `items/${plain.itemId}/a.webp`,
      p_photo_blur: 'x'.repeat(401),
    }).then(outcome);
    expect(longBlur.errorMessage).toContain('PHOTO_BLUR_TOO_LONG');

    const ok = await appRpc(manager, 'set_item_photo', {
      p_item_id: plain.itemId,
      p_photo_path: `items/${plain.itemId}/01HZZ.webp`,
      p_photo_blur: 'data:image/webp;base64,UklGRg==',
    }).then(outcome);
    expect(ok.ok, ok.errorMessage).toBe(true);

    const { data: row } = await svc
      .from('menu_items')
      .select('photo_path, photo_blur')
      .eq('id', plain.itemId)
      .single();
    expect((row as { photo_path: string }).photo_path).toBe(`items/${plain.itemId}/01HZZ.webp`);
    expect((row as { photo_blur: string }).photo_blur).toBe('data:image/webp;base64,UklGRg==');

    // Guests never set photos.
    const guestTry = await appRpc(guest.client, 'set_item_photo', {
      p_item_id: plain.itemId,
      p_photo_path: `items/${plain.itemId}/evil.webp`,
    }).then(outcome);
    expect(guestTry.errorMessage).toContain('FORBIDDEN');
  });

  // ── upsert_menu_item must not wipe the dedicated-setter columns ───────────

  it('upsert_menu_item keeps photo / sold_out / cost intact (photo-wipe bug fixed)', async () => {
    const cost = await appRpc(manager, 'set_item_cost', {
      p_item_id: plain.itemId,
      p_cost_iqd: 1_234,
    }).then(outcome);
    expect(cost.ok, cost.errorMessage).toBe(true);
    const so = await appRpc(manager, 'set_item_sold_out', {
      p_item_id: plain.itemId,
      p_sold_out: true,
    }).then(outcome);
    expect(so.ok, so.errorMessage).toBe(true);

    const mismatch = await appRpc(manager, 'upsert_menu_item', {
      p_id: plain.itemId,
      p_category_id: plain.categoryId,
      p_name_en: 'Plain (edited)',
      p_name_ar: 'عادي (معدل)',
      p_hook_en: 'Only in English',
    }).then(outcome);
    expect(mismatch.errorMessage).toContain('HOOK_PAIR_MISMATCH');

    const edited = await appRpc(manager, 'upsert_menu_item', {
      p_id: plain.itemId,
      p_category_id: plain.categoryId,
      p_name_en: 'Plain (edited)',
      p_name_ar: 'عادي (معدل)',
      p_hook_en: 'Fresh daily',
      p_hook_ar: 'طازج يومياً',
      p_highlight: 'blue',
    }).then(outcome);
    expect(edited.ok, edited.errorMessage).toBe(true);
    expect(edited.data).toBe(plain.itemId);

    const { data: row } = await svc
      .from('menu_items')
      .select('name_en, hook_en, hook_ar, highlight, photo_path, photo_blur, sold_out')
      .eq('id', plain.itemId)
      .single();
    const r = row as {
      name_en: string;
      hook_ar: string;
      highlight: string;
      photo_path: string | null;
      photo_blur: string | null;
      sold_out: boolean;
    };
    expect(r.name_en).toBe('Plain (edited)');
    expect(r.hook_ar).toBe('طازج يومياً');
    expect(r.highlight).toBe('blue');
    expect(r.photo_path).toBe(`items/${plain.itemId}/01HZZ.webp`); // NOT wiped
    expect(r.photo_blur).not.toBeNull();
    expect(r.sold_out).toBe(true); // NOT wiped

    const { data: c } = await svc
      .from('menu_item_costs')
      .select('cost_iqd')
      .eq('item_id', plain.itemId)
      .single();
    expect((c as { cost_iqd: number }).cost_iqd).toBe(1_234); // NOT wiped

    await appRpc(manager, 'set_item_sold_out', { p_item_id: plain.itemId, p_sold_out: false });
  });

  it('menu_item_costs: manager reads it, cashier / guest get RLS silence, anon is denied', async () => {
    const mgr = await manager.from('menu_item_costs').select('item_id, cost_iqd').eq('item_id', plain.itemId);
    expect(mgr.error).toBeNull();
    expect(mgr.data).toHaveLength(1);
    expect((mgr.data![0] as { cost_iqd: number }).cost_iqd).toBe(1_234);

    const csh = await cashier.from('menu_item_costs').select('item_id, cost_iqd').eq('item_id', plain.itemId);
    expect(csh.error).toBeNull();
    expect(csh.data).toHaveLength(0);

    const gst = await guest.client.from('menu_item_costs').select('item_id, cost_iqd').eq('item_id', plain.itemId);
    expect(gst.error).toBeNull();
    expect(gst.data).toHaveLength(0);

    const an = await anon.from('menu_item_costs').select('item_id, cost_iqd').eq('item_id', plain.itemId);
    expect(an.error).not.toBeNull();

    // menu_items itself stays fully selectable (no cost column leaks there).
    const mi = await anon.from('menu_items').select('*').eq('id', plain.itemId).single();
    expect(mi.error).toBeNull();
    expect(Object.keys(mi.data as object)).not.toContain('cost_iqd');

    // NULL cost = unknown = row deleted (never coerced to 0); negative refused.
    const neg = await appRpc(manager, 'set_item_cost', { p_item_id: plain.itemId, p_cost_iqd: -1 }).then(outcome);
    expect(neg.errorMessage).toContain('INVALID_COST');
    const clear = await appRpc(manager, 'set_item_cost', { p_item_id: plain.itemId, p_cost_iqd: null }).then(outcome);
    expect(clear.ok, clear.errorMessage).toBe(true);
    const { data: gone } = await svc.from('menu_item_costs').select('item_id').eq('item_id', plain.itemId);
    expect(gone).toHaveLength(0);
  });

  // ── modifier reveals ──────────────────────────────────────────────────────

  it('reveals: a revealed-group modifier is MODIFIER_INVALID without its revealing option, accepted with it', async () => {
    const orphan = await order(guest.client, [
      { variant_id: meal.variantId, qty: 1, modifiers: [{ modifier_id: colaId, qty: 1 }] },
    ]);
    expect(orphan.ok).toBe(false);
    expect(orphan.errorMessage).toContain('MODIFIER_INVALID');

    const withMeal = await order(guest.client, [
      {
        variant_id: meal.variantId,
        qty: 1,
        modifiers: [{ modifier_id: mealModifierId, qty: 1 }, { modifier_id: colaId, qty: 1 }],
      },
    ]);
    expect(withMeal.ok, withMeal.errorMessage).toBe(true);
    expect(Number((withMeal.data as { total_iqd: number }).total_iqd)).toBe(4_000 + 1_500 + 500);
  });

  it('reveals: the revealed group min_select=1 applies ONLY when revealed (MODIFIER_SELECTION)', async () => {
    // Meal chosen -> the drink group is active -> min 1 enforced.
    const noDrink = await order(guest.client, [
      { variant_id: meal.variantId, qty: 1, modifiers: [{ modifier_id: mealModifierId, qty: 1 }] },
    ]);
    expect(noDrink.ok).toBe(false);
    expect(noDrink.errorMessage).toContain('MODIFIER_SELECTION');

    // Meal chosen with two drinks -> max 1 violated.
    const twoDrinks = await order(guest.client, [
      {
        variant_id: meal.variantId,
        qty: 1,
        modifiers: [
          { modifier_id: mealModifierId, qty: 1 },
          { modifier_id: colaId, qty: 1 },
          { modifier_id: waterId, qty: 1 },
        ],
      },
    ]);
    expect(twoDrinks.errorMessage).toContain('MODIFIER_SELECTION');

    // No meal -> the drink group is inactive -> its min does not apply.
    const bare = await order(guest.client, [{ variant_id: meal.variantId, qty: 1 }]);
    expect(bare.ok, bare.errorMessage).toBe(true);
    expect(Number((bare.data as { total_iqd: number }).total_iqd)).toBe(4_000);
  });

  it('set_modifier_reveals: REVEAL_SELF / REVEAL_DEPTH (both directions) / manager ok / guest FORBIDDEN', async () => {
    const self = await appRpc(manager, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: [mealGroupId],
    }).then(outcome);
    expect(self.errorMessage).toContain('REVEAL_SELF');

    // (b) cola's own group (G2) is already a reveal target -> cola may not reveal.
    const scratch = await createTestMenuItem(svc, 'ext-scratch', 1_000);
    const g3 = await addModifierToItem(svc, scratch.itemId, 'خيار ثالث', 0);
    const depthB = await appRpc(manager, 'set_modifier_reveals', {
      p_modifier_id: colaId,
      p_group_ids: [g3.groupId],
    }).then(outcome);
    expect(depthB.errorMessage).toContain('REVEAL_DEPTH');

    // (a) a target group containing a modifier that reveals something itself.
    await addRevealGroup(svc, g3.modifierId, { min: 0, max: 1 }, [{ nameAr: 'فرعي', deltaIqd: 0 }]);
    const depthA = await appRpc(manager, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: [g3.groupId],
    }).then(outcome);
    expect(depthA.errorMessage).toContain('REVEAL_DEPTH');

    const nf = await appRpc(manager, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: ['00000000-0000-4000-8000-000000000000'],
    }).then(outcome);
    expect(nf.errorMessage).toContain('GROUP_NOT_FOUND');

    // Happy path: replace wholesale (same list, duplicates ignored) — rows survive unchanged.
    const ok = await appRpc(manager, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: [drinkGroupId, drinkGroupId],
    }).then(outcome);
    expect(ok.ok, ok.errorMessage).toBe(true);
    const { data: rows } = await anon
      .from('modifier_reveals')
      .select('group_id, sort_order')
      .eq('modifier_id', mealModifierId);
    expect(rows).toEqual([{ group_id: drinkGroupId, sort_order: 0 }]);

    const guestTry = await appRpc(guest.client, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: [],
    }).then(outcome);
    expect(guestTry.errorMessage).toContain('FORBIDDEN');
    const cashierTry = await appRpc(cashier, 'set_modifier_reveals', {
      p_modifier_id: mealModifierId,
      p_group_ids: [],
    }).then(outcome);
    expect(cashierTry.errorMessage).toContain('FORBIDDEN');
  });

  // ── featured discount (0029 settings + 0030 pricing) ──────────────────────

  it('featured 15 % promo: unit = applyPctDiscountIqd(list, 15), list kept, discount_source=featured', async () => {
    await setCafeSetting(owner, 'hero_mode', 'featured');
    await setCafeSetting(owner, 'featured_item_id', featured.itemId);
    await setCafeSetting(owner, 'featured_discount_pct', 15);

    const res = await order(guest.client, [
      { variant_id: featured.variantId, qty: 2 },
      { variant_id: plain.variantId, qty: 1 }, // not featured: full price
    ]);
    expect(res.ok, res.errorMessage).toBe(true);
    const orderId = (res.data as { order_id: string }).order_id;

    const expectedUnit = Number(applyPctDiscountIqd(7_777, 15));
    expect(expectedUnit).toBe(6_610); // (7777*85 + 50) / 100, floored
    expect(Number((res.data as { total_iqd: number }).total_iqd)).toBe(expectedUnit * 2 + 2_500);

    const { data: lines } = await svc
      .from('order_items')
      .select('menu_item_id, unit_price_iqd, list_price_iqd, discount_pct, discount_source, line_total_iqd')
      .eq('order_id', orderId);
    type Line = {
      menu_item_id: string;
      unit_price_iqd: number;
      list_price_iqd: number;
      discount_pct: number;
      discount_source: string | null;
      line_total_iqd: number;
    };
    const promo = (lines as Line[]).find((l) => l.menu_item_id === featured.itemId)!;
    expect(promo.list_price_iqd).toBe(7_777);
    expect(promo.unit_price_iqd).toBe(expectedUnit);
    expect(promo.discount_pct).toBe(15);
    expect(promo.discount_source).toBe('featured');
    expect(promo.line_total_iqd).toBe(expectedUnit * 2);

    const full = (lines as Line[]).find((l) => l.menu_item_id === plain.itemId)!;
    expect(full.list_price_iqd).toBe(2_500);
    expect(full.unit_price_iqd).toBe(2_500);
    expect(full.discount_pct).toBe(0);
    expect(full.discount_source).toBeNull();

    // Promo off again -> the same item is back at list price.
    await setCafeSetting(owner, 'featured_discount_pct', 0);
    const again = await order(guest.client, [{ variant_id: featured.variantId, qty: 1 }]);
    expect(again.ok, again.errorMessage).toBe(true);
    expect(Number((again.data as { total_iqd: number }).total_iqd)).toBe(7_777);
  });

  it('app.apply_pct_discount parity with @touch/core applyPctDiscountIqd (pct 0..99 x list prices)', async () => {
    const lists = [1, 999, 7_777, 12_345, 250_001];
    const cases: { list: number; pct: number }[] = [];
    for (const list of lists) for (let pct = 0; pct <= 99; pct++) cases.push({ list, pct });

    const BATCH = 50;
    for (let i = 0; i < cases.length; i += BATCH) {
      const slice = cases.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((c) =>
          svc.schema('app').rpc('apply_pct_discount', { p_list: c.list, p_pct: c.pct }),
        ),
      );
      results.forEach((r, j) => {
        const c = slice[j]!;
        expect(r.error, `${c.list} @ ${c.pct}%`).toBeNull();
        expect(Number(r.data), `${c.list} @ ${c.pct}%`).toBe(Number(applyPctDiscountIqd(c.list, c.pct)));
      });
    }

    // Both sides refuse out-of-range percentages.
    const bad = await svc.schema('app').rpc('apply_pct_discount', { p_list: 1000, p_pct: 100 });
    expect(bad.error?.message).toContain('INVALID_PCT');
    expect(() => applyPctDiscountIqd(1000, 100)).toThrow(RangeError);

    // Clients cannot call the internal helper at all.
    const denied = await appRpc(owner, 'apply_pct_discount', { p_list: 1000, p_pct: 10 });
    expect(denied.error?.message).toMatch(/permission denied/i);
  });

  // ── settings split ────────────────────────────────────────────────────────

  it('settings split: anon + guest read cafe_settings_public without any telegram_/analytics_ key; base table is staff-only', async () => {
    for (const [label, client] of [
      ['anon', anon],
      ['guest', guest.client],
    ] as const) {
      const pub = await client.from('cafe_settings_public').select('key, value');
      expect(pub.error, label).toBeNull();
      expect(pub.data!.length, label).toBeGreaterThan(0);
      const keys = (pub.data as { key: string }[]).map((k) => k.key);
      expect(keys.some((k) => k.startsWith('telegram_')), label).toBe(false);
      expect(keys.some((k) => k.startsWith('analytics_')), label).toBe(false);
      expect(keys, label).toContain('hero_mode');
    }

    const anonBase = await anon.from('cafe_settings').select('key');
    expect(anonBase.error).not.toBeNull();
    const guestBase = await guest.client.from('cafe_settings').select('key');
    expect(guestBase.error).toBeNull();
    expect(guestBase.data).toHaveLength(0);
    const mgrBase = await manager.from('cafe_settings').select('key').like('key', 'telegram_%');
    expect(mgrBase.error).toBeNull();
    expect(mgrBase.data!.length).toBeGreaterThan(0);
  });

  it('set_cafe_setting: manager FORBIDDEN on owner keys, owner ok; UNKNOWN_SETTING; INVALID_SETTING_VALUE cases', async () => {
    const mgr = await appRpc(manager, 'set_cafe_setting', {
      p_key: 'telegram_chat_id',
      p_value: '-1001234567890',
    }).then(outcome);
    expect(mgr.errorMessage).toContain('FORBIDDEN');

    const own = await appRpc(owner, 'set_cafe_setting', {
      p_key: 'telegram_chat_id',
      p_value: '-1001234567890',
    }).then(outcome);
    expect(own.ok, own.errorMessage).toBe(true);
    const stored = own.data as { key: string; value: string; is_public: boolean };
    expect(stored.key).toBe('telegram_chat_id');
    expect(stored.value).toBe('-1001234567890');
    expect(stored.is_public).toBe(false);

    // Managers may write content keys.
    const content = await appRpc(manager, 'set_cafe_setting', {
      p_key: 'featured_badge_en',
      p_value: 'New',
    }).then(outcome);
    expect(content.ok, content.errorMessage).toBe(true);

    // Guests / cashier: guarded.
    const g = await appRpc(guest.client, 'set_cafe_setting', { p_key: 'hero_mode', p_value: 'none' }).then(outcome);
    expect(g.errorMessage).toContain('FORBIDDEN');
    const c = await appRpc(cashier, 'set_cafe_setting', { p_key: 'hero_mode', p_value: 'none' }).then(outcome);
    expect(c.errorMessage).toContain('FORBIDDEN');

    const unknown = await appRpc(owner, 'set_cafe_setting', { p_key: 'nope', p_value: 1 }).then(outcome);
    expect(unknown.errorMessage).toContain('UNKNOWN_SETTING');

    const invalid: [string, unknown][] = [
      ['hero_mode', 'bogus'], // enum
      ['hero_mode', null], // null not allowed on enum
      ['hero_media_path', 'items/x.webp'], // wrong prefix (must be hero/)
      ['hero_media_path', 'hero/../x.webp'],
      ['featured_discount_pct', 150], // int range
      ['featured_discount_pct', 4.5], // not an integer
      ['featured_discount_pct', '15'], // string, not number
      ['featured_label_en', 'x'.repeat(201)], // text max
      ['ticker_en', 'not-an-array'],
      ['ticker_en', ['ok', 42]],
      ['bell_tutorial_enabled', 'yes'],
      ['telegram_chat_id', 'abc'],
      ['telegram_chat_id', '123'], // too short
      ['telegram_lang', 'fr'],
      ['telegram_last_callback_at', 'not-a-date'],
      ['analytics_business_day_start_hour', 13],
      ['analytics_excluded_item_ids', ['not-a-uuid']],
      ['analytics_engagement_floor', '2026-13-45'],
    ];
    for (const [key, value] of invalid) {
      const r = await appRpc(owner, 'set_cafe_setting', { p_key: key, p_value: value }).then(outcome);
      expect(r.ok, `${key}=${JSON.stringify(value)}`).toBe(false);
      expect(r.errorMessage, `${key}=${JSON.stringify(value)}`).toContain('INVALID_SETTING_VALUE');
    }

    const missingItem = await appRpc(owner, 'set_cafe_setting', {
      p_key: 'featured_item_id',
      p_value: '00000000-0000-4000-8000-000000000000',
    }).then(outcome);
    expect(missingItem.errorMessage).toContain('ITEM_NOT_FOUND');

    // Nullable shapes accept JSON null.
    const nul = await appRpc(owner, 'set_cafe_setting', { p_key: 'telegram_chat_id', p_value: null }).then(outcome);
    expect(nul.ok, nul.errorMessage).toBe(true);
  });

  // ── bell + tables + QR tokens (0031) ──────────────────────────────────────

  it('bell: set_table_bell(false) -> guest raise_waiter_call BELL_DISABLED; open_table_session returns bell_enabled', async () => {
    const off = await appRpc(owner, 'set_table_bell', { p_table_id: tableId, p_enabled: false }).then(outcome);
    expect(off.ok, off.errorMessage).toBe(true);

    const refused = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'water' }).then(outcome);
    expect(refused.ok).toBe(false);
    expect(refused.errorMessage).toContain('BELL_DISABLED');
    const { data: none } = await svc.from('waiter_calls').select('id').eq('table_id', tableId);
    expect(none).toHaveLength(0);

    // A fresh scan sees the flag.
    const tok = await appRpc(owner, 'generate_table_token', { p_table_id: tableId });
    expect(tok.error).toBeNull();
    const scanner = await anonymousSessionClient();
    const opened = await appRpc(scanner, 'open_table_session', { p_token: tok.data }).then(outcome);
    expect(opened.ok, opened.errorMessage).toBe(true);
    const o = opened.data as { session_id: string; table_id: string; table_number: string; bell_enabled: boolean };
    expect(o.table_id).toBe(tableId);
    expect(o.bell_enabled).toBe(false);
    expect(typeof o.table_number).toBe('string');

    const on = await appRpc(manager, 'set_table_bell', { p_table_id: tableId, p_enabled: true }).then(outcome);
    expect(on.ok, on.errorMessage).toBe(true);
    const reopened = await appRpc(scanner, 'open_table_session', { p_token: tok.data }).then(outcome);
    expect((reopened.data as { bell_enabled: boolean }).bell_enabled).toBe(true);

    const guestTry = await appRpc(guest.client, 'set_table_bell', { p_table_id: tableId, p_enabled: false }).then(outcome);
    expect(guestTry.errorMessage).toContain('FORBIDDEN');
    const cashierTry = await appRpc(cashier, 'set_table_bell', { p_table_id: tableId, p_enabled: false }).then(outcome);
    expect(cashierTry.errorMessage).toContain('FORBIDDEN');
  });

  it('table_qr_tokens: every active table with a token that open_table_session accepts; upsert_cafe_table CRUD', async () => {
    const tokens = await appRpc(owner, 'table_qr_tokens', {}).then(outcome);
    expect(tokens.ok, tokens.errorMessage).toBe(true);
    type Row = {
      table_id: string;
      table_number: string;
      token: string;
      bell_enabled: boolean;
      is_active: boolean;
      token_version: number;
    };
    const rows = tokens.data as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.is_active)).toBe(true);
    const mine = rows.find((r) => r.table_id === tableId);
    expect(mine).toBeDefined();
    expect(mine!.bell_enabled).toBe(true);

    const scanner = await anonymousSessionClient();
    const opened = await appRpc(scanner, 'open_table_session', { p_token: mine!.token }).then(outcome);
    expect(opened.ok, opened.errorMessage).toBe(true);
    expect((opened.data as { table_id: string }).table_id).toBe(tableId);

    // Manager may export too; cashier / guest are guarded.
    const mgr = await appRpc(manager, 'table_qr_tokens', {}).then(outcome);
    expect(mgr.ok, mgr.errorMessage).toBe(true);
    const csh = await appRpc(cashier, 'table_qr_tokens', {}).then(outcome);
    expect(csh.errorMessage).toContain('FORBIDDEN');

    // upsert_cafe_table: create, rename, TABLE_NUMBER_TAKEN, INVALID_TABLE_NUMBER.
    const num = `QR-${Date.now()}`;
    const created = await appRpc(manager, 'upsert_cafe_table', {
      p_table_number: num,
      p_zone: 'حديقة',
      p_capacity: 6,
    }).then(outcome);
    expect(created.ok, created.errorMessage).toBe(true);
    const newId = created.data as string;
    const renamed = await appRpc(manager, 'upsert_cafe_table', {
      p_id: newId,
      p_table_number: `${num}-B`,
      p_zone: 'حديقة',
      p_capacity: 8,
    }).then(outcome);
    expect(renamed.ok, renamed.errorMessage).toBe(true);
    const { data: t } = await svc.from('cafe_tables').select('table_number, capacity, bell_enabled').eq('id', newId).single();
    expect(t).toEqual({ table_number: `${num}-B`, capacity: 8, bell_enabled: true });

    const taken = await appRpc(manager, 'upsert_cafe_table', { p_table_number: `${num}-B` }).then(outcome);
    expect(taken.errorMessage).toContain('TABLE_NUMBER_TAKEN');
    const blank = await appRpc(manager, 'upsert_cafe_table', { p_table_number: '  ' }).then(outcome);
    expect(blank.errorMessage).toContain('INVALID_TABLE_NUMBER');
    await svc.from('cafe_tables').update({ is_active: false }).eq('id', newId);
  });

  // ── storage bucket policies ───────────────────────────────────────────────

  it('storage menu-media: manager uploads items/x/y.webp, guest upload rejected, anon download ok', async (ctx) => {
    const bucket = await svc.storage.getBucket('menu-media').catch(() => ({ data: null, error: { message: 'unreachable' } }));
    if (bucket.error || !bucket.data) {
      ctx.skip(); // storage API unreachable / bucket missing on this stack
      return;
    }

    const path = `items/${plain.itemId}/${Date.now()}.webp`;
    // Minimal RIFF/WEBP header bytes — content is irrelevant to the policy test.
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

    const upload = await manager.storage
      .from('menu-media')
      .upload(path, bytes, { contentType: 'image/webp', upsert: true });
    expect(upload.error, upload.error?.message).toBeNull();

    const guestUpload = await guest.client.storage
      .from('menu-media')
      .upload(`items/${plain.itemId}/guest-${Date.now()}.webp`, bytes, { contentType: 'image/webp' });
    expect(guestUpload.error).not.toBeNull();

    const cashierUpload = await cashier.storage
      .from('menu-media')
      .upload(`items/${plain.itemId}/cashier-${Date.now()}.webp`, bytes, { contentType: 'image/webp' });
    expect(cashierUpload.error).not.toBeNull();

    // Top-level folder is pinned by the insert policy.
    const badFolder = await manager.storage
      .from('menu-media')
      .upload(`other/${Date.now()}.webp`, bytes, { contentType: 'image/webp' });
    expect(badFolder.error).not.toBeNull();

    const download = await anon.storage.from('menu-media').download(path);
    expect(download.error, download.error?.message).toBeNull();
    expect(download.data!.size).toBe(bytes.length);

    const guestDelete = await guest.client.storage.from('menu-media').remove([path]);
    // Storage returns an empty list (not an error) when RLS hides the object — either way it must survive.
    void guestDelete;
    const still = await anon.storage.from('menu-media').download(path);
    expect(still.error).toBeNull();

    const cleanup = await svc.storage.from('menu-media').remove([path]);
    expect(cleanup.error).toBeNull();
  });
});
