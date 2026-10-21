/**
 * 0355 — Touch Shop sales reward.
 *
 *   * the rate: a kind 'shop' tab that settles records the branch's
 *     shop_sale_reward_pct once (shop_sale_reward_rates); a café tab never does,
 *     and a later change of the setting never rewrites a past sale;
 *   * who earns: each line earns for the person who placed its order, at the
 *     tab's percent of what the customer paid for it (app.cafe_net_lines net:
 *     after discounts, less refunds); never the owner;
 *   * the shop's view: app.shop_reward_info gives the percent, each shop size's
 *     price, cost and reward, and the caller's own month so far; a waiter is
 *     refused;
 *   * month close and the wage: app.shop_reward_sweep turns a closed month into
 *     one frozen earning per person, paid in the next unpaid wage month, and
 *     app.wage_line counts it in bonuses_iqd and lists it in shop_rewards
 *     (in a rolled-back transaction, so no month is moved for real).
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  testIdemKey,
  createStaffOfRole,
  ensureOpenDay,
  setCafeSetting,
  createTestCafeTable,
  DEV_PINS,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SEED_TAX_GROUP_STANDARD,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

interface RewardInfo {
  pct: number;
  products: { variant_id: string; price_iqd: number; cost_iqd: number | null; reward_iqd: number }[];
  me: { month: string; month_sales_iqd: number; month_reward_iqd: number } | null;
}

describe.skipIf(!docker)('0355 shop sales reward', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let shopA: SupabaseClient;
  let shopB: SupabaseClient;
  let waiter: SupabaseClient;
  const made: string[] = [];
  let shopAId: string;
  let shopBId: string;
  let categoryId: string;
  let ball: { variantId: string; ingredientId: string };
  let racket: { variantId: string; ingredientId: string };

  async function staff(role: string, tag: string): Promise<{ id: string; client: SupabaseClient }> {
    const s = await createStaffOfRole(svc, role, tag);
    made.push(s.id);
    await svc.from('staff_venues').upsert({ staff_id: s.id, venue_id: VENUE_A_ID });
    return s;
  }

  async function product(tag: string, priceIqd: number, costIqd: number | null) {
    const { data, error } = await svc
      .from('menu_items')
      .insert({ category_id: categoryId, name_en: `Reward ${tag}`, name_ar: `مكافأة ${tag}`, is_active: true, venue_id: VENUE_A_ID })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const v = await appRpc(owner, 'upsert_retail_variant', {
      p_item_id: (data as { id: string }).id,
      p_name_en: 'One',
      p_name_ar: 'واحد',
      p_price_iqd: priceIqd,
    }).then(outcome);
    expect(v.ok, v.errorMessage).toBe(true);
    const d = v.data as { variant_id: string; ingredient_id: string };
    if (costIqd !== null) {
      const got = await appRpc(manager, 'receive_delivery', {
        p_lines: [{ ingredient_id: d.ingredient_id, qty_received: 20, unit_cost_iqd: costIqd }],
        p_idempotency_key: testIdemKey('receive'),
        p_location: 'shop',
      }).then(outcome);
      expect(got.ok, got.errorMessage).toBe(true);
    }
    return { variantId: d.variant_id, ingredientId: d.ingredient_id };
  }

  async function openShopTab(by: SupabaseClient): Promise<string> {
    const tab = await appRpc(by, 'open_tab', {
      p_label: `Reward sale ${Date.now()}`,
      p_kind: 'shop',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    return (tab.data as { tab_id: string }).tab_id;
  }
  async function add(by: SupabaseClient, tabId: string, lines: { variant_id: string; qty: number }[]) {
    const r = await appRpc(by, 'till_add_items', {
      p_tab_id: tabId,
      p_items: lines,
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    return r.data as { order_id: string };
  }
  async function settle(by: SupabaseClient, tabId: string): Promise<string> {
    const r = await appRpc(by, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 10_000_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    return (r.data as { payment_id: string }).payment_id;
  }
  async function rateOf(tabId: string): Promise<number | null> {
    const { data } = await svc.from('shop_sale_reward_rates').select('reward_pct').eq('tab_id', tabId).maybeSingle();
    return data ? (data as { reward_pct: number }).reward_pct : null;
  }
  async function info(c: SupabaseClient): Promise<RewardInfo> {
    const r = await appRpc(c, 'shop_reward_info', {}).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    return r.data as RewardInfo;
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    const a = await staff('shop_staff', 'reward-a');
    const b = await staff('shop_staff', 'reward-b');
    const w = await staff('waiter', 'reward-w');
    shopA = a.client;
    shopAId = a.id;
    shopB = b.client;
    shopBId = b.id;
    waiter = w.client;
    await ensureOpenDay(manager, svc);
    await setCafeSetting(owner, 'shop_sale_reward_pct', 10);
    const { data, error } = await svc
      .from('menu_categories')
      .insert({ name_en: `Shop reward ${Date.now()}`, name_ar: 'مكافأة المتجر', tax_group_id: SEED_TAX_GROUP_STANDARD, is_active: true, venue_id: VENUE_A_ID })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    categoryId = (data as { id: string }).id;
    const set = await appRpc(manager, 'set_category_kind', { p_id: categoryId, p_kind: 'shop' }).then(outcome);
    expect(set.ok, set.errorMessage).toBe(true);
    ball = await product('ball', 12_345, 8_000);
    racket = await product('racket', 200_000, null);
  });

  afterAll(async () => {
    await setCafeSetting(owner, 'shop_sale_reward_pct', 10).catch(() => undefined);
    if (categoryId) {
      await svc.from('menu_items').update({ is_active: false }).eq('category_id', categoryId);
      await svc.from('menu_categories').update({ is_active: false }).eq('id', categoryId);
    }
    for (const c of [owner, manager, cashier, shopA, shopB, waiter]) await c?.auth.signOut();
    for (const id of made) await svc.from('staff').update({ is_active: false }).eq('id', id);
  });

  it('only the owner sets the percent', async () => {
    const r = await appRpc(manager, 'set_cafe_setting', { p_key: 'shop_sale_reward_pct', p_value: 20 }).then(outcome);
    expect(r.ok).toBe(false);
    const big = await appRpc(owner, 'set_cafe_setting', { p_key: 'shop_sale_reward_pct', p_value: 51 }).then(outcome);
    expect(big.ok).toBe(false);
  });

  it('shows the shop each product\'s price, cost and reward, and refuses a waiter', async () => {
    const mine = await info(shopA);
    expect(mine.pct).toBe(10);
    expect(mine.products.find((p) => p.variant_id === ball.variantId)).toEqual({
      variant_id: ball.variantId,
      price_iqd: 12_345,
      cost_iqd: 8_000,
      reward_iqd: 1_234,
    });
    // No delivery and no cost typed: the cost is not known.
    expect(mine.products.find((p) => p.variant_id === racket.variantId)).toMatchObject({ cost_iqd: null, reward_iqd: 20_000 });
    expect(mine.me).toMatchObject({ month_sales_iqd: expect.any(Number), month_reward_iqd: expect.any(Number) });
    expect((await info(owner)).me).toBeNull();
    const no = await appRpc(waiter, 'shop_reward_info', {}).then(outcome);
    expect(no.ok).toBe(false);
    expect(no.errorMessage).toContain('FORBIDDEN');
  });

  it('freezes the percent when a shop tab settles; a café tab gets none', async () => {
    const tab = await openShopTab(shopA);
    await add(shopA, tab, [{ variant_id: ball.variantId, qty: 1 }]);
    expect(await rateOf(tab)).toBeNull();
    await settle(shopA, tab);
    expect(await rateOf(tab)).toBe(10);
    await setCafeSetting(owner, 'shop_sale_reward_pct', 25);
    expect(await rateOf(tab)).toBe(10);
    expect((await info(shopA)).pct).toBe(25);
    await setCafeSetting(owner, 'shop_sale_reward_pct', 10);

    const tableId = await createTestCafeTable(svc, 'SHOPREWARD');
    const cafe = await appRpc(cashier, 'open_tab', { p_table_id: tableId }).then(outcome);
    expect(cafe.ok, cafe.errorMessage).toBe(true);
    const cafeTab = (cafe.data as { tab_id: string }).tab_id;
    await appRpc(cashier, 'cancel_tab', { p_tab_id: cafeTab, p_reason_code: 'test' });
    expect(await rateOf(cafeTab)).toBeNull();
  });

  it('credits each seller for their own lines, net of a refund, and closes the month onto the wage', async () => {
    const beforeA = (await info(shopA)).me!;
    const beforeB = (await info(shopB)).me!;

    // One tab, two people: A rings two balls, B a racket; A settles it.
    const tab = await openShopTab(shopA);
    await add(shopA, tab, [{ variant_id: ball.variantId, qty: 2 }]);
    const order = await add(shopB, tab, [{ variant_id: racket.variantId, qty: 1 }]);
    const paymentId = await settle(shopA, tab);
    // The racket comes back for 50,000 of its 200,000.
    const { data: racketLine } = await svc.from('order_items').select('id').eq('order_id', order.order_id).single();
    const back = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 50_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'retail_return',
      p_items: [{ order_item_id: (racketLine as { id: string }).id, qty: 1 }],
      p_idempotency_key: testIdemKey('payment.refund'),
    }).then(outcome);
    expect(back.ok, back.errorMessage).toBe(true);

    const afterA = (await info(shopA)).me!;
    const afterB = (await info(shopB)).me!;
    expect(afterA.month_sales_iqd - beforeA.month_sales_iqd).toBe(24_690);
    expect(afterA.month_reward_iqd - beforeA.month_reward_iqd).toBe(2_469);
    expect(afterB.month_sales_iqd - beforeB.month_sales_iqd).toBe(150_000);
    expect(afterB.month_reward_iqd - beforeB.month_reward_iqd).toBe(15_000);

    // Close the month in a rolled-back transaction: every shop tab this test
    // settled moves two business months back, so that month is closed
    // whatever today is, and is paid in the month after it.
    // Then, still inside it, B's order is made the owner's: the owner earns
    // nothing (a real owner sale would count in other suites' order totals).
    const tabs = `'${tab}'::uuid`;
    const raw = psql(`
      begin;
      create temp table k as
        select (date_trunc('month', app.venue_business_date('${VENUE_A_ID}'::uuid)) - interval '2 months')::date as m,
               coalesce(app.cafe_setting_int('analytics_business_day_start_hour', '${VENUE_A_ID}'::uuid), 4) as h,
               coalesce((select timezone from venues where id = '${VENUE_A_ID}'), 'Asia/Baghdad') as tz;
      -- The shop tabs of the other cases stay where they are (this month).
      update tabs set settled_at = ((select m from k)::timestamp + make_interval(hours => (select h from k) + 30))
                                   at time zone (select tz from k)
       where id in (${tabs});
      update shop_sale_reward_rates set created_at = created_at - interval '70 days' where tab_id in (${tabs});
      select 'sweep' || E'\\t' || app.shop_reward_sweep()::text;
      select 'again' || E'\\t' || app.shop_reward_sweep()::text;
      select 'earn' || E'\\t' || coalesce(jsonb_agg(jsonb_build_object(
               'staff_id', staff_id, 'sales_iqd', sales_iqd, 'reward_iqd', reward_iqd,
               'earned', earned_month = (select m from k),
               'pays_next', pay_month = ((select m from k) + interval '1 month')::date) order by sales_iqd), '[]')
        from shop_sale_reward_earnings where staff_id in ('${shopAId}', '${shopBId}', '${SEED_STAFF_IDS.owner}');
      select 'line' || E'\\t' || app.wage_line('${VENUE_A_ID}'::uuid, '${shopBId}'::uuid,
                                   ((select m from k) + interval '1 month')::date, current_date, 0)::text;
      update orders set placed_by_staff_id = '${SEED_STAFF_IDS.owner}' where id = '${order.order_id}';
      select 'owner' || E'\t' || coalesce(jsonb_agg(l.staff_id), '[]')
        from app.shop_reward_lines('${VENUE_A_ID}'::uuid, '-infinity', 'infinity') l
       where l.staff_id in ('${shopBId}', '${SEED_STAFF_IDS.owner}');
      rollback;`);
    const out: Record<string, unknown> = {};
    for (const l of raw.split('\n')) {
      const t = l.indexOf('\t');
      if (t > 0) out[l.slice(0, t)] = JSON.parse(l.slice(t + 1));
    }
    expect((out.sweep as { earnings: number }).earnings).toBeGreaterThanOrEqual(2);
    expect(out.again).toEqual({ earnings: 0 });
    expect(out.earn).toEqual([
      { staff_id: shopAId, sales_iqd: 24_690, reward_iqd: 2_469, earned: true, pays_next: true },
      { staff_id: shopBId, sales_iqd: 150_000, reward_iqd: 15_000, earned: true, pays_next: true },
    ]);
    const line = out.line as {
      bonuses_iqd: number;
      bonus_count: number;
      net_iqd: number;
      bonuses: unknown[];
      shop_rewards: { sales_iqd: number; reward_iqd: number }[];
    };
    expect(line.bonuses_iqd).toBe(15_000);
    expect(line.bonus_count).toBe(1);
    expect(line.net_iqd).toBe(15_000);
    expect(line.bonuses).toEqual([]);
    expect(line.shop_rewards).toMatchObject([{ sales_iqd: 150_000, reward_iqd: 15_000 }]);
    expect(out.owner).toEqual([]);
  });

  it('keeps the earnings from every client but the owner, and from the assistant', async () => {
    const { data: seen } = await shopA.from('shop_sale_reward_earnings').select('id');
    expect(seen).toEqual([]);
    const { error } = await shopA.from('shop_sale_reward_rates').select('tab_id');
    expect(error).not.toBeNull();
    expect(
      psql(`select count(*) from app.assistant_readable_columns
             where table_name in ('shop_sale_reward_rates', 'shop_sale_reward_earnings')`),
    ).toBe('0');
    const sweep = await appRpc(owner, 'shop_reward_sweep', {}).then(outcome);
    expect(sweep.ok).toBe(false);
  });
});
