import { describe, expect, it } from 'vitest';
import { CAP_MAX_MICROS, capInputValue, parseCapUsd } from './capLogic';

describe('parseCapUsd', () => {
  it('reads plain, grouped, symbol and cent amounts', () => {
    expect(parseCapUsd('35')).toBe(35_000_000);
    expect(parseCapUsd(' $1,250.5 ')).toBe(1_250_500_000);
    expect(parseCapUsd('0.01')).toBe(10_000);
    expect(parseCapUsd('20.')).toBe(20_000_000);
  });

  it('reads Arabic-Indic and Persian digits and the Arabic decimal mark', () => {
    expect(parseCapUsd('٣٥')).toBe(35_000_000);
    expect(parseCapUsd('١٢٫٥')).toBe(12_500_000);
    expect(parseCapUsd('۴۰')).toBe(40_000_000);
  });

  it('refuses what the RPC refuses', () => {
    expect(parseCapUsd('')).toBeNull();
    expect(parseCapUsd('0')).toBeNull();
    expect(parseCapUsd('-5')).toBeNull();
    expect(parseCapUsd('10000.01')).toBeNull();
    expect(parseCapUsd('1.234')).toBeNull();
    expect(parseCapUsd('abc')).toBeNull();
    expect(parseCapUsd('1e3')).toBeNull();
    expect(parseCapUsd('10000')).toBe(CAP_MAX_MICROS);
  });
});

describe('capInputValue', () => {
  it('starts the input from the current cap', () => {
    expect(capInputValue(20_000_000)).toBe('20');
    expect(capInputValue(12_500_000)).toBe('12.50');
    expect(capInputValue(null)).toBe('');
    expect(capInputValue(0)).toBe('');
  });
});
