/**
 * The answer gate (plan §4.5, _shared/assistant/gate.ts): a figure passes
 * only when it was given this turn, typed by the owner, or derived by a sum,
 * difference or percentage of two given figures. Everything else is flagged.
 */
import { describe, expect, it } from 'vitest';
import { gateAnswer, numbersIn, retryMessage, tokenizeNumbers } from '../supabase/functions/_shared/assistant/gate.ts';

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
      "These figures are not in this turn's tool results: 9,999,999, 55%. Restate the answer using only figures you were given, or say you do not have them.",
    );
  });
});
