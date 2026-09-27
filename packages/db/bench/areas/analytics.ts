/**
 * ANALYTICS — the owner dashboard's reads over a year of seeded traffic
 * (PHASE-2-PLAN.md Part C+: p95 < 500 ms).
 *
 * Every row here runs as the OWNER. app.analytics_guard() demands
 * app.is_staff('owner') and app.report_revenue calls app.reports_guard(true),
 * which is the same test — a manager session gets FORBIDDEN, and benching a
 * FORBIDDEN is benching the guard.
 *
 * The last row is the one PHASE-2-CHECKLIST.md asked for: `courts_summary.400d`,
 * the widest span app.analytics_bounds accepts.
 *
 * NOTHING HERE RAISES statement_timeout. The `authenticated` role carries 8 s
 * from migration 0109, and measuring these queries with that guard rail removed
 * would measure a database the product does not have. A timeout is recorded as
 * an OUTCOME (`outcome: 'timeout'`) and compare.ts defends it in both
 * directions, so the finding survives in the baseline instead of in a comment.
 * On this fixture `courts_endings.12mo` and `courts_guests.12mo` are the two
 * that time out; the 400-day summary is not.
 */
import { appRpc, signedInClient, SEED_STAFF } from '../../tests/helpers.ts';
import { ANALYTICS_SAMPLES, errorCode, isTimeout, makeRow, tally, timeIt } from '../harness.ts';
import type { BenchRow, Outcome } from '../types.ts';

/**
 * Stop sampling a row once this many calls in a row have timed out.
 *
 * A timing-out analytics call costs the FULL 8 s statement_timeout every time.
 * Twenty of them is 160 s to prove one thing twenty times, and the nightly runs
 * the whole suite three times (--repeat=3) inside a 45-minute job. Three
 * consecutive timeouts is already a settled answer; the row is recorded with
 * however many samples it got, `outcome: 'timeout'`, and compare.ts defends
 * that outcome in both directions.
 */
const TIMEOUT_GIVE_UP = 3;

/** Serial samples with the give-up rule. Returns the per-call ms. */
async function sampleUntilSettled(
  n: number,
  call: () => Promise<{ error: unknown }>,
  onError: (error: unknown) => void,
): Promise<{ samples: number[]; timedOut: boolean }> {
  const samples: number[] = [];
  let consecutiveTimeouts = 0;
  let timedOut = false;
  for (let i = 0; i < n; i++) {
    const timed = await timeIt(call);
    samples.push(timed.ms);
    const err = (timed.value as { error: unknown } | undefined)?.error ?? timed.error ?? null;
    if (err) {
      onError(err);
      if (isTimeout(err)) {
        timedOut = true;
        consecutiveTimeouts++;
        if (consecutiveTimeouts >= TIMEOUT_GIVE_UP) break;
        continue;
      }
    }
    consecutiveTimeouts = 0;
  }
  return { samples, timedOut };
}

/** Local yyyy-mm-dd `days` before today — the shape the RPCs take (date, not ts). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Twelve months back, and 400 days back — app.analytics_bounds caps the span at 400. */
const FROM_12MO = isoDaysAgo(365);
const FROM_400D = isoDaysAgo(400);
const TO_TODAY = isoDaysAgo(0);

/** The six court/hourly RPCs plus report_revenue, all on the 12-month window. */
const TWELVE_MONTH_ROWS: { id: string; fn: string; args: Record<string, unknown> }[] = [
  {
    id: 'analytics.courts_summary.12mo',
    fn: 'analytics_courts_summary',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_court_id: null },
  },
  {
    id: 'analytics.courts_demand.12mo',
    fn: 'analytics_courts_demand',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_court_id: null },
  },
  {
    id: 'analytics.courts_endings.12mo',
    fn: 'analytics_courts_endings',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_court_id: null },
  },
  {
    id: 'analytics.courts_guests.12mo',
    fn: 'analytics_courts_guests',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_court_id: null },
  },
  {
    id: 'analytics.courts_cafe.12mo',
    fn: 'analytics_courts_cafe',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_court_id: null },
  },
  {
    id: 'analytics.hourly.12mo',
    fn: 'analytics_hourly',
    args: { p_from: FROM_12MO, p_to: TO_TODAY },
  },
  // app.report_revenue(p_from date, p_to date, p_group text, p_filters jsonb)
  // — migration 0099. 'day' is what the operator's revenue page asks for, and
  // it is the grouping with the most buckets, so it is the honest one to bench.
  {
    id: 'analytics.report_revenue.12mo',
    fn: 'report_revenue',
    args: { p_from: FROM_12MO, p_to: TO_TODAY, p_group: 'day', p_filters: {} },
  },
];

