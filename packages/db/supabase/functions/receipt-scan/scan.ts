/**
 * receipt-scan, the flow (pure: no Deno, no npm:), for both kinds of paper: a
 * supplier receipt or a waiter's order slip. index.ts supplies the ports for
 * the kind; tests/receipt-scan.test.ts supplies fakes.
 *
 *   1. take the paper for a reading            app.receipt_begin_reading / app.slip_begin_reading
 *                                              (a lease token; the per-paper and per-person limits)
 *   2. no model connected -> given back, 503 RECEIPT_READER_NOT_CONFIGURED
 *   3. download the photo (15 s)               nothing is spent on a photo that is not there
 *   4. the spend cap (real models only)        app.llm_begin_request
 *   5. read it (60 s, hard)                     connect.ts / fake.ts, prompt.ts promptFor(kind)
 *   6. validate                                _shared/receipts/validate.ts (validateReading / validateSlip)
 *   7. store and match                          app.receipt_store_reading / app.slip_store_reading
 *   finally: record what the model spent       app.llm_record_usage ('receipt_scan' / 'order_slip_scan')
 *
 * Every path that took the paper ends it: stored (read), given back
 * (nothing was tried: the status it had before) or failed with a code the
 * review screen shows. Ending it is best effort (a failure to end it is
 * logged, never thrown over the real error), and a paper left "reading" by a
 * killed worker is ended by app.scan_sweep_stale (0240) after three minutes.
 * The lease token makes a late answer from an abandoned reading harmless: the
 * store and fail RPCs refuse a token that is not the paper's current one.
 */
import { FAKE_MODEL } from '../_shared/receipts/fake.ts';
import { promptFor } from '../_shared/receipts/prompt.ts';
import {
  ReceiptReaderError,
  type ReceiptMediaType,
  type ReceiptReader,
  type ReceiptUsage,
  type Reading,
  type ScanKind,
  type SlipReading,
} from '../_shared/receipts/types.ts';
import { validateReading, validateSlip } from '../_shared/receipts/validate.ts';

/** app.llm_record_usage's p_surface per kind. */
export const SCAN_SURFACE: Record<ScanKind, string> = { receipt: 'receipt_scan', order_slip: 'order_slip_scan' };
export const READ_TIMEOUT_MS = 60_000;
export const DOWNLOAD_TIMEOUT_MS = 15_000;

/** An RPC failure, carrying the P0001 code ('RECEIPT_BUSY', 'LLM_MONTHLY_CAP' …). */
export class PortError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'PortError';
  }
}

export interface BeginReading {
  storage_path: string;
  /** The branch's supplier names (receipt) or menu item names (order slip), for the model. */
  names: string[];
  /** This reading's lease: the store and fail RPCs refuse any other. */
  token: string | null;
}

export interface ScanPorts {
  kind: ScanKind;
  beginReading(id: string): Promise<BeginReading>;
  reader: ReceiptReader | null;
  /** Throws PortError('LLM_MONTHLY_CAP' | 'LLM_DAILY_QUOTA') when the budget is spent. */
  llmBegin(): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  storeReading(
    id: string,
    reading: Reading | SlipReading,
    model: string,
    token: string | null,
  ): Promise<{ lines: number; matched: number }>;
  failReading(id: string, code: string, status: 'uploaded' | 'failed', token: string | null): Promise<void>;
  recordUsage(model: string, usage: ReceiptUsage): Promise<void>;
  log(message: string): void;
  timeoutMs?: number;
  downloadTimeoutMs?: number;
}

export interface ScanResponse {
  status: number;
  body: Record<string, unknown>;
}

const BEGIN_ERRORS: Record<string, number> = {
  RECEIPT_NOT_FOUND: 404,
  RECEIPT_ALREADY_DONE: 409,
  RECEIPT_BUSY: 409,
  SLIP_NOT_FOUND: 404,
  SLIP_ALREADY_DONE: 409,
  SLIP_BUSY: 409,
  // 0240: one paper is read at most three times; staff below MGMT have a daily number.
  SCAN_REREAD_LIMIT: 429,
  SCAN_USER_DAILY_LIMIT: 429,
};
const CAP_CODES = new Set(['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA']);
/** The paper was set aside or taken over while this reading ran: its answer is dropped. */
const SUPERSEDED = new Set(['RECEIPT_NOT_READING', 'SLIP_NOT_READING', 'READING_SUPERSEDED']);

export function mediaTypeOf(path: string): ReceiptMediaType | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

/** Base64 of bytes, in chunks (a 5 MB photo would blow the argument limit in one call). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Token counts as app.llm_record_usage's bigints take them: whole, finite, not negative. */
export function cleanUsage(u: ReceiptUsage): ReceiptUsage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return { input: n(u.input), output: n(u.output), cache_write: n(u.cache_write), cache_read: n(u.cache_read) };
}

function codeOf(e: unknown): string {
  if (e instanceof PortError) return e.code;
  return e instanceof Error ? e.message : String(e);
}

class TimedOut extends Error {
  constructor() {
    super('timed out');
    this.name = 'TimedOut';
  }
}

/** Rejects with TimedOut after `ms`, whatever the promise does; the promise's own late rejection is swallowed. */
async function within<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => {});
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimedOut());
    }, ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

