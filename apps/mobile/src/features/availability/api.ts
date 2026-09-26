/**
 * Availability reads. Query fns take the typed client as an argument
 * (testable without RN); hooks.ts binds them to the app singleton.
 *
 * Per branch since multi-venue slice 4: `venue_settings_public`, `courts` and
 * `rate_rules` hold one branch's rows each (guests only ever read OPEN
 * branches, 0225), so every read that belongs to the grid takes the branch.
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
import { toBranches, type Branch } from './branch';

type Client = SupabaseClient<Database>;

/**
 * Every open branch: the view has one row per branch (0208). NEVER `.single()`
 * on this view any more — with two branches open it would fail outright.
 */
export async function fetchBranches(client: Client): Promise<Branch[]> {
  const { data, error } = await client.from('venue_settings_public').select('*');
  if (error) throw error;
  return toBranches((data ?? []) as unknown as Record<string, unknown>[]);
}

/**
 * One branch's settings row. '*' rather than a column list, so a column the
 * stack does not have yet degrades to an absent field rather than a 400.
 * `maybeSingle`: a branch that closed since the list was read is null, which
 * the screens already treat as "no settings" (default timezone, no phone).
 */
export async function fetchVenueSettings(
  client: Client,
  venueId: string,
): Promise<VenueSettingsPublic | null> {
  const { data, error } = await client
    .from('venue_settings_public')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as VenueSettingsPublic | null;
}

const COURT_COLUMNS =
  'id, venue_id, name_en, name_ar, description_en, description_ar, indoor, photo_path, duration_options, sort_order';

/** One branch's active courts, in their display order. */
export async function fetchCourts(client: Client, venueId: string): Promise<CourtRow[]> {
  const { data, error } = await client
    .from('courts')
    .select(COURT_COLUMNS)
    .eq('is_active', true)
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CourtRow[];
}

/**
 * The active courts of every open branch, for naming a reservation's court —
 * a guest's bookings can be at any branch, whichever one the picker shows.
 */
export async function fetchAllCourts(client: Client): Promise<CourtRow[]> {
  const { data, error } = await client
    .from('courts')
    .select(COURT_COLUMNS)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CourtRow[];
}

/**
 * Busy ranges overlapping a RANGE of venue-local days, via the no-PII
 * court_availability view (0008). Overlap test: start < windowEnd AND end > windowStart.
 *
 * The whole day strip in ONE request, rather than one request per chip. The
 * view returns only what is BUSY — bookings, holds, maintenance — so a week of
 * it is a couple of hundred rows on a two-court venue, which is one round trip
 * of much the same size as a single day's. Per-day fetching meant every day
 * chip the guest had not already visited waited on the network before it could
 * show anything, and over a phone connection that is the second-plus the guest
 * sees (owner, 2026-09-10). The grid for each date is still assembled
 * separately; only the fetch is shared.
 *
 * `toDate` is INCLUSIVE, and its window runs 36 h past that day's midnight —
 * enough to cover the trading night's post-midnight tail whatever the offset,
 * and the same margin the single-day version used.
 *
 * `courtIds` are the branch's courts: the view carries no venue, so the rows
 * are narrowed to them (no courts, no request).
 */
export async function fetchAvailabilityWindow(
  client: Client,
  courtIds: readonly string[],
  fromDate: string,
  toDate: string,
  tz: string,
): Promise<AvailabilityRow[]> {
  if (courtIds.length === 0) return [];
  const windowStart = wallTimeToUtc(fromDate, 0, tz);
  const windowEnd = new Date(wallTimeToUtc(toDate, 0, tz).getTime() + 36 * 3_600_000);
  const { data, error } = await client
    .from('court_availability')
    .select('court_id, start_at, end_at, kind')
    .in('court_id', [...courtIds])
    .lt('start_at', windowEnd.toISOString())
    .gt('end_at', windowStart.toISOString());
  if (error) throw error;
  return (data ?? []) as AvailabilityRow[];
}

/** One branch's active rate rules. */
export async function fetchRateRules(client: Client, venueId: string): Promise<RateRuleRow[]> {
  const { data, error } = await client
    .from('rate_rules')
    .select('id, court_id, days_of_week, start_time, end_time, priority, valid_from, valid_to, is_active')
    .eq('is_active', true)
    .eq('venue_id', venueId);
  if (error) throw error;
  return (data ?? []) as RateRuleRow[];
}

/** Rule prices (no venue column: matched to the branch's rules by `rule_id`). */
export async function fetchRatePrices(client: Client): Promise<RateRulePriceRow[]> {
  const { data, error } = await client
    .from('rate_rule_prices')
    .select('rule_id, duration_min, price_iqd');
  if (error) throw error;
  return (data ?? []) as RateRulePriceRow[];
}

/** The branch's degraded flag (app.is_degraded(p_venue), anon-callable). */
export async function fetchIsDegraded(client: Client, venueId: string): Promise<boolean> {
  const { data, error } = await client.schema('app').rpc('is_degraded', { p_venue: venueId });
  if (error) throw error;
  return data === true;
}
