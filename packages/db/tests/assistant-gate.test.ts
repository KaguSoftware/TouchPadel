/**
 * The answer gate (plan §4.5, _shared/assistant/gate.ts): a figure passes
 * only when it was given this turn, typed by the owner, or derived by a sum,
 * difference or percentage of two given figures. Everything else is flagged.
 */
import { describe, expect, it } from 'vitest';
import {
  PAIR_RULE_MAX_GIVEN,
  PCT_RULE_MAX_GIVEN,
  RETRY_MIN_ABS,
  gateAnswer,
  numbersIn,
  retryMessage,
  shouldRetry,
  tokenizeNumbers,
  type GateResult,
} from '../supabase/functions/_shared/assistant/gate.ts';

describe('tokenizeNumbers', () => {
  it('reads Arabic-Indic digits and Arabic separators', () => {
    const t = tokenizeNumbers('المجموع ١٬٢٥٠٬٠٠٠ دينار و ٤٣٫٢٪');
    expect(t.map((x) => x.value)).toEqual([1250000, 43.2]);
    expect(t[1]?.percent).toBe(true);
  });

  it('skips dates, times and years, and digits glued to handles', () => {
    expect(tokenizeNumbers('On 2026-09-20 at 14:30, r12 and phone#3 in 2025')).toEqual([]);
  });

  it('strips markdown pipes and currency words', () => {
    const t = tokenizeNumbers('| IQD 1,250,000 | **2,500** |');
    expect(t.map((x) => x.value)).toEqual([1250000, 2500]);
    expect(t[0]?.bare).toBe(false);
  });

  it('numbersIn is what clean.ts records as the allowed set', () => {
    expect(numbersIn('p1\tcash\t15000\t2026-09-20 14:30')).toEqual([15000]);
  });
});

describe('gateAnswer', () => {
  const allowed = [300000, 1200000, 42, 15000];

  it('passes a figure written with Arabic digits', () => {
    expect(gateAnswer('الإيراد ١٬٢٠٠٬٠٠٠ دينار', allowed, []).status).toBe('ok');
  });

  it('passes IQD with thousands separators', () => {
    const g = gateAnswer('Revenue was IQD 1,200,000 (panel_headline).', allowed, []);
    expect(g).toEqual({ status: 'ok', unverified: [], checked: 1 });
  });

  it('passes a percentage that is a ratio ×100 of two given figures, within 0.1', () => {
    expect(gateAnswer('Cafe was 25.0% of revenue', allowed, []).status).toBe('ok');
    expect(gateAnswer('Cafe was 25% of revenue', allowed, []).status).toBe('ok');
    expect(gateAnswer('Cafe was 26% of revenue', allowed, []).status).toBe('unverified');
  });

  it('passes a change percentage between two given figures', () => {
    // 1,200,000 → 300,000 is −75 %
    expect(gateAnswer('down 75%', allowed, []).status).toBe('ok');
  });

  it('passes sums and differences of two given figures', () => {
    expect(gateAnswer('Together 1,500,000', allowed, []).status).toBe('ok');
    expect(gateAnswer('A gap of 900,000', allowed, []).status).toBe('ok');
    expect(gateAnswer('Total 1,515,000', allowed, []).status).toBe('unverified'); // three terms
  });

  it('passes bare small counts up to 12 and flags larger bare integers', () => {
    expect(gateAnswer('Two tools were used, 3 refunds and 12 items.', [], []).status).toBe('ok');
    const g = gateAnswer('There were 13 refunds.', [], []);
    expect(g.status).toBe('unverified');
    expect(g.unverified).toEqual([{ raw: '13', value: 13 }]);
  });

  it('passes dates, times and years without counting them', () => {
    const g = gateAnswer('Between 2026-09-14 and 2026-09-20 (closing at 23:30 in 2026).', [], []);
    expect(g).toEqual({ status: 'ok', unverified: [], checked: 0 });
  });

  it('passes a figure the owner typed', () => {
    expect(gateAnswer('For 10,000 customers I would propose a job.', [], [10000]).status).toBe('ok');
  });

  it('allows one unit of the last shown digit', () => {
    expect(gateAnswer('about 1,234.6', [1234.56], []).status).toBe('ok');
    expect(gateAnswer('about 1,235', [1234.56], []).status).toBe('ok');
    expect(gateAnswer('about 1,236', [1234.56], []).status).toBe('unverified');
  });

  it('flags an invented figure, once, with its raw text', () => {
    const g = gateAnswer('Revenue 9,999,999 and again 9,999,999; cafe 42.', allowed, []);
    expect(g.status).toBe('unverified');
    expect(g.unverified).toEqual([{ raw: '9,999,999', value: 9999999 }]);
    expect(g.checked).toBe(3);
  });

  it('a message with no tool numbers and a figure in it is unverified by definition', () => {
    expect(gateAnswer('You made 1,250,000 today.', [], []).status).toBe('unverified');
  });

  it('writes the retry message the chat appends as a system message', () => {
    const g = gateAnswer('Revenue 9,999,999 and 55%.', allowed, []);
    expect(retryMessage(g.unverified)).toBe(
      "These figures are not in this turn's tool results or in a web passage you cited: 9,999,999, 55%. Restate the answer using only figures you were given, or say you do not have them.",
    );
  });
});

