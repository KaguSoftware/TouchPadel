/**
 * Read models for the trading and contact tabs. `venue_settings` (base table,
 * manager|owner read) and `tax_groups`. Both report-only here: the only write
 * paths that exist are `set_opening_hours` (hours tab) and
 * `set_waiter_call_cooldown` / `set_cafe_setting(s)` (cafe tab).
 */
import type { QueryKey } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export const VENUE_ADMIN_KEY: QueryKey = ['venueSettingsAdmin'];
export const TAX_GROUPS_KEY: QueryKey = ['taxGroups', 'admin'];

export interface VenueAdminRow {
  venue_name: string;
  currency: string;
  timezone: string;
  phone: string | null;
  tax_inclusive: boolean;
  cancellation_window_hours: number;
  hold_ttl_seconds: number;
  protected_horizon_hours: number;
  max_booking_horizon_days: number;
  max_live_holds_per_guest: number;
}

export interface TaxGroupRow {
  id: string;
  name_en: string;
  name_ar: string;
  rate_bp: number;
  is_active: boolean;
}

export async function fetchVenueAdmin(): Promise<VenueAdminRow> {
  const { data, error } = await supabase
    .from('venue_settings')
    .select('venue_name, currency, timezone, phone, tax_inclusive, cancellation_window_hours, hold_ttl_seconds, protected_horizon_hours, max_booking_horizon_days, max_live_holds_per_guest')
    .single();
  if (error) throw error;
  return data as VenueAdminRow;
}

export async function fetchTaxGroups(): Promise<TaxGroupRow[]> {
  const { data, error } = await supabase.from('tax_groups').select('id, name_en, name_ar, rate_bp, is_active').order('name_en');
  if (error) throw error;
  return (data ?? []) as TaxGroupRow[];
}

/** Basis points → percent for display only (1000 bp = 10%). Not money. */
export function bpToPercent(bp: number): number {
  return bp / 100;
}
