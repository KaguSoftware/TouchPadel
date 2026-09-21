/**
 * The bench runner.
 *
 *     node --experimental-strip-types bench/run.ts [--area=<name>|all] [--out=<dir>] [--repeat=N]
 *
 * Run it through the package script (`pnpm --filter @touch/db bench`) so the cwd
 * is packages/db, which every relative path here and in the areas assumes.
 *
 * --repeat=N runs the whole suite N times and keeps the MEDIAN of each row's
 * p95 (bench/stats.ts medianOf). A single run of a concurrency benchmark on a
 * shared CI runner is one sample of a noisy distribution; the median of three
 * throws away the round where another job on the box stole the CPU without
 * letting one lucky run hide a real regression the way a min would.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXIT_CLEAN, EXIT_HARNESS, EXIT_REGRESSION, medianOf } from './stats.ts';
import { collectMeta, formatTable, writeResults } from './harness.ts';
import type { BenchResults, BenchRow } from './types.ts';
import { stackAvailable } from '../tests/helpers.ts';

import * as booking from './areas/booking.ts';
import * as cafe from './areas/cafe.ts';
import * as analytics from './areas/analytics.ts';
import * as replay from './areas/replay.ts';

/** Declaration order is RUN order, and it matters — see the note in main(). */
const AREAS: Record<string, () => Promise<BenchRow[]>> = {
  booking: booking.run,
  cafe: cafe.run,
  analytics: analytics.run,
  replay: replay.run,
};

interface Args {
  area: string;
  out: string;
  repeat: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  const area = get('area') ?? 'all';
  if (area !== 'all' && !(area in AREAS)) {
    throw new Error(
      `unknown --area=${area}; expected all or one of ${Object.keys(AREAS).join(', ')}`,
    );
  }
  const repeatRaw = get('repeat') ?? '1';
  const repeat = Number.parseInt(repeatRaw, 10);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`--repeat must be a positive integer, got ${repeatRaw}`);
  }
  return { area, out: get('out') ?? 'bench/results', repeat };
}

/**
 * Fold N repeats of the same row into one.
 *
 * The p95 (and p50) become the MEDIAN across repeats; everything else comes
 * from the LAST repeat, because the counts, the errors and the invariants are
 * facts about a run rather than a distribution — averaging "49 losers" across
 * three runs would be meaningless, and an invariant that failed in any repeat
 * must not be averaged away.
 */
function foldRepeats(perRepeat: BenchRow[][]): BenchRow[] {
  const ids = perRepeat[0]!.map((r) => r.id);
  return ids.map((id) => {
    const versions = perRepeat
      .map((rows) => rows.find((r) => r.id === id))
      .filter((r): r is BenchRow => !!r);
    const last = versions[versions.length - 1]!;
    if (versions.length === 1) return last;
    const anyInvariantFailed = versions.some((v) => !v.invariants.ok);
    const failing = versions.find((v) => !v.invariants.ok);
    return {
      ...last,
      perCall: {
        ...last.perCall,
        p50: medianOf(versions.map((v) => v.perCall.p50)),
        p95: medianOf(versions.map((v) => v.perCall.p95)),
      },
      perRound: last.perRound
        ? {
            ...last.perRound,
            p50: medianOf(versions.filter((v) => v.perRound).map((v) => v.perRound!.p50)),
            p95: medianOf(versions.filter((v) => v.perRound).map((v) => v.perRound!.p95)),
          }
        : undefined,
      invariants: anyInvariantFailed ? failing!.invariants : last.invariants,
    };
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!(await stackAvailable())) {
    console.error(
      'bench: the local Supabase stack is not answering.\n' +
        '       Start it with `pnpm --filter @touch/db db:start`, apply migrations with\n' +
        '       `supabase db reset` FROM packages/db, load `pnpm db:fixtures` and then\n' +
        '       `pnpm --filter @touch/db bench:seed`.',
    );
    return EXIT_HARNESS;
  }

  const names = args.area === 'all' ? Object.keys(AREAS) : [args.area];
  const perRepeat: BenchRow[][] = [];

  for (let rep = 0; rep < args.repeat; rep++) {
    const rows: BenchRow[] = [];
    for (const name of names) {
      // ORDER MATTERS. booking runs first and deletes every reservation it
      // wrote before it returns, so the analytics rows measure the seeded table
      // and nothing else; cafe revives the bench day that replay then posts
      // onto. Running an area on its own with --area is fine; reordering them
      // is not.
      process.stderr.write(`[bench] repeat ${rep + 1}/${args.repeat}: ${name}\n`);
      rows.push(...(await AREAS[name]!()));
    }
    perRepeat.push(rows);
  }

  const rows = foldRepeats(perRepeat);
  const results: BenchResults = { meta: collectMeta(args.repeat), rows };

  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const written = writeResults(outDir, results);

  console.log(`\n${formatTable(rows)}\n`);
  for (const row of rows) {
    if (row.invariants.checks.length === 0) continue;
    for (const check of row.invariants.checks) {
      console.log(`${check.ok ? '  ok ' : '  FAIL'} ${row.id} :: ${check.name} — ${check.detail}`);
    }
  }
  console.log(`\n[bench] ${rows.length} rows -> ${written}`);

  // A runner that MEASURED an invariant failure still exits non-zero, so a
  // `bench` step in a workflow is red before the compare step ever runs.
  return rows.every((r) => r.invariants.ok) ? EXIT_CLEAN : EXIT_REGRESSION;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('[bench] harness error:', error instanceof Error ? error.stack : error);
    process.exit(EXIT_HARNESS);
  },
);
