/**
 * Multi-venue schema foundation — migrations 0122-0138 (Phase 2, Milestone 1,
 * slice 1). The contract suite for the venue axis: the column set, the column
 * defaults, the resolver order, the composite keys, the per-venue degraded
 * overloads and the RLS venue axis.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VENUE B LIVES AND DIES INSIDE THIS FILE.
 *
 * beforeAll calls ensureVenueBProbeData (creates venue B, ACTIVE) and afterAll
 * calls deactivateVenueBProbeData (sets it inactive again). Nothing else in the
 * repository may leave a second ACTIVE venue behind, and this file must not
 * either — not on a failure, not on a bail-out.
 *
 * Why it matters: vitest runs this package singleFork against ONE shared
 * database, so every other suite sees whatever state this file leaves. While
 * two venues are active, app.resolve_venue() cannot answer for a caller with no
 * asserted station and no single staff_venues row — which is exactly what a
 * service_role client is — so the venue_id column default, app.current_venue(),
 * raises VENUE_REQUIRED. Every venue-less `svc.from(...).insert(...)` in every
 * other test file, in the seeds and in the fixtures would go red. That is the
 * design (R1): a row is filed where the caller belongs, or the write is refused
 * loudly. It is also why EVERY service_role insert in this file names venue_id
 * explicitly, except where the point of the case is the default itself.
 *
 * Deactivation, not deletion: once venue B carries an audit_log or payments row
 * it cannot be deleted at all (append-only triggers plus foreign keys). An
 * inactive venue is invisible to app.resolve_venue, app.staff_venue_ids and the
 * venue axis of every policy, which is all that is needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  anonymousSessionClient,
  serviceClient,
  signedInClient,
  ensureTillFresh,
  ensureTestRateRule,
  ensureVenueBProbeData,
  deactivateVenueBProbeData,
  appRpc,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  VENUE_A_ID,
  VENUE_B_ID,
  type VenueBProbe,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/** Catalog reads the REST surface cannot make (pg_trigger); same shape as assistant-wall.test.ts. */
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}

/**
 * The hand list from the plan's table inventory — 35 scoped tables plus
 * venue_settings. Copied by hand on purpose: a list derived from the schema
 * would agree with the schema no matter what the schema said.
 */
const HAS_VENUE_ID = [
  // Parents (21)
  'courts', 'rate_rules', 'cafe_tables', 'day_sessions', 'menu_categories', 'menu_items',
  'modifier_groups', 'ingredients', 'deliveries', 'stock_counts', 'tax_groups',
  'marketing_audiences', 'marketing_campaigns', 'analytics_insights', 'analytics_patterns',
  'analytics_insight_rejections', 'telegram_outbox', 'telegram_actions', 'manager_alerts',
  'degraded_periods', 'audit_log',
  // Hot / ledger (14)
  'reservations', 'reservation_series', 'guest_sessions', 'tabs', 'orders', 'tickets',
  'payments', 'refunds', 'stock_batches', 'stock_movements', 'waiter_calls', 'staff_breaks',
  'station_staff', 'device_heartbeats',
  // The one-row singleton (slice 1 keeps its boolean primary key)
  'venue_settings',
] as const;

/** Leaf tables that derive their venue through a foreign key, and global tables. */
const NO_VENUE_ID = [
  // Derives via FK (17)
  'rate_rule_prices', 'menu_item_variants', 'menu_item_allergens', 'menu_item_costs',
  'addon_suggestions', 'modifiers', 'modifier_reveals', 'menu_item_modifier_groups',
  'order_items', 'order_item_modifiers', 'tab_adjustments', 'refund_items', 'recipe_lines',
  'delivery_lines', 'stock_count_lines', 'marketing_sends', 'promotion_redemptions',
  // Global
  'profiles', 'staff', 'allergens', 'telegram_staff', 'telegram_chats', 'notification_outbox',
  'sync_replays', 'promotions', 'customer_notes', 'customer_flags', 'staff_requests',
  'cafe_settings',
] as const;

