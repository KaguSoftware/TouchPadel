/**
 * The committed baseline and the suite that measures it must name the SAME
 * rows. Nothing here runs a query, starts a stack or looks at a millisecond.
 *
 * WHY ONLY ROW-ID PARITY. The committed baseline was taken on the CI runner
 * (`meta.runner: 'github-actions'`, since 72ce0d9), and its numbers are a gate
 * THERE and nowhere else: a laptop, or a hosted runner with a different CPU,
 * differs by far more than the 10 % rule. Asserting any timing here would go
 * red on every machine that is not the one it was written on — and a test that
 * is expected to be red teaches people to ignore it. The row IDS are different:
 * they are a contract between bench/areas/*.ts and bench/compare.ts, they do
 * not vary by machine, and drift between them is the one failure compare.ts
 * cannot report on its own, because it would simply never run.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Baseline } from '../bench/types.ts';

// fileURLToPath, not `.pathname`: the repo path contains a space.
const BASELINE = fileURLToPath(new URL('../bench/baseline.json', import.meta.url));

/**
 * The rows the suite is contracted to produce, written out by hand rather than
 * imported from the areas. Importing them would make this test agree with
 * whatever the code currently does, which is the one thing it must not do —
 * a deleted benchmark would then delete its own assertion.
 */
const EXPECTED_ROW_IDS = [
  // booking — PHASE-2-PLAN.md Part C+: p95 < 150 ms, losers get SLOT_TAKEN
  'booking.hold_slot@1.one_court',
  'booking.hold_slot@10.one_court',
  'booking.hold_slot@50.one_court',
  'booking.hold_slot@10.four_courts',
  'booking.hold_slot@50.four_courts',
  'booking.confirm_booking@1',
  'booking.confirm_booking@10',
  'booking.confirm_booking@50',
  'booking.contention@50.same_slot',
  // cafe — runs on every send
  'cafe.create_guest_order.10lines_3mods',
  'cafe.compute_tab_totals.40lines',
  // analytics — the owner dashboard over a seeded year
  'analytics.courts_summary.12mo',
  'analytics.courts_demand.12mo',
  'analytics.courts_endings.12mo',
  'analytics.courts_guests.12mo',
  'analytics.courts_cafe.12mo',
  'analytics.hourly.12mo',
  'analytics.report_revenue.12mo',
  'analytics.courts_summary.400d',
  // replay — SOW M7 acceptance
  'replay.drain_500',
] as const;

const present = existsSync(BASELINE);
const baseline: Baseline | null = present
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline)
  : null;

describe.skipIf(!present)('bench/baseline.json', () => {
  it('names exactly the rows the bench suite produces', () => {
    const inBaseline = Object.keys(baseline!.rows).sort();
    expect(inBaseline).toEqual([...EXPECTED_ROW_IDS].sort());
  });

  it('carries only the five fields compare.ts is allowed to read', () => {
    for (const [id, row] of Object.entries(baseline!.rows)) {
      expect(Object.keys(row).sort(), id).toEqual(
        ['concurrency', 'outcome', 'p50', 'p95', 'unit'].sort(),
      );
      expect(row.unit, id).toBe('ms');
      expect(typeof row.p50, id).toBe('number');
      expect(typeof row.p95, id).toBe('number');
      expect(row.concurrency, id).toBeGreaterThanOrEqual(1);
    }
  });

  it('records where it was taken, so a surprising number can be traced', () => {
    expect(baseline!.meta.runner).toBeTruthy();
    expect(baseline!.meta.sha).toBeTruthy();
    expect(baseline!.meta.cpu).toBeTruthy();
  });
});

it.skipIf(present)(
  'bench/baseline.json is absent — take one from the CI runner (Actions -> Bench (db) -> mode: baseline)',
  () => {
    // Deliberately a pass, not a throw. A checkout without a baseline is a
    // legitimate state (the very first run of the workflow produces it), and a
    // hard failure here would block every unrelated change to packages/db until
    // somebody found a runner. compare.ts is where an absent baseline is fatal,
    // and that is the right place: it is the gate, this is a contract check.
    expect(present).toBe(false);
  },
);
