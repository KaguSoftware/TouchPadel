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
  // Multi-venue slice 1: seeded at venue A by the 0123 staff trigger like every
  // other non-owner. tests/multi-venue.test.ts re-points these two to venue B
  // for the length of that file and puts them back in its afterAll.
  manager_b: 'manager-b@dev.touch.local',
  cashier_b: 'cashier-b@dev.touch.local',
} as const;
// 0078/SEC-13: six digits, no repeated digit and no sequential run. The old
// 111111 / 222222 are both refused by app.set_staff_pin now, so seeding them
// would have left the dev environment demonstrating a rule the product rejects.
export const DEV_PINS = { owner: '719264', manager: '380517', manager_b: '492738' } as const;

/**
 * The default venue, written by migration 0122 — a fixed constant, not an ee57
 * probe id, because every pre-multi-venue row in the database was backfilled to
 * it. The helpers below default their `venueId` argument to it, so a suite that
 * knows nothing about venues keeps planting its rows exactly where it always
 * did.
 */
export const VENUE_A_ID = 'c0000000-0000-4000-8000-000000000001';

/**
 * The second venue, created and then DEACTIVATED inside
 * tests/multi-venue.test.ts (ensureVenueBProbeData / deactivateVenueBProbeData).
 * It must never be ACTIVE outside that file: the suite runs singleFork against
 * one shared database, and a second active venue makes app.current_venue()
 * ambiguous, so every venue-less service_role insert in every other suite would
 * raise VENUE_REQUIRED.
 */
export const VENUE_B_ID = probeId('be00');

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
    user_metadata: { full_name: `Test Guest ${tag}`, phone: '+9647700000000' }, // phone: required to confirm since 0059
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return signedInClient(email);
}

let shapedCounter = 0;
/**
 * A guest created the way GoTrue would from an OAuth id token: arbitrary
 * metadata, no phone. `user_metadata` is stored verbatim, so a test can hand
 * the signup trigger exactly the Google / Apple shape (0058) without any
 * network call to either provider.
 */
export async function shapedGuest(
  svc: SupabaseClient,
  tag: string,
  shape: {
    email?: string;
    user_metadata: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  },
): Promise<{ id: string; email: string; client: SupabaseClient }> {
  const email = shape.email ?? `shaped-${tag}-${shapedCounter++}-${Date.now()}@test.touch.local`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: shape.user_metadata,
    app_metadata: shape.app_metadata,
  });
  if (error || !data.user) throw new Error(`shapedGuest createUser failed: ${error?.message}`);
  return { id: data.user.id, email, client: await signedInClient(email) };
}

/**
 * RPCs that consume a manager-PIN grant since 0115 (mirrors packages/core
 * PIN_GATED_RPCS; the operator wrapper does the same). A suite that wants the
 * RAW behaviour — no grant, PIN_GRANT_REQUIRED — calls c.schema('app').rpc
 * directly, as pin-grants.test.ts does.
 */
const PIN_GATED_RPCS = new Set(['apply_discount', 'override_price', 'refund', 'void_after_send', 'write_off_expired']);

/**
 * Call an app-schema RPC. For a PIN-gated RPC carrying p_pin it proves the PIN
 * to app.verify_manager_pin first (its own round trip, so the attempt commits
 * and the lockout counts — 0115), exactly as every production client does; a
 * refusal there is returned in the same { data, error } shape.
 */
export async function appRpc(c: SupabaseClient, fn: string, args: Record<string, unknown>) {
  if (PIN_GATED_RPCS.has(fn) && typeof args.p_pin === 'string') {
    const verified = await c.schema('app').rpc('verify_manager_pin', {
      p_pin: args.p_pin,
      p_device_id: typeof args.p_device_id === 'string' ? args.p_device_id : null,
    });
    if (verified.error) return verified;
    // A wrong PIN RETURNS null; hand back the refusal the RPC used to raise, in
    // the same { data, error } shape the suites destructure.
    if (verified.data === null) {
      const refused = { data: null, error: { message: 'PIN_INVALID', code: 'P0001', details: null, hint: null } };
      return refused as unknown as typeof verified;
    }
  }
  return c.schema('app').rpc(fn, args);
}

