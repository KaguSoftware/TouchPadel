/**
 * Shapes returned by app.staff_requests_page (migration 0072) plus the pure
 * helpers the screen and its tests share.
 *
 * The server already decides the queue's ORDER (pending first, newest first)
 * and its VISIBILITY (management sees the venue, everyone else sees their own),
 * so nothing here re-sorts or re-filters — a client that re-derived either
 * would drift from the row the server counted.
 */
import type { Tone } from '../../components/kit';

export const REQUESTS_QUERY_KEY = ['observation', 'requests'] as const;

export type StaffRequestKind = 'leave' | 'shift_swap' | 'advance' | 'correction';
export type StaffRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface StaffRequestRow {
  id: string;
  kind: StaffRequestKind;
  status: StaffRequestStatus;
  from_date: string | null;
  to_date: string | null;
  amount_iqd: number | null;
  note: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  staff_id: string;
  staff_name: string;
  staff_role: string;
  decided_by_name: string | null;
}

export interface StaffRequestsPage {
  requests: StaffRequestRow[];
  total: number;
  /** Pending rows VISIBLE to the caller — the badge on the Observation home. */
  pending: number;
}

/** Tone for the status pill; 'pending' is the only one that wants attention. */
export function statusTone(status: StaffRequestStatus): Tone {
  switch (status) {
    case 'pending':
      return 'warn';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'withdrawn':
      return 'neutral';
  }
}

/** Only a pending row can be decided, and never by its own author. */
export function canDecide(row: StaffRequestRow, viewerId: string | undefined): boolean {
  return row.status === 'pending' && row.staff_id !== viewerId;
}
