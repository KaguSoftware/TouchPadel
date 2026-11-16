/**
 * Staff clock-in reads and writes (0442, docs/design/clock-in/contracts-2026-11-15.md §3). Every
 * call names the branch in scope (`currentBranchId()`); keys sit under ['clock'] so one
 * invalidation after a write refreshes them all.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { WeekShift } from '@touch/core/staff/clock';
import { appRpc } from '../../lib/appRpc';
import { currentBranchId } from '../../lib/venueScope';
import { isObject, list, num, str } from '../roleExtras/roleExtrasLogic';

export const CK = {
  all: ['clock'] as const satisfies QueryKey,
  setup: (branch: string | null) => ['clock', 'setup', branch] as const satisfies QueryKey,
  shifts: (branch: string | null, staffId: string) => ['clock', 'shifts', branch, staffId] as const satisfies QueryKey,
  day: (branch: string | null, date: string | null) => ['clock', 'day', branch, date ?? 'today'] as const satisfies QueryKey,
} as const;

export interface ClockPlace {
  lat: number;
  lng: number;
  radiusM: number;
  maxAccuracyM: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface ClockStation {
  stationId: string;
  isTill: boolean;
  hasKey: boolean;
  issuedAt: string | null;
  issuedByName: string | null;
}

export interface ClockSetup {
  place: ClockPlace | null;
  stations: ClockStation[];
  canEditPlace: boolean;
}

export function readClockSetup(payload: unknown): ClockSetup {
  const p = isObject(payload) ? payload : {};
  const pl = isObject(p.place) ? p.place : null;
  const lat = pl ? num(pl.lat) : null;
  const lng = pl ? num(pl.lng) : null;
  return {
    place:
      pl && lat !== null && lng !== null
        ? {
            lat,
            lng,
            radiusM: num(pl.radius_m) ?? 120,
            maxAccuracyM: num(pl.max_accuracy_m) ?? 60,
            updatedAt: str(pl.updated_at),
            updatedByName: str(pl.updated_by_name),
          }
        : null,
    stations: list(p.stations)
      .filter((s) => typeof s.station_id === 'string')
      .map((s) => ({
        stationId: str(s.station_id) ?? '',
        isTill: s.is_till === true,
        hasKey: s.has_key === true,
        issuedAt: str(s.issued_at),
        issuedByName: str(s.issued_by_name),
      })),
    canEditPlace: p.can_edit_place === true,
  };
}

export async function fetchClockSetup(): Promise<ClockSetup> {
  return readClockSetup(await appRpc<unknown>('clock_setup', { p_venue_id: currentBranchId() }));
}

export function saveClockPlace(v: { lat: number; lng: number; radiusM: number; maxAccuracyM: number }): Promise<unknown> {
  return appRpc('set_clock_place', {
    p_venue_id: currentBranchId(),
    p_lat: v.lat,
    p_lng: v.lng,
    p_radius_m: v.radiusM,
    p_max_accuracy_m: v.maxAccuracyM,
  });
}

/** The secret comes back this once; the caller keeps it on the machine. */
export async function issueStationKey(stationId: string): Promise<{ secret: string; replaced: boolean }> {
  const r = await appRpc<unknown>('issue_station_clock_key', { p_station_id: stationId });
  const o = isObject(r) ? r : {};
  const secret = str(o.secret);
  if (!secret) throw new Error('clock: no secret in the answer');
  return { secret, replaced: o.replaced === true };
}

export function fetchShifts(staffId: string): Promise<unknown> {
  return appRpc<unknown>('staff_shifts_get', { p_venue_id: currentBranchId(), p_staff_id: staffId });
}

export function saveShifts(staffId: string, shifts: WeekShift[]): Promise<unknown> {
  return appRpc('set_staff_shifts', { p_venue_id: currentBranchId(), p_staff_id: staffId, p_shifts: shifts });
}

/** `null` is the branch's today. */
export function fetchClockDay(date: string | null): Promise<unknown> {
  return appRpc<unknown>('clock_day', date === null ? { p_venue_id: currentBranchId() } : { p_venue_id: currentBranchId(), p_date: date });
}

export function resetClockDevice(staffId: string): Promise<unknown> {
  return appRpc('clock_reset_device', { p_venue_id: currentBranchId(), p_staff_id: staffId });
}