/** The live schema as PostgREST publishes it (same trick as stored-fields.test.ts). */
async function liveColumns(): Promise<Record<string, string[]>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status}`);
  const doc = (await res.json()) as {
    definitions: Record<string, { properties?: Record<string, unknown> }>;
  };
  const out: Record<string, string[]> = {};
  for (const [table, spec] of Object.entries(doc.definitions ?? {})) {
    out[table] = Object.keys(spec.properties ?? {});
  }
  return out;
}

/** A far-future, per-run business_date: dates are opaque to the till logic. */
function farFutureDate(offsetDays = 0): string {
  const days = 30_000 + Math.floor(Math.random() * 1_000_000) + offsetDays;
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!up)('multi-venue schema foundation (0122-0138)', () => {
  let svc: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let managerB: SupabaseClient;
  let cashierB: SupabaseClient;
  let guest: SupabaseClient;
  let venueB: VenueBProbe;
  let live: Record<string, string[]>;
  /** Stations registered by case 10; removed in afterAll. */
  const registeredStations: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    live = await liveColumns();

    // Venue A's tills fresh BEFORE venue B's stale one exists: case 8 asserts
    // is_degraded(A) is false while is_degraded(B) is true, and a till another
    // suite left stale at A would make that read as a bug in the overload.
    await ensureTillFresh(svc);
    venueB = await ensureVenueBProbeData(svc);

    anon = anonClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    managerB = await signedInClient(SEED_STAFF.manager_b);
    cashierB = await signedInClient(SEED_STAFF.cashier_b);
    guest = await anonymousSessionClient();
  });

  afterAll(async () => {
    await deactivateVenueBProbeData(svc);
    if (registeredStations.length > 0) {
      // Heartbeats first: device_heartbeats.device_id is an FK to stations (0131).
      await svc.from('device_heartbeats').delete().in('device_id', registeredStations);
      await svc.from('stations').delete().in('id', registeredStations);
    }
    await ensureTillFresh(svc);
  });

  // ── 1 ──────────────────────────────────────────────────────────────────────
  it('1. the default venue exists at the fixed uuid and app.default_venue() returns it', async () => {
    const { data, error } = await svc
      .from('venues')
      .select('id, slug, is_active')
      .eq('id', VENUE_A_ID)
      .single();
    expect(error).toBeNull();
    expect((data as { is_active: boolean }).is_active).toBe(true);

    // default_venue() is service_role only — no client role may ask.
    const def = await svc.schema('app').rpc('default_venue', {});
    expect(def.error).toBeNull();
    expect(def.data).toBe(VENUE_A_ID);
  });

  // ── 2 ──────────────────────────────────────────────────────────────────────
  it('2. every scoped table has venue_id and every derived/global table does not', async () => {
    const missing = HAS_VENUE_ID.filter((t) => !(live[t] ?? []).includes('venue_id'));
    expect(missing, `tables missing venue_id: ${missing.join(', ')}`).toHaveLength(0);

    const unexpected = NO_VENUE_ID.filter((t) => (live[t] ?? []).includes('venue_id'));
    expect(
      unexpected,
      `tables that should derive their venue, not carry it: ${unexpected.join(', ')}`,
    ).toHaveLength(0);

    // The three new tables are published too.
    for (const t of ['venues', 'staff_venues', 'stations']) {
      expect(live[t], `${t} is not in the PostgREST schema`).toBeTruthy();
    }
  });

  // ── 3 ──────────────────────────────────────────────────────────────────────
  it('3. the column default is current_venue() on C tables and or_default() on D tables', async () => {
    // (a) An explicit NULL is refused by the validated CHECK (0129), not by a
    // NOT NULL — R5 keeps types.gen.ts's `venue_id: string | null`.
    const explicitNull = await svc.from('courts').insert({
      name_en: 'Multi-venue null probe',
      name_ar: 'فحص فارغ',
      indoor: true,
      duration_options: [60],
      is_active: false,
      venue_id: null,
    });
    expect(explicitNull.error?.code).toBe('23514');

    // (b) A C table with NO venue_id, written by service_role while two venues
    // are active: the default is app.current_venue(), which refuses rather than
    // guessing. This is what proves the default is not default_venue().
    const ambiguous = await svc.from('courts').insert({
      name_en: 'Multi-venue ambiguous probe',
      name_ar: 'فحص غامض',
      indoor: true,
      duration_options: [60],
      is_active: false,
    });
    expect(ambiguous.error?.message ?? '').toContain('VENUE_REQUIRED');

    // (c) A D table takes app.current_venue_or_default() instead, so a cron tick
    // or an edge function with no caller never raises — it files at venue A.
    const { data: alert, error: alertErr } = await svc
      .from('manager_alerts')
      .insert({ kind: 'low_stock', payload: { probe: 'multi-venue-d-default' } })
      .select('id, venue_id')
      .single();
    expect(alertErr).toBeNull();
    expect((alert as { venue_id: string }).venue_id).toBe(VENUE_A_ID);
  });

  // ── 4 ──────────────────────────────────────────────────────────────────────
  it('4. composite uniques: a number is unique per venue, not globally', async () => {
    // 'T1' already exists at venue A (fixtures/tables.sql) AND at venue B
    // (ensureVenueBProbeData). That pair is the whole claim.
    const { data: ones, error: onesErr } = await svc
      .from('cafe_tables')
      .select('id, venue_id')
      .eq('table_number', 'T1');
    expect(onesErr).toBeNull();
    const venues = new Set((ones ?? []).map((r) => (r as { venue_id: string }).venue_id));
    expect(venues.has(VENUE_B_ID)).toBe(true);

    // A SECOND 'T1' at venue B is still a duplicate.
    const dupe = await svc.from('cafe_tables').insert({
      venue_id: VENUE_B_ID,
      table_number: 'T1',
      zone: 'فحص ب',
      is_active: false,
    });
    expect(dupe.error?.code).toBe('23505');

    // Same shape for day_sessions (venue_id, business_date).
    const date = farFutureDate();
    const dayA = await svc.from('day_sessions').insert({
      venue_id: VENUE_A_ID, business_date: date, status: 'closed',
      opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager,
    });
    expect(dayA.error).toBeNull();
    const dayB = await svc.from('day_sessions').insert({
      venue_id: VENUE_B_ID, business_date: date, status: 'closed',
      opened_by: SEED_STAFF_IDS.manager_b, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager_b,
    });
    expect(dayB.error, 'the same business_date must be openable at each venue').toBeNull();
    const dayBAgain = await svc.from('day_sessions').insert({
      venue_id: VENUE_B_ID, business_date: date, status: 'closed',
      opened_by: SEED_STAFF_IDS.manager_b, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager_b,
    });
    expect(dayBAgain.error?.code).toBe('23505');
  });

  // ── 5 ──────────────────────────────────────────────────────────────────────
  it.skipIf(!dockerReachable())('5. the four append-only triggers survived the 0127 backfill', () => {
    // The backfill disables audit_log_ao / payments_ao / refunds_ao /
    // stock_movements_ao and re-enables them in the same transaction. A file
    // that forgot the re-enable would leave the money ledger mutable.
    //
    // Read pg_trigger directly (the query 0127's header tells the operator to
    // run after a hosted push). A zero-row UPDATE was the previous probe; it
    // proved that SOME statement trigger raised, not that these four are
    // enabled on these four tables.
    const rows = psql(`
      select c.relname || ':' || t.tgname || ':' || t.tgenabled
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and t.tgname in ('audit_log_ao', 'payments_ao', 'refunds_ao', 'stock_movements_ao')
       order by 1`).split('\n').filter(Boolean);
    expect(rows).toEqual([
      'audit_log:audit_log_ao:O',
      'payments:payments_ao:O',
      'refunds:refunds_ao:O',
      'stock_movements:stock_movements_ao:O',
    ]);
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────
  it('6. app.current_venue resolves station -> single membership -> single active venue', async () => {
    // (1) An asserted station wins over the caller's own membership: the venue-A
    // manager standing at venue B's till writes at venue B.
    const byStation = await appRpc(manager, 'current_venue', { p_station_id: venueB.stationId });
    expect(byStation.error).toBeNull();
    expect(byStation.data).toBe(VENUE_B_ID);

    // (2) No station, exactly one membership.
    const bMember = await appRpc(managerB, 'current_venue', { p_station_id: null });
    expect(bMember.error).toBeNull();
    expect(bMember.data).toBe(VENUE_B_ID);

    const aMember = await appRpc(manager, 'current_venue', { p_station_id: null });
    expect(aMember.error).toBeNull();
    expect(aMember.data).toBe(VENUE_A_ID);

    // (3) The owner has no staff_venues row at all (0123 deletes the owner's),
    // and with two venues active step 4 cannot break the tie either.
    const ambiguous = await appRpc(owner, 'current_venue', { p_station_id: null });
    expect(ambiguous.error?.message ?? '').toContain('VENUE_REQUIRED');
  });

  // ── 7 ──────────────────────────────────────────────────────────────────────
  it('7. the pre-identity guest surface never raises, even with two venues active', async () => {
    // R3: both are granted to anon and are called by the guest menu before any
    // identity exists, so they delegate through current_venue_or_default().
    const degraded = await appRpc(anon, 'is_degraded', {});
    expect(degraded.error).toBeNull();
    expect(typeof degraded.data).toBe('boolean');

    const mode = await appRpc(anon, 'venue_mode', {});
    expect(mode.error).toBeNull();
    expect(mode.data).toBeTruthy();
  });

  // ── 8 ──────────────────────────────────────────────────────────────────────
  it('8. degraded mode is per venue: B is stale, A is not', async () => {
    const atB = await appRpc(anon, 'is_degraded', { p_venue: VENUE_B_ID });
    expect(atB.error).toBeNull();
    expect(atB.data, "venue B's only till last beat a day ago").toBe(true);

    const atA = await appRpc(anon, 'is_degraded', { p_venue: VENUE_A_ID });
    expect(atA.error).toBeNull();
    expect(atA.data).toBe(false);

    // The zero-arg form answers for the default venue, so it must agree with A.
    const zeroArg = await appRpc(anon, 'is_degraded', {});
    expect(zeroArg.data).toBe(false);

    const modeB = await appRpc(anon, 'venue_mode', { p_venue: VENUE_B_ID });
    expect(modeB.error).toBeNull();
    expect((modeB.data as { degraded: boolean }).degraded).toBe(true);
  });

  // ── 9 ──────────────────────────────────────────────────────────────────────
  it('9. app.staff_venue_ids answers about the caller alone', async () => {
    const asOwner = await appRpc(owner, 'staff_venue_ids', {});
    expect(asOwner.error).toBeNull();
    const ownerVenues = asOwner.data as string[];
    expect(ownerVenues).toContain(VENUE_A_ID);
    expect(ownerVenues, 'an owner holds every ACTIVE venue').toContain(VENUE_B_ID);

    const asManager = await appRpc(manager, 'staff_venue_ids', {});
    expect(asManager.error).toBeNull();
    expect(asManager.data).toEqual([VENUE_A_ID]);

    const asCashierB = await appRpc(cashierB, 'staff_venue_ids', {});
    expect(asCashierB.error).toBeNull();
    expect(asCashierB.data).toEqual([VENUE_B_ID]);

    // A guest is not refused; there is simply nothing to answer.
    const asGuest = await appRpc(guest, 'staff_venue_ids', {});
    expect(asGuest.error).toBeNull();
    expect(asGuest.data).toEqual([]);
  });

  // ── 10 ─────────────────────────────────────────────────────────────────────
  it('10. heartbeat auto-registers a station when the venue is unambiguous, else STATION_UNKNOWN', async () => {
    const stamp = Date.now();

    // (a) The venue-A cashier has exactly one membership, so a brand-new till
    // registers itself at venue A. This is R2: the refusal is "resolve_venue
    // returned NULL", never "a second venue exists" — degraded.test.ts,
    // heartbeat-liveness.test.ts and retire-device.test.ts all beat as this
    // principal and would go red the moment venue B existed otherwise.
    const freshA = `MV-A-${stamp}`;
    registeredStations.push(freshA);
    const beatA = await appRpc(cashier, 'heartbeat', {
      p_device_id: freshA, p_queue_depth: 0, p_app_version: 'multi-venue-test', p_is_till: false,
    });
    expect(beatA.error).toBeNull();
    const { data: stationA, error: stationAErr } = await svc
      .from('stations')
      .select('venue_id')
      .eq('id', freshA)
      .single();
    expect(stationAErr).toBeNull();
    expect((stationA as { venue_id: string }).venue_id).toBe(VENUE_A_ID);

    // (b) The owner belongs to no single venue, so an unknown station cannot be
    // filed anywhere and is refused rather than guessed at.
    const freshUnknown = `MV-X-${stamp}`;
    const beatUnknown = await appRpc(owner, 'heartbeat', {
      p_device_id: freshUnknown, p_queue_depth: 0, p_app_version: 'multi-venue-test', p_is_till: false,
    });
    expect(beatUnknown.error?.message ?? '').toContain('STATION_UNKNOWN');
    const { data: ghost } = await svc.from('stations').select('id').eq('id', freshUnknown);
    expect(ghost ?? [], 'a refused heartbeat must register nothing').toHaveLength(0);

    // (c) A KNOWN station resolves on its own, whoever is beating.
    const beatB = await appRpc(managerB, 'heartbeat', {
      p_device_id: venueB.stationId, p_queue_depth: 0, p_app_version: 'multi-venue-test', p_is_till: true,
    });
    expect(beatB.error).toBeNull();
    const { data: beatRow } = await svc
      .from('device_heartbeats')
      .select('venue_id')
      .eq('device_id', venueB.stationId)
      .single();
    expect((beatRow as { venue_id: string }).venue_id).toBe(VENUE_B_ID);

    // That beat just un-degraded venue B. Case 8 runs before this one, but put
    // the fixture back so the order of these cases is not load-bearing.
    const { error: restaleErr } = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: new Date(Date.now() - 24 * 3600_000).toISOString() })
      .eq('device_id', venueB.stationId);
    expect(restaleErr).toBeNull();
  });

  // ── 11 ─────────────────────────────────────────────────────────────────────
  it('11. RLS: the staff branch of every policy is venue-scoped', async () => {
    // A staff-only table (0136 shape A) — no guest-readable disjunct, so this
    // is the clean statement of the claim. One closed day at each venue.
    const date = farFutureDate(7);
    const insA = await svc.from('day_sessions').insert({
      venue_id: VENUE_A_ID, business_date: date, status: 'closed',
      opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager,
    }).select('id').single();
    expect(insA.error).toBeNull();
    const insB = await svc.from('day_sessions').insert({
      venue_id: VENUE_B_ID, business_date: date, status: 'closed',
      opened_by: SEED_STAFF_IDS.manager_b, opening_float_iqd: 0,
      closed_at: new Date().toISOString(), closed_by: SEED_STAFF_IDS.manager_b,
    }).select('id').single();
    expect(insB.error).toBeNull();
    const dayA = (insA.data as { id: string }).id;
    const dayB = (insB.data as { id: string }).id;

    const cashierSeesB = await cashier.from('day_sessions').select('id').eq('id', dayB);
    expect(cashierSeesB.error, 'RLS hides, it does not raise').toBeNull();
    expect(cashierSeesB.data ?? []).toHaveLength(0);

    const cashierBSeesA = await cashierB.from('day_sessions').select('id').eq('id', dayA);
    expect(cashierBSeesA.error).toBeNull();
    expect(cashierBSeesA.data ?? []).toHaveLength(0);

    const cashierBSeesB = await cashierB.from('day_sessions').select('id').eq('id', dayB);
    expect(cashierBSeesB.error).toBeNull();
    expect(cashierBSeesB.data ?? []).toHaveLength(1);

    // The owner holds every active venue, so the owner sees both.
    const ownerSees = await owner
      .from('day_sessions')
      .select('id, venue_id')
      .in('id', [dayA, dayB]);
    expect(ownerSees.error).toBeNull();
    expect(ownerSees.data ?? []).toHaveLength(2);

    // KNOWN GAP, closed in slice 4. courts_read is 0136 shape C —
    // `using (is_active or <staff branch>)` — and only the STAFF branch gained
    // the venue clause. So a manager at venue A can still see an ACTIVE court at
    // venue B through the guest disjunct, exactly as a guest can. What slice 1
    // does guarantee is that the staff branch alone no longer reaches across
    // venues: an INACTIVE court at B is invisible to the A manager and visible
    // to the owner, who holds both venues.
    const hiddenCourt = 'ee570000-0000-4000-8000-00000000be13';
    const { error: hcErr } = await svc.from('courts').upsert(
      {
        id: hiddenCourt, venue_id: VENUE_B_ID, name_en: 'Probe B Retired Court',
        name_ar: 'ملعب ب متقاعد', indoor: true, duration_options: [60], sort_order: 103,
        is_active: false,
      },
      { onConflict: 'id' },
    );
    expect(hcErr).toBeNull();

    const managerSeesHidden = await manager.from('courts').select('id').eq('id', hiddenCourt);
    expect(managerSeesHidden.error).toBeNull();
    expect(managerSeesHidden.data ?? []).toHaveLength(0);

    const ownerSeesHidden = await owner.from('courts').select('id').eq('id', hiddenCourt);
    expect(ownerSeesHidden.error).toBeNull();
    expect(ownerSeesHidden.data ?? []).toHaveLength(1);

    const managerBSeesHidden = await managerB.from('courts').select('id').eq('id', hiddenCourt);
    expect(managerBSeesHidden.error).toBeNull();
    expect(managerBSeesHidden.data ?? []).toHaveLength(1);
  });

  it('11b. RLS: the device registry is per venue (stations_read_staff, 0139)', async () => {
    // Venue B's till is planted by ensureVenueBProbeData; venue A's stations
    // come from every other suite. Neither cashier sees the other site's tills.
    const cashierSeesB = await cashier.from('stations').select('id').eq('id', venueB.stationId);
    expect(cashierSeesB.error).toBeNull();
    expect(cashierSeesB.data ?? [], "a venue-A cashier must not read venue B's till").toHaveLength(0);

    const cashierBSeesA = await cashierB.from('stations').select('id').eq('venue_id', VENUE_A_ID);
    expect(cashierBSeesA.error).toBeNull();
    expect(cashierBSeesA.data ?? []).toHaveLength(0);

    const cashierBSeesB = await cashierB.from('stations').select('id').eq('id', venueB.stationId);
    expect(cashierBSeesB.error).toBeNull();
    expect(cashierBSeesB.data ?? []).toHaveLength(1);

    const ownerSees = await owner.from('stations').select('id').eq('id', venueB.stationId);
    expect(ownerSees.error).toBeNull();
    expect(ownerSees.data ?? []).toHaveLength(1);
  });

  it('11c. RLS: a manager reads the roster of their own venues only (staff_venues_read_mgmt, 0139)', async () => {
    const managerSeesB = await manager.from('staff_venues').select('staff_id').eq('venue_id', VENUE_B_ID);
    expect(managerSeesB.error).toBeNull();
    expect(managerSeesB.data ?? [], "a venue-A manager must not read venue B's roster").toHaveLength(0);

    const managerBSeesA = await managerB.from('staff_venues').select('staff_id').eq('venue_id', VENUE_A_ID);
    expect(managerBSeesA.error).toBeNull();
    expect(managerBSeesA.data ?? []).toHaveLength(0);

    const managerBSeesB = await managerB.from('staff_venues').select('staff_id').eq('venue_id', VENUE_B_ID);
    expect(managerBSeesB.error).toBeNull();
    expect(managerBSeesB.data ?? []).toHaveLength(2);

    // The cashier at B still reads their OWN row through staff_venues_read_own.
    const cashierBOwn = await cashierB.from('staff_venues').select('venue_id').eq('staff_id', SEED_STAFF_IDS.cashier_b);
    expect(cashierBOwn.error).toBeNull();
    expect(cashierBOwn.data ?? []).toHaveLength(1);

    const ownerSees = await owner.from('staff_venues').select('staff_id').eq('venue_id', VENUE_B_ID);
    expect(ownerSees.error).toBeNull();
    expect(ownerSees.data ?? []).toHaveLength(2);
  });

  // ── 12 ─────────────────────────────────────────────────────────────────────
  it('12. an RPC writes at the caller\'s venue, and cannot write across venues', async () => {
    // (a) The default inside a SECURITY DEFINER body still resolves from the
    // CALLER's context: the venue-A manager's new court lands at venue A with
    // no app change at all, which is the "production keeps working" claim.
    const created = await appRpc(manager, 'upsert_court', {
      p_name_en: `Multi-venue probe ${Date.now()}`,
      p_name_ar: 'ملعب فحص الفروع',
      p_indoor: true,
      p_duration_options: [60, 90],
      p_is_active: false,
    });
    expect(created.error).toBeNull();
    const courtId = created.data as string;
    const { data: courtRow } = await svc
      .from('courts')
      .select('venue_id')
      .eq('id', courtId)
      .single();
    expect((courtRow as { venue_id: string }).venue_id).toBe(VENUE_A_ID);

    // (b) The venue-A manager booking one of venue B's courts. The reservation
    // takes venue A from the column default, and the composite foreign key
    // (court_id, venue_id) -> courts(id, venue_id) has no row to point at.
    //
    // Observed on the first run (2026-09-21): the definer body does not wrap
    // it — PostgREST returns the raw 23503 naming reservations_court_venue_fkey,
    // with the (court_id, venue_id) pair in `details`. Slice 3 turns this into
    // VENUE_MISMATCH (P0001) in the RPC guard; until then the storage engine is
    // the guard, and this assertion pins that it fires.
    const start = new Date(Date.now() + 40 * 24 * 3600_000);
    start.setUTCHours(8, 0, 0, 0);
    const crossVenue = await appRpc(manager, 'staff_create_reservation', {
      p_court_id: venueB.courtIds[0],
      p_kind: 'booking',
      p_start_at: start.toISOString(),
      p_end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
      p_guest_name: 'Cross-venue probe',
    });
    expect(crossVenue.error, 'a booking must never cross venues').not.toBeNull();
    expect(crossVenue.error?.code).toBe('23503');
    expect(crossVenue.error?.message).toContain('reservations_court_venue_fkey');
  });

  // ── 13 ─────────────────────────────────────────────────────────────────────
  it("13. app.price_slot prices a court from its own venue's rules only (0139)", async () => {
    // Both venues carry a venue-wide 'TEST all-day' rule (court_id null,
    // priority -100). Give B's a price A's does not have: before 0139 the two
    // were both candidates for an A court and the raw uuid broke the tie.
    await ensureTestRateRule(svc);
    const { error: bErr } = await svc
      .from('rate_rule_prices')
      .update({ price_iqd: 99_000 })
      .eq('rule_id', venueB.ruleId);
    expect(bErr).toBeNull();

    const { data: courtA } = await svc
      .from('courts')
      .select('id')
      .eq('venue_id', VENUE_A_ID)
      .eq('is_active', true)
      .order('sort_order')
      .limit(1)
      .single();
    const courtAId = (courtA as { id: string }).id;

    // A far-future weekday morning, inside both all-day windows.
    const start = new Date(Date.now() + 45 * 24 * 3600_000);
    start.setUTCHours(8, 0, 0, 0);

    const priceA = await appRpc(anon, 'price_slot', {
      p_court_id: courtAId, p_start_at: start.toISOString(), p_duration_min: 60,
    });
    expect(priceA.error).toBeNull();
    const rowsA = (priceA.data ?? []) as { rule_id: string; price_iqd: number }[];
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.rule_id, "venue B's rule priced a venue-A court").not.toBe(venueB.ruleId);
    expect(Number(rowsA[0]?.price_iqd)).not.toBe(99_000);

    const priceB = await appRpc(anon, 'price_slot', {
      p_court_id: venueB.courtIds[0], p_start_at: start.toISOString(), p_duration_min: 60,
    });
    expect(priceB.error).toBeNull();
    const rowsB = (priceB.data ?? []) as { rule_id: string; price_iqd: number }[];
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.rule_id).toBe(venueB.ruleId);
    expect(Number(rowsB[0]?.price_iqd)).toBe(99_000);

    const { error: resetErr } = await svc
      .from('rate_rule_prices')
      .update({ price_iqd: 40_000 })
      .eq('rule_id', venueB.ruleId);
    expect(resetErr).toBeNull();
  });

  // ── 14 ─────────────────────────────────────────────────────────────────────
  it('14. the degraded sweep opens and closes periods per venue (0139)', async () => {
    // Fixture state: A's tills fresh, B's only till a day old. A beat at A runs
    // the sweep; before 0139 it read is_degraded() for A (false) and closed
    // EVERY open period, B's included, and never opened one for B.
    const stamp = Date.now();
    const tillA = `MV-SWEEP-${stamp}`;
    registeredStations.push(tillA);
    const beat = await appRpc(cashier, 'heartbeat', {
      p_device_id: tillA, p_queue_depth: 0, p_app_version: 'multi-venue-test', p_is_till: false,
    });
    expect(beat.error).toBeNull();

    const openB = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_B_ID).is('ended_at', null);
    expect(openB.error).toBeNull();
    expect(openB.data ?? [], 'venue B is degraded, so it has exactly one open period').toHaveLength(1);

    const openA = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_A_ID).is('ended_at', null);
    expect(openA.error).toBeNull();
    expect(openA.data ?? [], 'venue A is fresh, so nothing is open there').toHaveLength(0);

    const modeB = await appRpc(anon, 'venue_mode', { p_venue: VENUE_B_ID });
    expect(modeB.error).toBeNull();
    expect((modeB.data as { degraded_since: string | null }).degraded_since).not.toBeNull();

    // Recovery at B closes B's period and only B's: freshen its till and beat there.
    const { error: freshErr } = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('device_id', venueB.stationId);
    expect(freshErr).toBeNull();
    const beatB = await appRpc(managerB, 'heartbeat', {
      p_device_id: venueB.stationId, p_queue_depth: 0, p_app_version: 'multi-venue-test', p_is_till: true,
    });
    expect(beatB.error).toBeNull();
    const closedB = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_B_ID).is('ended_at', null);
    expect(closedB.data ?? []).toHaveLength(0);

    // Put B's till back a day so case order stays irrelevant.
    await svc
      .from('device_heartbeats')
      .update({ last_seen_at: new Date(Date.now() - 24 * 3600_000).toISOString() })
      .eq('device_id', venueB.stationId);
  });
});