describe('spaced thousands (Groq answered "29 000 IQD" on 2026-09-20)', () => {
  it('reads a space, NBSP or narrow NBSP between three-digit groups as one figure, and "2 3" as two', () => {
    expect(tokenizeNumbers('card 29 000 IQD and 1 250 000 more').map((t) => t.value)).toEqual([29000, 1250000]);
    expect(tokenizeNumbers('courts 2 3 and 4').map((t) => t.value)).toEqual([2, 3, 4]);
    // 30,000 − 1,000 = 29 000 passes the derived-difference rule.
    expect(gateAnswer('Card after refunds: 29 000 IQD.', [30000, 1000], []).status).toBe('ok');
  });
});

/** mulberry32: a seeded RNG so the measurements below are deterministic. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fmt = (n: number): string => n.toLocaleString('en-US');

describe('derived figures stay exact and small-set only', () => {
  const allowed = [300000, 1200000, 42, 15000];

  it('a sum or difference of figures shown without decimals must match exactly', () => {
    expect(gateAnswer('Together 1,500,000', allowed, []).status).toBe('ok');
    expect(gateAnswer('Together 1,500,001', allowed, []).status).toBe('unverified');
    expect(gateAnswer('A gap of 899,999', allowed, []).status).toBe('unverified');
    // still within one unit of a figure given verbatim (rule 1)
    expect(gateAnswer('Revenue 1,200,001', allowed, []).status).toBe('ok');
  });

  it('a decimal figure keeps the unit-of-last-digit tolerance on a derived value', () => {
    expect(gateAnswer('Together 1,500,000.0', allowed, []).status).toBe('ok');
    expect(gateAnswer('Together 1,500,000.1', allowed, []).status).toBe('ok');
    expect(gateAnswer('Together 1,500,000.3', allowed, []).status).toBe('unverified');
  });

  it('legit derived figures pass in the normal case (two periods, a total, a ratio)', () => {
    // a normal turn: a few dozen figures from the tool results
    const r = seeded(7);
    const given = [4200000, 3650000, 900000, 300000, 1200000, ...Array.from({ length: 30 }, () => 1000 + Math.floor(r() * 90000) * 7)];
    expect(given.length).toBeLessThanOrEqual(PAIR_RULE_MAX_GIVEN);
    expect(gateAnswer('This week was up by 550,000 on last week.', given, []).status).toBe('ok'); // 4,200,000 − 3,650,000
    expect(gateAnswer('Courts and cafe together: 5,100,000.', given, []).status).toBe('ok'); // 4,200,000 + 900,000
    // a ratio percent while the given set is within PCT_RULE_MAX_GIVEN
    const few = [300000, 1200000, 42, 15000];
    expect(few.length).toBeLessThanOrEqual(PCT_RULE_MAX_GIVEN);
    expect(gateAnswer('Cafe was 25% of revenue, down 75% on last week', few, []).status).toBe('ok');
  });

  it('past the caps a derived sum or percent whose operands the answer does not quote is unverified, a verbatim figure still passes', () => {
    const r = seeded(11);
    const filler = Array.from({ length: PAIR_RULE_MAX_GIVEN + 5 }, () => 100001 + Math.floor(r() * 90000) * 11);
    const given = [300000, 1200000, ...filler];
    expect(gateAnswer('Together 1,500,000', given, []).status).toBe('unverified');
    expect(gateAnswer('Revenue 1,200,000', given, []).status).toBe('ok');
    const mid = [300000, 1200000, ...filler.slice(0, PCT_RULE_MAX_GIVEN + 2)];
    expect(gateAnswer('Cafe was 25% of revenue', mid, []).status).toBe('unverified');
    expect(gateAnswer('Together 1,500,000', mid, []).status).toBe('ok'); // pair rule still on
  });
});

describe('derived figures are built from the operands the answer quotes (pack-sized payloads)', () => {
  // A real turn: context packs plus tool results give hundreds of figures, far past both caps.
  const packSized = (extra: number[]): number[] => {
    const r = seeded(21);
    return [...extra, ...Array.from({ length: 400 }, () => 250 * (40 + Math.floor(r() * 39960)))];
  };

  it('a two-period comparison passes against a 400-figure payload', () => {
    const given = packSized([4200000, 3650000]);
    expect(given.length).toBeGreaterThan(PAIR_RULE_MAX_GIVEN);
    const g = gateAnswer('Revenue 4,200,000 IQD, up 550,000 (15.1%) on last week (3,650,000).', given, []);
    expect(g).toEqual({ status: 'ok', unverified: [], checked: 4 });
  });

  it('a total of two quoted figures and a share of two quoted figures pass', () => {
    const given = packSized([900000, 4200000, 300000, 1200000]);
    expect(gateAnswer('Courts 4,200,000 and cafe 900,000, together 5,100,000.', given, []).status).toBe('ok');
    expect(gateAnswer('Cafe 300,000 of 1,200,000 is 25% of revenue.', given, []).status).toBe('ok');
  });

  it('an invented figure beside the same operands is still flagged', () => {
    const given = packSized([4200000, 3650000]);
    const g = gateAnswer('Revenue 4,200,000 IQD, up 551,000 (16.4%) on last week (3,650,000).', given, []);
    expect(g.status).toBe('unverified');
    expect(g.unverified.map((u) => u.raw)).toEqual(['551,000', '16.4%']);
  });

  it('a sum with no operand quoted in the answer is unverified against a big payload', () => {
    const given = packSized([4200000, 3650000]);
    expect(gateAnswer('Revenue was 7,850,000 IQD.', given, []).status).toBe('unverified');
  });

  it('a long table still verifies a derived figure from the figures beside it', () => {
    // 80 quoted rows (past both caps), then a change next to its two operands.
    const r = seeded(33);
    const rows = Array.from({ length: 80 }, () => 250 * (400 + Math.floor(r() * 30000)));
    const given = [...rows, 4200000, 3650000];
    const table = rows.map((v) => `Row: ${fmt(v)}`).join('\n');
    const answer = `${table}\nThis week 4,200,000 vs last week 3,650,000: up 550,000 (15.1%).`;
    expect(gateAnswer(answer, given, []).status).toBe('ok');
  });
});

describe('pair-rule false accepts (seeded measurement)', () => {
  // Before (every pair, +-1, no cap), invented ROUND 250-IQD figures (the worst case,
  // 1,500 trials each): 50 given 4.1 %, 200 given 29.1 %, 500 given 57.0 %. Invented
  // arbitrary 5-7 digit integers: 0.1 %, 0.1 %, 0.8 %. Random percents: 92 %, 100 %, 100 %.
  const TRIALS = 1500;

  for (const n of [50, 200, 500]) {
    it(`${n} given figures: the share of invented figures that pass is low`, () => {
      const r = seeded(1000 + n);
      const given = Array.from({ length: n }, () => Math.max(250, Math.round(Math.pow(10, 3 + r() * 3.7) / 250) * 250));
      let arbitrary = 0;
      let round = 0;
      let pct = 0;
      for (let i = 0; i < TRIALS; i++) {
        if (gateAnswer(`Revenue ${fmt(10000 + Math.floor(r() * 9990000))}`, given, []).status === 'ok') arbitrary++;
        if (gateAnswer(`Revenue ${fmt(250 * (40 + Math.floor(r() * 39960)))}`, given, []).status === 'ok') round++;
        if (gateAnswer(`Share ${(1 + Math.floor(r() * 990) / 10).toFixed(1)}%`, given, []).status === 'ok') pct++;
      }
      expect(arbitrary / TRIALS).toBeLessThanOrEqual(0.01);
      expect(round / TRIALS).toBeLessThanOrEqual(0.06);
      expect(pct / TRIALS).toBeLessThanOrEqual(0.02);
    });
  }

  // Answers that quote k of the given figures beside one invented figure (seeded, 400
  // trials per cell; measured worst over N = 50, 200, 500 and k = 2, 6, 20, 60, 150:
  // arbitrary integers 0.2 %, round 250-IQD figures 5.3 %, random percents 10.8 %, the
  // last being the PCT_RULE_MAX_GIVEN-sized ratio table, which no cap can make smaller).
  for (const n of [50, 200, 500]) {
    for (const k of [2, 6, 60]) {
      it(`${n} given figures, ${k} quoted in the answer: the share of invented figures that pass is low`, () => {
        const r = seeded(5000 + n + k);
        const given = Array.from({ length: n }, () => Math.max(250, Math.round(Math.pow(10, 3 + r() * 3.7) / 250) * 250));
        const trials = 400;
        let arbitrary = 0;
        let round = 0;
        let pct = 0;
        for (let i = 0; i < trials; i++) {
          const quoted = Array.from({ length: k }, () => fmt(given[Math.floor(r() * n)] as number)).join(', ');
          const lead = `Figures ${quoted}. `;
          if (gateAnswer(`${lead}Revenue ${fmt(10000 + Math.floor(r() * 9990000))}`, given, []).status === 'ok') arbitrary++;
          if (gateAnswer(`${lead}Revenue ${fmt(250 * (40 + Math.floor(r() * 39960)))}`, given, []).status === 'ok') round++;
          if (gateAnswer(`${lead}Share ${(1 + Math.floor(r() * 990) / 10).toFixed(1)}%`, given, []).status === 'ok') pct++;
        }
        expect(arbitrary / trials).toBeLessThanOrEqual(0.01);
        expect(round / trials).toBeLessThanOrEqual(0.08);
        expect(pct / trials).toBeLessThanOrEqual(0.16);
      });
    }
  }

  it('an answer quoting 300 figures and 100 invented ones costs far less than n squared per token', () => {
    const r = seeded(9);
    const given = Array.from({ length: 500 }, () => 250 * (1 + Math.floor(r() * 20000)));
    const answer = `${given.slice(0, 300).map(fmt).join(', ')} | ${Array.from({ length: 100 }, (_, i) => fmt(250 * (50 + i * 37) + 1)).join(', ')}`;
    const t0 = performance.now();
    gateAnswer(answer, given, []);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('a 500-figure set costs one pass over the set, not n squared per token', () => {
    const r = seeded(5);
    const given = Array.from({ length: 500 }, () => 250 * (1 + Math.floor(r() * 20000)));
    const answer = Array.from({ length: 120 }, (_, i) => `${fmt(250 * (50 + i * 37))} IQD`).join(', ');
    const t0 = performance.now();
    gateAnswer(answer, given, []);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('shouldRetry', () => {
  const gate = (...unverified: { raw: string; value: number }[]): GateResult => ({
    status: unverified.length ? 'unverified' : 'ok',
    unverified,
    checked: unverified.length,
  });

  it('never retries an answer that passed', () => {
    expect(shouldRetry(gate())).toBe(false);
  });

  it('retries for a percentage, however small', () => {
    expect(shouldRetry(gate({ raw: '7%', value: 7 }))).toBe(true);
    expect(shouldRetry(gate({ raw: '43.2٪', value: 43.2 }))).toBe(true);
  });

  it('retries for a money-sized figure, either sign', () => {
    expect(RETRY_MIN_ABS).toBe(1000);
    expect(shouldRetry(gate({ raw: '1,000', value: 1000 }))).toBe(true);
    expect(shouldRetry(gate({ raw: '-250,000', value: -250000 }))).toBe(true);
    expect(shouldRetry(gate({ raw: '9,999,999', value: 9999999 }))).toBe(true);
  });

  it('only marks small stray figures', () => {
    expect(shouldRetry(gate({ raw: '999', value: 999 }))).toBe(false);
    expect(shouldRetry(gate({ raw: '40', value: 40 }))).toBe(false);
    expect(shouldRetry(gate({ raw: '17.5', value: 17.5 }, { raw: '13', value: 13 }))).toBe(false);
  });

  it('one money-like figure among small ones is enough', () => {
    expect(shouldRetry(gate({ raw: '13', value: 13 }, { raw: '45,000', value: 45000 }))).toBe(true);
  });

  it('works on a real gate result', () => {
    expect(shouldRetry(gateAnswer('There were 13 refunds.', [], []))).toBe(false);
    expect(shouldRetry(gateAnswer('You made 1,250,000 today.', [], []))).toBe(true);
    expect(shouldRetry(gateAnswer('Up 55% on last week.', [], []))).toBe(true);
  });
});
