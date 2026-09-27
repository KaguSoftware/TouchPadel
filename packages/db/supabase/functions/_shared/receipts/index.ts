/**
 * Picks the reader for receipts and order slips. RECEIPT_READER=fake gives the stand-in (local,
 * CI, e2e); anything else asks connect.ts, the one file that knows a real
 * model. null means no model is connected: receipt-scan answers
 * RECEIPT_READER_NOT_CONFIGURED and the manager enters the lines by hand.
 *
 * The stand-in "reads" the same paper every time, so it is refused on a hosted
 * project: it is honoured only when SUPABASE_URL is a local stack (what
 * `supabase functions serve` and CI inject) or ALLOW_FAKE_READER=1 says so on
 * purpose. A `.env` copied up with `supabase secrets set --env-file` then
 * gives RECEIPT_READER_NOT_CONFIGURED, not invented stock.
 */
import { connectReceiptModel } from './connect.ts';
import { fakeReader } from './fake.ts';
import type { ReceiptReader } from './types.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'kong', 'host.docker.internal']);

/** True for the URL of a local Supabase stack (the CLI's kong container, or localhost). */
export function isLocalStack(url: string | undefined): boolean {
  try {
    const host = new URL(url ?? '').hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.startsWith('supabase_kong');
  } catch {
    return false;
  }
}

export function readerFromEnv(
  get: (name: string) => string | undefined,
  log: (message: string) => void = () => {},
): ReceiptReader | null {
  if ((get('RECEIPT_READER') ?? '').trim().toLowerCase() === 'fake') {
    if (isLocalStack(get('SUPABASE_URL')) || get('ALLOW_FAKE_READER') === '1') return fakeReader();
    log('RECEIPT_READER=fake refused: not a local stack (set ALLOW_FAKE_READER=1 to allow it on purpose)');
  }
  return connectReceiptModel(get);
}

export * from './types.ts';
export { validateReading, validateSlip } from './validate.ts';
export { promptFor } from './prompt.ts';