/** Idempotency key per resolved override #2: "{station}:{mutation_type}:{ulid}". */
export function testIdemKey(mutationType: string): string {
  const pseudoUlid = crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26);
  return `TEST1:${mutationType}:${pseudoUlid}`;
}

/** Create an isolated active court (service role bypasses RLS). */
export async function createTestCourt(
  svc: SupabaseClient,
  name: string,
  venueId: string = VENUE_A_ID,
): Promise<string> {
  const { data, error } = await svc
    .from('courts')
    .insert({
      name_en: name,
      name_ar: `ملعب اختبار ${name}`,
      indoor: true,
      duration_options: [60, 90, 120],
      is_active: true,
      venue_id: venueId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestCourt failed: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Ensure an all-day, all-week rate rule exists so price_slot always resolves —
 * concurrency tests must not depend on optional fixtures.
 *
 * `valid_from` is yesterday, NOT open-ended. This is an all-COURTS rule, so
 * without a lower bound it prices every slot on every court at every instant in
 * history — including the fixed past week that packages/db/fixtures/
 * pricing-golden.json uses, where three cases assert that NOTHING prices the
 * slot. An unbounded helper turns those three green-by-accident into failures
 * and, worse, would have made a genuine "no rule prices this" regression
 * invisible. Every suite that calls this books in the FUTURE, so a lower bound
 * of yesterday costs nothing.
 */
export async function ensureTestRateRule(
  svc: SupabaseClient,
  venueId: string = VENUE_A_ID,
): Promise<void> {
  const { data } = await svc
    .from('rate_rules')
    .select('id')
    .eq('name', 'TEST all-day')
    .eq('venue_id', venueId)
    .limit(1);
  if (data && data.length > 0) return;
  const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const { data: rule, error } = await svc
    .from('rate_rules')
    .insert({
      name: 'TEST all-day',
      court_id: null,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time: '00:00',
      end_time: '23:59:59',
      priority: -100, // never beats a real fixture rule
      valid_from: yesterday,
      is_active: true,
      venue_id: venueId,
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
  manager_b: 'a0000000-0000-4000-8000-000000000006',
  cashier_b: 'a0000000-0000-4000-8000-000000000007',
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
  venueId: string = VENUE_A_ID,
): Promise<TestMenuItem> {
  const n = cafeCounter++;
  const { data: cat, error: cErr } = await svc
    .from('menu_categories')
    .insert({
      name_en: `Test Category ${tag}-${n}`,
      name_ar: `تصنيف اختبار ${tag}-${n}`,
      tax_group_id: SEED_TAX_GROUP_STANDARD,
      is_active: true,
      venue_id: venueId,
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
      venue_id: venueId,
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
  venueId: string = VENUE_A_ID,
): Promise<string> {
  const n = cafeCounter++;
  const { data, error } = await svc
    .from('ingredients')
    .insert({
      kind: 'purchased',
      name_en: `Test Ingredient ${n}`,
      name_ar: nameAr,
      unit,
      is_active: true,
      venue_id: venueId,
    })
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
  venueId: string = VENUE_A_ID,
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
      venue_id: venueId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`addStockBatch failed: ${error.message}`);
  return (data as { id: string }).id;
}

export async function createTestCafeTable(
  svc: SupabaseClient,
  tag: string,
  venueId: string = VENUE_A_ID,
): Promise<string> {
  const { data, error } = await svc
    .from('cafe_tables')
    .insert({
      table_number: `T-${tag}-${Date.now()}-${cafeCounter++}`,
      zone: 'اختبار',
      capacity: 4,
      is_active: true,
      venue_id: venueId,
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
  venueId: string = VENUE_A_ID,
): Promise<string> {
  const { data: open, error } = await svc
    .from('day_sessions')
    .select('id')
    .eq('venue_id', venueId)
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
export async function forceCloseAllDays(
  svc: SupabaseClient,
  venueId: string = VENUE_A_ID,
): Promise<void> {
  const { error: tErr } = await svc
    .from('tabs')
    .update({ status: 'void' })
    .eq('venue_id', venueId)
    .in('status', ['open', 'awaiting_payment']);
  if (tErr) throw new Error(`forceCloseAllDays tabs failed: ${tErr.message}`);
  const { error: dErr } = await svc
    .from('day_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('venue_id', venueId)
    .in('status', ['open', 'closing']);
  if (dErr) throw new Error(`forceCloseAllDays days failed: ${dErr.message}`);
}

/**
 * Un-degrade the venue: refresh every till heartbeat — flagged via is_till
 * (0026) or named 'TILL%' (legacy prefix) — so a previous aborted
 * degraded-mode test never poisons unrelated suites.
 *
 * Scoped to ONE venue since slice 1: multi-venue.test.ts keeps venue B
 * deliberately degraded (a stale till) while venue A must stay fresh, and an
 * unscoped update here would wipe that fixture out from under it.
 */
export async function ensureTillFresh(
  svc: SupabaseClient,
  venueId: string = VENUE_A_ID,
): Promise<void> {
  const { error } = await svc
    .from('device_heartbeats')
    .update({ last_seen_at: new Date().toISOString(), queue_depth: 0 })
    .eq('venue_id', venueId)
    .or('is_till.eq.true,device_id.like.TILL*');
  if (error) throw new Error(`ensureTillFresh failed: ${error.message}`);
}

/**
 * Deterministic probe rows for the Drop 2+3 RLS matrix 'rows' expectations —
 * idempotent (fixed ee57-prefixed ids + ignoreDuplicates), created with the
 * service client so the matrix never depends on fixtures being applied.
 *
 * Venues (slice 1): only the rows the multi-venue suite reads back by venue
 * name `venue_id` explicitly. Everything else relies on the column default —
 * app.current_venue() resolves to the single active venue while venue B is
 * inactive, which is the only state any suite but multi-venue.test.ts sees.
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
    venue_id: VENUE_A_ID,
  });
  await up('guest_sessions', {
    id: probeId('202'), table_id: probeId('201'), auth_user_id: SEED_STAFF_IDS.owner,
    created_at: past, last_activity_at: past, expires_at: past, closed_at: past,
  });

  // Closed historical day + settled tab + till order/items/ticket + money rows.
  await up('day_sessions', {
    id: probeId('301'), business_date: '2001-01-01', status: 'closed',
    opened_at: past, opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
    closed_at: past, closed_by: SEED_STAFF_IDS.manager, venue_id: VENUE_A_ID,
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
  // Since 0131 device_heartbeats.device_id is an FK to stations(id), so the
  // station has to exist before its heartbeat does.
  await up('stations', { id: 'PROBE-RLS', venue_id: VENUE_A_ID, is_till: false });
  await up(
    'device_heartbeats',
    { device_id: 'PROBE-RLS', queue_depth: 0, venue_id: VENUE_A_ID },
    'device_id',
  );
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
  await writeCafeSettingRows(
    svc,
    specs.map((s) => ({ venue_id: VENUE_A_ID, key: s.key, value: s.default_value, is_public: s.is_public })),
    owner,
  );
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
  const { data, error } = await svc.from('cafe_settings').select('venue_id, key, value, is_public');
  if (error) throw new Error(`snapshotCafeSettings failed: ${error.message}`);
  const rows = (data ?? []) as CafeSettingRow[];
  return () => writeCafeSettingRows(svc, rows, owner);
}

/**
 * Non-null values: direct service-role upsert. JSON-null values: through the
 * owner RPC when available, else the row is deleted — app.cafe_setting()
 * falls back to the registry default (null for every nullable key), so the
 * effective value is identical either way.
 */
/** A cafe_settings row; keyed by (venue_id, key) since 0209. */
type CafeSettingRow = { venue_id: string; key: string; value: unknown; is_public: boolean };

async function writeCafeSettingRows(
  svc: SupabaseClient,
  rows: CafeSettingRow[],
  owner?: SupabaseClient,
): Promise<void> {
  const nonNull = rows.filter((r) => r.value !== null && r.value !== undefined);
  const nulls = rows.filter((r) => r.value === null || r.value === undefined);
  if (nonNull.length > 0) {
    const { error } = await svc
      .from('cafe_settings')
      .upsert(nonNull.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'venue_id,key' });
    if (error) throw new Error(`restore cafe_settings failed: ${error.message}`);
  }
  for (const r of nulls) {
    if (owner && r.venue_id === VENUE_A_ID) {
      await setCafeSetting(owner, r.key, null);
    } else {
      const { error } = await svc.from('cafe_settings').delete().eq('venue_id', r.venue_id).eq('key', r.key);
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

  // telegram_chats (0091): groups the bot has been added to (my_chat_member).
  await up(
    'telegram_chats',
    { chat_id: '-570091', title: 'Probe group ee57', type: 'group', bot_status: 'member', updated_at: past },
    'chat_id',
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

// ─────────────────────────────────────────────────────────────────────────────
// 0065 customers — probe rows for the RLS matrix (drop 5)
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic probe guest for the customer surface (0065). */
export const PROBE_CUSTOMER_EMAIL = 'probe-customer@test.touch.local';

/**
 * One probe guest profile carrying one note and one flag, so the matrix's
 * 'rows' expectations on customer_notes / customer_flags have something to
 * see. The auth user is find-or-create by email (GoTrue refuses a duplicate
 * address, so a rerun re-uses the first one); the note and flag are keyed on
 * the probe's customer_id so they are planted once.
 */
export async function ensureCustomerProbeData(svc: SupabaseClient): Promise<string> {
  let id: string | null = null;
  const { data: existing } = await svc
    .from('profiles')
    .select('id')
    .eq('full_name', 'RLS Probe Customer')
    .limit(1);
  if (existing && existing.length > 0) id = (existing[0] as { id: string }).id;
  if (!id) {
    const { data, error } = await svc.auth.admin.createUser({
      email: PROBE_CUSTOMER_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'RLS Probe Customer', phone: '+964 770 000 0065' },
    });
    if (error || !data.user) throw new Error(`probe customer createUser failed: ${error?.message}`);
    id = data.user.id;
  }
  const { data: note } = await svc
    .from('customer_notes')
    .select('id')
    .eq('customer_id', id)
    .limit(1);
  if (!note || note.length === 0) {
    const { error } = await svc.from('customer_notes').insert({
      customer_id: id,
      body: 'RLS probe note — staff-only',
      author_id: SEED_STAFF_IDS.court_desk,
    });
    if (error) throw new Error(`probe customer_notes failed: ${error.message}`);
  }
  const { error: flagErr } = await svc
    .from('customer_flags')
    .upsert(
      { customer_id: id, type: 'vip', label: 'probe', created_by: SEED_STAFF_IDS.court_desk },
      { onConflict: 'customer_id,type', ignoreDuplicates: true },
    );
  if (flagErr) throw new Error(`probe customer_flags failed: ${flagErr.message}`);
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0067 promotions — probe rows for the RLS matrix (drop 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One DISABLED probe promotion (ee57…701 — disabled so it can never be picked
 * for a real tab), a promotion adjustment on the settled drop-2 probe tab
 * (ee57…302) and the matching redemption row. Same ee57 scheme + idempotency
 * as ensureCafeProbeData; run after it (the tab must exist).
 */
export async function ensurePromotionProbeData(svc: SupabaseClient): Promise<void> {
  const up = async (table: string, row: Record<string, unknown>, onConflict = 'id') => {
    const { error } = await svc.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`probe ${table} failed: ${error.message}`);
  };
  const past = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  await up('promotions', {
    id: probeId('701'), name_en: 'Probe Promotion', name_ar: 'عرض الفحص',
    type: 'amount', value: 500, enabled: false, auto: true,
    created_by: SEED_STAFF_IDS.manager, created_at: past, updated_at: past,
  });
  await up('tab_adjustments', {
    id: probeId('703'), tab_id: probeId('302'), kind: 'discount_amount', value: 500, amount_iqd: 500,
    applied_by: SEED_STAFF_IDS.cashier, authorized_by: SEED_STAFF_IDS.manager,
    reason_code: 'promotion', promotion_id: probeId('701'), created_at: past,
  });
  await up('promotion_redemptions', {
    id: probeId('702'), promotion_id: probeId('701'), tab_id: probeId('302'),
    adjustment_id: probeId('703'), amount_iqd: 500, redeemed_by: SEED_STAFF_IDS.cashier,
    redeemed_at: past,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 0122-0138 multi-venue — probe rows for the RLS matrix (drop 13) and for
// tests/multi-venue.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One registered till at venue A, with a FRESH heartbeat.
 *
 * The drop-13 `stations` select rule needs a row to see, and every heartbeat
 * row needs its station to exist first (0131 FK). Fresh on purpose: the station
 * is a till, and a stale one would put venue A into degraded mode and change
 * the guard outcome of every guest RPC in the matrix.
 */
export async function ensureStationProbe(svc: SupabaseClient): Promise<void> {
  const { error: sErr } = await svc
    .from('stations')
    .upsert(
      { id: 'TILL-PROBE-A', venue_id: VENUE_A_ID, is_till: true, registered_by: SEED_STAFF_IDS.manager },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (sErr) throw new Error(`ensureStationProbe station failed: ${sErr.message}`);
  const { error: hErr } = await svc.from('device_heartbeats').upsert(
    {
      device_id: 'TILL-PROBE-A',
      venue_id: VENUE_A_ID,
      is_till: true,
      queue_depth: 0,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'device_id' },
  );
  if (hErr) throw new Error(`ensureStationProbe heartbeat failed: ${hErr.message}`);
}

export interface VenueBProbe {
  venueId: string;
  /** Two active courts at B, sort_order 101/102 (never courts 1-2 of venue A). */
  courtIds: [string, string];
  /** Two cafe tables at B numbered 'T1'/'T2' — a deliberate collision with A. */
  tableIds: [string, string];
  /** A registered till at B whose heartbeat is a day old (B reads degraded). */
  stationId: string;
  /** The venue-wide 'TEST all-day' rate rule at B (court_id null, priority -100). */
  ruleId: string;
}

/**
 * Create — and ACTIVATE — the second venue. Only tests/multi-venue.test.ts may
 * call this, and only with deactivateVenueBProbeData in its afterAll: while two
 * venues are active app.current_venue() is ambiguous for a caller with no
 * station and no single membership, so every venue-less service_role insert
 * anywhere else in the suite would raise VENUE_REQUIRED.
 *
 * Idempotent (fixed ee57 'be' ids + upserts), and EVERY insert names venue_id
 * rather than leaning on the column default — the default is exactly what this
 * fixture makes ambiguous.
 */
export async function ensureVenueBProbeData(svc: SupabaseClient): Promise<VenueBProbe> {
  const courtIds: [string, string] = [probeId('be11'), probeId('be12')];
  const tableIds: [string, string] = [probeId('be31'), probeId('be32')];
  const ruleId = probeId('be21');
  const stationId = 'TILL-B1-PROBE';
  const up = async (table: string, row: Record<string, unknown>, onConflict = 'id') => {
    const { error } = await svc.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`venue B probe ${table} failed: ${error.message}`);
  };

  // The venue itself, active — everything below hangs off it.
  const { error: vErr } = await svc.from('venues').upsert(
    {
      id: VENUE_B_ID,
      slug: 'probe-venue-b',
      name_en: 'Probe Venue B',
      name_ar: 'فرع تجريبي ب',
      timezone: 'Asia/Baghdad',
      is_active: true,
    },
    { onConflict: 'id' },
  );
  if (vErr) throw new Error(`venue B probe venues failed: ${vErr.message}`);

  // Since slice 2 (0208) every venue has its own venue_settings row and the
  // booking guards read the court's branch row, so B gets a copy of A's (what
  // app.create_branch does for a real branch).
  const { data: aSettings, error: sErr } = await svc
    .from('venue_settings')
    .select('*')
    .eq('venue_id', VENUE_A_ID)
    .single();
  if (sErr) throw new Error(`venue B probe venue_settings read failed: ${sErr.message}`);
  await up(
    'venue_settings',
    { ...(aSettings as Record<string, unknown>), venue_id: VENUE_B_ID, venue_name: 'Probe Venue B' },
    'venue_id',
  );

  // Courts sorted after venue A's two, so any "first court" lookup elsewhere
  // keeps picking A's court 1.
  await up('courts', {
    id: courtIds[0], venue_id: VENUE_B_ID, name_en: 'Probe B Court 1',
    name_ar: 'ملعب ب ١', indoor: true, duration_options: [60, 90, 120],
    sort_order: 101, is_active: true,
  });
  await up('courts', {
    id: courtIds[1], venue_id: VENUE_B_ID, name_en: 'Probe B Court 2',
    name_ar: 'ملعب ب ٢', indoor: true, duration_options: [60, 90, 120],
    sort_order: 102, is_active: true,
  });

  // Same shape ensureTestRateRule plants at A, so a B slot prices too.
  const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  await up('rate_rules', {
    id: ruleId, venue_id: VENUE_B_ID, name: 'TEST all-day', court_id: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '23:59:59',
    priority: -100, valid_from: yesterday, is_active: true,
  });
  const { error: pErr } = await svc.from('rate_rule_prices').upsert(
    [60, 90, 120].map((d) => ({ rule_id: ruleId, duration_min: d, price_iqd: 40_000 })),
    { onConflict: 'rule_id,duration_min', ignoreDuplicates: true },
  );
  if (pErr) throw new Error(`venue B probe rate_rule_prices failed: ${pErr.message}`);

  // 'T1'/'T2' already exist at venue A (fixtures/tables.sql). The collision is
  // the point: it proves 0134's (venue_id, table_number) unique replaced the
  // global one.
  await up('cafe_tables', {
    id: tableIds[0], venue_id: VENUE_B_ID, table_number: 'T1', zone: 'فحص ب',
    capacity: 4, is_active: true,
  });
  await up('cafe_tables', {
    id: tableIds[1], venue_id: VENUE_B_ID, table_number: 'T2', zone: 'فحص ب',
    capacity: 4, is_active: true,
  });

  // A till at B with a DAY-OLD heartbeat: app.is_degraded(B) is true while
  // app.is_degraded(A) stays false, which is how the per-venue overload is
  // proved (0137).
  await up('stations', {
    id: stationId, venue_id: VENUE_B_ID, is_till: true,
    registered_by: SEED_STAFF_IDS.manager_b,
  });
  const { error: hErr } = await svc.from('device_heartbeats').upsert(
    {
      device_id: stationId,
      venue_id: VENUE_B_ID,
      is_till: true,
      queue_depth: 0,
      last_seen_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
    },
    { onConflict: 'device_id' },
  );
  if (hErr) throw new Error(`venue B probe heartbeat failed: ${hErr.message}`);

  // Re-point the two B staff. Delete first: the 0123 trigger gave each of them
  // a venue-A row on insert, and a caller with TWO memberships resolves to
  // nothing (VENUE_REQUIRED) rather than to B.
  const bStaff = [SEED_STAFF_IDS.manager_b, SEED_STAFF_IDS.cashier_b];
  const { error: dErr } = await svc.from('staff_venues').delete().in('staff_id', bStaff);
  if (dErr) throw new Error(`venue B probe staff_venues delete failed: ${dErr.message}`);
  const { error: svErr } = await svc.from('staff_venues').insert([
    { staff_id: SEED_STAFF_IDS.manager_b, venue_id: VENUE_B_ID, role: 'manager' },
    { staff_id: SEED_STAFF_IDS.cashier_b, venue_id: VENUE_B_ID, role: 'cashier' },
  ]);
  if (svErr) throw new Error(`venue B probe staff_venues insert failed: ${svErr.message}`);

  // `up` ignores duplicates, and deactivateVenueBProbeData switched these rows
  // OFF on the previous run: put them back on explicitly, or the second run of
  // this suite proves nothing about an inactive court, table or rule.
  for (const [table, ids] of [
    ['courts', courtIds],
    ['cafe_tables', tableIds],
    ['rate_rules', [ruleId]],
  ] as const) {
    const { error } = await svc.from(table).update({ is_active: true }).in('id', ids);
    if (error) throw new Error(`venue B probe ${table} re-activate failed: ${error.message}`);
  }

  return { venueId: VENUE_B_ID, courtIds, tableIds, stationId, ruleId };
}

/**
 * Put the database back the way every other suite expects to find it: venue B
 * inactive (invisible to app.resolve_venue, app.staff_venue_ids and the venue
 * axis of every policy) and the two B staff back at venue A.
 *
 * Deactivation, never deletion — once B carries an audit_log or payments row it
 * cannot be deleted at all (append-only triggers plus FKs), and a half-deleted
 * venue is worse than an inactive one. The station row is left behind
 * deliberately: staff_breaks keeps its history and points at station ids.
 */
export async function deactivateVenueBProbeData(svc: SupabaseClient): Promise<void> {
  const { error: vErr } = await svc
    .from('venues')
    .update({ is_active: false })
    .eq('id', VENUE_B_ID);
  if (vErr) throw new Error(`deactivateVenueBProbeData venue failed: ${vErr.message}`);

  const { error: cErr } = await svc
    .from('courts')
    .update({ is_active: false })
    .eq('venue_id', VENUE_B_ID);
  if (cErr) throw new Error(`deactivateVenueBProbeData courts failed: ${cErr.message}`);

  const { error: tErr } = await svc
    .from('cafe_tables')
    .update({ is_active: false })
    .eq('venue_id', VENUE_B_ID);
  if (tErr) throw new Error(`deactivateVenueBProbeData tables failed: ${tErr.message}`);

  // The venue-wide 'TEST all-day' rule planted at B. app.price_slot is filtered
  // to the court's venue since 0139, but an ACTIVE rule at an inactive venue is
  // still a row the pricing suites would have to reason about; switch it off.
  const { error: rErr } = await svc
    .from('rate_rules')
    .update({ is_active: false })
    .eq('venue_id', VENUE_B_ID);
  if (rErr) throw new Error(`deactivateVenueBProbeData rate_rules failed: ${rErr.message}`);

  const bStaff = [SEED_STAFF_IDS.manager_b, SEED_STAFF_IDS.cashier_b];
  const { error: dErr } = await svc.from('staff_venues').delete().in('staff_id', bStaff);
  if (dErr) throw new Error(`deactivateVenueBProbeData staff_venues delete failed: ${dErr.message}`);
  const { error: svErr } = await svc.from('staff_venues').insert([
    { staff_id: SEED_STAFF_IDS.manager_b, venue_id: VENUE_A_ID, role: 'manager' },
    { staff_id: SEED_STAFF_IDS.cashier_b, venue_id: VENUE_A_ID, role: 'cashier' },
  ]);
  if (svErr) throw new Error(`deactivateVenueBProbeData staff_venues insert failed: ${svErr.message}`);
}
