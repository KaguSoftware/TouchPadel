/**
 * REPLAY — drain 500 queued mutations on reconnect (PHASE-2-PLAN.md Part C+:
 * under 60 s; exactly-once by row count. SOW M7 acceptance, and the C1
 * lost-mutation regression).
 *
 * This is the only area that leaves the database and speaks HTTP. `supabase
 * start` does NOT serve edge functions, so a run needs
 * `npx supabase functions serve` from packages/db alongside it; when the runtime
 * is unreachable the row is recorded as `outcome: 'skipped'` and compare.ts
 * fails on it if the baseline has it, which is the point — a silently absent
 * replay benchmark is worse than a red one.
 *
 * The request is byte-for-byte what apps/operator-shell/src/main/sync-worker.ts
 * (~L117) sends: POST /functions/v1/replay with `apikey` and
 * `Authorization: Bearer <access_token>` and a body of
 * { idempotency_key, mutation_type, payload, station_id, staff_id }.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANON_KEY,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  serviceClient,
  signedInClient,
} from '../../tests/helpers.ts';
import { REPLAY_DRAIN, invariants, makeRow, timeIt } from '../harness.ts';
import type { BenchRow } from '../types.ts';
import { BENCH_STATION, benchKey } from './booking.ts';

/** The empty open tab bench/seed.sql section 8 leaves for this drain. */
const BENCH_TAB_REPLAY = 'bec40000-0000-4000-8000-4ffffffffff2';
/** One bench variant; the drain measures the round trip, not the menu. */
const BENCH_VARIANT = 'bec40000-0000-4000-8000-00000000a201';

