/**
 * How a report figure goes into the exported file (F-14, Majed 2026-11-01:
 * "fix all report export bugs"). The screen formats a figure for reading; the
 * file keeps the number, in the unit its header names:
 *
 *   - a `…Minutes` figure is shown as hours ("15.5 h", hoursOf) and its column
 *     is headed in hours, so the file holds hours too, one decimal, not the
 *     minutes (a 60x error before);
 *   - a `…Pct` figure (15.4 meaning 15.4 per cent) is a percent column: the
 *     workbook's 0.0"%" format, one decimal and the sign, as formatPercent shows
 *     it on screen, instead of a whole number with no sign.
 */
import type { SheetColumn } from '../analytics/xlsx';

/** Minutes as hours, one decimal, the same rounding as hoursOf on screen. */
export function minutesToHours(minutes: number | null): number | null {
  return minutes === null ? null : Math.round(minutes / 6) / 10;
}

/** The file's column type for a figure key, or undefined for the default (money / count). */
export function csvTypeForKey(key: string): SheetColumn['type'] | undefined {
  if (key.endsWith('Pct')) return 'percent';
  if (key.endsWith('Minutes')) return 'decimal';
  return undefined;
}

/** The file's value for a figure key: minutes become hours, everything else as the server sent it. */
export function csvValueForKey(key: string, value: number | null): number | null {
  return key.endsWith('Minutes') ? minutesToHours(value) : value;
}
