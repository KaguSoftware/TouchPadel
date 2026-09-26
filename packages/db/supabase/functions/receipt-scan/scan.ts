/**
 * receipt-scan, the flow (pure: no Deno, no npm:), for both kinds of paper: a
 * supplier receipt or a waiter's order slip. index.ts supplies the ports for
 * the kind; tests/receipt-scan.test.ts supplies fakes.
 *
 *   1. take the paper for a reading            app.receipt_begin_reading / app.slip_begin_reading
 *   2. no model connected -> back to uploaded, 503 RECEIPT_READER_NOT_CONFIGURED
 *   3. the spend cap (real models only)        app.llm_begin_request
 *   4. download the photo, read it (60 s)      connect.ts / fake.ts, prompt.ts promptFor(kind)
 *   5. validate                                _shared/receipts/validate.ts (validateReading / validateSlip)
 *   6. store and match                          app.receipt_store_reading / app.slip_store_reading
 *   finally: record what the model spent       app.llm_record_usage ('receipt_scan' / 'order_slip_scan')
 *
 * Every path that took the paper ends it: stored (read), given back
 * (uploaded: nothing was tried) or failed with a code the review screen shows.
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
}

export interface ScanPorts {
  kind: ScanKind;
  beginReading(id: string): Promise<BeginReading>;
  reader: ReceiptReader | null;
  /** Throws PortError('LLM_MONTHLY_CAP' | 'LLM_DAILY_QUOTA') when the budget is spent. */
  llmBegin(): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  storeReading(id: string, reading: Reading | SlipReading, model: string): Promise<{ lines: number; matched: number }>;
  failReading(id: string, code: string, status: 'uploaded' | 'failed'): Promise<void>;
  recordUsage(model: string, usage: ReceiptUsage): Promise<void>;
  log(message: string): void;
  timeoutMs?: number;
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
};
const CAP_CODES = new Set(['LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA']);

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

function codeOf(e: unknown): string {
  if (e instanceof PortError) return e.code;
  return e instanceof Error ? e.message : String(e);
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

  const reader = ports.reader;
  if (!reader) {
    await ports.failReading(id, 'READER_NOT_CONFIGURED', 'uploaded');
    return {
      status: 503,
      body: { error: 'RECEIPT_READER_NOT_CONFIGURED', message: 'no receipt model is connected; enter the lines by hand' },
    };
  }

  // The fake spends nothing and must work where the LLM budget is zero.
  const metered = reader.model !== FAKE_MODEL;
  if (metered) {
    try {
      await ports.llmBegin();
    } catch (e) {
      const code = codeOf(e);
      if (CAP_CODES.has(code)) {
        await ports.failReading(id, code, 'uploaded');
        return { status: 429, body: { error: code } };
      }
      await ports.failReading(id, 'UPSTREAM', 'uploaded');
      throw e;
    }
  }

  const mediaType = mediaTypeOf(begin.storage_path);
  let bytes: Uint8Array;
  try {
    if (!mediaType) throw new Error(`unsupported photo type: ${begin.storage_path}`);
    bytes = await ports.download(begin.storage_path);
  } catch (e) {
    ports.log(`photo ${id}: ${codeOf(e)}`);
    await ports.failReading(id, 'PHOTO_MISSING', 'failed');
    return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code: 'PHOTO_MISSING' } };
  }

  let usage: ReceiptUsage | null = null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ports.timeoutMs ?? READ_TIMEOUT_MS);
  try {
    let raw: unknown;
    try {
      const result = await reader.read({
        kind: ports.kind,
        imageBase64: bytesToBase64(bytes),
        mediaType: mediaType!,
        ...promptFor(ports.kind, begin.names),
        signal: abort.signal,
      });
      usage = result.usage;
      raw = result.reading;
    } catch (e) {
      let code: string;
      if (e instanceof ReceiptReaderError) {
        code = e.code;
        usage = e.usage ?? null;
      } else {
        code = abort.signal.aborted ? 'TIMEOUT' : 'UPSTREAM';
      }
      ports.log(`read ${id}: ${code} ${e instanceof Error ? e.message : String(e)}`);
      await ports.failReading(id, code, 'failed');
      return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code } };
    }

    const checked = ports.kind === 'order_slip' ? validateSlip(raw) : validateReading(raw);
    if (!checked.ok) {
      ports.log(`read ${id}: INVALID_READING ${checked.reason}`);
      await ports.failReading(id, 'INVALID_READING', 'failed');
      return { status: 502, body: { error: 'RECEIPT_READ_FAILED', code: 'INVALID_READING' } };
    }
    if (checked.reading.lines.length === 0) {
      await ports.failReading(id, 'UNREADABLE', 'failed');
      return { status: 422, body: { error: 'RECEIPT_READ_FAILED', code: 'UNREADABLE' } };
    }

    const stored = await ports.storeReading(id, checked.reading, reader.model);
    return { status: 200, body: { status: 'read', lines: stored.lines, matched: stored.matched } };
  } finally {
    clearTimeout(timer);
    if (metered && usage) {
      try {
        await ports.recordUsage(reader.model, usage);
      } catch (e) {
        ports.log(`usage not recorded: ${codeOf(e)}`);
      }
    }
  }
}
