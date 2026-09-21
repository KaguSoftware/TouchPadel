/**
 * BOOKING — the contract's #1 promise (PHASE-2-PLAN.md Part C+: p95 < 150 ms per
 * RPC; losers get SLOT_TAKEN, never 40P01).
 *
 * Nine rows: hold_slot at 1 / 10 / 50 callers on one court and across four,
 * confirm_booking at the same three widths, and the contention row that puts 50
 * callers on ONE slot and asserts the outcome rather than the clock.
 */
import { performance } from 'node:perf_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appRpc, futureSlot, guestClient, outcome, serviceClient } from '../../tests/helpers.ts';
import {
  CONCURRENT_ROUNDS,
  SERIAL_SAMPLES,
  errorCode,
  invariants,
  makeRow,
  runConcurrent,
  runSerial,
  tally,
  timeIt,
} from '../harness.ts';
import type { BenchRow } from '../types.ts';

/** The four seeded bench courts (bench/seed.sql section 1), in sort order. */
export const BENCH_COURTS = [
  'bec40000-0000-4000-8000-00000000c001',
  'bec40000-0000-4000-8000-00000000c002',
  'bec40000-0000-4000-8000-00000000c003',
  'bec40000-0000-4000-8000-00000000c004',
] as const;

/**
 * Station prefix for every key this suite writes.
 *
 * The idempotency-key discipline is "{station}:{mutation_type}:{ulid}"
 * (tests/helpers.ts testIdemKey uses TEST1). BENCH1 keeps bench rows separable
 * from test rows in reservations.idempotency_key and sync_replays, and it is
 * also the device_id every bench call passes — which is how the between-rounds
 * cleanup below finds exactly the rows this run created and nothing else.
 */
export const BENCH_STATION = 'BENCH1';

/**
 * A 26-character pseudo-ULID: 10 of timestamp, 6 of per-process entropy, 10 of
 * counter, EACH FIXED-WIDTH.
 *
 * The fixed widths are the whole point. The first version built
 * `base36(now) + base36(counter)` and then padEnd'd the result to 26 with
 * zeros, which makes counter 1 and counter 36 produce the identical key — "1"
 * padded is "1" + 17 zeros, and "10" padded is "1" + "0" + 16 zeros. The replay
 * drain found it immediately: 12 of its 500 POSTs came back `duplicate` and the
 * exactly-once invariant failed with `delta 488`. A variable-width field
 * followed by padding is not a unique id, and the only reason this was caught
 * rather than shipped is that the row asserts a row count instead of a clock.
 *
 * The entropy block separates two RUNS that start in the same millisecond;
 * reservations.idempotency_key and sync_replays.idempotency_key are both UNIQUE
 * across all time, so a second bench run must not re-use the first one's keys.
 */
const KEY_ENTROPY = Math.floor(Math.random() * 36 ** 6)
  .toString(36)
  .toUpperCase()
  .padStart(6, '0');
let keyCounter = 0;

export function benchKey(mutationType: string): string {
  const ulid =
    Date.now().toString(36).toUpperCase().padStart(10, '0') +
    KEY_ENTROPY +
    (keyCounter++).toString(36).toUpperCase().padStart(10, '0');
  return `${BENCH_STATION}:${mutationType}:${ulid}`;
}

/**
 * Delete every reservation this run wrote on the bench courts.
 *
 * TWO reasons, and the second is the one that is easy to miss:
 *
 * 1. venue_settings.max_live_holds_per_guest is 3. Fifty guests reused across
 *    thirty rounds would each be holding thirty slots by the end, and every call
 *    from round four onwards would return HOLD_QUOTA_EXCEEDED — the row would
 *    measure a quota check, not a booking.
 * 2. The analytics rows run LATER IN THE SAME PROCESS against the same table. A
 *    booking area that left ~6,000 rows behind would move the analytics
 *    measurement by however much this run happened to write, and the nightly
 *    comparison against a committed baseline would drift with it.
 *
 * `device_id = BENCH1` is the handle: the seeded 12,800 bookings carry no
 * device_id at all, so this can never reach them.
 */
async function clearRunRows(svc: SupabaseClient): Promise<void> {
  const { error } = await svc.from('reservations').delete().eq('device_id', BENCH_STATION);
  if (error) throw new Error(`booking bench cleanup failed: ${error.message}`);
}

/** Distinct future slots, one per caller. futureSlot() never repeats a start. */
function slots(n: number): string[] {
  return Array.from({ length: n }, () => futureSlot().start.toISOString());
}

function holdArgs(courtId: string, startAt: string) {
  return {
    p_court_id: courtId,
    p_start_at: startAt,
    p_duration_min: 60,
    p_idempotency_key: benchKey('reservation.hold'),
    p_device_id: BENCH_STATION,
  };
}

