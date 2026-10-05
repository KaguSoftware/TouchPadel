/**
 * Date of birth (Edit profile, 0302): the server stores a calendar date,
 * `YYYY-MM-DD`, from 1900-01-01 to today. The picker works in `Date`s, so a
 * date travels as noon UTC and is shown and picked in UTC: noon keeps it on the
 * same calendar day whatever zone a formatter or the platform picker leans on.
 */

/** The zone the date of birth is shown and picked in. */
export const BIRTH_TZ = 'UTC';
export const BIRTH_MIN = '1900-01-01';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → that day at 12:00 UTC; null for anything else. */
export function birthDateToDate(value: string | null | undefined): Date | null {
  const m = value ? ISO_DATE.exec(value) : null;
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return dateToBirthDate(date) === value ? date : null;
}

/** A picked `Date` → its UTC calendar day, `YYYY-MM-DD`. */
export function dateToBirthDate(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's calendar day, `YYYY-MM-DD`, for the picker's upper bound. */
export function todayBirthDate(now: Date = new Date()): string {
  return dateToBirthDate(now);
}

/** The server's range, 1900-01-01 .. today. */
export function isValidBirthDate(value: string, now: Date = new Date()): boolean {
  return birthDateToDate(value) !== null && value >= BIRTH_MIN && value <= todayBirthDate(now);
}

/** Where the picker opens when nothing is set yet: 25 years before today. */
export function defaultBirthDate(now: Date = new Date()): string {
  return `${String(now.getUTCFullYear() - 25).padStart(4, '0')}-01-01`;
}

/**
 * SwiftUI's wheel (`DateWheelSheet.ios.tsx`) takes no time zone: it shows and
 * picks in the PHONE's. So the day goes in as local noon and comes back by its
 * local calendar fields, never through UTC, which would slip a day east of +12.
 */
export function birthDateToLocalDate(value: string | null | undefined): Date | null {
  const utc = birthDateToDate(value);
  return utc ? new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12) : null;
}

/** A `Date` picked on the phone's own calendar → that local day, `YYYY-MM-DD`. */
export function localDateToBirthDate(date: Date): string {
  return dateToBirthDate(
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)),
  );
}
