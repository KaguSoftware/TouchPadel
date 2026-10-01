import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EdgeModule_ from './edge';

type EdgeModule = typeof EdgeModule_;

const callEdge = vi.fn();
vi.mock('./edge', async (orig) => ({ ...(await orig<EdgeModule>()), callEdge }));

const { EdgeError } = await import('./edge');
const { errorToMessageKey } = await import('./errors');
const { readingState, requestReading, scanErrorKey, serverOffset, READ_DEADLINE_MS } = await import('./scanReading');

const T0 = Date.parse('2026-09-27T10:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const paper = (over: Partial<Parameters<typeof readingState>[0] & object> = {}) => ({
  status: 'read',
  error_code: null,
  created_at: at(0),
  reading_started_at: null,
  server_now: null,
  ...over,
});

describe('readingState: judged on the server clock', () => {
  it('a reading runs for the server three minutes, then is stuck', () => {
    const d = paper({ status: 'reading', reading_started_at: at(0) });
    expect(readingState(d, T0 + 10_000)).toBe('reading');
    expect(readingState(d, T0 + READ_DEADLINE_MS - 1)).toBe('reading');
    expect(readingState(d, T0 + READ_DEADLINE_MS)).toBe('stale');
    // No start time from an older server: trust the status.
    expect(readingState(paper({ status: 'reading' }), T0 + 3_600_000)).toBe('reading');
  });

  it('a paper just filed waits 90 s for its first reading; one with a code does not', () => {
    expect(readingState(paper({ status: 'uploaded' }), T0 + 30_000)).toBe('waiting');
    expect(readingState(paper({ status: 'uploaded' }), T0 + 95_000)).toBe('idle');
    expect(readingState(paper({ status: 'uploaded', error_code: 'READER_NOT_CONFIGURED' }), T0 + 1_000)).toBe('idle');
    expect(readingState(paper({ status: 'failed' }), T0)).toBe('idle');
    expect(readingState(null, T0)).toBe('idle');
  });

  it('the station clock is corrected by the server_now it was sent', () => {
    // The station runs five minutes slow: a reading started a minute ago is still running.
    const receivedAt = T0 - 300_000;
    const offset = serverOffset(at(0), receivedAt);
    expect(offset).toBe(300_000);
    const d = paper({ status: 'reading', reading_started_at: at(-60_000) });
    expect(readingState(d, receivedAt + offset)).toBe('reading');
    expect(serverOffset(null, T0)).toBe(0);
    expect(serverOffset('nonsense', T0)).toBe(0);
  });

  it('every stored error code has its own line; anything else the general one', () => {
    expect(scanErrorKey('READ_ABANDONED')).toBe('ws.receipts.error.READ_ABANDONED');
    expect(scanErrorKey('TRUNCATED')).toBe('ws.receipts.error.TRUNCATED');
    expect(scanErrorKey('SOMETHING_NEW')).toBe('ws.receipts.error.other');
    expect(scanErrorKey(null)).toBeNull();
  });
});

describe('requestReading', () => {
  beforeEach(() => callEdge.mockReset());

  it('asks once, with no cache and a time limit', async () => {
    callEdge.mockResolvedValueOnce({ status: 'read' });
    expect(await requestReading({ slip_id: 's1' })).toBeNull();
    expect(callEdge).toHaveBeenCalledWith('receipt-scan', { slip_id: 's1' }, expect.objectContaining({ ttlMs: 0 }));
    expect(callEdge.mock.calls[0]![2].signal).toBeInstanceOf(AbortSignal);
  });

  it('a failure the paper records is not an error; a limit or busy is', async () => {
    callEdge.mockRejectedValueOnce(new EdgeError(502, 'UPSTREAM', 'x', 'TIMEOUT'));
    expect(await requestReading({ receipt_id: 'r1' })).toBeNull();
    callEdge.mockRejectedValueOnce(new EdgeError(429, 'RATE_LIMITED', 'x', 'SCAN_REREAD_LIMIT'));
    const refused = await requestReading({ receipt_id: 'r1' });
    expect(refused).toBeInstanceOf(EdgeError);
    expect((refused as InstanceType<typeof EdgeError>).code).toBe('SCAN_REREAD_LIMIT');
    // The screen says it through the one mapper, by the server's code.
    expect(errorToMessageKey(refused)).toBe('op.errors.SCAN_REREAD_LIMIT');
    callEdge.mockRejectedValueOnce(new EdgeError(409, 'UNKNOWN', 'x', 'RECEIPT_BUSY'));
    expect(errorToMessageKey(await requestReading({ receipt_id: 'r1' }))).toBe('op.errors.RECEIPT_BUSY');
  });

  it('a network failure or the station giving up is said as a network failure', async () => {
    callEdge.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    expect(await requestReading({ receipt_id: 'r1' })).toBeInstanceOf(TypeError);
    callEdge.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await requestReading({ receipt_id: 'r1' })).toBeInstanceOf(TypeError);
  });
});