export async function run(): Promise<BenchRow[]> {
  const svc = serviceClient();
  const rows: BenchRow[] = [];

  // Fifty guests, created ONCE and reused. Creating a guest is an auth admin
  // round trip plus a sign-in; doing it per round would put ~1,500 of them in
  // the middle of the measurement.
  const guests: SupabaseClient[] = [];
  for (let i = 0; i < 50; i++) guests.push(await guestClient(svc, 'bench'));

  await clearRunRows(svc);

  // ───────────────────────────────────────────────────────────────────────────
  // hold_slot, serial
  // ───────────────────────────────────────────────────────────────────────────
  {
    const serialSlots = slots(SERIAL_SAMPLES);
    const codes: string[] = [];
    const timed = await runSerial(
      SERIAL_SAMPLES,
      async (i) => {
        const res = await appRpc(
          guests[i % guests.length]!,
          'hold_slot',
          holdArgs(BENCH_COURTS[0]!, serialSlots[i]!),
        );
        if (res.error) codes.push(errorCode(res.error));
        return res;
      },
      // Untimed: release the hold so the cap (3 live holds per guest) never
      // turns a later sample into a HOLD_QUOTA_EXCEEDED measurement.
      () => clearRunRows(svc),
    );
    await clearRunRows(svc);
    rows.push(
      makeRow({
        id: 'booking.hold_slot@1.one_court',
        area: 'booking',
        concurrency: 1,
        callSamples: timed.map((t) => t.ms),
        outcome: codes.length === 0 ? 'ok' : `error:${codes[0]}`,
        errors: tally(codes),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // hold_slot, concurrent. Each caller takes its OWN slot, so nobody loses and
  // the row measures the cost of app.lock_court under contention for the LOCK
  // rather than for the slot. One court serializes all N; four courts let four
  // run at once (i % 4), which is what makes the pair worth having.
  // ───────────────────────────────────────────────────────────────────────────
  for (const [concurrency, spread] of [
    [10, 'one_court'],
    [50, 'one_court'],
    [10, 'four_courts'],
    [50, 'four_courts'],
  ] as const) {
    const callerSlots = slots(concurrency);
    const codes: string[] = [];
    const roundsOut = await runConcurrent(
      CONCURRENT_ROUNDS,
      concurrency,
      async (_r, c) => {
        const court = spread === 'one_court' ? BENCH_COURTS[0]! : BENCH_COURTS[c % 4]!;
        const res = await appRpc(guests[c]!, 'hold_slot', holdArgs(court, callerSlots[c]!));
        if (res.error) codes.push(errorCode(res.error));
        return res;
      },
      // Untimed, between rounds: the slots have to go back, because the same
      // caller takes the same slot next round and a live hold would answer
      // SLOT_TAKEN in microseconds — thirty rounds of measuring a rejection.
      () => clearRunRows(svc),
    );
    rows.push(
      makeRow({
        id: `booking.hold_slot@${concurrency}.${spread}`,
        area: 'booking',
        concurrency,
        callSamples: roundsOut.flatMap((r) => r.calls.map((c) => c.ms)),
        roundSamples: roundsOut.map((r) => r.roundMs),
        outcome: codes.length === 0 ? 'ok' : `error:${codes[0]}`,
        errors: tally(codes),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // confirm_booking. The hold is created UNTIMED and only the confirm is
  // measured: hold_slot already has its own rows, and folding it in here would
  // report the sum of two RPCs under one id.
  // ───────────────────────────────────────────────────────────────────────────
  for (const concurrency of [1, 10, 50] as const) {
    const callSamples: number[] = [];
    const roundSamples: number[] = [];
    const codes: string[] = [];
    const rounds = concurrency === 1 ? SERIAL_SAMPLES : CONCURRENT_ROUNDS;
    const callerSlots = slots(concurrency);

    for (let r = 0; r < rounds; r++) {
      // Untimed setup.
      const holds = await Promise.all(
        Array.from({ length: concurrency }, async (_, c) => {
          const court = BENCH_COURTS[c % 4]!;
          const res = await appRpc(guests[c]!, 'hold_slot', holdArgs(court, callerSlots[c]!));
          const d = res.data as { reservation_id?: string } | null;
          return { client: guests[c]!, id: d?.reservation_id };
        }),
      );

      // Timed. roundMs is the WALL CLOCK of the whole Promise.all, exactly as
      // harness.ts runConcurrent measures it — not the sum of the per-call
      // times. The sum of N concurrent calls is roughly N times the wall clock,
      // so reporting it under the same `perRound` field as the hold_slot rows
      // would put two different quantities in one column.
      const t0 = performance.now();
      const timed = await Promise.all(
        holds.map((h) =>
          timeIt(async () => {
            if (!h.id) throw new Error('hold was not created');
            const res = await appRpc(h.client, 'confirm_booking', {
              p_hold_id: h.id,
              p_guest_name: 'bench-guest',
              p_players: 4,
            });
            if (res.error) codes.push(errorCode(res.error));
            return res;
          }),
        ),
      );
      const roundMs = performance.now() - t0;
      callSamples.push(...timed.map((t) => t.ms));
      if (concurrency > 1) roundSamples.push(roundMs);
      await clearRunRows(svc);
    }

    rows.push(
      makeRow({
        id: `booking.confirm_booking@${concurrency}`,
        area: 'booking',
        concurrency,
        callSamples,
        roundSamples: concurrency > 1 ? roundSamples : undefined,
        outcome: codes.length === 0 ? 'ok' : `error:${codes[0]}`,
        errors: tally(codes),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE CONTENTION ROW. Fifty callers, ONE slot, thirty times over. This row
  // exists for its invariants, not its clock:
  //
  //     exactly 1 winner and 49 losers, every round;
  //     every loss is P0001 SLOT_TAKEN — the refusal the contract names;
  //     zero 40P01 (deadlock), 40001 (serialization failure), 57014 (timeout).
  //
  // A 40P01 here would mean app.lock_court's ordering had broken and two
  // callers were taking court locks in opposite orders; a 40001 would mean the
  // exclusion constraint was being reached without the advisory lock in front
  // of it. Both are correctness failures that a p95 alone would never show, and
  // both set invariants.ok = false, which compare.ts fails the run on.
  //
  // THE LOSSES ARE NOT IN `errors`. Every other row's `errors` map means "things
  // that went wrong", and compare.ts fails a run that produces any on a row the
  // baseline had clean. Here 1,470 SLOT_TAKENs are the measurement: putting them
  // in `errors` made the very first comparison fail with
  // "errors on a row the baseline had clean — {SLOT_TAKEN: 1470}". They belong
  // in `notes`, counted, with the invariants doing the actual asserting; a loss
  // code that ISN'T SLOT_TAKEN is a genuine error and does go in `errors`.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const inv = invariants();
    const codes: string[] = [];
    const winsPerRound: number[] = [];
    const lossesPerRound: number[] = [];
    const unexpected: string[] = [];
    let nonSlotTaken = 0;
    let retryable = 0;

    const contended = slots(CONCURRENT_ROUNDS); // one fresh slot per round
    const roundsOut = await runConcurrent(
      CONCURRENT_ROUNDS,
      50,
      async (r, c) => {
        const res = await appRpc(
          guests[c]!,
          'hold_slot',
          holdArgs(BENCH_COURTS[0]!, contended[r]!),
        );
        return outcome(res);
      },
      // Untimed. The slot is fresh each round, so this is not about the slot —
      // it is the hold cap again: the winner of round N still holds it in round
      // N+1, and three wins would retire a guest from the experiment.
      () => clearRunRows(svc),
    );

    for (const round of roundsOut) {
      let wins = 0;
      let losses = 0;
      for (const call of round.calls) {
        const o = call.value as { ok: boolean; errorMessage?: string } | undefined;
        if (o?.ok) {
          wins++;
          continue;
        }
        losses++;
        const message = o?.errorMessage ?? String(call.error ?? 'unknown');
        const code = message.split(/[\s:(]/)[0] ?? 'unknown';
        codes.push(code);
        if (!message.includes('SLOT_TAKEN')) {
          nonSlotTaken++;
          unexpected.push(code); // a loss that is NOT the contracted refusal
        }
        if (/40P01|40001|57014/.test(message)) retryable++;
      }
      winsPerRound.push(wins);
      lossesPerRound.push(losses);
    }
    await clearRunRows(svc);

    inv.check(
      'exactly one winner per round',
      winsPerRound.every((w) => w === 1),
      `wins per round: ${JSON.stringify([...new Set(winsPerRound)])} over ${winsPerRound.length} rounds`,
    );
    inv.check(
      'exactly 49 losers per round',
      lossesPerRound.every((l) => l === 49),
      `losses per round: ${JSON.stringify([...new Set(lossesPerRound)])}`,
    );
    inv.check(
      'every loss is SLOT_TAKEN',
      nonSlotTaken === 0,
      `${nonSlotTaken} losses carried a message other than SLOT_TAKEN`,
    );
    inv.check(
      'no 40P01 / 40001 / 57014',
      retryable === 0,
      `${retryable} losses were a deadlock, a serialization failure or a timeout`,
    );

    const totalWins = winsPerRound.reduce((a, b) => a + b, 0);
    const totalLosses = lossesPerRound.reduce((a, b) => a + b, 0);
    rows.push(
      makeRow({
        id: 'booking.contention@50.same_slot',
        area: 'booking',
        concurrency: 50,
        callSamples: roundsOut.flatMap((r) => r.calls.map((c) => c.ms)),
        roundSamples: roundsOut.map((r) => r.roundMs),
        outcome: 'ok',
        // Only the losses that were NOT the contracted SLOT_TAKEN.
        errors: tally(unexpected),
        invariants: inv.done(),
        notes: {
          wins: totalWins,
          losses: totalLosses,
          rounds: CONCURRENT_ROUNDS,
          loss_codes: JSON.stringify(tally(codes)),
        },
      }),
    );
  }

  await clearRunRows(svc);
  return rows;
}
