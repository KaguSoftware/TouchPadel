/**
 * shop_price_watch (0322) — the shop desk PC reads each shop size's supplier
 * page every hour and reports what it read; a supplier price change reaches
 * the owner and the shop assistants on the phone.
 *
 *   * a size's link is set and cleared through app.set_shop_price_watch; a
 *     link that is not https to a public host is SUPPLIER_URL_INVALID, a café
 *     size NOT_SHOP_CATEGORY, and a new link forgets what the old one read;
 *   * app.record_shop_supplier_price answers stale (the link changed while the
 *     page was read), error, first, same and changed;
 *   * a change queues a shop_price_changed push to the owner and the branch's
 *     shop assistants (never the manager, never the cashier), only when the
 *     new price is not already the shop's, and carries the product's name,
 *     never a price;
 *   * the café cashier is refused (FORBIDDEN).
 *
 * The watch rows and the outbox rows a run causes are deleted in afterAll, so
 * the matrix's management 'silence' on shop_price_watches holds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  createStaffOfRole,
  createTestMenuItem,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SEED_TAX_GROUP_STANDARD,
} from './helpers';

const up = await stackAvailable();
const RUN = Date.now().toString(36);
const URL_A = `https://supplier.example.com/p/${RUN}-a`;
const URL_B = `https://supplier.example.com/p/${RUN}-b`;

describe.skipIf(!up)('shop price watch (0322)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let shop: SupabaseClient;
  let shopId: string;
  const categories: string[] = [];
  const variants: string[] = [];
  let small: string;
  let large: string;
  let cafeSize: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    const made = await createStaffOfRole(svc, 'shop_staff', 'pricewatch');
    shop = made.client;
    shopId = made.id;

    // A shop product with two sizes, so the push names the size too.
    const cat = await appRpc(shop, 'upsert_shop_category', {
      p_name_en: `Watch ${RUN}`,
      p_name_ar: `مراقبة ${RUN}`,
      p_tax_group_id: SEED_TAX_GROUP_STANDARD,
    }).then(outcome);
    expect(cat.ok, cat.errorMessage).toBe(true);
    categories.push(cat.data as string);
    const item = await appRpc(shop, 'upsert_menu_item', {
      p_category_id: cat.data as string,
      p_name_en: `Racket ${RUN}`,
      p_name_ar: `مضرب ${RUN}`,
      p_is_active: true,
    }).then(outcome);
    expect(item.ok, item.errorMessage).toBe(true);
    const sizes: string[] = [];
    for (const [en, ar, price, isDefault] of [
      ['Small', 'صغير', 20_000, true],
      ['Large', 'كبير', 30_000, false],
    ] as const) {
      const size = await appRpc(shop, 'upsert_retail_variant', {
        p_item_id: item.data as string,
        p_name_en: en,
        p_name_ar: ar,
        p_price_iqd: price,
        p_is_default: isDefault,
      }).then(outcome);
      expect(size.ok, size.errorMessage).toBe(true);
      sizes.push((size.data as { variant_id: string }).variant_id);
    }
    [small, large] = sizes as [string, string];
    variants.push(small, large);

    const cafe = await createTestMenuItem(svc, `pricewatch-${RUN}`, 5_000);
    categories.push(cafe.categoryId);
    cafeSize = cafe.variantId;
  });

  afterAll(async () => {
    if (variants.length > 0) await svc.from('shop_price_watches').delete().in('variant_id', variants);
    await svc
      .from('notification_outbox')
      .delete()
      .eq('payload->>title_key', 'shop_price_changed')
      .in('payload->>dedupe', variants.map((v) => `shop-price:${v}`));
    if (categories.length > 0) {
      await svc.from('menu_items').update({ is_active: false }).in('category_id', categories);
      await svc.from('menu_categories').update({ is_active: false }).in('id', categories);
    }
    for (const c of [owner, manager, cashier, shop]) await c?.auth.signOut();
    if (shopId) await svc.from('staff').update({ is_active: false }).eq('id', shopId);
  });

  async function watchRow(variantId: string) {
    const { data, error } = await svc
      .from('shop_price_watches')
      .select('url, supplier_price_iqd, previous_price_iqd, price_changed_at, checked_at, read_ok_at, last_error')
      .eq('variant_id', variantId)
      .maybeSingle();
    expect(error).toBeNull();
    return data as {
      url: string;
      supplier_price_iqd: number | null;
      previous_price_iqd: number | null;
      price_changed_at: string | null;
      checked_at: string | null;
      read_ok_at: string | null;
      last_error: string | null;
    } | null;
  }

  async function pushes(variantId: string) {
    const { data, error } = await svc
      .from('notification_outbox')
      .select('profile_id, kind, payload')
      .eq('payload->>title_key', 'shop_price_changed')
      .eq('payload->>dedupe', `shop-price:${variantId}`);
    expect(error).toBeNull();
    return (data ?? []) as { profile_id: string; kind: string; payload: Record<string, unknown> }[];
  }

  it('sets a link, reads it back, and clears it on an empty link', async () => {
    const set = outcome(await appRpc(shop, 'set_shop_price_watch', { p_variant_id: large, p_url: `  ${URL_A}  ` }));
    expect(set.errorMessage).toBeUndefined();
    expect(set.data).toEqual({ variant_id: large, url: URL_A });

    // The shop assistant reads its own branch's watches.
    const read = await shop.from('shop_price_watches').select('variant_id, url').eq('variant_id', large);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([{ variant_id: large, url: URL_A }]);

    const cleared = outcome(await appRpc(shop, 'set_shop_price_watch', { p_variant_id: large, p_url: '   ' }));
    expect(cleared.data).toEqual({ variant_id: large, url: null });
    expect(await watchRow(large)).toBeNull();

    const audit = await svc
      .from('audit_log')
      .select('action, after')
      .eq('action', 'shop.price_watch.set')
      .eq('entity_id', large);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(2);
  });

  it('refuses a link that is not https to a public host', async () => {
    for (const bad of [
      'http://supplier.example.com/p/1',
      'https://127.0.0.1/p/1',
      'https://localhost/p/1',
      'https://user@supplier.example.com/p/1',
      'https://printer.local/p/1',
      'https://router.home.arpa/p/1',
      'https://intranet/p/1',
      'https://[::1]/p/1',
      'https://0x7f.0.0.1/p/1',
      // A browser reads these hosts as 127.0.0.1.
      'https://127.0.0.1\\.example.com/p/1',
      'https://%31%32%37.0.0.1/p/1',
      'https://supplier.example.com/a b',
    ]) {
      const r = outcome(await appRpc(shop, 'set_shop_price_watch', { p_variant_id: small, p_url: bad }));
      expect(r.errorMessage, bad).toContain('SUPPLIER_URL_INVALID');
    }
    expect(await watchRow(small)).toBeNull();
  });

  it('refuses a café size', async () => {
    const r = outcome(await appRpc(manager, 'set_shop_price_watch', { p_variant_id: cafeSize, p_url: URL_A }));
    expect(r.errorMessage).toContain('NOT_SHOP_CATEGORY');
  });

  it('refuses the café cashier', async () => {
    const set = outcome(await appRpc(cashier, 'set_shop_price_watch', { p_variant_id: small, p_url: URL_A }));
    expect(set.errorMessage).toContain('FORBIDDEN');
    const report = outcome(await appRpc(cashier, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 1 }));
    expect(report.errorMessage).toContain('FORBIDDEN');
  });

  it('reports stale, error, first, same and changed, and pushes only a change the shop does not already sell at', async () => {
    expect(outcome(await appRpc(manager, 'set_shop_price_watch', { p_variant_id: small, p_url: URL_A })).ok).toBe(true);

    // The link changed while the page was read.
    const stale = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_B, p_price_iqd: 21_000 }));
    expect(stale.data).toEqual({ status: 'stale' });

    const badErr = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_error: 'nope' }));
    expect(badErr.errorMessage).toContain('INVALID_ARGUMENT');
    const badPrice = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 0 }));
    expect(badPrice.errorMessage).toContain('INVALID_ARGUMENT');

    const err = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_error: 'timeout' }));
    expect(err.data).toEqual({ status: 'error', supplier_price_iqd: null, shop_price_iqd: 20_000 });
    let row = await watchRow(small);
    expect(row?.last_error).toBe('timeout');
    expect(row?.checked_at).not.toBeNull();
    expect(row?.read_ok_at).toBeNull();

    const first = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 21_000 }));
    expect(first.data).toEqual({ status: 'first', supplier_price_iqd: 21_000, shop_price_iqd: 20_000 });
    row = await watchRow(small);
    expect(row).toMatchObject({ supplier_price_iqd: 21_000, previous_price_iqd: null, price_changed_at: null, last_error: null });
    expect(row?.read_ok_at).not.toBeNull();

    const same = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 21_000 }));
    expect(same.data).toMatchObject({ status: 'same' });

    const changed = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 25_000 }));
    expect(changed.data).toEqual({ status: 'changed', supplier_price_iqd: 25_000, shop_price_iqd: 20_000 });
    row = await watchRow(small);
    expect(row).toMatchObject({ supplier_price_iqd: 25_000, previous_price_iqd: 21_000 });
    expect(row?.price_changed_at).not.toBeNull();

    const audit = await svc
      .from('audit_log')
      .select('before, after')
      .eq('action', 'shop.price_watch.changed')
      .eq('entity_id', small);
    expect(audit.data).toEqual([{ before: { supplier_price_iqd: 21_000 }, after: { supplier_price_iqd: 25_000 } }]);

    // The owner and the shop assistant hear of it; the manager who reported it
    // and the cashier do not.
    const sent = await pushes(small);
    const to = sent.map((p) => p.profile_id);
    expect(to).toContain(SEED_STAFF_IDS.owner);
    expect(to).toContain(shopId);
    expect(to).not.toContain(SEED_STAFF_IDS.manager);
    expect(to).not.toContain(SEED_STAFF_IDS.cashier);
    for (const p of sent) {
      expect(p.kind).toBe('staff_info');
      expect(p.payload).toMatchObject({ route: 'staff', id: null, title_key: 'shop_price_changed' });
      // The product and its size, and no price anywhere: the closed payload
      // holds nothing else (the dedupe key names the size only, and send-push
      // never forwards it).
      expect(Object.keys(p.payload).sort()).toEqual(['dedupe', 'id', 'params', 'route', 'title_key']);
      expect(p.payload.params).toEqual({ step: { en: `Racket ${RUN} (Small)`, ar: `مضرب ${RUN} (صغير)` } });
    }

    // Another change within 15 minutes is recorded and audited, but pushes no
    // one again: the dedupe is per size, so stepping the price cannot flood
    // the owner's phone.
    const again = outcome(await appRpc(manager, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 25_001 }));
    expect(again.data).toEqual({ status: 'changed', supplier_price_iqd: 25_001, shop_price_iqd: 20_000 });
    expect((await pushes(small)).length).toBe(sent.length);
  });

  it('does not push when the new supplier price is already the shop price', async () => {
    expect(outcome(await appRpc(shop, 'set_shop_price_watch', { p_variant_id: large, p_url: URL_A })).ok).toBe(true);
    expect(outcome(await appRpc(shop, 'record_shop_supplier_price', { p_variant_id: large, p_url: URL_A, p_price_iqd: 28_000 })).data)
      .toMatchObject({ status: 'first' });
    const changed = outcome(await appRpc(shop, 'record_shop_supplier_price', { p_variant_id: large, p_url: URL_A, p_price_iqd: 30_000 }));
    expect(changed.data).toEqual({ status: 'changed', supplier_price_iqd: 30_000, shop_price_iqd: 30_000 });
    expect(await pushes(large)).toHaveLength(0);
  });

  it('pushes the shop assistant whose desk reported the change too, once', async () => {
    // The previous case left `large` watched at the shop's own 30,000. The
    // assistant signed in at the shop PC is the caller notify_staff skips;
    // the RPC queues theirs itself.
    const changed = outcome(await appRpc(shop, 'record_shop_supplier_price', { p_variant_id: large, p_url: URL_A, p_price_iqd: 32_000 }));
    expect(changed.data).toEqual({ status: 'changed', supplier_price_iqd: 32_000, shop_price_iqd: 30_000 });
    const to = (await pushes(large)).map((p) => p.profile_id).sort();
    expect(to).toEqual([SEED_STAFF_IDS.owner, shopId].sort());

    // Within 15 minutes the caller's own row is deduped like everyone else's.
    expect(outcome(await appRpc(shop, 'record_shop_supplier_price', { p_variant_id: large, p_url: URL_A, p_price_iqd: 33_000 })).data)
      .toMatchObject({ status: 'changed' });
    expect(await pushes(large)).toHaveLength(2);
  });

  it('forgets what the old link read when the link changes', async () => {
    const moved = outcome(await appRpc(owner, 'set_shop_price_watch', { p_variant_id: small, p_url: URL_B }));
    expect(moved.data).toEqual({ variant_id: small, url: URL_B });
    expect(await watchRow(small)).toEqual({
      url: URL_B,
      supplier_price_iqd: null,
      previous_price_iqd: null,
      price_changed_at: null,
      checked_at: null,
      read_ok_at: null,
      last_error: null,
    });
    // A read of the old page arriving late is stale.
    const late = outcome(await appRpc(owner, 'record_shop_supplier_price', { p_variant_id: small, p_url: URL_A, p_price_iqd: 26_000 }));
    expect(late.data).toEqual({ status: 'stale' });
  });
});