/** How many of the 500 keys are re-POSTed verbatim to prove exactly-once. */
const REPOST = 50;

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/replay`;

/**
 * Does the functions runtime answer at all?
 *
 * Mirrors the wait loop in .github/workflows/ci.yml (~L406-418): ANY HTTP
 * status means the runtime is up. A POST with no Authorization gets 401 from
 * replay's own staff check, which is an answer; a connection refusal is not.
 */
async function runtimeReachable(): Promise<boolean> {
  try {
    const res = await fetch(FUNCTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON_KEY },
      body: '{}',
      signal: AbortSignal.timeout(5_000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

interface PostOut {
  status: number;
  result?: string;
  error?: string;
}

async function postReplay(accessToken: string, key: string): Promise<PostOut> {
  const res = await fetch(FUNCTIONS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      idempotency_key: key,
      mutation_type: 'order.add_items',
      payload: {
        tabId: BENCH_TAB_REPLAY,
        items: [{ variantId: BENCH_VARIANT, qty: 1, modifiers: [] }],
      },
      station_id: BENCH_STATION,
      staff_id: SEED_STAFF_IDS.cashier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
  return { status: res.status, result: body.result, error: body.error };
}

/**
 * order_items currently hanging off the replay tab, through its orders.
 *
 * ONE request with a PostgREST inner join, not two with an `.in(order_ids)`.
 * The drain leaves 500 orders on this tab, and 500 uuids in an `in.(…)` filter
 * is a ~19 KB query string: the gateway rejects it and supabase-js hands back
 * an error with an EMPTY message, which is a miserable thing to debug at the
 * end of a twenty-minute bench run. `orders!inner(tab_id)` pushes the join to
 * the database where it belongs and the URL stays constant-length.
 */
async function countTabItems(svc: SupabaseClient): Promise<number> {
  const { count, error } = await svc
    .from('order_items')
    .select('id, orders!inner(tab_id)', { count: 'exact', head: true })
    .eq('orders.tab_id', BENCH_TAB_REPLAY);
  if (error) throw new Error(`replay item probe failed: ${error.message || '(empty)'}`);
  return count ?? 0;
}

async function countReplays(svc: SupabaseClient): Promise<number> {
  const { count, error } = await svc
    .from('sync_replays')
    .select('id', { count: 'exact', head: true })
    .eq('device_id', BENCH_STATION);
  if (error) throw new Error(`sync_replays probe failed: ${error.message}`);
  return count ?? 0;
}

export async function run(): Promise<BenchRow[]> {
  const svc = serviceClient();

  if (!(await runtimeReachable())) {
    return [
      makeRow({
        id: 'replay.drain_500',
        area: 'replay',
        concurrency: 1,
        callSamples: [],
        outcome: 'skipped',
        notes: {
          reason: `no edge runtime at ${FUNCTIONS_URL} — run \`npx supabase functions serve\` from packages/db`,
        },
      }),
    ];
  }

  const cashier = await signedInClient(SEED_STAFF.cashier);
  const { data: session } = await cashier.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) throw new Error('replay bench: cashier session has no access token');

  // COUNT DELTAS, not absolutes. public.sync_replays carries an append-only
  // trigger (sync_replays_ao), so a run cannot clear its predecessor's rows the
  // way the booking area clears its reservations, and a second bench run
  // without a teardown in between would otherwise "find" 1,000 replays and call
  // exactly-once broken. The claim being tested is that THIS drain applied each
  // of its 500 keys exactly once, which is a delta.
  const itemsBefore = await countTabItems(svc);
  const replaysBefore = await countReplays(svc);

  const keys = Array.from({ length: REPLAY_DRAIN }, () => benchKey('order.add_items'));
  const samples: number[] = [];
  const statuses: Record<string, number> = {};
  let applied = 0;

  // STRICTLY SEQUENTIAL. The shell's sync worker drains its queue one row at a
  // time and in order (a tab.open has to land before the order that names it),
  // so a parallel drain would measure a throughput the product never asks for.
  const t0 = performance.now();
  for (const key of keys) {
    const timed = await timeIt(() => postReplay(accessToken, key));
    samples.push(timed.ms);
    const out = timed.value as PostOut | undefined;
    const label = out ? `${out.status}:${out.result ?? out.error ?? 'none'}` : 'transport';
    statuses[label] = (statuses[label] ?? 0) + 1;
    if (out?.result === 'applied') applied++;
  }
  const wallMs = performance.now() - t0;

  const itemsAfter = await countTabItems(svc);
  const replaysAfter = await countReplays(svc);

  // EXACTLY-ONCE, the second half: re-POST 50 of the keys VERBATIM. That is what
  // a till does when it reconnects mid-drain and replays from its last
  // acknowledged row — the classic double-charge. Every one must come back
  // `duplicate` from the sync_replays lookup, and neither count may move.
  const repostKeys = keys.slice(0, REPOST);
  let duplicates = 0;
  for (const key of repostKeys) {
    const out = await postReplay(accessToken, key);
    if (out.result === 'duplicate') duplicates++;
  }
  const itemsFinal = await countTabItems(svc);
  const replaysFinal = await countReplays(svc);

  const inv = invariants();
  inv.check(
    'all 500 applied',
    applied === REPLAY_DRAIN,
    `${applied}/${REPLAY_DRAIN} returned result=applied; statuses ${JSON.stringify(statuses)}`,
  );
  inv.check(
    'order_items grew by exactly 500',
    itemsAfter - itemsBefore === REPLAY_DRAIN,
    `${itemsBefore} -> ${itemsAfter} (delta ${itemsAfter - itemsBefore})`,
  );
  inv.check(
    'sync_replays grew by exactly 500',
    replaysAfter - replaysBefore === REPLAY_DRAIN,
    `${replaysBefore} -> ${replaysAfter} (delta ${replaysAfter - replaysBefore})`,
  );
  inv.check(
    `all ${REPOST} re-POSTs answered duplicate`,
    duplicates === REPOST,
    `${duplicates}/${REPOST} came back duplicate`,
  );
  inv.check(
    're-POSTs moved neither count',
    itemsFinal === itemsAfter && replaysFinal === replaysAfter,
    `items ${itemsAfter} -> ${itemsFinal}, replays ${replaysAfter} -> ${replaysFinal}`,
  );
  inv.check(
    'drain under 60 s',
    wallMs < 60_000,
    `${(wallMs / 1000).toFixed(1)} s for ${REPLAY_DRAIN} sequential POSTs`,
  );

  return [
    makeRow({
      id: 'replay.drain_500',
      area: 'replay',
      concurrency: 1,
      callSamples: samples,
      outcome: applied === REPLAY_DRAIN ? 'ok' : `error:${Object.keys(statuses)[0] ?? 'unknown'}`,
      errors: applied === REPLAY_DRAIN ? {} : statuses,
      invariants: inv.done(),
      notes: {
        wall_ms: Math.round(wallMs),
        applied,
        order_items_delta: itemsAfter - itemsBefore,
        sync_replays_delta: replaysAfter - replaysBefore,
        reposted: REPOST,
        duplicates,
      },
    }),
  ];
}
