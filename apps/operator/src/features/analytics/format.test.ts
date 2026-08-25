import { describe, expect, it } from 'vitest';
import { makeFormatters } from './format';

describe('makeFormatters', () => {
  const en = makeFormatters('en');
  const ar = makeFormatters('ar');

  it('uses Latin digits in both locales', () => {
    expect(en.num(1234567)).toBe('1,234,567');
    expect(ar.num(1234567)).toMatch(/^1[,٬]234[,٬]567$/);
    expect(ar.money(12500)).toMatch(/12[,٬]500 د\.ع$/);
    expect(en.money(-500)).toBe('−500 IQD');
  });
  it('formats percentages and signed deltas', () => {
    expect(en.pct(42)).toBe('42%');
    expect(en.pct(3.25)).toBe('3.3%');
    expect(en.signedPct(12)).toBe('+12%');
    expect(en.signedPct(-8)).toBe('−8%');
    expect(en.signedPct(0)).toBe('0%');
  });
  it('formats durations, hours and dates', () => {
    expect(en.duration(45)).toBe('45s');
    expect(en.duration(135)).toBe('2m 15s');
    expect(ar.duration(135)).toBe('2د 15ث');
    expect(en.hour(7)).toBe('07:00');
    expect(en.date('2026-08-12')).toMatch(/12 Aug/);
    expect(en.date('2026-08-12', true)).toMatch(/2026/);
    expect(en.dateRange('2026-08-01', '2026-08-01')).toMatch(/^1 Aug$/);
    expect(en.dateRange('2026-08-01', '2026-08-10')).toContain('–');
  });
  it('maps JS weekday indexes', () => {
    expect(en.weekday(0)).toBe('Sun');
    expect(en.weekday(1)).toBe('Mon');
    expect(en.weekday(6)).toBe('Sat');
  });
});
