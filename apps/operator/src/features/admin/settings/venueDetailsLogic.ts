/**
 * The booking rules are stored in whatever unit the column was born with —
 * seconds for the hold, hours for the cancellation window, days for how far
 * ahead a guest may book. A person reads "5 min", not "300 s", so each is said
 * in the largest unit it divides into exactly, up to `largest`: a 48-hour rule
 * stays "48 h" (it was set in hours, and "2 days" invites "which two?").
 */
import type { VenueAdminRow } from './venueQueries';

export type SpanUnit = 'days' | 'hours' | 'minutes' | 'seconds';

const SIZE: Record<SpanUnit, number> = { days: 86_400, hours: 3_600, minutes: 60, seconds: 1 };
const ORDER: readonly SpanUnit[] = ['days', 'hours', 'minutes', 'seconds'];

export function durationParts(totalSeconds: number, largest: SpanUnit = 'days'): { unit: SpanUnit; count: number } {
  const s = Math.max(0, Math.round(totalSeconds));
  for (const unit of ORDER.slice(ORDER.indexOf(largest))) {
    if (unit === 'seconds' || (s > 0 && s % SIZE[unit] === 0)) return { unit, count: s / SIZE[unit] };
  }
  return { unit: 'seconds', count: s };
}

// ---------------------------------------------------------------------------
// Editing (app.set_venue_details, 0104)
// ---------------------------------------------------------------------------


/** The editable fields as the owner types them: text, and numbers in the unit shown. */
export interface VenueDraft {
  venueName: string;
  phone: string;
  cancellationHours: string;
  holdMinutes: string;
  horizonDays: string;
  maxHolds: string;
}

export type VenueField = keyof VenueDraft;
export type VenueFieldError = 'nameLength' | 'phoneFormat' | 'wholeNumber' | 'range';

/**
 * The ranges app.set_venue_details enforces, in the units the form uses. The
 * hold is stored in seconds and edited in minutes (60..3600 s = 1..60 min).
 */
export const VENUE_RANGES: Record<'cancellationHours' | 'holdMinutes' | 'horizonDays' | 'maxHolds', { min: number; max: number }> = {
  cancellationHours: { min: 0, max: 168 },
  holdMinutes: { min: 1, max: 60 },
  horizonDays: { min: 0, max: 730 },
  maxHolds: { min: 1, max: 10 },
};

export function draftFromVenue(v: VenueAdminRow): VenueDraft {
  return {
    venueName: v.venue_name,
    phone: v.phone ?? '',
    cancellationHours: String(v.cancellation_window_hours),
    holdMinutes: String(Math.max(1, Math.round(v.hold_ttl_seconds / 60))),
    horizonDays: String(v.max_booking_horizon_days),
    maxHolds: String(v.max_live_holds_per_guest),
  };
}

export function venueDraftErrors(d: VenueDraft): Partial<Record<VenueField, VenueFieldError>> {
  const errors: Partial<Record<VenueField, VenueFieldError>> = {};
  const name = d.venueName.trim();
  if (name.length < 2 || name.length > 80) errors.venueName = 'nameLength';
  const phone = d.phone.trim();
  if (phone !== '' && !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.phone = 'phoneFormat';
  for (const key of Object.keys(VENUE_RANGES) as (keyof typeof VENUE_RANGES)[]) {
    const raw = d[key].trim();
    if (!/^\d+$/.test(raw)) {
      errors[key] = 'wholeNumber';
      continue;
    }
    const n = Number(raw);
    if (n < VENUE_RANGES[key].min || n > VENUE_RANGES[key].max) errors[key] = 'range';
  }
  return errors;
}

/** Only what changed, in the server's keys and units. Empty when nothing did. */
export function venuePatch(saved: VenueAdminRow, d: VenueDraft): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {};
  if (d.venueName.trim() !== saved.venue_name) patch.venue_name = d.venueName.trim();
  const phone = d.phone.trim() === '' ? null : d.phone.trim();
  if (phone !== (saved.phone ?? null)) patch.phone = phone;
  if (Number(d.cancellationHours) !== saved.cancellation_window_hours) patch.cancellation_window_hours = Number(d.cancellationHours);
  const holdSeconds = Number(d.holdMinutes) * 60;
  if (String(Math.max(1, Math.round(saved.hold_ttl_seconds / 60))) !== d.holdMinutes.trim()) patch.hold_ttl_seconds = holdSeconds;
  if (Number(d.horizonDays) !== saved.max_booking_horizon_days) patch.max_booking_horizon_days = Number(d.horizonDays);
  if (Number(d.maxHolds) !== saved.max_live_holds_per_guest) patch.max_live_holds_per_guest = Number(d.maxHolds);
  return patch;
}
