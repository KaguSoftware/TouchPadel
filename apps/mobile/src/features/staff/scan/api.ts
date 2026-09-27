/**
 * The staff phone's scanned paper (Phase 2 Milestone 4b): a supplier receipt
 * (create_receipt, 0237) or a waiter's order slip (create_order_slip, 0239),
 * filed from a photo already uploaded to staff-media, then read by the
 * receipt-scan edge function. The phone never creates an order or a delivery:
 * the till and Goods in do, after a person checks the reading.
 */
import { callStaffEdge, staffRpc } from '../api';
import { StaffEdgeError } from '../edge';
import { readMyReceipts, readMySlips, type MyReceipt, type MySlip } from './logic';

export async function fileOrderSlip(venueId: string, path: string, key: string): Promise<string> {
  const res = await staffRpc<{ id: string }>('create_order_slip', {
    p_venue_id: venueId,
    p_storage_path: path,
    p_idempotency_key: key,
  });
  return res.id;
}

export async function fileReceipt(venueId: string, path: string, key: string): Promise<string> {
  const res = await staffRpc<{ id: string }>('create_receipt', {
    p_venue_id: venueId,
    p_storage_path: path,
    p_source: 'phone',
    p_idempotency_key: key,
  });
  return res.id;
}

/**
 * Ask receipt-scan to read what was just filed. Its outcome (read, failed, no
 * model connected) is stored on the slip or receipt and shown where a person
 * checks it, so a failure here is not the sender's to handle. A request that
 * never reached the server (the network dropped) is tried once more a few
 * seconds later: otherwise the paper would wait, unread, for someone at the
 * till or Goods in to press Read again. An answer from the server, whatever it
 * says, is never repeated (a second reading costs money).
 */
export async function readScanned(
  body: { slip_id: string } | { receipt_id: string },
  retryAfterMs = 5_000,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await callStaffEdge('receipt-scan', body);
      return;
    } catch (e) {
      // StaffEdgeError: the server answered. Anything else never reached it.
      if (e instanceof StaffEdgeError || attempt > 0) return;
      await new Promise((r) => setTimeout(r, retryAfterMs));
    }
  }
}

export async function fetchMySlips(venueId: string): Promise<MySlip[]> {
  return readMySlips(await staffRpc<unknown>('my_order_slips', { p_venue_id: venueId }));
}

export async function fetchMyReceipts(venueId: string): Promise<MyReceipt[]> {
  return readMyReceipts(await staffRpc<unknown>('my_receipts', { p_venue_id: venueId }));
}
