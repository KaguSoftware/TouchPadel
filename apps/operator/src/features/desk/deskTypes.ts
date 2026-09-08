/**
 * Row shapes the desk screens share. `reservations` is read directly (RLS
 * lets staff see the whole table); writes go through mutate() / appRpc.
 */
import type { CustomerFlagType } from '../../components/kit';

export type ReservationKind = 'booking' | 'hold' | 'maintenance';

export interface ReservationRow {
  id: string;
  court_id: string;
  kind: ReservationKind;
  status: string;
  start_at: string;
  end_at: string;
  guest_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  price_iqd: number | null;
  hold_expires_at: string | null;
  notes: string | null;
  /** Added by migration 0066; absent on older rows/servers. */
  series_id?: string | null;
  source?: 'mobile' | 'desk' | string;
}

export const RESERVATION_COLUMNS =
  'id, court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone, price_iqd, hold_expires_at, notes';

/** A tab row, as far as the desk needs it: does this booking's tab exist and is it settled? */
export interface TabLinkRow {
  reservation_id: string | null;
  status: 'open' | 'awaiting_payment' | 'settled' | 'void' | string;
}

// ---------------------------------------------------------------------------
// 0065 customers (build plan §4)
// ---------------------------------------------------------------------------

export interface CustomerFlag {
  type: CustomerFlagType | string;
  label?: string | null;
}

export interface CustomerCounts {
  bookings: number;
  cancellations: number;
  noShows: number;
  cafeOrders?: number;
}

export interface CustomerSearchRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_lang: 'en' | 'ar' | string | null;
  flags: CustomerFlag[];
  counts: CustomerCounts;
}

/** `customer_notes` as customer_record returns them (0065): author + editor resolved to staff display names. */
export interface CustomerNote {
  id: string;
  body: string;
  author_id: string | null;
  author_name?: string | null;
  created_at: string;
  edited_at?: string | null;
  edited_by?: string | null;
  edited_by_name?: string | null;
}

/** `app.customer_reservation_json` (0065) — a reservation as the customer record and series detail carry it. */
export interface CustomerReservationRow {
  id: string;
  court_id: string;
  court_name_en?: string;
  court_name_ar?: string;
  start_at: string;
  end_at: string;
  status: string;
  kind: ReservationKind | string;
  price_iqd: number | null;
  source?: 'mobile' | 'desk' | string;
}

export interface CustomerRecord {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    preferred_lang: 'en' | 'ar' | string | null;
    created_at?: string | null;
  };
  flags: CustomerFlag[];
  counts: CustomerCounts;
  upcoming: CustomerReservationRow[];
  history: CustomerReservationRow[];
  cafeOrders: { id: string; opened_at: string; total_iqd: number | null; status: string; reservation_id: string | null }[];
  notes: CustomerNote[];
  /** Empty in 0065; the series lane fills it. */
  series: { id: string; pattern: string; starts_on: string; ends_on: string; court_id: string; occurrences?: number; cancelled_at?: string | null }[];
}

// ---------------------------------------------------------------------------
// 0066 series
// ---------------------------------------------------------------------------

export type SeriesPattern = 'weekly' | 'fortnightly' | 'weekdays';

export interface SeriesConflict {
  existingReservationId: string;
  resolvable: boolean;
  alternativeCourtIds: string[];
}

export interface SeriesOccurrencePreview {
  date: string;
  startsAt: string;
  endsAt: string;
  conflict: SeriesConflict | null;
}

export interface SeriesPreview {
  occurrences: SeriesOccurrencePreview[];
}

export type SeriesResolution = { date: string; action: 'skip' } | { date: string; action: 'moveCourt'; courtId: string };

export interface SeriesCreateResult {
  seriesId: string;
  created: string[];
  skipped: string[];
}

/** `reservation_series` row (0066) plus the court names series_detail appends. */
export interface SeriesRow {
  id: string;
  court_id: string;
  court_name_en?: string;
  court_name_ar?: string;
  pattern: SeriesPattern | string;
  weekdays: number[] | null;
  start_time: string;
  duration_min: number;
  starts_on: string;
  ends_on: string;
  guest_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  notes: string | null;
  created_at?: string;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
}

export interface SeriesOccurrence extends CustomerReservationRow {
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  /** end_at < now() — the server decides; played occurrences are untouchable. */
  played: boolean;
}

export interface SeriesDetail {
  series: SeriesRow;
  occurrences: SeriesOccurrence[];
}
