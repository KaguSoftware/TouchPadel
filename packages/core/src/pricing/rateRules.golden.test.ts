/**
 * Golden pricing cases — the TypeScript half (SEC-10, security-general.md §06).
 *
 * WHY THIS FILE READS ACROSS A PACKAGE BOUNDARY. The fixture lives in
 * packages/db/fixtures/pricing-golden.json and is read from here on purpose:
 * the deliverable is ONE file with TWO readers, and copying the numbers into
 * this package would defeat it entirely. The other reader is
 * packages/db/tests/pricing-golden.test.ts, which asserts the same cases
 * against app.price_slot in SQL.
 *
 * THE FAILURE THIS PREVENTS. Two implementations price every slot in the
 * product: SQL (app.price_slot) when a booking is written, and this module when
 * the phone renders the availability grid without a round-trip. They were
 * written from the same spec, separately, and 0048/H4 already caught them
 * disagreeing once — a midnight-crossing rule that SQL priced by wrapping and
 * this module refused. A guest quoted one number and charged another is the
 * outcome; a shared fixture is the only thing that makes the disagreement
 * visible before a guest finds it.
 *
 * The cases deliberately never tie on (specificity, priority), so the final
 * tie-break — rule id ascending, a uuid in SQL and a string here — never
 * decides an outcome. The two implementations therefore agree on these cases
 * for reasons that hold in both, not by coincidence of ordering.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRateRule, type RateRule, type RateRulePrice } from './rateRules';
import type { IQD } from '../money/iqd';

interface GoldenRule {
  id: string;
  courtRef: string | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  priority: number;
  validFrom: string | null;
  validTo: string | null;
  prices: Record<string, number>;
  isActive: boolean;
}

interface GoldenCase {
  name: string;
  courtRef: string;
  startAtUtc: string;
  localWallTime: string;
  durationMin: number;
  expectedRuleRef: string | null;
  expectedIqd: number | null;
}

interface Golden {
  timezone: string;
  rules: GoldenRule[];
  cases: GoldenCase[];
}

const golden = JSON.parse(
  readFileSync(new URL('../../../db/fixtures/pricing-golden.json', import.meta.url), 'utf8'),
) as Golden;

/**
 * The fixture's court refs ('a', 'b') stand in for court ids. resolveRateRule
 * compares them by equality and never parses them, so a readable ref carries
 * the same meaning as the uuid the DB half uses.
 */
const rules: RateRule[] = golden.rules.map((r) => ({
  id: r.id,
  name: r.id,
  courtId: r.courtRef,
  daysOfWeek: r.daysOfWeek,
  startTime: r.startTime,
  endTime: r.endTime,
  priority: r.priority,
  validFrom: r.validFrom,
  validTo: r.validTo,
  isActive: r.isActive,
}));

const prices: RateRulePrice[] = golden.rules.flatMap((r) =>
  Object.entries(r.prices).map(([duration, price]) => ({
    ruleId: r.id,
    durationMin: Number(duration),
    priceIqd: price as IQD,
  })),
);

describe('golden pricing cases (shared with packages/db)', () => {
  it('the fixture is the one the DB half reads, and it has not shrunk', () => {
    // A case silently disappearing is the one failure mode a per-case loop
    // cannot report: 29 green cases look exactly like 30.
    expect(golden.cases).toHaveLength(30);
    expect(golden.timezone).toBe('Asia/Baghdad');
  });

  for (const c of golden.cases) {
    it(`${c.localWallTime} · court ${c.courtRef} · ${c.durationMin}m — ${c.name}`, () => {
      const resolved = resolveRateRule(
        rules,
        prices,
        c.courtRef,
        new Date(c.startAtUtc),
        c.durationMin,
        golden.timezone,
      );

      if (c.expectedIqd === null) {
        expect(resolved).toBeNull();
        return;
      }
      expect(resolved).not.toBeNull();
      expect(resolved?.priceIqd).toBe(c.expectedIqd);
      expect(resolved?.ruleId).toBe(c.expectedRuleRef);
    });
  }
});
