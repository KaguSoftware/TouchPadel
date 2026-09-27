import { describe, expect, it } from 'vitest';
import { dateKeystroke, isIsoDate, MAX_ISO_DATE } from './dateFieldLogic';

describe('isIsoDate', () => {
  it('accepts a real four-digit-year date', () => {
    expect(isIsoDate('2026-09-23')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true); // a leap day that exists
    expect(isIsoDate(MAX_ISO_DATE)).toBe(true);
  });

  it('rejects a year that is not exactly four digits', () => {
    // The reported crash: typing 2028 and then one more key.
    expect(isIsoDate('20285-09-23')).toBe(false);
    expect(isIsoDate('202-09-23')).toBe(false);
    expect(isIsoDate('202609-23')).toBe(false);
  });

  it('rejects a shape that is not YYYY-MM-DD', () => {
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('2026-09')).toBe(false);
    expect(isIsoDate('2026/09/23')).toBe(false);
    expect(isIsoDate('2026-9-3')).toBe(false);
  });

  it('rejects a date that matches the shape but does not exist', () => {
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-09-00')).toBe(false);
    expect(isIsoDate('2027-02-29')).toBe(false); // 2027 is not a leap year
  });
});

describe('dateKeystroke', () => {
  it('publishes a complete date', () => {
    expect(dateKeystroke('2026-09-23')).toBe('2026-09-23');
  });

  it('holds everything else so the field keeps its previous value', () => {
    expect(dateKeystroke('20285-09-23')).toBeNull();
    expect(dateKeystroke('')).toBeNull();
    expect(dateKeystroke('2026-02-31')).toBeNull();
  });

  it('leaves bounds to the screen that owns them', () => {
    // A past date is well-formed, so it publishes; whether it is ALLOWED is a
    // question for the screen's validation, not for the box.
    expect(dateKeystroke('1999-01-01')).toBe('1999-01-01');
  });
});
