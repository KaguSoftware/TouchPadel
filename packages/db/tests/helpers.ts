/**
 * Shared test harness for the local Supabase stack.
 *
 * Env (falls back to `supabase start` local defaults):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Long-standing `supabase start` demo keys (local only — no secret value).
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const DEV_PASSWORD = 'touch-dev-password';
export const SEED_STAFF = {
  owner: 'owner@dev.touch.local',
  manager: 'manager@dev.touch.local',
  cashier: 'cashier@dev.touch.local',
  prep: 'prep@dev.touch.local',
  court_desk: 'desk@dev.touch.local',
} as const;
export const DEV_PINS = { owner: '111111', manager: '222222' } as const;

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, clientOptions);
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
}

/** True when the local stack answers; suites skip themselves otherwise. */
export async function stackAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function signedInClient(email: string, password: string = DEV_PASSWORD) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message} (run pnpm db:reset?)`);
  return c;
}

export async function anonymousSessionClient() {
  const c = anonClient();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`);
  return c;
}

let guestCounter = 0;
/** Creates (idempotently) and signs in a throwaway guest account. */
export async function guestClient(svc: SupabaseClient, tag: string) {
  const email = `guest-${tag}-${guestCounter++}-${Date.now()}@test.touch.local`;
  const { error } = await svc.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test Guest ${tag}` },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return signedInClient(email);
}

/** Call an app-schema RPC. */
export function appRpc(c: SupabaseClient, fn: string, args: Record<string, unknown>) {
  return c.schema('app').rpc(fn, args);
}

/** Idempotency key per resolved override #2: "{station}:{mutation_type}:{ulid}". */
export function testIdemKey(mutationType: string): string {
  const pseudoUlid = crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26);
  return `TEST1:${mutationType}:${pseudoUlid}`;
}

/** Create an isolated active court (service role bypasses RLS). */
export async function createTestCourt(svc: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await svc
    .from('courts')
    .insert({
      name_en: name,
      name_ar: `ملعب اختبار ${name}`,
      indoor: true,
      duration_options: [60, 90, 120],
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestCourt failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Ensure an all-day, all-week rate rule exists so price_slot always resolves —
 * concurrency tests must not depend on optional fixtures.
 */
export async function ensureTestRateRule(svc: SupabaseClient): Promise<void> {
  const { data } = await svc.from('rate_rules').select('id').eq('name', 'TEST all-day').limit(1);
  if (data && data.length > 0) return;
  const { data: rule, error } = await svc
    .from('rate_rules')
    .insert({
      name: 'TEST all-day',
      court_id: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time: '00:00',
      end_time: '23:59:59',
      priority: -100, // never beats a real fixture rule
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`ensureTestRateRule failed: ${error.message}`);
  const ruleId = (rule as { id: string }).id;
  const { error: pErr } = await svc.from('rate_rule_prices').insert(
    [60, 90, 120].map((d) => ({ rule_id: ruleId, duration_min: d, price_iqd: 40_000 })),
  );
  if (pErr) throw new Error(`ensureTestRateRule prices failed: ${pErr.message}`);
}

let slotCounter = 0;
/**
 * A unique future slot (each call gets its own day+hour so tests never collide).
 * Base hour 6 UTC = 09:00 venue-local (Asia/Baghdad): hours 6..17 UTC keep any
 * slot up to +120min inside the venue's EVENING window, which the seed sets to
 * 09:00-24:00 (Touch trades 09:00-02:00, stored as ["09:00","24:00"] plus an
 * inherited ["00:00","02:00"] tail on the next day). Staying below 20:00 local
 * keeps every slot clear of the midnight boundary, so no test here has to
 * reason about which calendar day a segment lands on.
 */
export function futureSlot(hoursFromMidnightUtc = 6): { start: Date; plus: (min: number) => Date } {
  const day = 7 + Math.floor(slotCounter / 12);
  const hour = hoursFromMidnightUtc + (slotCounter % 12);
  slotCounter++;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + day);
  start.setUTCHours(hour, 0, 0, 0);
  return { start, plus: (min: number) => new Date(start.getTime() + min * 60_000) };
}

export interface RpcOutcome {
  ok: boolean;
  duplicate?: boolean;
  errorMessage?: string;
  data?: unknown;
}

export function outcome(res: { data: unknown; error: { message: string } | null }): RpcOutcome {
  if (res.error) return { ok: false, errorMessage: res.error.message };
  const d = res.data as { duplicate?: boolean } | null;
  return { ok: true, duplicate: d?.duplicate, data: res.data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop 2+3 cafe helpers (menu / tables / sessions / day / stock)
// ─────────────────────────────────────────────────────────────────────────────

/** Seeded staff ids (supabase/seed.sql — stable across resets). */
export const SEED_STAFF_IDS = {
  owner: 'a0000000-0000-4000-8000-000000000001',
  manager: 'a0000000-0000-4000-8000-000000000002',
  cashier: 'a0000000-0000-4000-8000-000000000003',
  prep: 'a0000000-0000-4000-8000-000000000004',
  court_desk: 'a0000000-0000-4000-8000-000000000005',
} as const;

/** Seeded 'Standard' (0%) tax group (supabase/seed.sql). */
export const SEED_TAX_GROUP_STANDARD = 'b0000000-0000-4000-8000-000000000001';

/**
 * Reserved TEST-probe uuid prefix `ee57` — same scheme as the fixtures' `f1f7`
 * prefix (packages/db/fixtures/courts.sql): every deterministic row the test
 * suite plants starts with it, so a probe row can never be mistaken for real
 * data and cleanup-by-prefix stays possible.
 */
export function probeId(suffix: string): string {
  return `ee570000-0000-4000-8000-${suffix.padStart(12, '0')}`;
}

let cafeCounter = 0;

export interface TestMenuItem {
  categoryId: string;
  itemId: string;
  variantId: string;
}

/** Isolated active category + item + default variant (service role bypasses RLS). */
export async function createTestMenuItem(
  svc: SupabaseClient,
  tag: string,
  priceIqd: number,
): Promise<TestMenuItem> {
  const n = cafeCounter++;
  const { data: cat, error: cErr } = await svc
    .from('menu_categories')
    .insert({
      name_en: `Test Category ${tag}-${n}`,
      name_ar: `تصنيف اختبار ${tag}-${n}`,
      tax_group_id: SEED_TAX_GROUP_STANDARD,
      is_active: true,
    })
    .select('id')
    .single();
  if (cErr) throw new Error(`createTestMenuItem category failed: ${cErr.message}`);
  const categoryId = (cat as { id: string }).id;

  const { data: item, error: iErr } = await svc
    .from('menu_items')
    .insert({
      category_id: categoryId,
      name_en: `Test Item ${tag}-${n}`,
      name_ar: `صنف اختبار ${tag}-${n}`,
      is_active: true,
    })
    .select('id')
    .single();
  if (iErr) throw new Error(`createTestMenuItem item failed: ${iErr.message}`);
  const itemId = (item as { id: string }).id;

  const { data: variant, error: vErr } = await svc
    .from('menu_item_variants')
    .insert({
      item_id: itemId,
      name_en: 'Regular',
      name_ar: 'عادي',
      price_iqd: priceIqd,
      is_default: true,
    })
    .select('id')
    .single();
  if (vErr) throw new Error(`createTestMenuItem variant failed: ${vErr.message}`);
  return { categoryId, itemId, variantId: (variant as { id: string }).id };
}

/** Attach a fresh modifier group + one modifier to an item. */
export async function addModifierToItem(
  svc: SupabaseClient,
  itemId: string,
  nameAr: string,
  deltaIqd: number,
): Promise<{ groupId: string; modifierId: string }> {
  const n = cafeCounter++;
  const { data: grp, error: gErr } = await svc
    .from('modifier_groups')
    .insert({ name_en: `Test Group ${n}`, name_ar: `مجموعة اختيارات ${n}`, min_select: 0, max_select: 2 })
    .select('id')
    .single();
  if (gErr) throw new Error(`addModifierToItem group failed: ${gErr.message}`);
  const groupId = (grp as { id: string }).id;

  const { data: mod, error: mErr } = await svc
    .from('modifiers')
    .insert({
      group_id: groupId,
      name_en: `Test Modifier ${n}`,
      name_ar: nameAr,
      price_delta_iqd: deltaIqd,
      is_active: true,
    })
    .select('id')
    .single();
  if (mErr) throw new Error(`addModifierToItem modifier failed: ${mErr.message}`);

  const { error: lErr } = await svc
    .from('menu_item_modifier_groups')
    .insert({ item_id: itemId, group_id: groupId });
  if (lErr) throw new Error(`addModifierToItem link failed: ${lErr.message}`);
  return { groupId, modifierId: (mod as { id: string }).id };
}

export async function createTestIngredient(
  svc: SupabaseClient,
  nameAr: string,
  unit: 'g' | 'ml' | 'pc',
): Promise<string> {
  const n = cafeCounter++;
  const { data, error } = await svc
    .from('ingredients')
    .insert({ kind: 'purchased', name_en: `Test Ingredient ${n}`, name_ar: nameAr, unit, is_active: true })
    .select('id')
    .single();
  if (error) throw new Error(`createTestIngredient failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** One BOM line attached to a variant XOR a modifier. */
export async function addRecipeLine(
  svc: SupabaseClient,
  target: { variantId?: string; modifierId?: string },
  ingredientId: string,
  qty: number,
): Promise<void> {
  const { error } = await svc.from('recipe_lines').insert({
    variant_id: target.variantId ?? null,
    modifier_id: target.modifierId ?? null,
    ingredient_id: ingredientId,
    qty,
  });
  if (error) throw new Error(`addRecipeLine failed: ${error.message}`);
}

/** Plant a live stock batch directly (goods-in ledger row not required for on-hand). */
export async function addStockBatch(
  svc: SupabaseClient,
  ingredientId: string,
  qty: number,
  unitCostIqd: number,
  expiryDaysFromNow?: number,
): Promise<string> {
  const expiry =
    expiryDaysFromNow === undefined
      ? null
      : new Date(Date.now() + expiryDaysFromNow * 24 * 3600_000).toISOString().slice(0, 10);
  const { data, error } = await svc
    .from('stock_batches')
    .insert({
      ingredient_id: ingredientId,
      expiry_date: expiry,
      qty_received: qty,
      qty_remaining: qty,
      unit_cost_iqd: unitCostIqd,
    })
    .select('id')
    .single();
  if (error) throw new Error(`addStockBatch failed: ${error.message}`);
  return (data as { id: string }).id;
}

export async function createTestCafeTable(svc: SupabaseClient, tag: string): Promise<string> {
  const { data, error } = await svc
    .from('cafe_tables')
    .insert({
      table_number: `T-${tag}-${Date.now()}-${cafeCounter++}`,
      zone: 'اختبار',
      capacity: 4,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestCafeTable failed: ${error.message}`);
  return (data as { id: string }).id;
}

export interface GuestSession {
  client: SupabaseClient;
  token: string;
  sessionId: string;
  tableId: string;
}

/**
 * Full QR journey for tests: a manager/owner client signs a token for the
 * table, a fresh anonymous client scans it (app.open_table_session).
 */
export async function openGuestSession(
  staffClient: SupabaseClient,
  tableId: string,
): Promise<GuestSession> {
  const tok = await appRpc(staffClient, 'generate_table_token', { p_table_id: tableId });
  if (tok.error) throw new Error(`generate_table_token failed: ${tok.error.message}`);
  const token = tok.data as string;

  const client = await anonymousSessionClient();
  const opened = await appRpc(client, 'open_table_session', { p_token: token });
  if (opened.error) throw new Error(`open_table_session failed: ${opened.error.message}`);
  const d = opened.data as { session_id: string; table_id: string };
  return { client, token, sessionId: d.session_id, tableId: d.table_id };
}

/**
 * Reuse the currently open business day or open a fresh one on a unique
 * far-future business_date (dates are opaque to the till logic; uniqueness is
 * what matters across reruns without a db reset).
 */
export async function ensureOpenDay(
  manager: SupabaseClient,
  svc: SupabaseClient,
  openingFloatIqd = 100_000,
): Promise<string> {
  const { data: open, error } = await svc
    .from('day_sessions')
    .select('id')
    .in('status', ['open', 'closing'])
    .limit(1);
  if (error) throw new Error(`ensureOpenDay probe failed: ${error.message}`);
  if (open && open.length > 0) return (open[0] as { id: string }).id;
  return openFreshDay(manager, openingFloatIqd);
}

/** Open a brand-new day session on a unique business_date. */
export async function openFreshDay(
  manager: SupabaseClient,
  openingFloatIqd = 100_000,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const days = 20_000 + Math.floor(Math.random() * 2_000_000); // far-future unique date
    const date = new Date(days * 86_400_000).toISOString().slice(0, 10);
    const res = await appRpc(manager, 'open_day', {
      p_opening_float_iqd: openingFloatIqd,
      p_business_date: date,
    });
    if (res.error) throw new Error(`open_day failed: ${res.error.message}`);
    const d = res.data as { duplicate: boolean; day_session_id: string; status?: string };
    if (!d.duplicate || d.status === 'open') return d.day_session_id;
    // duplicate on a closed date: extremely unlikely — retry with a new date
  }
  throw new Error('openFreshDay: could not find a free business_date');
}

/**
 * Force-close any open day and void its open tabs (service role, direct
 * writes) so a test that needs a pristine day can open one deterministically.
 */
export async function forceCloseAllDays(svc: SupabaseClient): Promise<void> {
  const { error: tErr } = await svc
    .from('tabs')
    .update({ status: 'void' })
    .in('status', ['open', 'awaiting_payment']);
  if (tErr) throw new Error(`forceCloseAllDays tabs failed: ${tErr.message}`);
  const { error: dErr } = await svc
    .from('day_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .in('status', ['open', 'closing']);
  if (dErr) throw new Error(`forceCloseAllDays days failed: ${dErr.message}`);
}

/**
 * Un-degrade the venue: refresh every till heartbeat — flagged via is_till
 * (0026) or named 'TILL%' (legacy prefix) — so a previous aborted
 * degraded-mode test never poisons unrelated suites.
 */
export async function ensureTillFresh(svc: SupabaseClient): Promise<void> {
  const { error } = await svc
    .from('device_heartbeats')
    .update({ last_seen_at: new Date().toISOString(), queue_depth: 0 })
    .or('is_till.eq.true,device_id.like.TILL*');
  if (error) throw new Error(`ensureTillFresh failed: ${error.message}`);
}

/**
 * Deterministic probe rows for the Drop 2+3 RLS matrix 'rows' expectations —
 * idempotent (fixed ee57-prefixed ids + ignoreDuplicates), created with the
 * service client so the matrix never depends on fixtures being applied.
 */
export async function ensureCafeProbeData(svc: SupabaseClient): Promise<void> {
  const up = async (table: string, row: Record<string, unknown>, onConflict = 'id') => {
    const { error } = await svc.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`probe ${table} failed: ${error.message}`);
  };
  const past = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  // Menu surface (active rows so anon 'rows' expectations hold).
  await up('menu_categories', {
    id: probeId('101'), name_en: 'Probe Drinks', name_ar: 'مشروبات الفحص',
    tax_group_id: SEED_TAX_GROUP_STANDARD, is_active: true,
  });
  await up('menu_items', {
    id: probeId('102'), category_id: probeId('101'),
    name_en: 'Probe Tea', name_ar: 'شاي الفحص', is_active: true,
  });
  await up('menu_item_variants', {
    id: probeId('103'), item_id: probeId('102'),
    name_en: 'Regular', name_ar: 'عادي', price_iqd: 2000, is_default: true,
  });
  await up('menu_item_variants', {
    id: probeId('104'), item_id: probeId('102'),
    name_en: 'Large', name_ar: 'كبير', price_iqd: 3000,
  });
  await up('modifier_groups', {
    id: probeId('105'), name_en: 'Probe Extras', name_ar: 'إضافات الفحص',
    min_select: 0, max_select: 1,
  });
  await up('modifiers', {
    id: probeId('106'), group_id: probeId('105'),
    name_en: 'Extra Mint', name_ar: 'نعناع إضافي', price_delta_iqd: 500, is_active: true,
  });
  await up(
    'menu_item_modifier_groups',
    { item_id: probeId('102'), group_id: probeId('105') },
    'item_id,group_id',
  );

  // Table + a CLOSED guest session (a live one would give staff principals a
  // working guest context and change RPC guard outcomes).
  await up('cafe_tables', {
    id: probeId('201'), table_number: 'PROBE-1', zone: 'فحص', is_active: true,
  });
  await up('guest_sessions', {
    id: probeId('202'), table_id: probeId('201'), auth_user_id: SEED_STAFF_IDS.owner,
    created_at: past, last_activity_at: past, expires_at: past, closed_at: past,
  });

  // Closed historical day + settled tab + till order/items/ticket + money rows.
  await up('day_sessions', {
    id: probeId('301'), business_date: '2001-01-01', status: 'closed',
    opened_at: past, opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
    closed_at: past, closed_by: SEED_STAFF_IDS.manager,
  });
  await up('tabs', {
    id: probeId('302'), day_session_id: probeId('301'), status: 'settled',
    label: 'طاولة فحص الصلاحيات', opened_by_staff_id: SEED_STAFF_IDS.cashier,
    subtotal_iqd: 2500, tax_iqd: 0, discount_iqd: 0, total_iqd: 2500, settled_at: past,
  });
  await up('orders', {
    id: probeId('303'), tab_id: probeId('302'), source: 'till',
    placed_by_staff_id: SEED_STAFF_IDS.cashier, status: 'served',
  });
  await up('order_items', {
    id: probeId('304'), order_id: probeId('303'), menu_item_id: probeId('102'),
    variant_id: probeId('103'), qty: 1, unit_price_iqd: 2000, line_total_iqd: 2500,
  });
  await up(
    'order_item_modifiers',
    { order_item_id: probeId('304'), modifier_id: probeId('106'), qty: 1, price_delta_iqd: 500 },
    'order_item_id,modifier_id',
  );
  await up('tickets', {
    id: probeId('305'), order_id: probeId('303'), status: 'completed',
    completed_at: past, actual_prep_seconds: 60,
  });
  await up('payments', {
    id: probeId('306'), tab_id: probeId('302'), day_session_id: probeId('301'),
    method: 'cash', amount_iqd: 2500, tendered_iqd: 5000, change_iqd: 2500,
    recorded_by: SEED_STAFF_IDS.cashier,
  });
  await up('refunds', {
    id: probeId('307'), payment_id: probeId('306'), amount_iqd: 500,
    reason_code: 'probe', refunded_by: SEED_STAFF_IDS.manager,
  });
  await up('tab_adjustments', {
    id: probeId('308'), tab_id: probeId('302'), kind: 'discount_amount', value: 500,
    amount_iqd: 500, applied_by: SEED_STAFF_IDS.cashier,
    authorized_by: SEED_STAFF_IDS.manager, reason_code: 'probe',
  });

  // Resolved waiter call (resolved: never blocks the one-open-per-table index).
  await up('waiter_calls', {
    id: probeId('401'), table_id: probeId('201'), guest_session_id: probeId('202'),
    reason: 'water', status: 'resolved', raised_at: past,
    resolved_at: past, resolved_by: SEED_STAFF_IDS.manager,
  });

  // Stock surface (recipe on the UNUSED variant so the probe ticket consumes nothing).
  await up('ingredients', {
    id: probeId('501'), kind: 'purchased', name_en: 'Probe Beans',
    name_ar: 'حبوب الفحص', unit: 'g', is_active: true,
  });
  await up('recipe_lines', {
    id: probeId('502'), variant_id: probeId('104'), ingredient_id: probeId('501'), qty: 10,
  });
  await up('stock_batches', {
    id: probeId('503'), ingredient_id: probeId('501'),
    qty_received: 1000, qty_remaining: 1000, unit_cost_iqd: 5,
  });
  await up('manager_alerts', {
    id: probeId('504'), kind: 'low_stock',
    payload: { ingredient_id: probeId('501'), probe: true },
  });

  // Heartbeat + replay bookkeeping (non-TILL device: never flips degraded mode).
  await up('device_heartbeats', { device_id: 'PROBE-RLS', queue_depth: 0 }, 'device_id');
  await up(
    'sync_replays',
    {
      device_id: 'PROBE-RLS',
      idempotency_key: 'PROBE:sync.replay:00000000000000000000000000',
      entity: 'order',
      result: 'applied',
    },
    'idempotency_key',
  );

  // stock_movements has an identity pk — key the probe row on its reason_code.
  const { data: mv, error: mvErr } = await svc
    .from('stock_movements')
    .select('id')
    .eq('reason_code', 'ee57-probe')
    .limit(1);
  if (mvErr) throw new Error(`probe stock_movements lookup failed: ${mvErr.message}`);
  if (!mv || mv.length === 0) {
    const { error } = await svc.from('stock_movements').insert({
      ingredient_id: probeId('501'),
      batch_id: probeId('503'),
      movement_type: 'goods_in',
      qty_delta: 1000,
      unit_cost_iqd: 5,
      staff_id: SEED_STAFF_IDS.manager,
      reason_code: 'ee57-probe',
    });
    if (error) throw new Error(`probe stock_movements insert failed: ${error.message}`);
  }

  await ensureCafeProbeDataDrop4(svc); // 0027–0034 probe rows (drop 4)
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop 4 cafe-rebuild helpers (0027–0034: settings / reveals / telegram /
// analytics)
// ─────────────────────────────────────────────────────────────────────────────

/** Owner/manager write path for cafe_settings (app.set_cafe_setting); throws on error. */
export async function setCafeSetting(
  staffClient: SupabaseClient,
  key: string,
  value: unknown,
): Promise<void> {
  const { error } = await appRpc(staffClient, 'set_cafe_setting', { p_key: key, p_value: value });
  if (error) throw new Error(`set_cafe_setting(${key}) failed: ${error.message}`);
}

/**
 * Restore EVERY cafe setting to its registry default (app.cafe_setting_specs,
 * service role only). Note: this also undoes the fixtures' featured hero —
 * suites that only want to undo their own edits should prefer
 * snapshotCafeSettings().
 */
export async function resetCafeSettings(svc: SupabaseClient, owner?: SupabaseClient): Promise<void> {
  const { data, error } = await svc.schema('app').rpc('cafe_setting_specs', {});
  if (error) throw new Error(`cafe_setting_specs failed: ${error.message}`);
  const specs = data as { key: string; is_public: boolean; default_value: unknown }[];
  await writeCafeSettingRows(svc, specs.map((s) => ({ key: s.key, value: s.default_value, is_public: s.is_public })), owner);
}

/**
 * Snapshot the whole cafe_settings table; the returned function restores it
 * verbatim. Pass the owner client so JSON-null values (nullable keys) can be
 * restored through app.set_cafe_setting — PostgREST turns a JSON null into a
 * SQL NULL on a direct upsert, which the NOT NULL column refuses.
 */
export async function snapshotCafeSettings(
  svc: SupabaseClient,
  owner?: SupabaseClient,
): Promise<() => Promise<void>> {
  const { data, error } = await svc.from('cafe_settings').select('key, value, is_public');
  if (error) throw new Error(`snapshotCafeSettings failed: ${error.message}`);
  const rows = (data ?? []) as { key: string; value: unknown; is_public: boolean }[];
  return () => writeCafeSettingRows(svc, rows, owner);
}

/**
 * Non-null values: direct service-role upsert. JSON-null values: through the
 * owner RPC when available, else the row is deleted — app.cafe_setting()
 * falls back to the registry default (null for every nullable key), so the
 * effective value is identical either way.
 */
async function writeCafeSettingRows(
  svc: SupabaseClient,
  rows: { key: string; value: unknown; is_public: boolean }[],
  owner?: SupabaseClient,
): Promise<void> {
  const nonNull = rows.filter((r) => r.value !== null && r.value !== undefined);
  const nulls = rows.filter((r) => r.value === null || r.value === undefined);
  if (nonNull.length > 0) {
    const { error } = await svc
      .from('cafe_settings')
      .upsert(nonNull.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'key' });
    if (error) throw new Error(`restore cafe_settings failed: ${error.message}`);
  }
  for (const r of nulls) {
    if (owner) {
      await setCafeSetting(owner, r.key, null);
    } else {
      const { error } = await svc.from('cafe_settings').delete().eq('key', r.key);
      if (error) throw new Error(`restore cafe_settings (${r.key}) failed: ${error.message}`);
    }
  }
}

/**
 * Create a modifier group revealed by `revealingModifierId` (0028), with the
 * given modifiers. Direct service-role insert into modifier_reveals (the
 * belt trigger still refuses self-reveals); app.set_modifier_reveals is
 * exercised separately by the RPC tests.
 */
export async function addRevealGroup(
  svc: SupabaseClient,
  revealingModifierId: string,
  select: { min: number; max: number },
  modifiers: { nameAr: string; deltaIqd: number }[],
): Promise<{ groupId: string; modifierIds: string[] }> {
  const n = cafeCounter++;
  const { data: grp, error: gErr } = await svc
    .from('modifier_groups')
    .insert({
      name_en: `Revealed Group ${n}`,
      name_ar: `مجموعة مكشوفة ${n}`,
      min_select: select.min,
      max_select: select.max,
    })
    .select('id')
    .single();
  if (gErr) throw new Error(`addRevealGroup group failed: ${gErr.message}`);
  const groupId = (grp as { id: string }).id;

  const modifierIds: string[] = [];
  for (const [i, m] of modifiers.entries()) {
    const { data: mod, error: mErr } = await svc
      .from('modifiers')
      .insert({
        group_id: groupId,
        name_en: `Revealed Modifier ${n}-${i}`,
        name_ar: m.nameAr,
        price_delta_iqd: m.deltaIqd,
        sort_order: i,
        is_active: true,
      })
      .select('id')
      .single();
    if (mErr) throw new Error(`addRevealGroup modifier failed: ${mErr.message}`);
    modifierIds.push((mod as { id: string }).id);
  }

  const { error: rErr } = await svc
    .from('modifier_reveals')
    .insert({ modifier_id: revealingModifierId, group_id: groupId, sort_order: 0 });
  if (rErr) throw new Error(`addRevealGroup reveal failed: ${rErr.message}`);
  return { groupId, modifierIds };
}

/**
 * Drop-4 probe rows for the RLS matrix (same ee57 scheme + idempotency as
 * ensureCafeProbeData, which calls this at the end): a probe reveal
 * (modifier 106 -> group 107 with modifier 108), a cost on probe item 102,
 * telegram_outbox / telegram_actions rows (identity pks: keyed on a probe
 * marker), and analytics_insights / patterns / rejections rows.
 */
export async function ensureCafeProbeDataDrop4(svc: SupabaseClient): Promise<void> {
  const up = async (table: string, row: Record<string, unknown>, onConflict = 'id') => {
    const { error } = await svc.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`probe ${table} failed: ${error.message}`);
  };
  const past = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  // Probe reveal: choosing 'Extra Mint' (106) reveals group 107 (min 0 so the
  // probe item stays orderable without it).
  await up('modifier_groups', {
    id: probeId('107'), name_en: 'Probe Revealed', name_ar: 'مكشوفة الفحص',
    min_select: 0, max_select: 1,
  });
  await up('modifiers', {
    id: probeId('108'), group_id: probeId('107'),
    name_en: 'Probe Reveal Option', name_ar: 'خيار مكشوف', price_delta_iqd: 0, is_active: true,
  });
  await up(
    'modifier_reveals',
    { modifier_id: probeId('106'), group_id: probeId('107'), sort_order: 0 },
    'modifier_id,group_id',
  );

  // Cost on the probe item (manager|owner-only surface).
  await up('menu_item_costs', { item_id: probeId('102'), cost_iqd: 800 }, 'item_id');

  // telegram_outbox / telegram_actions have identity pks — key on a marker.
  const { data: ob, error: obErr } = await svc
    .from('telegram_outbox')
    .select('id')
    .eq('kind', 'test')
    .contains('payload', { probe: 'ee57' })
    .limit(1);
  if (obErr) throw new Error(`probe telegram_outbox lookup failed: ${obErr.message}`);
  if (!ob || ob.length === 0) {
    const { error } = await svc.from('telegram_outbox').insert({
      kind: 'test',
      ref_id: null,
      chat_id: '-100000000000',
      payload: { probe: 'ee57', sent_by: 'probe', at: past },
      status: 'sent',
      attempts: 1,
      sent_at: past,
      scheduled_for: past,
      created_at: past,
    });
    if (error) throw new Error(`probe telegram_outbox insert failed: ${error.message}`);
  }
  const { data: act, error: actErr } = await svc
    .from('telegram_actions')
    .select('id')
    .eq('ref_id', probeId('303'))
    .eq('detail', 'ee57-probe')
    .limit(1);
  if (actErr) throw new Error(`probe telegram_actions lookup failed: ${actErr.message}`);
  if (!act || act.length === 0) {
    const { error } = await svc.from('telegram_actions').insert({
      at: past,
      action: 'o:seen',
      ref_id: probeId('303'),
      tg_user_id: 1,
      tg_first_name: 'Probe',
      result: 'duplicate',
      detail: 'ee57-probe',
    });
    if (error) throw new Error(`probe telegram_actions insert failed: ${error.message}`);
  }

  // telegram_staff (0039): the allowlist that authorizes a bot-button tap.
  await up(
    'telegram_staff',
    {
      tg_user_id: 570039,
      staff_id: SEED_STAFF_IDS.manager,
      label: 'Probe',
      can_void: false,
      is_active: true,
      created_at: past,
    },
    'tg_user_id',
  );

  // LLM tables (owner-only reads).
  await up('analytics_insights', {
    id: probeId('601'), range_from: '2001-01-01', range_to: '2001-01-07',
    compare_basis: 'prev', locale: 'ar',
    insights: [{ text: 'probe', kind: 'probe', subjects: [], metrics: {}, confidence: 'low' }],
    created_by: SEED_STAFF_IDS.owner, created_at: past,
  });
  await up('analytics_patterns', {
    id: probeId('602'), range_from: '2001-01-01', range_to: '2001-01-07', locale: 'ar',
    patterns: [{ text: 'probe' }], created_by: SEED_STAFF_IDS.owner, created_at: past,
  });
  await up('analytics_insight_rejections', {
    id: probeId('603'), text: 'ee57 probe rejection', text_key: 'ee57 probe rejection',
    reason: 'probe', created_by: SEED_STAFF_IDS.owner, created_at: past,
  });
}
