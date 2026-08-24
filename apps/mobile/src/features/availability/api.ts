/**
 * Availability reads. Query fns take the typed client as an argument
 * (testable without RN); hooks.ts binds them to the app singleton.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { wallTimeToUtc } from '@touch/core';
import type {
  AvailabilityRow,
  CourtRow,
  RateRulePriceRow,
  RateRuleRow,
  VenueSettingsPublic,
} from './assemble';

type Client = SupabaseClient<Database>;

export async function fetchVenueSettings(client: Client): Promise<VenueSettingsPublic> {
  const { data, error } = await client
    .from('venue_settings_public')
    .select('venue_name, timezone, opening_hours, closed_dates, cancellation_window_hours')
    .single();
  if (error) throw error;
  return data as VenueSettingsPublic;
}

export async function fetchCourts(client: Client): Promise<CourtRow[]> {
  const { data, error } = await client
    .from('courts')
    .select(
      'id, name_en, name_ar, description_en, description_ar, indoor, photo_path, duration_options, sort_order',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CourtRow[];
}

/**
 * Busy ranges overlapping one venue-local day, via the no-PII
 * court_availability view (0008). Overlap test: start < dayEnd AND end > dayStart.
 */
export async function fetchDayAvailability(
  client: Client,
  date: string,
  tz: string,
): Promise<AvailabilityRow[]> {
  const dayStart = wallTimeToUtc(date, 0, tz);
  const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000); // covers DST-less +1 day safely
  const { data, error } = await client
    .from('court_availability')
    .select('court_id, start_at, end_at, kind')
    .lt('start_at', dayEnd.toISOString())
    .gt('end_at', dayStart.toISOString());
  if (error) throw error;
  return (data ?? []) as AvailabilityRow[];
}

export async function fetchRateRules(client: Client): Promise<RateRuleRow[]> {
  const { data, error } = await client
    .from('rate_rules')
    .select('id, court_id, days_of_week, start_time, end_time, priority, valid_from, valid_to, is_active')
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []) as RateRuleRow[];
}

export async function fetchRatePrices(client: Client): Promise<RateRulePriceRow[]> {
  const { data, error } = await client
    .from('rate_rule_prices')
    .select('rule_id, duration_min, price_iqd');
  if (error) throw error;
  return (data ?? []) as RateRulePriceRow[];
}
