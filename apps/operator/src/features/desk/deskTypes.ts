/**
 * Row shapes the desk screens share. `reservations` is read directly (RLS
 * lets staff see the whole table); writes go through mutate() / appRpc.
 */
import type { CustomerFlagType } from '../../components/kit';

/**
 * `lesson` (coaching, R13): a lesson's court row (`guest_id` null, `guest_name`
 * exactly 'Lesson'). Lessons are changed from their own screen only; the desk
 * learns which rows are lessons from `desk_lessons` and from this kind.
 */
export type ReservationKind = 'booking' | 'hold' | 'maintenance' | 'lesson';

export interface ReservationRow {
  id: string;
  court_id: string;
  kind: ReservationKind;
  status: string;
  start_at: string;
  end_at: string;
  guest_id: string | null;
  /** Walk-in name typed at the desk. A booking made from an account leaves this null — see `guest`. */
  guest_name: string | null;
  /**
   * The account the booking was made from, joined through `guest_id`. Absent on
   * rows a previous build cached offline, so readers go through `guestNameOf`.
   */
  guest?: { full_name: string | null } | null;
  guest_phone: string | null;
  price_iqd: number | null;
  hold_expires_at: string | null;
  notes: string | null;
  /** Added by migration 0066; absent on older rows/servers. */
  series_id?: string | null;
  /**
   * A lesson's court row (0278): present only where a screen selects `*`
   * (BookingDetail); never in RESERVATION_COLUMNS, which a server without
   * coaching could not answer (coaching operator.md §5.1).
   */
  lesson_id?: string | null;
  source?: 'mobile' | 'desk' | string;
}

export const RESERVATION_COLUMNS =
  'id, court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone, price_iqd, hold_expires_at, notes,' +
  ' guest:profiles!reservations_guest_id_fkey(full_name)';

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
  /** Since 0262 this includes the customer's open-match seat no-shows (DF-12, DF-15). */
  noShows: number;
  cafeOrders?: number;
  /** Open matches (0262 customer_counts); absent from an older server. */
  matchesPlayed?: number;
  /** The part of `noShows` that was an open-match seat. */
  matchNoShows?: number;
  /** Open-match seats left after booking that nobody took over. */
  lateLeaves?: number;
}

/** profiles.gender (0256): what open matches of a category the player may join (OM-39). */
export type CustomerGender = 'female' | 'male';
/** Who declared it: the guest in the app, or the desk (staff_set_customer_gender). */
export type CustomerGenderSource = 'guest' | 'staff';

export interface CustomerSearchRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_lang: 'en' | 'ar' | string | null;
  flags: CustomerFlag[];
  counts: CustomerCounts;
  /** 0262; absent from an older server. */
  gender?: CustomerGender | string | null;
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
    /** 0262 (OM-39); both absent from an older server. */
    gender?: CustomerGender | string | null;
    gender_set_by?: CustomerGenderSource | string | null;
  };
  flags: CustomerFlag[];
  counts: CustomerCounts;
  upcoming: CustomerReservationRow[];
  history: CustomerReservationRow[];
  cafeOrders: { id: string; opened_at: string; total_iqd: number | null; status: string; reservation_id: string | null }[];
  notes: CustomerNote[];
  /** Empty in 0065; the series lane fills it. */
  series: { id: string; pattern: string; starts_on: string; ends_on: string; court_id: string; occurrences?: number; cancelled_at?: string | null }[];
  /** 0262: the customer's last 20 open matches, at every branch; absent from an older server. */
  matches?: CustomerMatchRow[];
}

/** One `customer_record.matches[]` row (open matches db.md §4.7.13). */
export interface CustomerMatchRow {
  match_id: string;
  reservation_id: string | null;
  venue_id: string | null;
  /** matches.status */
  status: string;
  start_at: string;
  end_at: string | null;
  /** `open`, `women`, `men` */
  category: string;
  /** Their seat's match_seats.status */
  seat_status: string | null;
  /** Their seat's match_seats.kind */
  kind: string | null;
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
