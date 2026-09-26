/**
 * Picks the reader for receipts and order slips. RECEIPT_READER=fake gives the stand-in (local,
 * CI, e2e); anything else asks connect.ts, the one file that knows a real
 * model. null means no model is connected: receipt-scan answers
 * RECEIPT_READER_NOT_CONFIGURED and the manager enters the lines by hand.
 */
import { connectReceiptModel } from './connect.ts';
import { fakeReader } from './fake.ts';
import type { ReceiptReader } from './types.ts';

export function readerFromEnv(get: (name: string) => string | undefined): ReceiptReader | null {
  if ((get('RECEIPT_READER') ?? '').trim().toLowerCase() === 'fake') return fakeReader();
  return connectReceiptModel(get);
}

export * from './types.ts';
export { validateReading, validateSlip } from './validate.ts';
export { promptFor } from './prompt.ts';
