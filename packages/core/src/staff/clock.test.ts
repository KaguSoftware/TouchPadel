import { describe, expect, it } from 'vitest';
import { clockCode, parseClockCode, shiftMinutes, weekProblem } from './clock';

// "12345678901234567890" as hex: the RFC 4226 / 6238 SHA-1 test secret.
const RFC_SECRET = Buffer.from('12345678901234567890', 'utf8').toString('hex');
// The station secret the SQL test vectors use (0x01 .. 0x14).
const SEQ_SECRET = '0102030405060708090a0b0c0d0e0f1011121314';

describe('clockCode', () => {
  it('matches RFC 6238 (SHA-1) and app.clock_code', () => {
    // RFC 6238 Appendix B, T = 59 s -> counter 1 -> 94287082 (8 digits; 6 = 287082).
    expect(clockCode(RFC_SECRET, 59_000).code).toBe('287082');
    // RFC 6238, T = 1111111109 -> 07081804 -> 081804.
    expect(clockCode(RFC_SECRET, 1_111_111_109_000).code).toBe('081804');
    // app.clock_code(0x01..0x14, 0) and (…, 59000000), computed on the stack.
    expect(clockCode(SEQ_SECRET, 0).code).toBe('486114');
    expect(clockCode(SEQ_SECRET, 59_000_000 * 30_000).code).toBe('844436');
  });

  it('draws TPCLOCK:<code> and counts down to the next step', () => {
    const r = clockCode(SEQ_SECRET, 61_000);
    expect(r.qr).toBe(`TPCLOCK:${r.code}`);
    expect(r.secondsLeft).toBe(29);
    expect(clockCode(SEQ_SECRET, 60_000).secondsLeft).toBe(30);
  });

  it('refuses a secret that is not hex', () => {
    expect(() => clockCode('zz', 0)).toThrow();
  });
});

describe('parseClockCode', () => {
  it('reads the QR text or six typed digits', () => {
    expect(parseClockCode('TPCLOCK:012345')).toBe('012345');
    expect(parseClockCode(' tpclock:012345 ')).toBe('012345');
    expect(parseClockCode('012 345')).toBe('012345');
    expect(parseClockCode('12345')).toBeNull();
    expect(parseClockCode('TP-ABCDEFGH-123456')).toBeNull();
    expect(parseClockCode('https://evil.example/012345')).toBeNull();
  });
});

describe('set hours', () => {
  it('measures a shift, past midnight too', () => {
    expect(shiftMinutes({ starts_at: '10:00', ends_at: '14:30' })).toBe(270);
    expect(shiftMinutes({ starts_at: '22:00', ends_at: '03:00' })).toBe(300);
  });

  it('allows touching shifts and a gap, refuses overlap, length and empty shifts', () => {
    expect(
      weekProblem([
        { weekday: 1, starts_at: '10:00', ends_at: '14:00', role: 'waiter' },
        { weekday: 1, starts_at: '14:00', ends_at: '18:00', role: 'cashier' },
        { weekday: 1, starts_at: '19:00', ends_at: '23:00', role: null },
      ]),
    ).toBeNull();
    expect(
      weekProblem([
        { weekday: 1, starts_at: '10:00', ends_at: '14:00', role: null },
        { weekday: 1, starts_at: '13:00', ends_at: '18:00', role: null },
      ]),
    ).toEqual({ index: 1, reason: 'overlap' });
    // Sunday night runs into Monday morning.
    expect(
      weekProblem([
        { weekday: 7, starts_at: '22:00', ends_at: '03:00', role: null },
        { weekday: 1, starts_at: '02:00', ends_at: '06:00', role: null },
      ]),
    ).toEqual({ index: 1, reason: 'overlap' });
    expect(weekProblem([{ weekday: 2, starts_at: '06:00', ends_at: '23:00', role: null }])).toEqual({
      index: 0,
      reason: 'too_long',
    });
    expect(weekProblem([{ weekday: 2, starts_at: '06:00', ends_at: '06:00', role: null }])).toEqual({
      index: 0,
      reason: 'empty',
    });
  });
});
