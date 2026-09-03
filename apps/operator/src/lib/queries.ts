/**
 * Shared query keys and the fetchers that own them.
 *
 * WHY THIS FILE EXISTS. The app has one global `QueryClient` with a 10-second
 * `staleTime`, and three keys were being used from two features each with
 * DIFFERENT filters and column sets. Whichever screen you visited first won,
 * and the second screen silently rendered the first one's rows:
 *
 *   ['cafeTables'] — the till selected 2 columns WHERE is_active = true; the QR
 *     admin selected 5 columns including inactive rows. Visit QR admin, then
 *     open the till: the new-tab table picker offers tables that are switched
 *     off.
 *   ['settings'] — the desk calendar needs `timezone`; the opening-hours editor
 *     did not select it. Prime the cache from the editor and the calendar reads
 *     `timezone` as undefined and silently falls back to a hard-coded constant —
 *     the whole grid renders in the wrong timezone, with no error anywhere.
 *   ['courts'] — the desk calendar orders by `sort_order`; the rate editor did
 *     not select it.
 *
 * The rule this file enforces: **one key, one shape.** Where two screens want
 * the same rows they share a fetcher here (selecting the union of the columns,
 * which costs nothing on tables this size). Where they genuinely want different
 * rows, they get different keys.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { OpeningHours } from '@touch/core';
import { supabase } from './supabase';
import { cachedQuery } from './refCache';

// ---------------------------------------------------------------------------
// Key registry — every shared key in one place, so a collision is visible.
// Feature-private keys (['tab', id], ['profilesSearch', q], the analytics tree)
// stay in their own modules; they are not shared and cannot collide.
// ---------------------------------------------------------------------------
export const QK = {
  /** venue_settings_public, one row: timezone + hours + closed dates. */
  venueSettings: ['venueSettings'] as const satisfies QueryKey,
  /** Active courts, ordered for display. */
  courts: ['courts'] as const satisfies QueryKey,
  /** The open (or closing) day session, or null. */
  day: ['day'] as const satisfies QueryKey,
  /** ACTIVE cafe tables only — the till's table picker. */
  activeCafeTables: ['cafeTables', 'active'] as const satisfies QueryKey,
  /** ALL cafe tables including inactive — the QR admin's editor. */
  allCafeTables: ['cafeTables', 'all'] as const satisfies QueryKey,
} as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface VenueSettingsRow {
  timezone: string;
  opening_hours: OpeningHours;
  closed_dates: string[] | null;
}

export interface CourtRow {
  id: string;
  name_en: string;
  name_ar: string;
  duration_options: number[];
  sort_order: number;
}

export interface DaySessionRow {
  id: string;
  status: string;
  business_date: string;
  opened_at: string;
  opening_float_iqd: number;
}

// ---------------------------------------------------------------------------
// Fetchers — pass to useQuery as { queryKey, queryFn }
// ---------------------------------------------------------------------------

/**
 * The venue's timezone, opening hours and closed dates. `timezone` is in the
 * select on purpose even for callers that do not need it: it is the column the
 * desk calendar silently lost when a narrower query shared this key.
 */
export async function fetchVenueSettings(): Promise<VenueSettingsRow> {
  const { data, error } = await supabase
    .from('venue_settings_public')
    .select('timezone, opening_hours, closed_dates')
    .single();
  if (error) throw error;
  return data as unknown as VenueSettingsRow;
}

export async function fetchActiveCourts(): Promise<CourtRow[]> {
  // cachedQuery: the desk keeps its court list through an outage (SOW L671).
  return cachedQuery('courts', async () => {
    const { data, error } = await supabase
      .from('courts')
      .select('id, name_en, name_ar, duration_options, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    return data as unknown as CourtRow[];
  });
}

/** The day session the till and day-close screen both work against.
 *  cachedQuery: "no business day is open" must mean the day is closed, never
 *  that the network died — the till keeps trading against the cached day. */
export async function fetchOpenDay(): Promise<DaySessionRow | null> {
  return cachedQuery('day', async () => {
    const { data, error } = await supabase
      .from('day_sessions')
      .select('id, status, business_date, opened_at, opening_float_iqd')
      .in('status', ['open', 'closing'])
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as DaySessionRow | null;
  });
}

export interface ActiveTableRow {
  id: string;
  table_number: string;
}

/** Tables a guest could actually be seated at — the till's picker. */
export async function fetchActiveCafeTables(): Promise<ActiveTableRow[]> {
  return cachedQuery('tables', async () => {
    const { data, error } = await supabase
      .from('cafe_tables')
      .select('id, table_number')
      .eq('is_active', true)
      .order('table_number');
    if (error) throw error;
    return data as ActiveTableRow[];
  });
}
