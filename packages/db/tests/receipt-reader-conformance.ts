/**
 * What any reader connect.ts returns must do, checked the same way for the
 * fake today and for a real model the day one is connected (connect.ts, A:
 * "Test"). A helper, not a test file: receipt-scan.test.ts runs it against the
 * fake, and the vendor's own case runs it against the real reader with fetch
 * stubbed. Returns the problems found; [] means it conforms.
 *
 *   * a model name the usage ledger can store (1..100 characters);
 *   * a read answers { reading, usage } with whole, finite, non-negative
 *     token counts;
 *   * an aborted read rejects, and quickly (the 60 s limit relies on it);
 *   * a failure is a ReceiptReaderError with one of the contract's codes, or
 *     any error on an abort (scan.ts calls that TIMEOUT).
 */
import { promptFor } from '../supabase/functions/_shared/receipts/prompt.ts';
import {
  ReceiptReaderError,
  type ReceiptReadInput,
  type ReceiptReader,
  type ScanKind,
} from '../supabase/functions/_shared/receipts/types.ts';

const CODES = new Set(['NOT_CONFIGURED', 'RATE_LIMITED', 'UPSTREAM', 'TIMEOUT', 'UNREADABLE', 'TRUNCATED']);
// A 1x1 white JPEG: enough for a stubbed vendor, never sent anywhere real.
const PIXEL =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function input(kind: ScanKind, signal: AbortSignal): ReceiptReadInput {
  return { kind, imageBase64: PIXEL, mediaType: 'image/jpeg', ...promptFor(kind, []), signal };
}

const wholeCount = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 0);

export async function readerConformance(reader: ReceiptReader, abortWithinMs = 1_000): Promise<string[]> {
  const problems: string[] = [];
  if (typeof reader.model !== 'string' || reader.model.trim().length === 0 || reader.model.length > 100) {
    problems.push('model must be a name of 1 to 100 characters');
  }

  for (const kind of ['receipt', 'order_slip'] as const) {
    try {
      const res = await reader.read(input(kind, new AbortController().signal));
      if (res === null || typeof res !== 'object' || !('reading' in res)) {
        problems.push(`${kind}: read() must answer { reading, usage }`);
      } else {
        const u = res.usage as unknown as Record<string, unknown> | undefined;
        if (!u || !wholeCount(u.input) || !wholeCount(u.output) || u.input === undefined || u.output === undefined
            || !wholeCount(u.cache_write) || !wholeCount(u.cache_read)) {
          problems.push(`${kind}: usage must carry whole, non-negative input and output token counts`);
        }
      }
    } catch (e) {
      if (!(e instanceof ReceiptReaderError) || !CODES.has(e.code)) {
        problems.push(`${kind}: a failed read must throw ReceiptReaderError with a contract code, got ${String(e)}`);
      }
    }
  }

  const abort = new AbortController();
  abort.abort();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    reader.read(input('receipt', abort.signal)).then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'hung'>((resolve) => {
      timer = setTimeout(() => resolve('hung'), abortWithinMs);
    }),
  ]);
  clearTimeout(timer);
  if (outcome === 'resolved') problems.push('an aborted read must reject, not answer');
  if (outcome === 'hung') problems.push(`an aborted read must reject within ${abortWithinMs} ms (took longer)`);
  else if (Date.now() - started > abortWithinMs) problems.push('an aborted read rejected too slowly');

  return problems;
}
