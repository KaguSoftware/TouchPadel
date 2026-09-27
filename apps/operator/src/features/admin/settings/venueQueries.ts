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
  heartbeat_stale_seconds: number;
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
    .select('venue_name, currency, timezone, phone, tax_inclusive, cancellation_window_hours, hold_ttl_seconds, protected_horizon_hours, heartbeat_stale_seconds, max_booking_horizon_days, max_live_holds_per_guest')
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

// ---------------------------------------------------------------------------
// Devices (0118 / C2): the heartbeat rows behind degraded mode, owner-retirable.
// ---------------------------------------------------------------------------
export const DEVICES_KEY: QueryKey = ['deviceHeartbeats', 'admin'];

export interface DeviceRow {
  device_id: string;
  last_seen_at: string;
  queue_depth: number;
  app_version: string | null;
  is_till: boolean;
  staff_id: string | null;
}

export async function fetchDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from('device_heartbeats')
    .select('device_id, last_seen_at, queue_depth, app_version, is_till, staff_id')
    .order('device_id');
  if (error) throw error;
  return (data ?? []) as DeviceRow[];
}

/** A till is the flag OR the legacy name (app.is_degraded reads both, 0026). */
export function isTillDevice(d: Pick<DeviceRow, 'device_id' | 'is_till'>): boolean {
  return d.is_till || d.device_id.startsWith('TILL');
}

/** Stale the way the server counts it: older than heartbeat_stale_seconds. */
export function isStaleDevice(d: Pick<DeviceRow, 'last_seen_at'>, staleSeconds: number, now = Date.now()): boolean {
  return now - new Date(d.last_seen_at).getTime() > staleSeconds * 1000;
}