export async function run(): Promise<BenchRow[]> {
  const owner = await signedInClient(SEED_STAFF.owner);
  const rows: BenchRow[] = [];

  for (const spec of TWELVE_MONTH_ROWS) {
    const codes: string[] = [];
    const { samples, timedOut } = await sampleUntilSettled(
      ANALYTICS_SAMPLES,
      () => appRpc(owner, spec.fn, spec.args),
      (error) => codes.push(errorCode(error)),
    );
    const outcome: Outcome = timedOut ? 'timeout' : codes.length === 0 ? 'ok' : `error:${codes[0]}`;
    rows.push(
      makeRow({
        id: spec.id,
        area: 'analytics',
        concurrency: 1,
        callSamples: samples,
        // ANALYTICS_SAMPLES is 20 and the serial warmup is 5; a quarter of a
        // 20-sample row is too much to drop, and the first analytics call of a
        // run is not cold in the way a booking RPC is (the planner has just
        // been ANALYZEd by the seed). Two is enough to shake out connection
        // setup.
        warmupCalls: 2,
        outcome,
        errors: tally(codes),
      }),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE 400-DAY ROW. PHASE-2-CHECKLIST.md carries this as a finding to bring
  // into the bench: "analytics_courts_summary over 400 days hits the statement
  // timeout on a database full of test data". Here it stops being a note and
  // becomes a measured, asserted property — a row whose recorded `outcome` the
  // comparer defends in BOTH directions. If a future change makes it fast
  // enough to return, compare.ts fails with "the 400-day timeout is fixed:
  // update the baseline and close the checklist finding", which is a good
  // failure and the only way this finding ever gets closed on purpose.
  //
  // 400 is the largest span app.analytics_bounds accepts (it raises
  // INVALID_RANGE above that), so this is the worst case the API can be asked
  // for, not an invented one.
  //
  // Fewer samples: each attempt costs the full 8 s statement_timeout when it
  // does time out, so twenty of them would be nearly three minutes of a nightly
  // job spent proving the same thing twenty times.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const codes: string[] = [];
    const { samples, timedOut } = await sampleUntilSettled(
      5,
      () =>
        appRpc(owner, 'analytics_courts_summary', {
          p_from: FROM_400D,
          p_to: TO_TODAY,
          p_court_id: null,
        }),
      (error) => codes.push(errorCode(error)),
    );
    const outcome: Outcome = timedOut ? 'timeout' : codes.length === 0 ? 'ok' : `error:${codes[0]}`;
    rows.push(
      makeRow({
        id: 'analytics.courts_summary.400d',
        area: 'analytics',
        concurrency: 1,
        callSamples: samples,
        warmupCalls: 1,
        outcome,
        // `expect` is WHAT WAS MEASURED, not what the checklist predicted.
        // On this fixture the 400-day call returns; it does not time out. The
        // slow ingredient turned out to be court COUNT, not row count —
        // app.analytics_open_minutes cross-joins every court with every hour of
        // the window, and a stack that has been through the test suite carries
        // dozens of courts from createTestCourt. Writing 'timeout' here anyway
        // would have made the baseline assert a belief instead of a
        // measurement, and the first honest nightly would have failed on it.
        expect: outcome,
        errors: tally(codes),
        notes: {
          finding:
            'PHASE-2-CHECKLIST.md predicted a statement timeout here; on the bench fixture it returns — see bench/README.md',
          statement_timeout: 'authenticated role, 8s (migration 0109)',
          span_days: 400,
        },
      }),
    );
  }

  return rows;
}
