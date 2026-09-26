/**
 * The stand-in model: RECEIPT_READER=fake. It never looks at the photo and
 * always "reads" the same paper of the kind asked for, so local work, CI and
 * the e2e specs can drive both flows (reading, matching, review, Goods in or
 * the till) with no key and no spend. Never selected on hosted unless someone
 * sets the variable there.
 *
 *   receipt     items of the seeded ingredient list, one in Arabic marked
 *               unclear (handwriting), and a delivery fee that matches no stock
 *   order_slip  items of the menu fixture (packages/db/fixtures/menu.sql), in
 *               Arabic as a waiter writes them, a note, one unclear line and
 *               one that matches nothing, for table 3
 */
import type { ReceiptReader, ScanKind } from './types.ts';

export const FAKE_MODEL = 'fake-receipt-reader';

export const FAKE_READING = {
  supplier_name: 'Fake Supplier',
  receipt_date: '2026-09-20',
  total_iqd: 58000,
  lines: [
    { text: 'Whole milk 1L', qty: 12, unit: 'L', unit_price_iqd: 1500, line_total_iqd: 18000 },
    { text: 'سكر', qty: 5, unit: 'كيلو', line_total_iqd: 10000, unclear: true },
    { text: 'Espresso beans 1kg', qty: 2, unit: 'kg', unit_price_iqd: 14000, line_total_iqd: 28000 },
    { text: 'Delivery fee', qty: 1, line_total_iqd: 2000 },
  ],
} as const;

export const FAKE_SLIP = {
  table_number: 'ط3',
  lines: [
    { text: 'لاتيه', qty: 2, notes: 'بدون سكر' },
    { text: 'كابتشينو كبير', qty: 1 },
    { text: 'شاي كرك', unclear: true },
    { text: 'شي ما بالمنيو', qty: 1 },
  ],
} as const;

export function fakeReader(): ReceiptReader {
  return {
    model: FAKE_MODEL,
    async read({ kind, signal }: { kind: ScanKind; signal: AbortSignal }) {
      if (signal.aborted) throw new Error('aborted');
      const reading = kind === 'order_slip' ? FAKE_SLIP : FAKE_READING;
      return { reading: structuredClone(reading), usage: { input: 0, output: 0 } };
    },
  };
}
