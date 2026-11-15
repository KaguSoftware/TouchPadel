import { afterEach, describe, expect, it } from 'vitest';
import { noteServerDate, offsetFromDateHeader, resetServerClock, serverNow } from '../serverClock';

// Audit finding 32: the cancel window and the hold countdown run on the
// server's clock, learnt from each response's Date header.

afterEach(() => resetServerClock());

describe('serverClock', () => {
  const received = Date.parse('2026-11-15T10:00:00Z');

  it('a phone two hours fast reads the server two hours behind it', () => {
    expect(offsetFromDateHeader('Sun, 15 Nov 2026 08:00:00 GMT', received)).toBe(-2 * 3_600_000);
  });

  it('a second or two of header resolution and latency is no skew', () => {
    expect(offsetFromDateHeader('Sun, 15 Nov 2026 10:00:02 GMT', received)).toBe(0);
  });

  it('an unreadable header changes nothing', () => {
    expect(offsetFromDateHeader(null, received)).toBeNull();
    expect(offsetFromDateHeader('nonsense', received)).toBeNull();
  });

  it('serverNow follows the last response', () => {
    noteServerDate(new Date(Date.now() - 2 * 3_600_000).toUTCString());
    const lag = Date.now() - serverNow().getTime();
    expect(lag).toBeGreaterThan(2 * 3_600_000 - 2_000);
    expect(lag).toBeLessThan(2 * 3_600_000 + 2_000);
    noteServerDate('garbage');
    expect(Date.now() - serverNow().getTime()).toBeGreaterThan(3_600_000);
  });
});
