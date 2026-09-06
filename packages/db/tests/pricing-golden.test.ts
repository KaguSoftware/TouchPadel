/**
 * Golden pricing cases — the SQL half (SEC-10, security-general.md §06).
 *
 * The other half is packages/core/src/pricing/rateRules.golden.test.ts. Both
 * read packages/db/fixtures/pricing-golden.json; neither owns the numbers.
 *
 * WHY TWO TESTS FOR ONE THING. app.price_slot prices a booking when it is
 * written; @touch/core's resolveRateRule prices the same slot when the phone
 * draws the availability grid, without a round-trip. Two implementations of one
 * spec, written separately — and 0048/H4 already caught them disagreeing, on a
 * midnight-crossing rule SQL priced by wrapping and TypeScript refused. The
 * guest-visible failure is being quoted one number and charged another. A
 * per-implementation test cannot catch that; only a shared fixture can.
 *
 * ISOLATION. Every rule in the fixture carries validFrom/validTo confining it
 * to a fixed PAST week (Sun 2026-03-01 .. Sun 2026-03-08, Asia/Baghdad).
 * app.price_slot has no notion of "future" — it is a pure function of (court,
 * instant, duration) — so a past week prices exactly as a future one would,
 * while being a week no other suite books in. Inserting these rules therefore
 * cannot change the price of any slot another test asserts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, createTestCourt } from './helpers';

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

const golden = JSON.parse(
  readFileSync(new URL('../fixtures/pricing-golden.json', import.meta.url), 'utf8'),
) as { timezone: string; rules: GoldenRule[]; cases: GoldenCase[] };

const up = await stackAvailable();

describe.skipIf(!up)('golden pricing cases (shared with @touch/core)', () => {
  let svc: SupabaseClient;
  const courtIdByRef = new Map<string, string>();
  /** fixture rule ref -> the uuid it was inserted as, to check WHICH rule won. */
  const ruleIdByRef = new Map<string, string>();

  beforeAll(async () => {
    svc = serviceClient();
    courtIdByRef.set('a', await createTestCourt(svc, 'GOLDEN-A'));
    courtIdByRef.set('b', await createTestCourt(svc, 'GOLDEN-B'));

    for (const r of golden.rules) {
      const { data, error } = await svc
        .from('rate_rules')
        .insert({
          name: `GOLDEN ${r.id}`,
          court_id: r.courtRef === null ? null : courtIdByRef.get(r.courtRef),
          days_of_week: r.daysOfWeek,
          start_time: r.startTime,
          end_time: r.endTime,
          priority: r.priority,
          valid_from: r.validFrom,
          valid_to: r.validTo,
          is_active: r.isActive,
        })
        .select('id')
        .single();
      if (error) throw new Error(`golden rule ${r.id}: ${error.message}`);
      const ruleId = (data as { id: string }).id;
      ruleIdByRef.set(r.id, ruleId);

      const rows = Object.entries(r.prices).map(([duration, price]) => ({
        rule_id: ruleId,
        duration_min: Number(duration),
        price_iqd: price,
      }));
      const { error: pErr } = await svc.from('rate_rule_prices').insert(rows);
      if (pErr) throw new Error(`golden prices ${r.id}: ${pErr.message}`);
    }
  });

  it('the fixture is the one the core half reads, and it has not shrunk', () => {
    // 29 green cases look exactly like 30. This is the only assertion that can
    // notice a case being deleted rather than fixed.
    expect(golden.cases).toHaveLength(30);
    expect(golden.timezone).toBe('Asia/Baghdad');
  });

  for (const c of golden.cases) {
    it(`${c.localWallTime} · court ${c.courtRef} · ${c.durationMin}m — ${c.name}`, async () => {
      const { data, error } = await svc.schema('app').rpc('price_slot', {
        p_court_id: courtIdByRef.get(c.courtRef),
        p_start_at: c.startAtUtc,
        p_duration_min: c.durationMin,
      });
      expect(error).toBeNull();

      const rows = (data ?? []) as { rule_id: string; price_iqd: number }[];

      if (c.expectedIqd === null) {
        // price_slot returns ZERO ROWS when nothing prices the slot; the booking
        // RPCs turn that into NO_RATE.
        expect(rows).toHaveLength(0);
        return;
      }

      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.price_iqd)).toBe(c.expectedIqd);
      // Not just the right money — the right RULE. Two rules can carry the same
      // price for different reasons (weekday late and weekday peak both 50,000),
      // and a resolution bug that picks the wrong one is invisible on price alone
      // until the day their prices diverge.
      expect(rows[0]?.rule_id).toBe(ruleIdByRef.get(c.expectedRuleRef ?? ''));
    });
  }
});
