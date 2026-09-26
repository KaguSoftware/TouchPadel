/**
 * The pure half of the phone's camera pages (app/staff-order-slip.tsx,
 * app/staff-receipt.tsx): who may use each, the two logs read defensively, and
 * each row's tone. PURE (vitest).
 */
import type { StaffRole } from '@touch/core';

/** create_order_slip's roles (0239): the floor and management. */
export const SLIP_ROLES: readonly StaffRole[] = ['waiter', 'cashier', 'manager', 'owner'];
/** create_receipt's roles (0237): the driver and management, as purchases. */
export const RECEIPT_ROLES: readonly StaffRole[] = ['driver', 'manager', 'owner'];

export type SlipStatus = 'uploaded' | 'reading' | 'read' | 'failed' | 'sent' | 'rejected';
export type ReceiptStatus = 'uploaded' | 'reading' | 'read' | 'failed' | 'confirmed' | 'rejected';

export interface MySlip {
  id: string;
  status: SlipStatus;
  created_at: string;
  table_number: string | null;
  line_count: number;
  rejected_reason: string | null;
}

export interface MyReceipt {
  id: string;
  status: ReceiptStatus;
  created_at: string;
  supplier_name_read: string | null;
  total_iqd_read: number | null;
  rejected_reason: string | null;
}

const SLIP_STATUSES: readonly SlipStatus[] = ['uploaded', 'reading', 'read', 'failed', 'sent', 'rejected'];
const RECEIPT_STATUSES: readonly ReceiptStatus[] = ['uploaded', 'reading', 'read', 'failed', 'confirmed', 'rejected'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : dflt;

/** app.my_order_slips as returned; anything else reads as none. */
export function readMySlips(payload: unknown): MySlip[] {
  if (!isObject(payload) || !Array.isArray(payload.slips)) return [];
  return payload.slips
    .filter((s): s is Record<string, unknown> => isObject(s) && typeof s.id === 'string')
    .map((s) => ({
      id: s.id as string,
      status: oneOf(s.status, SLIP_STATUSES, 'uploaded'),
      created_at: str(s.created_at) ?? '',
      table_number: str(s.table_number) ?? str(s.table_number_read),
      line_count: num(s.line_count) ?? 0,
      rejected_reason: str(s.rejected_reason),
    }));
}

/** app.my_receipts as returned; anything else reads as none. */
export function readMyReceipts(payload: unknown): MyReceipt[] {
  if (!isObject(payload) || !Array.isArray(payload.receipts)) return [];
  return payload.receipts
    .filter((r): r is Record<string, unknown> => isObject(r) && typeof r.id === 'string')
    .map((r) => ({
      id: r.id as string,
      status: oneOf(r.status, RECEIPT_STATUSES, 'uploaded'),
      created_at: str(r.created_at) ?? '',
      supplier_name_read: str(r.supplier_name_read),
      total_iqd_read: num(r.total_iqd_read),
      rejected_reason: str(r.rejected_reason),
    }));
}

export type ScanTone = 'good' | 'warn' | 'plain';

/** Done well (sent, in stock), set aside, or still with the till or Goods in. */
export function scanTone(status: SlipStatus | ReceiptStatus): ScanTone {
  if (status === 'sent' || status === 'confirmed') return 'good';
  if (status === 'rejected') return 'warn';
  return 'plain';
}
