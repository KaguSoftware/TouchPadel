/**
 * The scanned-paper reading, as Goods in (ReceiptReview) and the till
 * (SlipReview) see it (0237/0239, hardened by 0240). Pure apart from
 * requestReading, so scanReading.test.ts covers every branch.
 *
 *   * readingState: is a reading running (hold the editor and poll), stuck
 *     (the server gives it up at three minutes; offer Read again and Set
 *     aside), about to start (a paper filed in the last 90 s), or idle. Timed
 *     on the SERVER's clock (the detail's server_now), not the station's.
 *   * scanErrorKey: the paper's error_code -> its ws.receipts.error.* line.
 *   * requestReading: ask receipt-scan once; a refusal the paper does not
 *     record (the per-paper or per-person limit, busy, a network failure) is
 *     returned so the screen can say it.
 */
import type { MessageKey } from '@touch/i18n';
import { callEdge, EdgeError } from './edge';

/** The server's own deadline (*_begin_reading, app.scan_sweep_stale): a reading older than this is abandoned. */
export const READ_DEADLINE_MS = 180_000;
/** A paper filed this recently with no reading yet is still expected to be read (the phone asked). */
export const FIRST_READ_GRACE_MS = 90_000;
/** How long the station waits for one Read again (the edge function gives up at 60 s). */
export const READ_REQUEST_TIMEOUT_MS = 75_000;

export type ReadingState = 'reading' | 'stale' | 'waiting' | 'idle';

export interface ReadingClock {
  status: string;
  error_code: string | null;
  created_at: string;
  reading_started_at: string | null;
  /** The database's now() when the detail was read. */
  server_now: string | null;
}

/**
 * Milliseconds to add to the station's clock to get the server's: the
 * detail's server_now against when the station received it. 0 without one.
 */
export function serverOffset(serverNow: string | null, receivedAt: number): number {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) && receivedAt > 0 ? t - receivedAt : 0;
}

export function readingState(d: ReadingClock | null, serverNowMs: number): ReadingState {
  if (!d) return 'idle';
  if (d.status === 'reading') {
    const started = d.reading_started_at ? Date.parse(d.reading_started_at) : NaN;
    // No start time (an older server): trust the status, as before.
    if (!Number.isFinite(started)) return 'reading';
    return serverNowMs - started < READ_DEADLINE_MS ? 'reading' : 'stale';
  }
  if (d.status === 'uploaded' && d.error_code === null) {
    const created = Date.parse(d.created_at);
    if (Number.isFinite(created) && serverNowMs - created < FIRST_READ_GRACE_MS) return 'waiting';
  }
  return 'idle';
}

/** error_code values with their own line under ws.receipts.error (the slip screen shares them). */
export const SCAN_ERROR_CODES: ReadonlySet<string> = new Set([
  'READER_NOT_CONFIGURED',
  'NOT_CONFIGURED',
  'LLM_MONTHLY_CAP',
  'LLM_DAILY_QUOTA',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM',
  'UNREADABLE',
  'TRUNCATED',
  'INVALID_READING',
  'PHOTO_MISSING',
  'STORE_FAILED',
  'READ_ABANDONED',
]);

export function scanErrorKey(code: string | null): MessageKey | null {
  if (!code) return null;
  return `ws.receipts.error.${SCAN_ERROR_CODES.has(code) ? code : 'other'}` as MessageKey;
}

/** receipt-scan answers the paper does not record; the screen says them (op.errors.*). */
const REFUSALS: ReadonlySet<string> = new Set([
  'SCAN_REREAD_LIMIT',
  'SCAN_USER_DAILY_LIMIT',
  'RECEIPT_BUSY',
  'SLIP_BUSY',
  'RECEIPT_ALREADY_DONE',
  'SLIP_ALREADY_DONE',
  'READING_SUPERSEDED',
]);

/**
 * Ask receipt-scan to read one paper. Its outcome is stored on the paper
 * (status, error_code), so a reading that failed is not thrown; what the paper
 * cannot record comes back as the EdgeError to show (its `code` is the
 * refusal, which errorToMessageKey maps), and anything else as null.
 */
export async function requestReading(
  body: { receipt_id: string } | { slip_id: string },
  signal: AbortSignal = AbortSignal.timeout(READ_REQUEST_TIMEOUT_MS),
): Promise<Error | null> {
  try {
    await callEdge('receipt-scan', body, { ttlMs: 0, signal });
    return null;
  } catch (e) {
    if (e instanceof EdgeError) return REFUSALS.has(e.code) ? e : null;
    // The station gave up waiting, or the network failed: the paper may still
    // be read. Said as a network failure (errors.network), whatever threw.
    return e instanceof TypeError ? e : new TypeError(e instanceof Error ? e.message : String(e));
  }
}
