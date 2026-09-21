/**
 * Diff a bench run against the committed baseline.
 *
 *     node --experimental-strip-types bench/compare.ts [--results=<dir>] [--baseline=<file>]
 *     node --experimental-strip-types bench/compare.ts --update-baseline [--force]
 *
 * Exit 0 clean, 1 regression or invariant failure, 2 harness error
 * (bench/stats.ts EXIT_*). The nightly workflow reads nothing but the code.
 *
 * THE RULE, in one line: a row regresses when
 *
 *     p95 > baseline.p95 * 1.10  AND  (p95 - baseline.p95) > 10 ms
 *
 * Both halves are needed. The ratio alone fires on a 4.0 -> 4.5 ms row every
 * time a GitHub runner is busy; the floor alone would let a 500 ms report crawl
 * to 509 ms every night until it was a second slow. p50 is printed and never
 * judged — it is the number that tells a human WHY a p95 moved.
 *
 * `meta` is never compared. A laptop and a hosted runner differ by far more
 * than 10 % on every row, which is exactly why the committed baseline has to
 * come from the CI runner (see bench/README.md).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXIT_CLEAN, EXIT_HARNESS, EXIT_REGRESSION, isRegression } from './stats.ts';
import type { Baseline, BaselineRow, BenchResults } from './types.ts';

interface Args {
  results: string;
  baseline: string;
  update: boolean;
  force: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
  };
  return {
    results: get('results') ?? 'bench/results',
    baseline: get('baseline') ?? 'bench/baseline.json',
    update: argv.includes('--update-baseline'),
    force: argv.includes('--force'),
  };
}

function readResults(dir: string): BenchResults {
  const path = resolve(dir, 'results.json');
  if (!existsSync(path)) {
    throw new Error(`no results at ${path} — run \`pnpm --filter @touch/db bench\` first`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as BenchResults;
}

/** The committed shape: meta, plus only the five fields a diff may read. */
function toBaseline(results: BenchResults): Baseline {
  const rows: Record<string, BaselineRow> = {};
  for (const r of results.rows) {
    rows[r.id] = {
      p50: Number(r.perCall.p50.toFixed(2)),
      p95: Number(r.perCall.p95.toFixed(2)),
      outcome: r.outcome,
      unit: r.unit,
      concurrency: r.concurrency,
    };
  }
  return { meta: results.meta, rows };
}

function updateBaseline(args: Args): number {
  // A baseline is only meaningful on the machine that will re-measure it, so
  // writing one outside CI is refused unless the author says --force and takes
  // responsibility for the placeholder. See bench/README.md.
  if (process.env.GITHUB_ACTIONS !== 'true' && !args.force) {
    console.error(
      '[bench:compare] refusing to write a baseline outside GitHub Actions.\n' +
        '                A baseline taken on a laptop is not a baseline the nightly job can\n' +
        '                compare against: every row would differ by far more than 10 %.\n' +
        '                Take it from the CI runner (Actions -> Bench (db) -> mode: baseline),\n' +
        '                or pass --force to write a deliberate PLACEHOLDER.',
    );
    return EXIT_HARNESS;
  }
  const results = readResults(args.results);
  const baseline = toBaseline(results);
  if (process.env.GITHUB_ACTIONS !== 'true') baseline.meta.runner = 'local-placeholder';
  const path = resolve(args.baseline);
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `[bench:compare] wrote ${Object.keys(baseline.rows).length} rows to ${path} (runner: ${baseline.meta.runner})`,
  );
  return EXIT_CLEAN;
}

function compare(args: Args): number {
  const baselinePath = resolve(args.baseline);
  if (!existsSync(baselinePath)) {
    console.error(
      `[bench:compare] no baseline at ${baselinePath}.\n` +
        '                Take one from the CI runner: Actions -> Bench (db) -> Run workflow ->\n' +
        '                mode: baseline, then commit the baseline.json from the artifact.',
    );
    return EXIT_HARNESS;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  const results = readResults(args.results);
  const measured = new Map(results.rows.map((r) => [r.id, r]));

  const failures: string[] = [];
  const lines: string[] = [];

  // A row the baseline has and the run does not is a FAILURE, not a pass. The
  // ways a row disappears are: somebody deleted the benchmark, the area threw
  // before reaching it, or the edge runtime was down. None of those is a clean
  // nightly run, and all three are invisible if a missing row is skipped.
  for (const id of Object.keys(baseline.rows)) {
    if (!measured.has(id)) failures.push(`${id}: in the baseline but MISSING from this run`);
  }
  // And the other direction: a new row must be blessed into the baseline
  // deliberately, so that "I added a benchmark" and "the baseline is stale" are
  // never the same silence.
  for (const id of measured.keys()) {
    if (!(id in baseline.rows)) {
      failures.push(`${id}: measured but NOT in the baseline — run mode: baseline to adopt it`);
    }
  }

  for (const [id, base] of Object.entries(baseline.rows)) {
    const row = measured.get(id);
    if (!row) continue;

    if (!row.invariants.ok) {
      const broken = row.invariants.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name} (${c.detail})`);
      failures.push(`${id}: INVARIANT failed — ${broken.join('; ')}`);
    }

    if (row.outcome !== base.outcome) {
      failures.push(`${id}: outcome changed ${base.outcome} -> ${row.outcome}`);
    }

    const hadErrors = Object.keys(row.errors).length > 0;
    const baseClean = base.outcome === 'ok';
    if (hadErrors && baseClean && row.outcome === 'ok') {
      failures.push(
        `${id}: errors on a row the baseline had clean — ${JSON.stringify(row.errors)}`,
      );
    }

    const p95 = row.perCall.p95;
    const regressed = isRegression(base.p95, p95);
    const delta = p95 - base.p95;
    const pct = base.p95 === 0 ? 0 : (delta / base.p95) * 100;
    lines.push(
      `${regressed ? 'REGRESSION' : '        ok'}  ${id.padEnd(38)} ` +
        `p95 ${base.p95.toFixed(1)} -> ${p95.toFixed(1)} ms ` +
        `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ms, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)  ` +
        `p50 ${base.p50.toFixed(1)} -> ${row.perCall.p50.toFixed(1)}`,
    );
    if (regressed) {
      failures.push(
        `${id}: p95 ${base.p95.toFixed(1)} -> ${p95.toFixed(1)} ms ` +
          `(+${delta.toFixed(1)} ms, +${pct.toFixed(1)} %) — over 10 % and over the 10 ms floor`,
      );
    }
  }

  console.log(lines.sort().join('\n'));
  console.log(
    `\n[bench:compare] baseline from ${baseline.meta.runner} @ ${baseline.meta.sha.slice(0, 8)}; ` +
      `run from ${results.meta.runner} @ ${results.meta.sha.slice(0, 8)} (repeat ${results.meta.repeat})`,
  );
  if (failures.length === 0) {
    console.log(`[bench:compare] ${Object.keys(baseline.rows).length} rows, no regressions.`);
    return EXIT_CLEAN;
  }
  console.error(`\n[bench:compare] ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  return EXIT_REGRESSION;
}

try {
  const args = parseArgs(process.argv.slice(2));
  process.exit(args.update ? updateBaseline(args) : compare(args));
} catch (error: unknown) {
  console.error('[bench:compare] harness error:', error instanceof Error ? error.message : error);
  process.exit(EXIT_HARNESS);
}
