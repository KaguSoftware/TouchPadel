/**
 * CAFE — the two calls that run on every send (PHASE-2-PLAN.md Part C+:
 * p95 < 150 ms).
 *
 *   cafe.create_guest_order.10lines_3mods  — the QR guest path, end to end
 *   cafe.compute_tab_totals.40lines        — the fold the till repeats constantly
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  appRpc,
  ensureOpenDay,
  ensureTillFresh,
  openGuestSession,
  serviceClient,
  signedInClient,
  SEED_STAFF,
  type GuestSession,
} from '../../tests/helpers.ts';
import { SERIAL_SAMPLES, errorCode, makeRow, runSerial, tally } from '../harness.ts';
import type { BenchRow } from '../types.ts';
import { BENCH_STATION, benchKey } from './booking.ts';

/** Seeded by bench/seed.sql section 8. */
const BENCH_DAY = 'bec40000-0000-4000-8000-3ffffffffff1';
const BENCH_TAB_40 = 'bec40000-0000-4000-8000-4ffffffffff1';
const BENCH_TABLE = 'bec40000-0000-4000-8000-00000000b001';

/** Bench menu variants a1xx/a2xx, six of them (bench/seed.sql section 5). */
const BENCH_VARIANTS = Array.from(
  { length: 6 },
  (_, i) => `bec40000-0000-4000-8000-00000000a2${String(i + 1).padStart(2, '0')}`,
);
/** Three modifiers, one from each bench group. */
const BENCH_MODIFIERS = [1, 2, 3].map(
  (g) => `bec40000-0000-4000-8000-00000000a4${String(g * 10 + 1).padStart(2, '0')}`,
);

/**
 * venue_settings.guest_orders_per_minute is 6, per GUEST SESSION. Sixty timed
 * orders from one session would be six measurements and fifty-four
 * TOO_MANY_ORDERS refusals, which is a rate limiter working correctly and a
 * benchmark measuring nothing. A fresh session every five orders stays under
 * the limit with a margin; opening one is untimed.
 */
const ORDERS_PER_SESSION = 5;

/**
 * Put the seeded bench day and its 40-line tab back into the state the seed
 * left them in.
 *
 * Any suite that calls tests/helpers.ts forceCloseAllDays — cafe-flow,
 * cafe-money, cafe-stock-analytics, replay-idempotency all do — closes every
 * open day and voids every open tab. That is correct behaviour for those suites
 * and it runs against the same local stack, so between `bench:seed` and a bench
 * run the day can legitimately have been closed underneath us. Re-opening is a
 * service-role UPDATE on rows this file owns by id; it is not a substitute for
 * the seed, which is still where the rows come from.
 */
async function reviveBenchDay(svc: SupabaseClient): Promise<void> {
  const { data: day, error: dayErr } = await svc
    .from('day_sessions')
    .select('id, status')
    .eq('id', BENCH_DAY)
    .maybeSingle();
  if (dayErr) throw new Error(`bench day probe failed: ${dayErr.message}`);
  if (!day) throw new Error(`bench day ${BENCH_DAY} is missing — run bench:seed first`);

  if ((day as { status: string }).status !== 'open') {
    // Only one day may be open at a time (app.open_day raises PREVIOUS_DAY_OPEN),
    // so close whatever else is open before re-opening ours.
    const { error: shutErr } = await svc
      .from('day_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .in('status', ['open', 'closing'])
      .neq('id', BENCH_DAY);
    if (shutErr) throw new Error(`bench day takeover failed: ${shutErr.message}`);
    const { error: openErr } = await svc
      .from('day_sessions')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', BENCH_DAY);
    if (openErr) throw new Error(`bench day re-open failed: ${openErr.message}`);
  }

  const { error: tabErr } = await svc
    .from('tabs')
    .update({ status: 'open' })
    .in('id', [BENCH_TAB_40, 'bec40000-0000-4000-8000-4ffffffffff2'])
    .neq('status', 'open');
  if (tabErr) throw new Error(`bench tab re-open failed: ${tabErr.message}`);
}

/** Ten lines; the first three carry one modifier each, from three groups. */
function tenLinesThreeMods() {
  return Array.from({ length: 10 }, (_, i) => ({
    variant_id: BENCH_VARIANTS[i % BENCH_VARIANTS.length],
    qty: 1 + (i % 2),
    ...(i < 3 ? { modifiers: [{ modifier_id: BENCH_MODIFIERS[i], qty: 1 }] } : {}),
  }));
}

export async function run(): Promise<BenchRow[]> {
  const svc = serviceClient();
  const rows: BenchRow[] = [];

  // app.create_guest_order refuses outright while the till is offline
  // (DEGRADED_LOCKOUT, migration 0038), so refresh the heartbeats first; a stale
  // one left by an earlier degraded-mode test would turn this whole area into
  // sixty identical refusals.
  await ensureTillFresh(svc);
  await reviveBenchDay(svc);

  const manager = await signedInClient(SEED_STAFF.manager);
  const owner = await signedInClient(SEED_STAFF.owner);
  await ensureOpenDay(manager, svc);

  // ───────────────────────────────────────────────────────────────────────────
  // create_guest_order: 10 lines, 3 modifiers
  // ───────────────────────────────────────────────────────────────────────────
  {
    const codes: string[] = [];
    let session: GuestSession | null = null;
    const timed = await runSerial(SERIAL_SAMPLES, async (i) => {
      if (i % ORDERS_PER_SESSION === 0) session = await openGuestSession(owner, BENCH_TABLE);
      const res = await appRpc(session!.client, 'create_guest_order', {
        p_items: tenLinesThreeMods(),
        p_idempotency_key: benchKey('order.create'),
        p_device_id: BENCH_STATION,
      });
      if (res.error) codes.push(errorCode(res.error));
      return res;
    });
    rows.push(
      makeRow({
        id: 'cafe.create_guest_order.10lines_3mods',
        area: 'cafe',
        concurrency: 1,
        callSamples: timed.map((t) => t.ms),
        outcome: codes.length === 0 ? 'ok' : `error:${codes[0]}`,
        errors: tally(codes),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // compute_tab_totals on the seeded 40-line tab.
  //
  // THROUGH THE SERVICE-ROLE CLIENT, deliberately. Migration 0106 (~L275-276)
  // revokes this function from public, anon AND authenticated and grants it to
  // service_role alone: it is an internal fold the money RPCs call, not
  // something a till session may invoke. Benching it as `owner` would measure a
  // 404 from PostgREST and quietly report a two-millisecond p95.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const codes: string[] = [];
    const timed = await runSerial(SERIAL_SAMPLES, async () => {
      const res = await appRpc(svc, 'compute_tab_totals', { p_tab_id: BENCH_TAB_40 });
      if (res.error) codes.push(errorCode(res.error));
      return res;
    });
    rows.push(
      makeRow({
        id: 'cafe.compute_tab_totals.40lines',
        area: 'cafe',
        concurrency: 1,
        callSamples: timed.map((t) => t.ms),
        outcome: codes.length === 0 ? 'ok' : `error:${codes[0]}`,
        errors: tally(codes),
      }),
    );
  }

  return rows;
}