export async function scanReceipt(ports: ScanPorts, id: string): Promise<ScanResponse> {
  let begin: BeginReading;
  try {
    begin = await ports.beginReading(id);
  } catch (e) {
    const code = codeOf(e);
    const status = BEGIN_ERRORS[code];
    if (status) return { status, body: { error: code } };
    throw e;
  }

  // From here the paper is ours: every way out ends the reading.
  let ended = false;
  const end = async (code: string, status: 'uploaded' | 'failed') => {
    ended = true;
    try {
      await ports.failReading(id, code, status, begin.token);
    } catch (e) {
      ports.log(`reading ${id} not ended (${code}): ${codeOf(e)}`);
    }
  };

  try {
    return await read(ports, id, begin, end);
  } catch (e) {
    if (!ended) await end('UPSTREAM', 'failed');
    throw e;
  }
}

async function read(
  ports: ScanPorts,
  id: string,
  begin: BeginReading,
  end: (code: string, status: 'uploaded' | 'failed') => Promise<void>,
): Promise<ScanResponse> {
  const reader = ports.reader;
  if (!reader) {
    await end('READER_NOT_CONFIGURED', 'uploaded');
    return {
      status: 503,
      body: { error: 'RECEIPT_READER_NOT_CONFIGURED', message: 'no receipt model is connected; enter the lines by hand' },
    };
  }

  // The photo before the budget: a missing or odd photo spends nothing.
  const mediaType = mediaTypeOf(begin.storage_path);
  let bytes: Uint8Array;
  try {
    if (!mediaType) throw new Error(`unsupported photo type: ${begin.storage_path}`);
    bytes = await within(ports.download(begin.storage_path), ports.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  } catch (e) {
    const code = e instanceof TimedOut ? 'TIMEOUT' : 'PHOTO_MISSING';
    ports.log(`photo ${id}: ${code} ${codeOf(e)}`);
    await end(code, 'failed');
    return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code } };
  }

  // The fake spends nothing and must work where the LLM budget is zero.
  const metered = reader.model !== FAKE_MODEL;
  if (metered) {
    try {
      await ports.llmBegin();
    } catch (e) {
      const code = codeOf(e);
      if (CAP_CODES.has(code)) {
        await end(code, 'uploaded');
        return { status: 429, body: { error: code } };
      }
      await end('UPSTREAM', 'uploaded');
      throw e;
    }
  }

  let usage: ReceiptUsage | null = null;
  const abort = new AbortController();
  try {
    let raw: unknown;
    try {
      // Raced against the clock as well as aborted: a reader that ignores the
      // signal still gives the paper back on time.
      const result = await within(
        reader.read({
          kind: ports.kind,
          imageBase64: bytesToBase64(bytes),
          mediaType: mediaType!,
          ...promptFor(ports.kind, begin.names),
          signal: abort.signal,
        }),
        ports.timeoutMs ?? READ_TIMEOUT_MS,
        () => abort.abort(),
      );
      usage = result.usage;
      raw = result.reading;
    } catch (e) {
      let code: string;
      if (e instanceof ReceiptReaderError) {
        code = e.code;
        usage = e.usage ?? null;
      } else {
        code = e instanceof TimedOut || abort.signal.aborted ? 'TIMEOUT' : 'UPSTREAM';
      }
      // connect.ts writes a ReceiptReaderError's message (short, no response
      // body); anything else is logged by name only, since a vendor's own
      // message can carry what it was sent.
      const why = e instanceof ReceiptReaderError ? e.message.slice(0, 200) : e instanceof Error ? e.name : typeof e;
      ports.log(`read ${id}: ${code} ${why}`);
      await end(code, 'failed');
      return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code } };
    }

    const checked = ports.kind === 'order_slip' ? validateSlip(raw) : validateReading(raw);
    if (!checked.ok) {
      ports.log(`read ${id}: INVALID_READING ${checked.reason}`);
      await end('INVALID_READING', 'failed');
      return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code: 'INVALID_READING' } };
    }
    if (checked.reading.lines.length === 0) {
      await end('UNREADABLE', 'failed');
      return { status: 422, body: { error: 'RECEIPT_READ_FAILED', code: 'UNREADABLE' } };
    }

    let stored: { lines: number; matched: number };
    try {
      stored = await ports.storeReading(id, checked.reading, reader.model, begin.token);
    } catch (e) {
      const code = codeOf(e);
      if (SUPERSEDED.has(code)) {
        // Set aside, or read again by someone else, while this one ran.
        return { status: 409, body: { error: 'READING_SUPERSEDED' } };
      }
      ports.log(`store ${id}: ${code}`);
      await end('STORE_FAILED', 'failed');
      return { status: 500, body: { error: 'RECEIPT_READ_FAILED', code: 'STORE_FAILED' } };
    }
    return { status: 200, body: { status: 'read', lines: stored.lines, matched: stored.matched } };
  } finally {
    if (metered && usage) {
      try {
        await ports.recordUsage(reader.model, cleanUsage(usage));
      } catch (e) {
        ports.log(`usage not recorded: ${codeOf(e)}`);
      }
    }
  }
}
